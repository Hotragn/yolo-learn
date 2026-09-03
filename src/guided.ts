import { getActiveSiteModel, setSiteVersion, siteHash } from "./types"
import { clearAll, loadFlows, patchFlow } from "./store"
import { detectDrift, healFlow } from "./drift"
import { executeToolByName, unmintFlow } from "./webmcp"
import { recallForPage } from "./recall"

/**
 * The guided run.
 *
 * A reviewer needs six interactions to reach the payoff, and most stop before
 * the redesign, which is the whole point of the project. This drives the exact
 * same registered tool objects an agent calls, in order, with narration.
 *
 * It is emphatically NOT a canned animation: every beat below is a real tool
 * call against real storage, and the approval dialog still belongs to the
 * human. If a beat fails, the script stops and says so rather than pretending.
 */

export type BeatState = "pending" | "active" | "done" | "failed"

export interface Beat {
  id: string
  title: string
  detail: string
  state: BeatState
  result?: string
}

export interface GuidedSnapshot {
  running: boolean
  beats: Beat[]
  /** Set when the script is waiting for the human to approve a submit. */
  awaitingApproval: boolean
  finishedAt: number | null
}

const BEATS: { id: string; title: string; detail: string }[] = [
  { id: "reset", title: "Start from nothing", detail: "Clear stored flows so this is a true cold start" },
  { id: "miss", title: "Cache miss", detail: "recall_page: nothing known about this page" },
  { id: "learn", title: "Read the page", detail: "learn_site: no demonstration, no invented values" },
  { id: "hit", title: "Cache hit", detail: "recall_page: known, and the page still matches" },
  { id: "run", title: "Run it", detail: "The agent fills the form. You approve the submit" },
  { id: "redesign", title: "One year later", detail: "The clinic ships a redesign" },
  { id: "stale", title: "Cache stale", detail: "recall_page: 4 changes, exactly 1 question" },
  { id: "heal", title: "Heal", detail: "heal_flow: one answer, and it matches again" },
  { id: "green", title: "Run it again", detail: "Green on the redesigned site" },
]

let snapshot: GuidedSnapshot = { running: false, beats: seed(), awaitingApproval: false, finishedAt: null }
const listeners = new Set<() => void>()

function seed(): Beat[] {
  return BEATS.map((b) => ({ ...b, state: "pending" as BeatState }))
}

function emit() {
  for (const l of [...listeners]) {
    try { l() } catch (err) { console.error("guided listener failed", err) }
  }
}

export function subscribeGuided(l: () => void): () => void {
  listeners.add(l)
  return () => { listeners.delete(l) }
}

export function getGuided(): GuidedSnapshot {
  return snapshot
}

export function resetGuided() {
  snapshot = { running: false, beats: seed(), awaitingApproval: false, finishedAt: null }
  emit()
}

function set(id: string, state: BeatState, result?: string) {
  snapshot = {
    ...snapshot,
    beats: snapshot.beats.map((b) => (b.id === id ? { ...b, state, result } : b)),
  }
  emit()
}

