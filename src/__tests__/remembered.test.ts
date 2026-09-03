import { describe, expect, it } from "vitest"
import { rememberedDescription, toolNameForOrigin } from "../remembered"
import type { RemoteMemory } from "../remote"

/**
 * A learned origin becomes its own WebMCP tool, so this function decides a
 * name an agent will call. Two constraints follow from that and neither is
 * cosmetic: registerTool REJECTS a duplicate name with InvalidStateError, and
 * the same origin must produce the same name every session or a returning
 * user's tool would be re-minted under a new one.
 */

function memory(over: Partial<RemoteMemory> = {}): RemoteMemory {
  return {
    origin: "https://example.com",
    startUrl: "https://example.com/apply",
    fingerprint: "abc123",
    learnedAt: new Date().toISOString(),
    bytesRead: 466 * 1024,
    visits: 1,
    steps: [
      {
        order: 1,
        url: "https://example.com/apply",
        intent: "apply",
        submitLabel: "Continue",
        formCount: 1,
        refused: [],
        fields: [
          { label: "Email", purpose: "email", from: 'name="email"', required: true },
          { label: "Postcode", purpose: "postcode", from: 'name="postcode"', required: false },
        ],
      },
    ],
    ...over,
  }
}

describe("toolNameForOrigin", () => {
  it("names an origin after its host, with a digest that keeps it unique", () => {
    // The readable part is the host; the suffix is what stops two origins that
    // slug identically from claiming the same tool name.
    expect(toolNameForOrigin("https://example.com")).toMatch(/^remembered_example_com_[a-z0-9]{4}$/)
    expect(toolNameForOrigin("https://www.gov.uk")).toMatch(/^remembered_www_gov_uk_[a-z0-9]{4}$/)
  })

  it("is stable, so a returning user gets the same tool rather than a new one", () => {
    expect(toolNameForOrigin("https://example.com")).toBe(toolNameForOrigin("https://example.com"))
  })

  it("ignores the path, because memory is keyed by origin", () => {
    expect(toolNameForOrigin("https://example.com/a/b?c=d")).toBe(toolNameForOrigin("https://example.com"))
  })

  it("produces a name a tool registry will accept", () => {
    for (const origin of [
      "https://example.com",
      "https://sub.domain.co.uk",
      "https://my-site.example.org",
      "http://localhost:5173",
      "https://xn--bcher-kva.example",
    ]) {
      expect(toolNameForOrigin(origin)).toMatch(/^[a-z0-9_]+$/)
    }
  })

  it("stays inside the 64 character cap", () => {
    const long = "https://" + "a".repeat(200) + ".example.com"
    expect(toolNameForOrigin(long).length).toBeLessThanOrEqual(64)
  })

  it("does not collapse to a bare prefix when the host is unusable", () => {
    expect(toolNameForOrigin("")).toBe("remembered_site")
    expect(toolNameForOrigin("///")).toBe("remembered_site")
  })

  it("gives different hosts different names", () => {
    expect(toolNameForOrigin("https://a.example.com")).not.toBe(toolNameForOrigin("https://b.example.com"))
  })

  // registerTool rejects a duplicate name, so a collision is not cosmetic: the
  // second origin silently fails to mint, or worse, points at the first one's
  // memory. These are the cases where distinct origins slug identically.
  it.each([
    ["scheme differs", "http://example.com", "https://example.com"],
    ["port differs", "http://localhost:5173", "http://localhost:4173"],
    ["hyphen versus dot", "https://a-b.example.com", "https://a.b.example.com"],
  ])("distinguishes origins that differ only by %s", (_why, a, b) => {
    expect(toolNameForOrigin(a)).not.toBe(toolNameForOrigin(b))
  })
})

describe("rememberedDescription is what an agent reads to decide", () => {
  it("says where, how much, and what it holds", () => {
    const d = rememberedDescription(memory())
    expect(d).toContain("https://example.com")
    expect(d).toContain("1 step")
    expect(d).toContain("Email")
    expect(d).toContain("466KB")
  })

  it("states that the default call fetches nothing, which is the whole point", () => {
    expect(rememberedDescription(memory())).toMatch(/from memory and fetches nothing/i)
  })

  it("tells the agent how to refresh deliberately", () => {
    expect(rememberedDescription(memory())).toMatch(/refresh=true/i)
  })

  it("promises read-only, matching what the crawler actually does", () => {
    expect(rememberedDescription(memory())).toMatch(/never submits/i)
  })

  it("handles a memory with no readable fields without producing a dangling list", () => {
    const empty = memory({ steps: [{ ...memory().steps[0], fields: [] }] })
    const d = rememberedDescription(empty)
    expect(d).toContain("no readable fields")
    expect(d).not.toContain(": .")
  })

  it("falls back to purpose when a field had no visible label", () => {
    const unlabelled = memory({
      steps: [
        {
          ...memory().steps[0],
          fields: [{ label: "", purpose: "email", from: 'name="email"', required: true }],
        },
      ],
    })
    expect(rememberedDescription(unlabelled)).toContain("email")
  })
})
