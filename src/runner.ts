import {
  coerceValue,
  FieldSpec,
  SideEffect,
  SiteModel,
  siteHash,
  StepSpec,
  TaughtFlow,
} from "./types"
import { getFlow, logEvent, patchFlow, safeSession } from "./store"
import { valueForField } from "./drift"

export interface RunResult {
  ok: boolean
  confirmedByHuman: boolean
  stepsExecuted: number
  message: string
  needsHealing?: boolean
  /** Exactly what went into the form, so the agent can report it back verbatim. */
  submitted?: Record<string, string>
  reference?: string
  runId?: string
  /** How many times a page teardown interrupted this run and it picked up again. */
  resumeCount?: number
}

// --- the plan -----------------------------------------------------------
// Computed before anything is typed. Bailing out half-filled would leave the
// wizard in a state the user has to undo, and it is also the only honest place
// to decide whether a missing value is the caller's problem or the flow's.

export interface PlanItem {
  stepIndex: number
  purpose: string
  label: string
  value: string
}

export interface Plan {
  items: PlanItem[]
  /** Set when a required field has no value from any source. */
  blocked?: { label: string; paramKey?: string }
}

export function planFor(flow: TaughtFlow, params: Record<string, unknown>, site: SiteModel): Plan {
  const items: PlanItem[] = []
  for (let i = 0; i < site.steps.length; i++) {
    for (const field of site.steps[i].fields) {
      const value = valueForField(flow, params, field)
      if (value == null || value === "") {
        if (field.required) {
          const param = flow.params.find((p) => p.sourceField.fieldPurpose === field.purpose)
          return { items, blocked: { label: field.label, paramKey: param?.key } }
        }
        continue
      }
      items.push({ stepIndex: i, purpose: field.purpose, label: field.label, value })
    }
  }
  return { items }
}

export function sideEffectOf(step: StepSpec): SideEffect {
  return step.sideEffect ?? "irreversible"
}

// --- persisted run state ------------------------------------------------
// A navigation, or a reload, destroys every bit of JavaScript state including
// the promise the agent is waiting on. The run itself must not die with it, so
// it lives in sessionStorage: per tab, because two tabs should not share a run,
// and gone when the tab is, because a run is not a document.

export type RunStatus = "running" | "awaiting_approval" | "done" | "denied" | "failed"

export interface ActiveRun {
  runId: string
  flowId: string
  toolName: string
  params: Record<string, string>
  /** Next step to execute. Everything before it is already filled and passed. */
  stepIndex: number
  /** purpose -> value, so a resumed run restores the form rather than restarting. */
  filled: Record<string, string>
  status: RunStatus
  message: string
  reference?: string
  needsHealing?: boolean
  startedAt: string
  updatedAt: string
  resumeCount: number
}

const RUN_KEY = "run.v1"
const runListeners = new Set<() => void>()

function emitRun() {
  for (const l of [...runListeners]) {
    try { l() } catch (err) { console.error("run listener failed", err) }
  }
}

export function subscribeRun(l: () => void): () => void {
  runListeners.add(l)
  return () => { runListeners.delete(l) }
}

