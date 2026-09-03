import { safeGetItem, safeSetItem, TaughtFlow } from "./types"

const FLOWS_KEY = "flows.v1"
const AUDIT_KEY = "audit.v1"

export interface AuditEvent {
  at: string
  type: "teach" | "learn" | "mint" | "run" | "drift" | "heal" | "confirm" | "delete"
  detail: string
}

type Listener = () => void
const listeners = new Set<Listener>()

// Writes can happen while listeners are running (a listener that repairs flow
// status calls upsertFlow). Coalesce those into one notification instead of
// recursing through every subscriber again.
let emitting = false
let emitQueued = false

function emit() {
  if (emitting) { emitQueued = true; return }
  emitting = true
  try {
    do {
      emitQueued = false
      for (const l of [...listeners]) {
        try { l() } catch (err) { console.error("store listener failed", err) }
      }
    } while (emitQueued)
  } finally {
    emitting = false
  }
}

export function subscribe(l: Listener): () => void {
  listeners.add(l)
  return () => { listeners.delete(l) }
}

export function loadFlows(): TaughtFlow[] {
  try {
    const parsed = JSON.parse(safeGetItem(FLOWS_KEY) ?? "[]")
    return Array.isArray(parsed) ? (parsed as TaughtFlow[]).filter(isFlow) : []
  } catch {
    return []
  }
}

// A cold load reads whatever is in localStorage, which may be from an older
// build or hand-edited. Drop anything that would crash the UI.
function isFlow(f: unknown): f is TaughtFlow {
  const o = f as Partial<TaughtFlow>
  return !!o && typeof o.id === "string" && typeof o.name === "string" && Array.isArray(o.steps) && Array.isArray(o.params)
}

export function saveFlows(flows: TaughtFlow[]) {
  safeSetItem(FLOWS_KEY, JSON.stringify(flows))
  emit()
}

export function getFlow(id: string): TaughtFlow | undefined {
  return loadFlows().find((f) => f.id === id)
}

export function flowNames(): string[] {
  return loadFlows().map((f) => f.name)
}

export function upsertFlow(flow: TaughtFlow) {
  const flows = loadFlows()
  const i = flows.findIndex((f) => f.id === flow.id)
  if (i >= 0) flows[i] = flow
  else flows.push(flow)
  saveFlows(flows)
}

/**
 * Patch a flow in place. Returns undefined when the flow is gone (deleted
 * mid-run), so callers never resurrect a deleted flow by spreading undefined.
 */
export function patchFlow(id: string, patch: Partial<TaughtFlow>): TaughtFlow | undefined {
  const flows = loadFlows()
  const i = flows.findIndex((f) => f.id === id)
  if (i < 0) return undefined
  const next = { ...flows[i], ...patch }
  flows[i] = next
  saveFlows(flows)
  return next
}

/** Rewrite every flow in one pass, one write, one notification. */
export function updateFlows(fn: (f: TaughtFlow) => TaughtFlow): TaughtFlow[] {
  const flows = loadFlows()
  const next = flows.map(fn)
  const changed = next.some((f, i) => f !== flows[i])
  if (changed) saveFlows(next)
  return next
}

export interface DeletedFlow { flow: TaughtFlow; index: number }

export function deleteFlow(id: string): DeletedFlow | null {
  const flows = loadFlows()
  const index = flows.findIndex((f) => f.id === id)
  if (index < 0) return null
  const [flow] = flows.splice(index, 1)
  saveFlows(flows)
  return { flow, index }
}

export function restoreFlow(deleted: DeletedFlow) {
  const flows = loadFlows()
  if (flows.some((f) => f.id === deleted.flow.id)) return
  flows.splice(Math.min(deleted.index, flows.length), 0, deleted.flow)
  saveFlows(flows)
}

/**
 * sessionStorage, with a no-op stand-in when it throws.
 *
 * Run state belongs here rather than in localStorage: a run belongs to one tab
 * and should not outlive it, and two tabs must not fight over the same run.
 */
export function safeSession(): Pick<Storage, "getItem" | "setItem" | "removeItem"> {
  try {
    const probe = "__probe__"
    sessionStorage.setItem(probe, "1")
    sessionStorage.removeItem(probe)
    return sessionStorage
  } catch {
    return { getItem: () => null, setItem: () => {}, removeItem: () => {} }
  }
}

export function logEvent(type: AuditEvent["type"], detail: string) {
  const events = getAudit()
  events.unshift({ at: new Date().toISOString(), type, detail })
  safeSetItem(AUDIT_KEY, JSON.stringify(events.slice(0, 100)))
  emit()
}

export function getAudit(): AuditEvent[] {
  try {
    const parsed = JSON.parse(safeGetItem(AUDIT_KEY) ?? "[]")
    return Array.isArray(parsed) ? (parsed as AuditEvent[]) : []
  } catch {
    return []
  }
}

export function clearAll() {
  safeSetItem(FLOWS_KEY, "[]")
  safeSetItem(AUDIT_KEY, "[]")
  emit()
}
