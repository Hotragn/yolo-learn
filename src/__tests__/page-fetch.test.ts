import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { EXAMPLE_PUBLIC_FORM, explainReadFailure, fetchRemotePage } from "../page-fetch"

/**
 * This module exists for one reason: nobody evaluating this should ever be
 * shown a raw parse stack. A missing API, an HTML error page and a JS-only
 * site are three completely different failures that all arrive looking like
 * "Unexpected token < in JSON", and each needs its own sentence.
 */

const realFetch = globalThis.fetch

function respond(body: unknown, { type = "application/json", throws = false } = {}) {
  globalThis.fetch = vi.fn(async () => {
    if (throws) throw new Error("Failed to fetch")
    return {
      headers: { get: () => type },
      json: async () => {
        if (typeof body === "string") throw new Error(body)
        return body
      },
    } as unknown as Response
  }) as typeof fetch
}

beforeEach(() => {
  vi.restoreAllMocks()
})
afterEach(() => {
  globalThis.fetch = realFetch
})

describe("explainReadFailure turns machinery into a sentence", () => {
  it("catches every shape of 'the endpoint is not there'", () => {
    for (const raw of [
      "Unexpected token < in JSON at position 0",
      "SyntaxError: Unexpected token '<'",
      "<!DOCTYPE html> was returned",
      "The fetch endpoint did not return JSON.",
      "is /api/fetch-page running?",
      "not valid JSON",
    ]) {
      expect(explainReadFailure(raw)).toMatch(/page-read service did not answer/i)
    }
  })

  it("explains a rate limit as something to wait out", () => {
    expect(explainReadFailure("Too many requests from this address in the last minute.")).toMatch(
      /wait a moment/i
    )
  })

  it("explains an empty read as a logged-in or JS-only page", () => {
    for (const raw of [
      "No form controls in there.",
      "no readable fields",
      "No form on the first page.",
      "Still no form fields after render",
    ]) {
      const out = explainReadFailure(raw)
      expect(out).toMatch(/no form fields were found/i)
      expect(out).toMatch(/logged-in apps and OAuth screens/i)
    }
  })

  it("explains a timeout and a dead host differently, because the fix differs", () => {
    expect(explainReadFailure("The operation was aborted")).toMatch(/took too long/i)
    expect(explainReadFailure("Could not resolve nope.invalid.")).toMatch(/host could not be reached/i)
  })

  it("always offers a way forward", () => {
    for (const raw of ["Unexpected token <", "aborted", "Could not resolve x", "no readable fields"]) {
      expect(explainReadFailure(raw)).toMatch(/W3C survey example|wait a moment/i)
    }
  })

  it("passes through a message that is already clear, rather than flattening it", () => {
    const good = "example.com resolves to 127.0.0.1, which is a private or reserved address."
    expect(explainReadFailure(good)).toBe(good)
  })

  it("survives empty input", () => {
    expect(() => explainReadFailure("")).not.toThrow()
  })
})

describe("fetchRemotePage never leaks a stack", () => {
  it("returns the body untouched on success", async () => {
    respond({ html: "<form></form>", finalUrl: "https://x.example.com/", bytes: 12 })
    const r = await fetchRemotePage("https://x.example.com/")
    expect(r.html).toBe("<form></form>")
    expect(r.error).toBeUndefined()
  })

  it("catches an HTML error page served instead of JSON", async () => {
    respond({}, { type: "text/html" })
    const r = await fetchRemotePage("https://x.example.com/")
    expect(r.error).toMatch(/page-read service did not answer/i)
    expect(r.error).not.toMatch(/token|JSON\.parse|SyntaxError/i)
  })

  it("catches a body that is not parseable JSON", async () => {
    respond("Unexpected token < in JSON at position 0")
    const r = await fetchRemotePage("https://x.example.com/")
    expect(r.error).toMatch(/page-read service did not answer/i)
  })

  it("catches a network failure", async () => {
    respond({}, { throws: true })
    const r = await fetchRemotePage("https://x.example.com/")
    expect(r.error).toBeTruthy()
    expect(r.error).not.toContain("Failed to fetch")
  })

  it("humanises an error the server itself reported", async () => {
    respond({ error: "Too many requests from this address in the last minute." })
    const r = await fetchRemotePage("https://x.example.com/")
    expect(r.error).toMatch(/wait a moment/i)
  })

  it("keeps the rest of the body when the server reports an error", async () => {
    respond({ error: "Could not resolve nope.invalid.", finalUrl: "https://nope.invalid/" })
    const r = await fetchRemotePage("https://nope.invalid/")
    expect(r.finalUrl).toBe("https://nope.invalid/")
    expect(r.error).toMatch(/host could not be reached/i)
  })

  it("encodes the URL, so a query string does not corrupt the request", async () => {
    respond({ html: "<form></form>" })
    await fetchRemotePage("https://x.example.com/search?q=a&b=c#frag")
    const called = (globalThis.fetch as unknown as { mock: { calls: string[][] } }).mock.calls[0][0]
    expect(called).toContain(encodeURIComponent("https://x.example.com/search?q=a&b=c#frag"))
    // One query parameter only: the target's own & must not add another.
    expect(called.split("?").length).toBe(2)
    expect(called.split("&").length).toBe(1)
  })

  it("tolerates a response with no content-type header", async () => {
    globalThis.fetch = vi.fn(async () => ({
      headers: {},
      json: async () => ({ html: "<form></form>" }),
    })) as unknown as typeof fetch
    const r = await fetchRemotePage("https://x.example.com/")
    expect(r.html).toBe("<form></form>")
  })
})

describe("the fallback example offered in every failure message", () => {
  it("is a real https URL, since it is suggested to people who are stuck", () => {
    const u = new URL(EXAMPLE_PUBLIC_FORM)
    expect(u.protocol).toBe("https:")
    expect(u.hostname).toBe("www.w3.org")
  })
})