export function loadRun(): ActiveRun | null {
  try {
    const raw = safeSession().getItem(RUN_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as ActiveRun
    if (!parsed || typeof parsed.runId !== "string" || typeof parsed.flowId !== "string") return null
    if (typeof parsed.stepIndex !== "number") return null
    return parsed
  } catch {
    return null
  }
}

export function saveRun(run: ActiveRun): ActiveRun {
  const next = { ...run, updatedAt: new Date().toISOString() }
  try { safeSession().setItem(RUN_KEY, JSON.stringify(next)) } catch { /* private mode */ }
  emitRun()
  return next
}

export function clearRun() {
  try { safeSession().removeItem(RUN_KEY) } catch { /* private mode */ }
  emitRun()
}

/** A run that a page teardown interrupted, and that should pick up where it stopped. */
export function resumableRun(): ActiveRun | null {
  const run = loadRun()
  if (!run) return null
  return run.status === "running" || run.status === "awaiting_approval" ? run : null
}

// --- driver registration ------------------------------------------------

type Driver = (run: ActiveRun, signal: AbortSignal) => Promise<RunResult>

let driver: Driver | null = null
let resetter: (() => void) | null = null
let inFlight = false

export function setRunDriver(fn: Driver | null) {
  driver = fn
}

export function setSiteReset(fn: (() => void) | null) {
  resetter = fn
}

export function resetSite() {
  resetter?.()
}

export function isSiteMounted(): boolean {
  return driver !== null
}

export function isRunning(): boolean {
  return inFlight
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

function fail(message: string, extra: Partial<RunResult> = {}): RunResult {
  return { ok: false, confirmedByHuman: false, stepsExecuted: 0, message, ...extra }
}

/**
 * Write the outcome where it survives: the flow's own history. This is how an
 * agent whose promise died with the page can still find out what happened,
 * through get_run_status or list_flows.
 */
export function finishRun(run: ActiveRun, result: RunResult): RunResult {
  const flow = getFlow(run.flowId)
  const settled: RunStatus = result.ok ? "done" : result.needsHealing ? "failed" : "denied"
  saveRun({
    ...run,
    status: settled,
    message: result.message,
    reference: result.reference,
    needsHealing: result.needsHealing,
  })

  if (flow) {
    const runs = [{ at: new Date().toISOString(), ok: result.ok, message: result.message }, ...(flow.runs ?? [])].slice(0, 3)
    patchFlow(run.flowId, {
      runs,
      runCount: result.ok ? flow.runCount + 1 : flow.runCount,
      lastRunAt: new Date().toISOString(),
      status: result.ok ? "healthy" : flow.status,
    })
    if (result.ok) {
      logEvent("run", `Ran ${flow.name}: ${result.message}`)
      logEvent("confirm", `Human approved the submit for ${flow.name}`)
    } else {
      logEvent("run", `${flow.name} did not complete: ${result.message}`)
    }
  }
  return { ...result, runId: run.runId, resumeCount: run.resumeCount }
}

async function waitForDriver(signal: AbortSignal): Promise<boolean> {
  const started = Date.now()
  while (!driver && Date.now() - started < 5000) {
    if (signal.aborted) return false
    await sleep(50)
  }
  return driver !== null
}

/**
 * Start a run and, if this page survives long enough, return its outcome.
 *
 * If the document is torn down mid-run the promise dies with it, which is
 * unavoidable and worth being plain about: the run continues on screen, picks
 * up where it stopped, and the outcome lands in the flow's history for the
 * agent to collect afterwards.
 */
export async function runFlowInteractive(
  flow: TaughtFlow,
  params: Record<string, string>,
  signal: AbortSignal
): Promise<RunResult> {
  if (inFlight) {
    return fail("Another run is already on screen. Wait for it to finish, or deny it, then try again.")
  }

  const existing = resumableRun()
  if (existing) {
    return fail(
      `A run of ${existing.toolName} is already in progress at step ${existing.stepIndex + 1}. ` +
        `Call get_run_status to see it.`
    )
  }

  // siteHash() carries the active version. Hardcoding "#/site" would silently
  // drop ?v=2 and run the flow against the old site.
  if (!location.hash.startsWith("#/site")) location.hash = siteHash()

  const run = saveRun({
    runId: `run_${Date.now().toString(36)}`,
    flowId: flow.id,
    toolName: flow.name,
    params,
    stepIndex: 0,
    filled: {},
    status: "running",
    message: "starting",
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    resumeCount: 0,
  })

  inFlight = true
  try {
    if (!(await waitForDriver(signal))) {
      return finishRun(run, fail("The demo site view never mounted, so the flow could not run."))
    }
    return await driver!(run, signal)
  } finally {
    inFlight = false
  }
}

/**
 * Pick a run back up after the document that started it was torn down. Called
 * by the site view on mount, not by an agent: by definition nobody is waiting.
 */
export async function resumeRun(signal: AbortSignal): Promise<RunResult | null> {
  const run = resumableRun()
  if (!run || inFlight) return null
  if (!driver) return null

  const flow = getFlow(run.flowId)
  if (!flow) {
    return finishRun(run, fail(`The "${run.toolName}" flow was deleted, so the run could not continue.`))
  }

  const resumed = saveRun({ ...run, status: "running", resumeCount: run.resumeCount + 1 })
  logEvent(
    "run",
    `Resumed ${run.toolName} at step ${run.stepIndex + 1} after the page was torn down ` +
      `(resume ${resumed.resumeCount})`
  )

  inFlight = true
  try {
    return await driver(resumed, signal)
  } finally {
    inFlight = false
  }
}

// --- untrusted argument normalization -----------------------------------
// Everything an agent sends is untrusted: wrong case, wrong format, wrong
// value entirely, or a key that is not a parameter of this flow. Normalize
// what is unambiguously recoverable, reject the rest with a message that tells
// the agent exactly what is allowed.

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

function squash(s: string): string {
  return s.trim().replace(/\s+/g, " ").toLowerCase()
}

function isRealDate(value: string): boolean {
  if (!DATE_RE.test(value)) return false
  const parsed = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}

export function normalizeForField(field: FieldSpec, raw: unknown): { value?: string; error?: string } {
  const value = coerceValue(raw).trim()
  if (!value) return {}

  if (field.options?.length) {
    const match = field.options.find((o) => squash(o) === squash(value))
    if (!match) {
      return { error: `"${field.label}" must be one of: ${field.options.join(", ")} (received "${value}")` }
    }
    return { value: match }
  }

  // A date input holds nothing it cannot parse, so "2026-13-99" would submit
  // blank. Round-trip the value instead of trusting its shape.
  if (field.type === "date" && !isRealDate(value)) {
    return { error: `"${field.label}" must be a real calendar date formatted YYYY-MM-DD (received "${value}")` }
  }

  return { value }
}

export interface NormalizedParams {
  params: Record<string, string>
  errors: string[]
  ignoredKeys: string[]
}

/** Map an agent's raw arguments onto this flow's parameters, by key. */
export function normalizeParams(
  flow: TaughtFlow,
  raw: Record<string, unknown>,
  site: SiteModel
): NormalizedParams {
  const params: Record<string, string> = {}
  const errors: string[] = []
  const fieldsByPurpose = new Map<string, FieldSpec>()
  for (const step of site.steps) for (const f of step.fields) fieldsByPurpose.set(f.purpose, f)

  for (const param of flow.params) {
    if (!(param.key in raw) || raw[param.key] == null) continue
    const field = fieldsByPurpose.get(param.sourceField.fieldPurpose)
    if (!field) continue // the field is gone from the site; drift reports it
    const { value, error } = normalizeForField(field, raw[param.key])
    if (error) errors.push(error)
    else if (value) params[param.key] = value
  }

  const known = new Set(flow.params.map((p) => p.key))
  const ignoredKeys = Object.keys(raw).filter((k) => !known.has(k))
  return { params, errors, ignoredKeys }
}
