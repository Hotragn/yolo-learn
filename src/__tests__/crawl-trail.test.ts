import { beforeEach, describe, expect, it, vi } from "vitest"

const fetchRemotePage = vi.fn()

vi.mock("../page-fetch", async (orig) => ({
  ...(await orig<typeof import("../page-fetch")>()),
  fetchRemotePage: (url: string) => fetchRemotePage(url),
}))

import { readPagesInOrder } from "../crawl"

/**
 * The hand-navigation path: the user browses a site themselves, then names the
 * pages they went through. There is no extension and nothing observes their
 * tab, so this is where the safety rails have to hold, because the input is a
 * list of URLs a person pasted.
 */

function formPage(heading: string, fields: string) {
  return `<h1>${heading}</h1><form method="post" action="/x">${fields}
          <button type="submit">Continue</button></form>`
}

const EMAIL = '<label for="e">Email</label><input id="e" name="email" required>'
const ADDRESS = '<label for="a">Address line 1</label><input id="a" name="address_line1" required>'

beforeEach(() => {
  fetchRemotePage.mockReset()
  fetchRemotePage.mockImplementation(async (url: string) => ({
    html: formPage("Step", EMAIL),
    finalUrl: url,
  }))
})

describe("it reads the pages in the order they were given", () => {
  it("keeps the user's ordering rather than re-deriving one", async () => {
    fetchRemotePage.mockImplementation(async (url: string) => ({
      html: url.endsWith("/two") ? formPage("Address", ADDRESS) : formPage("Contact", EMAIL),
      finalUrl: url,
    }))

    const r = await readPagesInOrder(["https://s.example.com/one", "https://s.example.com/two"])
    expect(r.ok).toBe(true)
    expect(r.steps.map((s) => s.order)).toEqual([1, 2])
    expect(r.steps[0].fields[0].purpose).toBe("email")
    expect(r.steps[1].fields[0].purpose).toBe("address line1")
  })

  it("records that each step was advanced by the next URL the user pasted", async () => {
    const r = await readPagesInOrder(["https://s.example.com/one", "https://s.example.com/two"])
    expect(r.steps[0].advancedBy).toBe("next URL you pasted")
    // Nothing follows the last page, so it claims no onward move.
    expect(r.steps[1].advancedBy).toBeUndefined()
  })

  it("counts the markup it actually read", async () => {
    const r = await readPagesInOrder(["https://s.example.com/one", "https://s.example.com/two"])
    expect(r.bytesRead).toBeGreaterThan(0)
    expect(fetchRemotePage).toHaveBeenCalledTimes(2)
  })
})

