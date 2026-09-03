import { describe, expect, it, vi, beforeEach } from "vitest"
import { readFlowAcrossPages, readPagesInOrder } from "../crawl"

/**
 * The safety rules matter more than the feature here. A tool that walks other
 * people's sites has exactly one unforgivable failure: submitting something.
 */
const pages: Record<string, string> = {
  "https://shop.example.com/start": `<h1>Choose a plan</h1>
    <form method="get" action="/step2"><label>Plan <select name="plan"><option>basic</option></select></label>
    <button>Continue</button></form>`,
  "https://shop.example.com/step2": `<h1>Your details</h1>
    <form method="get" action="/step3"><label>Email <input name="email" required></label>
    <label>Password <input type="password" name="password"></label><button>Next</button></form>`,
  "https://shop.example.com/step3": `<h1>Payment</h1>
    <form method="post" action="/charge"><label>Card number <input name="cc-number" autocomplete="cc-number"></label>
    <button>Pay now</button></form>`,
  "https://shop.example.com/loop": `<form method="get" action="/loop"><input name="x"><button>Next</button></form>`,
  "https://shop.example.com/offsite": `<form method="get" action="https://elsewhere.example.net/x"><input name="y"><button>Go</button></form>`,
}

beforeEach(() => {
  vi.stubGlobal("fetch", async (input: string) => {
    const target = decodeURIComponent(String(input).split("url=")[1] ?? "")
    const html = pages[target]
    return {
      ok: true,
      json: async () => (html ? { html, finalUrl: target } : { error: `no such page ${target}` }),
    } as unknown as Response
  })
})

describe("reading a multi-page flow", () => {
  it("walks GET steps and records each one", async () => {
    const out = await readFlowAcrossPages("https://shop.example.com/start")
    expect(out.ok).toBe(true)
    expect(out.steps.length).toBeGreaterThanOrEqual(2)
    expect(out.steps[0].fields.map((f) => f.purpose)).toContain("plan")
    expect(out.steps[1].fields.map((f) => f.purpose)).toContain("email")
  })

  it("records where each purpose was read from", async () => {
    const out = await readFlowAcrossPages("https://shop.example.com/start")
    expect(out.steps[0].fields[0].from).toContain("name=")
  })

  it("refuses the password rather than reading it", async () => {
    const out = await readFlowAcrossPages("https://shop.example.com/start")
    const step2 = out.steps.find((s) => s.url.endsWith("/step2"))!
    expect(step2.fields.map((f) => f.purpose)).not.toContain("password")
    expect(step2.refused.join(" ").toLowerCase()).toContain("password")
  })

  it("STOPS at a POST form rather than following it, which is the whole safety line", async () => {
    const out = await readFlowAcrossPages("https://shop.example.com/start")
    // /step3 is reachable and readable, but its own POST action is never followed.
    expect(out.steps.every((s) => !s.url.includes("/charge"))).toBe(true)
    expect(out.stoppedBecause).toMatch(/nowhere to continue|submitting/i)
  })

  it("never issues anything but a GET to the fetch endpoint", async () => {
    const calls: unknown[] = []
    vi.stubGlobal("fetch", async (input: string, init?: RequestInit) => {
      calls.push(init?.method ?? "GET")
      const target = decodeURIComponent(String(input).split("url=")[1] ?? "")
      return { ok: true, json: async () => ({ html: pages[target] ?? "", finalUrl: target }) } as unknown as Response
    })
    await readFlowAcrossPages("https://shop.example.com/start")
    expect(calls.every((m) => m === "GET")).toBe(true)
  })

  it("will not follow the flow off its origin", async () => {
    const out = await readFlowAcrossPages("https://shop.example.com/offsite")
    expect(out.steps.every((s) => s.url.startsWith("https://shop.example.com"))).toBe(true)
  })

  it("ends a self-linking page instead of spinning", async () => {
    const out = await readFlowAcrossPages("https://shop.example.com/loop")
    expect(out.stoppedBecause).toMatch(/looped back/i)
    expect(out.steps.length).toBe(1)
  })

  it("says plainly that it submitted nothing", async () => {
    const out = await readFlowAcrossPages("https://shop.example.com/start")
    expect(out.notes.join(" ")).toMatch(/nothing submitted|never/i)
  })

  it("reports a bad URL rather than throwing", async () => {
    const out = await readFlowAcrossPages("not a url")
    expect(out.ok).toBe(false)
    expect(out.stoppedBecause).toMatch(/not a URL/i)
  })
})

describe("pages the user already opened", () => {
  it("reads each listed GET page and never follows a POST", async () => {
    const out = await readPagesInOrder([
      "https://shop.example.com/start",
      "https://shop.example.com/step2",
      "https://shop.example.com/step3",
    ])
    expect(out.ok).toBe(true)
    expect(out.steps.map((s) => s.url)).toEqual([
      "https://shop.example.com/start",
      "https://shop.example.com/step2",
    ])
    expect(out.notes.join(" ")).toMatch(/no readable form|refused|payment/i)
    expect(out.steps.every((s) => !s.url.includes("/charge"))).toBe(true)
  })

  it("will not leave the first origin even if the paste includes another host", async () => {
    const out = await readPagesInOrder(["https://shop.example.com/start", "https://elsewhere.example.net/x"])
    expect(out.steps.every((s) => s.url.startsWith("https://shop.example.com"))).toBe(true)
    expect(out.notes.join(" ")).toMatch(/not on/)
  })
})
