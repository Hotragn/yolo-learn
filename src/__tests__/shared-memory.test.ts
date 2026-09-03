import { describe, expect, it } from "vitest"
import { KNOWN_RULE_IDS, KNOWN_RULE_SET } from "../../api/_rules.js"
import { RULES } from "../audit/lenses"
import { splitAuditKey } from "../audit/run"
import { auditKey } from "../audit/run"

describe("the shared-memory allow-list cannot drift from the real rules", () => {
  // api/_rules.js is plain JS because it runs in a serverless function, and
  // src/audit/lenses.ts is the actual source of rule ids. Two hand-maintained
  // lists always drift, so this asserts they cannot.
  const actual = Object.values(RULES).map((r) => r.id).sort()
  const allowed = [...KNOWN_RULE_IDS].sort()

  it("allows every rule the lenses can emit", () => {
    expect(allowed).toEqual(actual)
  })

  it("allows nothing the lenses cannot emit", () => {
    for (const id of KNOWN_RULE_IDS) {
      expect(actual).toContain(id)
    }
  })

  it("rejects anything not on the list, which is what makes storing ids safe", () => {
    expect(KNOWN_RULE_SET.has("wcag-1.4.3")).toBe(true)
    expect(KNOWN_RULE_SET.has("<script>alert(1)</script>")).toBe(false)
    expect(KNOWN_RULE_SET.has("wcag-1.4.3-but-evil")).toBe(false)
    expect(KNOWN_RULE_SET.has("")).toBe(false)
  })
})

describe("splitting an audit key for the endpoint", () => {
  function docOf(html: string): Document {
    document.body.innerHTML = html
    return document
  }

  it("round-trips a real audit key", () => {
    const key = auditKey(docOf(`<form><input name="a"><button>Next</button></form>`), "https://example.com")
    const parts = splitAuditKey(key)
    expect(parts).not.toBeNull()
    expect(parts!.origin).toBe("https://example.com")
    expect(parts!.fingerprint).toMatch(/^[a-z0-9]{1,16}$/)
  })

  it("refuses a label that is not an origin, so junk never reaches the endpoint", () => {
    // The pasted-HTML path uses "pasted" as its label, which must not be
    // published as though it were a real site.
    expect(splitAuditKey("pasted#abc123")).toBeNull()
    expect(splitAuditKey("https://example.com/with/a/path#abc")).toBeNull()
    expect(splitAuditKey("nohash")).toBeNull()
    expect(splitAuditKey("https://example.com#" + "x".repeat(20))).toBeNull()
  })

  it("keeps a port, because a different port is a different origin", () => {
    expect(splitAuditKey("http://localhost:5173#abc")?.origin).toBe("http://localhost:5173")
  })
})