describe("the rails", () => {
  it("will not leave the first origin, whatever the list says", async () => {
    const r = await readPagesInOrder([
      "https://s.example.com/one",
      "https://evil.example.net/steal",
      "https://s.example.com/two",
    ])
    expect(fetchRemotePage).toHaveBeenCalledTimes(2)
    expect(fetchRemotePage).not.toHaveBeenCalledWith("https://evil.example.net/steal")
    expect(r.notes.join(" ")).toContain("not on https://s.example.com")
  })

  it("caps the trail, so a pasted wall of URLs cannot become a crawl", async () => {
    const many = Array.from({ length: 20 }, (_, i) => `https://s.example.com/p${i}`)
    await readPagesInOrder(many)
    expect(fetchRemotePage.mock.calls.length).toBeLessThanOrEqual(8)
  })

  it("reads a repeated URL once", async () => {
    await readPagesInOrder([
      "https://s.example.com/one",
      "https://s.example.com/one",
      "https://s.example.com/two",
    ])
    expect(fetchRemotePage).toHaveBeenCalledTimes(2)
  })

  it("skips a line that is not a URL instead of failing the whole trail", async () => {
    const r = await readPagesInOrder(["https://s.example.com/one", "notaurl", "https://s.example.com/two"])
    expect(r.ok).toBe(true)
    expect(r.steps).toHaveLength(2)
    expect(r.notes.join(" ")).toContain("not a URL")
  })

  it("declines when the first line is not a URL, since it sets the origin", async () => {
    const r = await readPagesInOrder(["notaurl", "https://s.example.com/one"])
    expect(r.ok).toBe(false)
    expect(r.stoppedBecause).toContain("first line is not a URL")
    expect(fetchRemotePage).not.toHaveBeenCalled()
  })

  it("asks for input rather than failing silently on an empty list", async () => {
    const r = await readPagesInOrder([])
    expect(r.ok).toBe(false)
    expect(r.stoppedBecause).toMatch(/at least one/i)
  })

  it("ignores blank lines from a sloppy paste", async () => {
    const r = await readPagesInOrder(["", "  ", "https://s.example.com/one", ""])
    expect(r.ok).toBe(true)
    expect(fetchRemotePage).toHaveBeenCalledTimes(1)
  })

  it("follows a redirect only while it stays on the origin", async () => {
    fetchRemotePage.mockImplementation(async (url: string) => ({
      html: formPage("Step", EMAIL),
      finalUrl: url.endsWith("/two") ? "https://elsewhere.example.net/landed" : url,
    }))

    const r = await readPagesInOrder(["https://s.example.com/one", "https://s.example.com/two"])
    expect(r.steps).toHaveLength(1)
    expect(r.notes.join(" ")).toContain("left https://s.example.com")
  })

  it("always states that it only read, and never submitted", async () => {
    const r = await readPagesInOrder(["https://s.example.com/one"])
    expect(r.notes.join(" ")).toMatch(/GET requests only/i)
    expect(r.notes.join(" ")).toMatch(/Nothing submitted/i)
  })
})

describe("pages that are not a form", () => {
  it("notes a page with nothing readable but keeps the rest of the trail", async () => {
    fetchRemotePage.mockImplementation(async (url: string) => ({
      html: url.endsWith("/two") ? "<h1>Just an article</h1><p>words</p>" : formPage("Contact", EMAIL),
      finalUrl: url,
    }))

    const r = await readPagesInOrder(["https://s.example.com/one", "https://s.example.com/two"])
    expect(r.ok).toBe(true)
    expect(r.steps).toHaveLength(1)
    expect(r.notes.join(" ")).toContain("no readable form")
  })

  it("explains itself when no page in the trail had a form", async () => {
    fetchRemotePage.mockImplementation(async (url: string) => ({
      html: "<h1>Article</h1><p>words</p>",
      finalUrl: url,
    }))

    const r = await readPagesInOrder(["https://s.example.com/one"])
    expect(r.ok).toBe(false)
    expect(r.stoppedBecause.length).toBeGreaterThan(10)
  })

  it("stops on a fetch failure and says which failure it was", async () => {
    fetchRemotePage.mockImplementation(async (url: string) =>
      url.endsWith("/two")
        ? { error: "s.example.com answered 403 Forbidden" }
        : { html: formPage("Contact", EMAIL), finalUrl: url }
    )

    const r = await readPagesInOrder(["https://s.example.com/one", "https://s.example.com/two"])
    expect(r.steps).toHaveLength(1)
    expect(r.stoppedBecause).toBeTruthy()
  })
})

describe("credentials in a hand-navigated trail", () => {
  it("refuses a password field rather than reading it as a step field", async () => {
    fetchRemotePage.mockImplementation(async (url: string) => ({
      html: formPage(
        "Sign in",
        '<label for="u">Username</label><input id="u" name="username">' +
          '<label for="p">Password</label><input id="p" name="password" type="password">'
      ),
      finalUrl: url,
    }))

    const r = await readPagesInOrder(["https://s.example.com/login"])
    const purposes = r.steps.flatMap((s) => s.fields.map((f) => f.purpose)).join(" ")
    expect(purposes).not.toMatch(/password/i)
    expect(r.notes.join(" ")).toMatch(/Credential and payment fields were refused/i)
  })
})
