import { TaughtFlow } from "./types"

const FLOWS_KEY = "flows.v1"
const AUDIT_KEY = "audit.v1"

export interface AuditEvent {
  at: string
  type: "teach" | "run" | "drift" | "heal" | "confirm" | "delete"
  detail: string
}

type Listener = () => void
const listeners = new Set<Listener>()

function emit() { listeners.forEach((l) => l()) }

export function subscribe(l: Listener): () => void {
  listeners.add(l)
  return () => listeners.delete(l)
}

export function loadFlows(): TaughtFlow[] {
  try { return JSON.parse(localStorage.getItem(FLOWS_KEY) ?? "[]") as TaughtFlow[] }
  catch { return [] }
}

export function saveFlows(flows: TaughtFlow[]) {
  localStorage.setItem(FLOWS_KEY, JSON.stringify(flows))
  emit()
}

export function getFlow(id: string): TaughtFlow | undefined {
  return loadFlows().find((f) => f.id === id)
}

export function upsertFlow(flow: TaughtFlow) {
  const flows = loadFlows()
  const i = flows.findIndex((f) => f.id === flow.id)
  if (i >= 0) flows[i] = flow
  else flows.push(flow)
  saveFlows(flows)
}

export function deleteFlow(id: string) {
  saveFlows(loadFlows().filter((f) => f.id !== id))
}

export function logEvent(type: AuditEvent["type"], detail: string) {
  const events = getAudit()
  events.unshift({ at: new Date().toISOString(), type, detail })
  localStorage.setItem(AUDIT_KEY, JSON.stringify(events.slice(0, 100)))
  emit()
}

export function getAudit(): AuditEvent[] {
  try { return JSON.parse(localStorage.getItem(AUDIT_KEY) ?? "[]") as AuditEvent[] }
  catch { return [] }
}
