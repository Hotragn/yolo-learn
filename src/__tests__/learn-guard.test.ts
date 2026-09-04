import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * A real agent, in ChatGPT's in-app browser, skipped recall_page and called
 * learn_site on a page it already knew. The result was clinic_booking_2: a
 * duplicate of a flow that was already healed, healthy and run twice.
 *
 * The description told it to call recall first. Descriptions are advice, and
 * an agent is free to ignore advice, so the guard has to live where it cannot
 * be skipped. These tests pin exactly the behaviour that went wrong.
 */

const recallForPage = vi.fn()
const learnCurrentSite = vi.fn(async () => ({ ok: true, summary: "Learned", toolName: "clinic_booking" }))

vi.mock("../recall", () => ({ recallForPage }))
vi.mock("../learn", () => ({ learnCurrentSite }))

import { getToolEntries, initTools } from "../webmcp"
import { clearAll } from "../store"

async function learnSite(args: Record<string, unknown> = {}) {
  const tool = getToolEntries().find((e) => e.tool.name === "learn_site")!.tool
  return (await tool.execute(args, {} as { signal: AbortSignal })) as Record<string, unknown>
}

beforeEach(async () => {
  localStorage.clear()
  sessionStorage.clear()
  clearAll()
  recallForPage.mockReset()
  learnCurrentSite.mockClear()
  await initTools()
})

describe("learn_site refuses to duplicate a page it already knows", () => {
  it("returns the existing flow on a cache hit, and does not learn", async () => {
    recallForPage.mockReturnValue({
      state: "hit",
      origin: "https://x.example.com",
      fingerprint: "76f034c5",
      summary: "known and unchanged",
      nextStep: "Run it.",
      flows: [{ id: "flow_1", name: "clinic_booking", state: "fresh", learnedBy: "autonomous" }],
    })

    const r = await learnSite()
    expect(learnCurrentSite).not.toHaveBeenCalled()
    expect(r.learned).toBe(false)
    expect(r.toolName).toBe("clinic_booking")
    expect(String(r.summary)).toMatch(/already known/i)
  })

  it("points at healing rather than duplicating when the page has drifted", async () => {
    recallForPage.mockReturnValue({
      state: "stale",
      origin: "https://x.example.com",
      fingerprint: "7622e4d8",
      summary: "4 change(s) detected, 1 needs an answer",
      nextStep: "Heal it.",
      flows: [{ id: "flow_1", name: "clinic_booking", state: "stale", learnedBy: "autonomous" }],
    })

    const r = await learnSite()
    expect(learnCurrentSite).not.toHaveBeenCalled()
    expect(r.learned).toBe(false)
    expect(String(r.summary)).toMatch(/heal the existing flow/i)
    // The exact trap: a drifted page must not become a second copy.
    expect(String(r.summary)).toMatch(/second copy/i)
  })

  it("learns when the page is genuinely unknown", async () => {
    recallForPage.mockReturnValue({
      state: "miss",
      origin: "https://x.example.com",
      fingerprint: "abc",
      summary: "nothing known",
      nextStep: "Learn it.",
      flows: [],
    })

    await learnSite()
    expect(learnCurrentSite).toHaveBeenCalled()
  })

  it("re-reads when force is passed, because a deliberate refresh is still allowed", async () => {
    recallForPage.mockReturnValue({
      state: "hit",
      origin: "https://x.example.com",
      fingerprint: "abc",
      summary: "known",
      nextStep: "Run it.",
      flows: [{ id: "flow_1", name: "clinic_booking", state: "fresh", learnedBy: "autonomous" }],
    })

    await learnSite({ force: true })
    expect(learnCurrentSite).toHaveBeenCalled()
  })

  it("does not treat a truthy-ish force as force, since args are untrusted", async () => {
    recallForPage.mockReturnValue({
      state: "hit",
      origin: "https://x.example.com",
      fingerprint: "abc",
      summary: "known",
      nextStep: "Run it.",
      flows: [{ id: "flow_1", name: "clinic_booking", state: "fresh", learnedBy: "autonomous" }],
    })

    await learnSite({ force: "yes" })
    expect(learnCurrentSite).not.toHaveBeenCalled()
  })

  it("advertises force, so an agent can find the escape hatch", () => {
    const tool = getToolEntries().find((e) => e.tool.name === "learn_site")!.tool
    expect(tool.inputSchema.properties).toHaveProperty("force")
    expect(tool.description).toMatch(/already known/i)
  })
})
