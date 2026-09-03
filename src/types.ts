export type FieldType = "text" | "date" | "time" | "select" | "tel"

/** Hard cap on any value we accept from an agent. Tool args are untrusted input. */
export const MAX_VALUE_LEN = 200

export interface FieldSpec {
  purpose: string
  label: string
  type: FieldType
  options?: string[]
  required?: boolean
}

/**
 * Where a step lived when it was learned.
 *
 * A single-document wizard has one route for every step. A real checkout has
 * one per page, and a run that spans them has to survive the navigations in
 * between. Recording the route is what lets a resumed run know which step it
 * is looking at, and what lets a moved page be reported as drift rather than
 * as a mystery failure.
 */
export interface StepRoute {
  /** location.pathname at the time the step was read. */
  path: string
  /** The hash route, for a single-document app. */
  hash?: string
}

/**
 * How much damage pressing this step's button does.
 *
 * One approval at the end is correct for a single document and wrong the
 * moment a flow spans pages, because by then the earlier steps have already
 * committed. The runner stops at every irreversible step instead.
 *
 * Classification is conservative: anything that does not clearly read as
 * navigation is treated as irreversible.
 */
export type SideEffect = "none" | "reversible" | "irreversible"

export interface StepSpec {
  order: number
  intent: string
  fields: FieldSpec[]
  submitLabel: string
  route?: StepRoute
  sideEffect?: SideEffect
}

export interface SiteModel {
  version: string
  changelog: string[]
  steps: StepSpec[]
}

const TIME_OPTIONS = ["9:00 AM", "10:00 AM", "11:00 AM", "1:00 PM", "2:00 PM", "3:00 PM", "4:00 PM"]
const SERVICE_OPTIONS = ["checkup", "dental cleaning", "physical exam"]

export const SITE_V1: SiteModel = {
  version: "1.0",
  changelog: [],
  steps: [
    { order: 1, intent: "choose service", fields: [
      { purpose: "service type", label: "Service", type: "select", options: SERVICE_OPTIONS, required: true },
    ], submitLabel: "Next", sideEffect: "none" },
    { order: 2, intent: "pick date and time", fields: [
      { purpose: "date", label: "Preferred date", type: "date", required: true },
      { purpose: "time", label: "Preferred time", type: "select", options: TIME_OPTIONS, required: true },
    ], submitLabel: "Next", sideEffect: "none" },
    { order: 3, intent: "enter patient details", fields: [
      { purpose: "patient name", label: "Your name", type: "text", required: true },
      { purpose: "phone", label: "Phone number", type: "tel", required: true },
    ], submitLabel: "Next", sideEffect: "none" },
    { order: 4, intent: "confirm booking", fields: [], submitLabel: "Confirm booking", sideEffect: "irreversible" },
  ],
}

export const SITE_V2: SiteModel = {
  version: "2.0",
  changelog: [
    "Renamed 'Your name' to 'Full name (as on insurance card)'",
    "Added required 'Insurance ID' field to patient details",
    "Reordered: pick date and time now comes before choosing service",
    "Changed final button from 'Confirm booking' to 'Book appointment'",
  ],
  steps: [
    { order: 1, intent: "pick date and time", fields: [
      { purpose: "date", label: "Preferred date", type: "date", required: true },
      { purpose: "time", label: "Preferred time", type: "select", options: TIME_OPTIONS, required: true },
    ], submitLabel: "Next", sideEffect: "none" },
    { order: 2, intent: "choose service", fields: [
      { purpose: "service type", label: "Service", type: "select", options: SERVICE_OPTIONS, required: true },
    ], submitLabel: "Next", sideEffect: "none" },
    { order: 3, intent: "enter patient details", fields: [
      { purpose: "patient name", label: "Full name (as on insurance card)", type: "text", required: true },
      { purpose: "phone", label: "Phone number", type: "tel", required: true },
      { purpose: "insurance id", label: "Insurance ID", type: "text", required: true },
    ], submitLabel: "Next", sideEffect: "none" },
    { order: 4, intent: "confirm booking", fields: [], submitLabel: "Book appointment", sideEffect: "irreversible" },
  ],
}

// --- localStorage helpers. Private-mode Safari and disabled-storage throw. ---

export function safeGetItem(key: string): string | null {
  try { return localStorage.getItem(key) } catch { return null }
}

export function safeSetItem(key: string, value: string): boolean {
  try { localStorage.setItem(key, value) ; return true } catch { return false }
}

// --- active site version -------------------------------------------------
// Deriving the version from location.hash alone is wrong: the Flow Library
// lives at "#/" with no ?v= param, so drift would always be measured against
// v1 no matter which version the user is actually looking at. The URL sets the
// version; the choice is then remembered for every route.

export type SiteVersion = "1.0" | "2.0"
const VERSION_KEY = "siteVersion.v1"
let activeVersion: SiteVersion = "1.0"

