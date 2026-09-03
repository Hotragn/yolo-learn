import { coerceValue, FieldSpec, SiteModel, siteHash, TaughtFlow } from "./types"

export interface RunResult {
  ok: boolean
  confirmedByHuman: boolean
  stepsExecuted: number
  message: string
  needsHealing?: boolean
  /** Exactly what went into the form, so the agent can report it back verbatim. */
  submitted?: Record<string, string>
  reference?: string
}

type Executor = (flow: TaughtFlow, params: Record<string, unknown>, signal: AbortSignal) => Promise<RunResult>

let executor: Executor | null = null
let running = false

export function setRunExecutor(fn: Executor | null) {
  executor = fn
}

export function isRunning(): boolean {
  return running
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

function fail(message: string, extra: Partial<RunResult> = {}): RunResult {
  return { ok: false, confirmedByHuman: false, stepsExecuted: 0, message, ...extra }
}

export async function runFlowInteractive(
  flow: TaughtFlow,
  params: Record<string, unknown>,
  signal: AbortSignal
): Promise<RunResult> {
  if (running) {
    return fail("Another run is already on screen. Wait for it to finish, or deny it, then try again.")
  }
  running = true
  try {
    // siteHash() carries the active version. Hardcoding "#/site" here would
    // silently drop ?v=2 and run the flow against the old site.
    if (!location.hash.startsWith("#/site")) location.hash = siteHash()

    const started = Date.now()
    while (!executor && Date.now() - started < 5000) {
      if (signal.aborted) return fail("Cancelled before the run started.")
      await sleep(50)
    }
    if (!executor) return fail("The demo site view never mounted, so the flow could not run.")
    return await executor(flow, params, signal)
  } finally {
    running = false
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
