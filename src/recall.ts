import { getActiveSiteModel, TaughtFlow } from "./types"
import { loadFlows } from "./store"
import { detectDrift, DriftReportOf, fingerprintSteps } from "./drift"

/**
 * Recall: the cache lookup.
 *
 * The whole product is a cache with revalidation, and saying so out loud makes
 * the behaviour obvious rather than magical:
 *
 *   MISS   nothing known for this origin. Read the page and learn it.
 *   HIT    known, and the page still hashes to what was stored. Run it now.
 *          No re-reading, no diffing, nothing to ask.
 *   STALE  known, but the page hashes differently. Revalidate: the drift
 *          engine says what moved, and at most one thing needs a human.
 *
 * The cache key is (origin, structure fingerprint). The fingerprint is the
 * ETag: a digest of step order, intents, button labels and each field's
 * purpose, type, requiredness and options. A fingerprint match is a
 * conditional-request hit, which is why a known unchanged page costs nothing.
 */

export type RecallState = "miss" | "hit" | "stale"

export interface RecalledFlow {
  id: string
  name: string
  state: "fresh" | "stale"
  learnedBy: TaughtFlow["learnedBy"]
  storedFingerprint?: string
  changes?: DriftReportOf["changes"]
  questions?: DriftReportOf["questions"]
}

export interface RecallResult {
  state: RecallState
  origin: string
  /** The page as it hashes right now. */
  fingerprint: string
  summary: string
  nextStep: string
  flows: RecalledFlow[]
}

/** Flows learned on this origin. Flows stored before origins existed still count. */
export function flowsForOrigin(origin = location.origin): TaughtFlow[] {
  return loadFlows().filter((f) => !f.origin || f.origin === origin)
}

export function recallForPage(): RecallResult {
  const site = getActiveSiteModel()
  const origin = location.origin
  const fingerprint = fingerprintSteps(site.steps)
  const known = flowsForOrigin(origin)

  if (known.length === 0) {
    return {
      state: "miss",
      origin,
      fingerprint,
      summary: "Nothing known about this page yet.",
      nextStep: "Call learn_site to read it. No demonstration is needed.",
      flows: [],
    }
  }

  const flows: RecalledFlow[] = known.map((flow) => {
    // The fast path. A fingerprint match means the page is structurally
    // identical to what was stored, so there is no diff worth computing.
    if (flow.structureFingerprint && flow.structureFingerprint === fingerprint) {
      return {
        id: flow.id,
        name: flow.name,
        state: "fresh",
        learnedBy: flow.learnedBy,
        storedFingerprint: flow.structureFingerprint,
      }
    }
    const report = detectDrift(flow, site)
    if (report.status === "healthy") {
      return {
        id: flow.id,
        name: flow.name,
        state: "fresh",
        learnedBy: flow.learnedBy,
        storedFingerprint: flow.structureFingerprint,
      }
    }
    return {
      id: flow.id,
      name: flow.name,
      state: "stale",
      learnedBy: flow.learnedBy,
      storedFingerprint: flow.structureFingerprint,
      changes: report.changes,
      questions: report.questions,
    }
  })

  const stale = flows.filter((f) => f.state === "stale")

  if (stale.length === 0) {
    return {
      state: "hit",
      origin,
      fingerprint,
      summary: `Already known: ${flows.map((f) => f.name).join(", ")}. The page still matches what was stored.`,
      nextStep: "Run the flow. Nothing needs re-reading and nothing needs an answer.",
      flows,
    }
  }

  const questions = stale.flatMap((f) => f.questions ?? [])
  return {
    state: "stale",
    origin,
    fingerprint,
    summary:
      `Known but out of date: ${stale.map((f) => f.name).join(", ")}. ` +
      `The page no longer matches what was stored.`,
    nextStep: questions.length
      ? "Ask the user the questions below, then call heal_flow. Everything else re-reads from the page."
      : "Call heal_flow. All of it re-reads from the page, so nothing needs an answer.",
    flows,
  }
}
