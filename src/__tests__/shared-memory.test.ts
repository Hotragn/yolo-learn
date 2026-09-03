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

describe("the audit key describes the audited page, not the caller's", () => {
  // The bug this guards against: the Audit view rederived the key by calling
  // auditKey(document, origin), which fingerprints the Yolo Learn page's own
  // DOM. Every audited URL on one origin then collapsed onto a single
  // fingerprint, and the fingerprint never changed when the target did.
  function keyFor(html: string, label: string): string {
    document.body.innerHTML = html
    return auditKey(document, label)
  }

  it("changes when the audited markup changes", () => {
    const a = keyFor(`<form><input name="one"><button>Next</button></form>`, "https://example.com")
    const b = keyFor(`<form><input name="one"><input name="two"><button>Next</button></form>`, "https://example.com")
    expect(a).not.toBe(b)
  })

  it("is stable for the same markup", () => {
    const html = `<form><input name="one"><button>Next</button></form>`
    expect(keyFor(html, "https://example.com")).toBe(keyFor(html, "https://example.com"))
  })

  it("separates two origins with identical markup", () => {
    const html = `<form><input name="one"><button>Next</button></form>`
    expect(keyFor(html, "https://a.example")).not.toBe(keyFor(html, "https://b.example"))
  })

  it("survives the round trip the endpoint requires", () => {
    const key = keyFor(`<form><input name="q"><button>Next</button></form>`, "https://www.w3.org")
    const parts = splitAuditKey(key)
    expect(parts).not.toBeNull()
    expect(parts!.origin).toBe("https://www.w3.org")
    expect(parts!.fingerprint).toMatch(/^[a-z0-9]{1,16}$/)
  })
})