function versionFromLocation(): SiteVersion | null {
  if (typeof location === "undefined") return null
  const qs = location.hash.split("?")[1] ?? ""
  const v = new URLSearchParams(qs).get("v")
  if (v === "2" || v === "2.0") return "2.0"
  if (v === "1" || v === "1.0") return "1.0"
  return null
}

/** Reconcile the active version with the URL. Returns true when it changed. */
export function syncSiteVersion(): boolean {
  const next = versionFromLocation() ?? (safeGetItem(VERSION_KEY) === "2.0" ? "2.0" : "1.0")
  if (next === activeVersion) return false
  activeVersion = next
  safeSetItem(VERSION_KEY, next)
  return true
}

export function setSiteVersion(v: SiteVersion) {
  activeVersion = v
  safeSetItem(VERSION_KEY, v)
}

export function getActiveSiteVersion(): SiteVersion { return activeVersion }

export function getActiveSiteModel(): SiteModel {
  return activeVersion === "2.0" ? SITE_V2 : SITE_V1
}

/** Site route that carries the active version, so a run never silently downgrades to v1. */
export function siteHash(extra?: string): string {
  const v = activeVersion === "2.0" ? "2" : "1"
  return `#/site?v=${v}${extra ? "&" + extra : ""}`
}

if (typeof location !== "undefined") syncSiteVersion()

// --- taught flows --------------------------------------------------------

export interface FlowParam {
  key: string
  label: string
  type: "string" | "date"
  sourceField: { stepIntent: string; fieldPurpose: string }
}

export interface RunRecord {
  at: string
  ok: boolean
  message: string
}

/**
 * How the app came to know a flow. "autonomous" means it read the page itself
 * and nobody demonstrated anything.
 */
export type LearnedBy = "demonstration" | "autonomous"

export interface TaughtFlow {
  id: string
  name: string
  intent: string
  learnedBy?: LearnedBy
  taughtAt: string
  siteVersionAtTeach: string
  /** Cache key part one: which site this was learned on. */
  origin?: string
  /**
   * Cache key part two: a digest of the page structure at learn time. This is
   * the ETag. If the page still hashes to this, nothing has changed and there
   * is nothing to recompute.
   */
  structureFingerprint?: string
  params: FlowParam[]
  steps: StepSpec[]
  fieldValues: Record<string, string>
  fieldAnswers?: Record<string, string>
  status: "never_run" | "healthy" | "drifted"
  runCount: number
  lastRunAt: string | null
  lastHealedAt: string | null
  runs?: RunRecord[]
}

export type ChangeType =
  | "RENAMED"
  | "NEW_FIELD"
  | "REMOVED_FIELD"
  | "REORDERED"
  | "WORDING"
  | "REMOVED_STEP"
  | "NEW_STEP"
  | "ROUTE_CHANGED"

export interface DriftChange {
  type: ChangeType
  description: string
  autoHealable: boolean
}

export interface DriftQuestion {
  id: string
  purpose: string
  label: string
  question: string
}

export interface DriftReport {
  status: "healthy" | "drifted"
  summary: string
  changes: DriftChange[]
  questions: DriftQuestion[]
}

// --- naming --------------------------------------------------------------

export function slugify(s: string): string {
  return s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "")
}

export function camel(s: string): string {
  const words = s.split(/[^a-zA-Z0-9]+/).filter(Boolean)
  return words.map((w, i) => (i === 0 ? w.toLowerCase() : w[0].toUpperCase() + w.slice(1).toLowerCase())).join("")
}

/** A WebMCP tool name must be unique: registerTool rejects duplicates. */
export function uniqueName(base: string, taken: string[]): string {
  const slug = slugify(base) || "my_flow"
  if (!taken.includes(slug)) return slug
  for (let n = 2; n < 1000; n++) {
    const candidate = `${slug}_${n}`
    if (!taken.includes(candidate)) return candidate
  }
  return `${slug}_${Date.now()}`
}

const NAVIGATION_LABEL = /^(next|continue|proceed|forwards?|onwards?|back|previous)\b/i
const IRREVERSIBLE_LABEL =
  /\b(pay|buy|purchase|order|checkout|book|confirm|submit|send|place|delete|remove|cancel|transfer|withdraw)\b/i

/**
 * Conservative by design. A label that clearly reads as navigation is safe;
 * anything else is assumed to commit something, because being wrong in that
 * direction only costs an extra confirmation.
 */
export function classifySideEffect(submitLabel: string): SideEffect {
  const label = (submitLabel ?? "").trim()
  if (!label) return "irreversible"
  if (NAVIGATION_LABEL.test(label)) return "none"
  if (IRREVERSIBLE_LABEL.test(label)) return "irreversible"
  return "irreversible"
}

/** Form control name, used by the declarative WebMCP attributes. */
export function fieldName(purpose: string): string { return slugify(purpose) }

/** Clamp and stringify anything an agent hands us. */
export function coerceValue(v: unknown): string {
  return String(v ?? "").slice(0, MAX_VALUE_LEN)
}
