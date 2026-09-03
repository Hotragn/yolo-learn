import { beforeEach, describe, expect, it, vi } from "vitest"

const fetchRemotePage = vi.fn()

vi.mock("../page-fetch", async (orig) => ({
  ...(await orig<typeof import("../page-fetch")>()),
  fetchRemotePage: (url: string) => fetchRemotePage(url),
}))

// Minting is how an agent sees a memory, not part of storing one. Stubbed so
// these tests exercise remote.ts rather than the whole WebMCP layer.
const mintRememberedTool = vi.fn(async () => ({ name: "remembered_x", native: false }))
vi.mock("../webmcp", () => ({ mintRememberedTool }))

import {
  fingerprintOf,
  forgetRemote,
  knownRemotes,
  learnFromHtml,
  learnUrl,
  recallRemote,
} from "../remote"

/** A page with one readable form. `extra` lets a test change its shape. */
function page(title: string, fields: string, action = "/next") {
  return {
    html: `<h1>${title}</h1><form method="get" action="${action}">${fields}
           <button type="submit">Continue</button></form>`,
    finalUrl: undefined as string | undefined,
  }
}

const BOOKING = '<label for="e">Email</label><input id="e" name="email" required>'

beforeEach(() => {
  localStorage.clear()
  forgetRemote()
  fetchRemotePage.mockReset()
  mintRememberedTool.mockClear()
  // Default: every URL returns the same one-form page with no onward link, so
  // the walk reads exactly one page unless a test says otherwise.
  fetchRemotePage.mockImplementation(async (url: string) => ({
    ...page("Book", BOOKING, ""),
    finalUrl: url,
  }))
})

describe("fingerprintOf is a shape, not a snapshot", () => {
  const shape = [
    { order: 1, url: "u", intent: "sign up", submitLabel: "Next", formCount: 1, refused: [],
      fields: [{ label: "Email", purpose: "email", from: 'name="email"', required: true }] },
  ]

  it("is stable for the same shape", () => {
    expect(fingerprintOf(shape)).toBe(fingerprintOf(structuredClone(shape)))
  })

  it("ignores a relabelled field, because a rename is drift the engine heals", () => {
    const relabelled = structuredClone(shape)
    relabelled[0].fields[0].label = "Your email address"
    expect(fingerprintOf(relabelled)).toBe(fingerprintOf(shape))
  })

  it("ignores the order fields appear in within a step", () => {
    const two = structuredClone(shape)
    two[0].fields.push({ label: "Name", purpose: "name", from: 'name="name"', required: false })
    const swapped = structuredClone(two)
    swapped[0].fields.reverse()
    expect(fingerprintOf(swapped)).toBe(fingerprintOf(two))
  })

  it("changes when a purpose changes, which is the task actually moving", () => {
    const moved = structuredClone(shape)
    moved[0].fields[0].purpose = "phone"
    expect(fingerprintOf(moved)).not.toBe(fingerprintOf(shape))
  })

  it("changes when a step is added", () => {
    expect(fingerprintOf([...shape, { ...shape[0], order: 2, intent: "pay" }])).not.toBe(fingerprintOf(shape))
  })

  it("survives an empty list without throwing", () => {
    expect(typeof fingerprintOf([])).toBe("string")
  })
})

describe("recallRemote never fetches, because a hit that fetched would save nothing", () => {
  it("misses on an origin it has never seen", async () => {
    const r = recallRemote("https://unknown.example.com/x")
    expect(r.state).toBe("miss")
    expect(fetchRemotePage).not.toHaveBeenCalled()
  })

  it("hits after a learn, still without fetching", async () => {
    await learnUrl("https://a.example.com/start")
    fetchRemotePage.mockClear()

    const r = recallRemote("https://a.example.com/anything-else")
    expect(r.state).toBe("hit")
    expect(fetchRemotePage).not.toHaveBeenCalled()
    expect(r.summary).toContain("already known")
  })

  it("is keyed by origin, so a different host is a miss", async () => {
    await learnUrl("https://a.example.com/start")
    expect(recallRemote("https://b.example.com/start").state).toBe("miss")
  })

  it("treats junk as a miss rather than throwing", () => {
    expect(recallRemote("not a url").state).toBe("miss")
    expect(recallRemote("").state).toBe("miss")
  })
})