function awaiting(on: boolean) {
  snapshot = { ...snapshot, awaitingApproval: on }
  emit()
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const asRecord = (v: unknown) => (v && typeof v === "object" ? (v as Record<string, unknown>) : {})

async function beat<T>(id: string, pause: number, fn: () => Promise<T> | T): Promise<T> {
  set(id, "active")
  await sleep(pause)
  const value = await fn()
  return value
}

export async function runGuidedDemo(): Promise<void> {
  if (snapshot.running) return
  snapshot = { running: true, beats: seed(), awaitingApproval: false, finishedAt: null }
  emit()

  try {
    // 1. Cold start. Unregister anything already minted so the run is honest.
    await beat("reset", 350, () => {
      for (const flow of loadFlows()) unmintFlow(flow.name)
      clearAll()
      setSiteVersion("1.0")
      location.hash = siteHash()
    })
    set("reset", "done", "storage cleared, site on v1")
    await sleep(500)

    // 2. Cache miss.
    const miss = await beat("miss", 400, () => recallForPage())
    if (miss.state !== "miss") {
      set("miss", "failed", `expected a miss, got ${miss.state}`)
      return
    }
    set("miss", "done", `miss on ${new URL(miss.origin).host} · page hashes to ${miss.fingerprint}`)
    await sleep(400)

    // 3. Learn by reading.
    const learned = asRecord(await beat("learn", 300, () => executeToolByName("learn_site", {})))
    if (!learned.ok) {
      set("learn", "failed", String(learned.summary ?? "learning failed"))
      return
    }
    const toolName = String(learned.toolName ?? "")
    const params = Array.isArray(learned.parameters) ? learned.parameters.length : 0
    set("learn", "done", `${toolName} · ${params} parameters, 0 values stored`)
    await sleep(500)

    // 4. Cache hit. This is the beat that shows the point of the fingerprint.
    const hit = await beat("hit", 400, () => recallForPage())
    set(
      "hit",
      hit.state === "hit" ? "done" : "failed",
      hit.state === "hit" ? `hit · fingerprint matched, nothing re-read` : `expected a hit, got ${hit.state}`
    )
    if (hit.state !== "hit") return
    await sleep(400)

    // 5. Run it. The approval dialog is the human's, so the script waits.
    set("run", "active")
    awaiting(true)
    const ran = asRecord(
      await executeToolByName(toolName, {
        serviceType: "dental cleaning",
        date: nextFriday(),
        time: "2:00 PM",
        patientName: "Ada Lovelace",
        phone: "555-0177",
      })
    )
    awaiting(false)
    if (!ran.ok) {
      set("run", "failed", String(ran.message ?? "not submitted"))
      return
    }
    set("run", "done", String(ran.message))
    await sleep(500)

    // 6. The redesign.
    await beat("redesign", 400, () => {
      setSiteVersion("2.0")
      location.hash = siteHash()
    })
    set("redesign", "done", "site is now v2")
    await sleep(700)

    // 7. Cache stale.
    const stale = await beat("stale", 450, () => recallForPage())
    const changes = stale.flows.flatMap((f) => f.changes ?? []).length
    const questions = stale.flows.flatMap((f) => f.questions ?? [])
    set(
      "stale",
      stale.state === "stale" ? "done" : "failed",
      stale.state === "stale"
        ? `stale · ${changes} changes, ${questions.length} question`
        : `expected stale, got ${stale.state}`
    )
    if (stale.state !== "stale") return
    await sleep(500)

    // 8. Heal with the one answer.
    await beat("heal", 300, () => {
      const site = getActiveSiteModel()
      for (const flow of loadFlows()) {
        const report = detectDrift(flow, site)
        if (report.status !== "drifted") continue
        const answers: Record<string, string> = {}
        for (const q of report.questions) answers[q.id] = "INS-99812"
        patchFlow(flow.id, healFlow(flow, site, answers).flow)
      }
    })
    const afterHeal = recallForPage()
    set(
      "heal",
      afterHeal.state === "hit" ? "done" : "failed",
      afterHeal.state === "hit" ? "one answer applied, page matches again" : `still ${afterHeal.state}`
    )
    if (afterHeal.state !== "hit") return
    await sleep(500)

    // 9. Green on the redesigned site.
    set("green", "active")
    awaiting(true)
    const again = asRecord(
      await executeToolByName(toolName, {
        serviceType: "checkup",
        date: nextFriday(21),
        time: "10:00 AM",
        patientName: "Ada Lovelace",
        phone: "555-0177",
      })
    )
    awaiting(false)
    set("green", again.ok ? "done" : "failed", String(again.message ?? "not submitted"))
  } finally {
    awaiting(false)
    snapshot = { ...snapshot, running: false, finishedAt: Date.now() }
    emit()
  }
}

function nextFriday(offsetDays = 7): string {
  const d = new Date()
  d.setDate(d.getDate() + offsetDays)
  while (d.getDay() !== 5) d.setDate(d.getDate() + 1)
  return d.toISOString().slice(0, 10)
}

// --- deep links ---------------------------------------------------------

/**
 * Seed state so any beat of the story is reachable in one click. A reviewer who
 * abandons the loop halfway would otherwise never see the payoff.
 *
 *   #/?demo=learned   a flow already learned on v1
 *   #/?demo=drifted   the same flow, site switched to v2, drift ready to read
 *   #/?demo=healed    healed and green on v2
 */
export type DemoSeed = "learned" | "drifted" | "healed"

export async function seedDemo(which: DemoSeed): Promise<boolean> {
  for (const flow of loadFlows()) unmintFlow(flow.name)
  clearAll()

  setSiteVersion("1.0")
  location.hash = siteHash()
  await sleep(120)

  const learned = asRecord(await executeToolByName("learn_site", {}))
  if (!learned.ok) return false
  if (which === "learned") return true

  setSiteVersion("2.0")
  location.hash = siteHash()
  await sleep(120)
  if (which === "drifted") return true

  const site = getActiveSiteModel()
  for (const flow of loadFlows()) {
    const report = detectDrift(flow, site)
    if (report.status !== "drifted") continue
    const answers: Record<string, string> = {}
    for (const q of report.questions) answers[q.id] = "INS-99812"
    patchFlow(flow.id, healFlow(flow, site, answers).flow)
  }
  return true
}
