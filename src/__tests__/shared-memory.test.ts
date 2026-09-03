import { describe, expect, it } from "vitest"
import { KNOWN_RULE_IDS, KNOWN_RULE_SET } from "../../api/_rules.js"
import { RULES } from "../audit/lenses"
import { auditDocument, auditHTML, auditKey, splitAuditKey } from "../audit/run"

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

describe("a page that never renders must not read as clean", () => {
  it("flags a render failure instead of reporting zero findings", async () => {
    // The bug: a blind 1200ms timeout raced the iframe load, so a slow page
    // was measured before its body existed. Zero findings then looked exactly
    // like a clean page, which is the one thing this project refuses to do.
    const out = await auditHTML("", { label: "https://empty.example", remember: false })
    expect(out.renderFailed).toBe(true)
    expect(out.totals.findings).toBe(0)
    // The notes have to say so loudly, because the number alone is misleading.
    expect(out.notes.join(" ")).toMatch(/RENDER FAILED/)
    expect(out.notes.join(" ")).toMatch(/not a clean result/i)
  })

  it("does not publish shared memory for a page it could not render", async () => {
    const out = await auditHTML("", { label: "https://empty.example", remember: false })
    // No key means splitAuditKey refuses it, so nothing reaches the endpoint.
    expect(splitAuditKey(out.key)).toBeNull()
  })

  // The happy path cannot be asserted here: jsdom does not render srcdoc, so
  // the frame's body stays empty and every auditHTML call looks like a render
  // failure. That is also why this path went untested long enough for the
  // 1200ms race to survive - nothing in the suite touched auditHTML at all.
  // It is verified in a real browser against the live deployment instead, and
  // the result is recorded in VERIFICATION.md.
  it("measures a document it is handed directly, which is testable here", () => {
    document.body.innerHTML = `<main><form><input name="permit_ref" required><button>Pay now</button></form></main>`
    const out = auditDocument(document, { label: "https://real.example", remember: false })
    expect(out.renderFailed).toBeUndefined()
    expect(splitAuditKey(out.key)).not.toBeNull()
    expect(out.totals.checked).toBeGreaterThan(0)
  })
})


describe("the audit key describes the page that was audited", () => {
  // The bug this guards: the caller used to recompute the key with
  // auditKey(document, origin), fingerprinting Yolo Learn's own DOM instead of
  // the audited page's. Every audited URL on one origin would then collide on a
  // single fingerprint, and the fingerprint would never change when the target
  // page did, so shared memory would have been keyed on the wrong thing
  // entirely. The key is now computed from the audited document and returned on
  // the result rather than rederived by the caller.
  //
  // auditHTML itself cannot be exercised here: it renders into an iframe, and
  // jsdom does not lay out srcdoc frames, so it correctly takes its
  // RENDER FAILED path. The browser verifies that end. These test the
  // fingerprinting the key is built from.
  const parse = (html: string) => new DOMParser().parseFromString(html, "text/html")
  const FORM_A = `<form><label>Name <input name="name"></label><button>Next</button></form>`
  const FORM_B = `<form><label>PO <input name="po_ref"></label><label>SKU <input name="sku"></label><button>Order</button></form>`

  it("differs for different markup under the same label", () => {
    expect(auditKey(parse(FORM_A), "https://same.example.com")).not.toBe(
      auditKey(parse(FORM_B), "https://same.example.com")
    )
  })

  it("is stable for the same markup, so a second look finds the first", () => {
    expect(auditKey(parse(FORM_A), "https://same.example.com")).toBe(
      auditKey(parse(FORM_A), "https://same.example.com")
    )
  })

  it("differs for the same markup under different labels", () => {
    expect(auditKey(parse(FORM_A), "https://a.example.com")).not.toBe(
      auditKey(parse(FORM_A), "https://b.example.com")
    )
  })

  it("yields a key the memory endpoint accepts, origin intact", () => {
    const parts = splitAuditKey(auditKey(parse(FORM_A), "https://ok.example.com"))
    expect(parts).not.toBeNull()
    expect(parts!.origin).toBe("https://ok.example.com")
    expect(parts!.fingerprint).toMatch(/^[a-z0-9]{1,16}$/)
  })

  it("cannot be published when the label is not an origin", () => {
    // The pasted path labels its audits "pasted", which must never reach the
    // shared store dressed as a real site.
    expect(splitAuditKey(auditKey(parse(FORM_A), "pasted"))).toBeNull()
  })

  it("publishes nothing for a page that never rendered", async () => {
    // An unmeasured page must not contribute to shared memory. Its key is
    // empty, and splitAuditKey refuses it.
    const out = await auditHTML(FORM_A, { label: "https://render-fail.example.com", remember: false })
    expect(out.notes.join(" ")).toContain("RENDER FAILED")
    expect(splitAuditKey(out.key)).toBeNull()
  })
})