describe("learnUrl reads once", () => {
  it("reads on the first visit and reports the cost", async () => {
    const first = await learnUrl("https://a.example.com/start")
    expect(first.ok).toBe(true)
    expect(first.cached).toBe(false)
    expect(first.bytesRead).toBeGreaterThan(0)
    expect(fetchRemotePage).toHaveBeenCalledTimes(1)
  })

  it("serves the second visit from memory, fetching nothing", async () => {
    await learnUrl("https://a.example.com/start")
    fetchRemotePage.mockClear()

    const second = await learnUrl("https://a.example.com/start")
    expect(second.cached).toBe(true)
    expect(second.bytesRead).toBe(0)
    expect(fetchRemotePage).not.toHaveBeenCalled()
    expect(second.steps.length).toBeGreaterThan(0)
  })

  it("re-reads when forced, which is how a moved task is found", async () => {
    await learnUrl("https://a.example.com/start")
    fetchRemotePage.mockClear()

    const forced = await learnUrl("https://a.example.com/start", { force: true })
    expect(forced.cached).toBe(false)
    expect(fetchRemotePage).toHaveBeenCalled()
  })

  it("says so when the shape changed under it", async () => {
    await learnUrl("https://a.example.com/start")
    fetchRemotePage.mockImplementation(async (url: string) => ({
      ...page("Book", '<label for="p">Phone</label><input id="p" name="phone" required>', ""),
      finalUrl: url,
    }))

    const again = await learnUrl("https://a.example.com/start", { force: true })
    expect(again.summary).toContain("CHANGED")
  })

  it("does not claim a change when only the wording moved", async () => {
    await learnUrl("https://a.example.com/start")
    fetchRemotePage.mockImplementation(async (url: string) => ({
      ...page("Book", '<label for="e">Your email address</label><input id="e" name="email" required>', ""),
      finalUrl: url,
    }))

    const again = await learnUrl("https://a.example.com/start", { force: true })
    expect(again.summary).not.toContain("CHANGED")
  })

  it("counts visits", async () => {
    await learnUrl("https://a.example.com/start")
    await learnUrl("https://a.example.com/start")
    await learnUrl("https://a.example.com/start")
    expect(knownRemotes()[0].visits).toBe(3)
  })

  it("reports a failure instead of storing an empty memory", async () => {
    fetchRemotePage.mockImplementation(async () => ({ error: "example.com answered 403 Forbidden" }))
    const r = await learnUrl("https://blocked.example.com/x")
    expect(r.ok).toBe(false)
    expect(knownRemotes()).toHaveLength(0)
  })

  it("rejects a non-URL without touching the network", async () => {
    const r = await learnUrl("nonsense")
    expect(r.ok).toBe(false)
    expect(fetchRemotePage).not.toHaveBeenCalled()
  })

  it("mints a tool so an agent can call the memory by name", async () => {
    await learnUrl("https://a.example.com/start")
    expect(mintRememberedTool).toHaveBeenCalledWith("https://a.example.com")
  })
})

describe("memory is bounded", () => {
  it("keeps at most 40 origins, so a long session cannot fill localStorage", async () => {
    for (let i = 0; i < 45; i++) await learnUrl(`https://site${i}.example.com/x`)
    expect(knownRemotes()).toHaveLength(40)
  })

  it("forgets everything on request", async () => {
    await learnUrl("https://a.example.com/start")
    forgetRemote()
    expect(knownRemotes()).toHaveLength(0)
  })

  it("ignores corrupt stored memory rather than crashing", () => {
    localStorage.setItem("remote.v1", "{not json")
    expect(knownRemotes()).toEqual([])
    expect(recallRemote("https://a.example.com/x").state).toBe("miss")
  })
})

describe("learnFromHtml stores the shape and not the page", () => {
  const signedIn = `
    <h1>Your account</h1>
    <form method="post" action="/save">
      <label for="n">Full name</label><input id="n" name="full_name" value="Real Person" required>
      <input type="hidden" name="csrf" value="deadbeef">
      <input type="password" name="password" value="hunter2">
      <button type="submit">Save</button>
    </form>`

  it("reads a task out of a signed-in snapshot", async () => {
    const r = await learnFromHtml("https://bank.example.com/account", signedIn)
    expect(r.ok).toBe(true)
    expect(r.steps[0].fields.map((f) => f.purpose)).toContain("full name")
  })

  it("stores nothing personal, and no markup at all", async () => {
    await learnFromHtml("https://bank.example.com/account", signedIn)
    const stored = localStorage.getItem("remote.v1") ?? ""
    for (const secret of ["Real Person", "hunter2", "deadbeef", "<form", "<input"]) {
      expect(stored).not.toContain(secret)
    }
  })

  it("never sends the snapshot anywhere", async () => {
    await learnFromHtml("https://bank.example.com/account", signedIn)
    expect(fetchRemotePage).not.toHaveBeenCalled()
  })

  it("refuses a bad URL", async () => {
    expect((await learnFromHtml("nope", signedIn)).ok).toBe(false)
  })
})
