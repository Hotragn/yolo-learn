export type FieldType = "text" | "date" | "time" | "select" | "tel"

export interface FieldSpec {
  purpose: string
  label: string
  type: FieldType
  options?: string[]
  required?: boolean
}

export interface StepSpec {
  order: number
  intent: string
  fields: FieldSpec[]
  submitLabel: string
}

export interface SiteModel {
  version: string
  changelog: string[]
  steps: StepSpec[]
}

const TIME_OPTIONS = ["9:00 AM", "10:00 AM", "11:00 AM", "1:00 PM", "2:00 PM", "3:00 PM", "4:00 PM"]

export const SITE_V1: SiteModel = {
  version: "1.0",
  changelog: [],
  steps: [
    { order: 1, intent: "choose service", fields: [
      { purpose: "service type", label: "Service", type: "select", options: ["checkup", "dental cleaning", "physical exam"], required: true },
    ], submitLabel: "Next" },
    { order: 2, intent: "pick date and time", fields: [
      { purpose: "date", label: "Preferred date", type: "date", required: true },
      { purpose: "time", label: "Preferred time", type: "select", options: TIME_OPTIONS, required: true },
    ], submitLabel: "Next" },
    { order: 3, intent: "enter patient details", fields: [
      { purpose: "patient name", label: "Your name", type: "text", required: true },
      { purpose: "phone", label: "Phone number", type: "tel", required: true },
    ], submitLabel: "Next" },
    { order: 4, intent: "confirm booking", fields: [], submitLabel: "Confirm booking" },
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
    ], submitLabel: "Next" },
    { order: 2, intent: "choose service", fields: [
      { purpose: "service type", label: "Service", type: "select", options: ["checkup", "dental cleaning", "physical exam"], required: true },
    ], submitLabel: "Next" },
    { order: 3, intent: "enter patient details", fields: [
      { purpose: "patient name", label: "Full name (as on insurance card)", type: "text", required: true },
      { purpose: "phone", label: "Phone number", type: "tel", required: true },
      { purpose: "insurance id", label: "Insurance ID", type: "text", required: true },
    ], submitLabel: "Next" },
    { order: 4, intent: "confirm booking", fields: [], submitLabel: "Book appointment" },
  ],
}

export function getActiveSiteModel(): SiteModel {
  const qs = location.hash.split("?")[1] ?? ""
  return new URLSearchParams(qs).get("v") === "2" ? SITE_V2 : SITE_V1
}

export interface FlowParam {
  key: string
  label: string
  type: "string" | "date"
  sourceField: { stepIntent: string; fieldPurpose: string }
}

export interface TaughtFlow {
  id: string
  name: string
  intent: string
  taughtAt: string
  siteVersionAtTeach: string
  params: FlowParam[]
  steps: StepSpec[]
  fieldValues: Record<string, string>
  fieldAnswers?: Record<string, string>
  status: "never_run" | "healthy" | "drifted"
  runCount: number
  lastRunAt: string | null
  lastHealedAt: string | null
}

export type ChangeType = "RENAMED" | "NEW_FIELD" | "REMOVED_FIELD" | "REORDERED" | "WORDING" | "REMOVED_STEP"

export interface DriftChange {
  type: ChangeType
  description: string
  autoHealable: boolean
}

export interface DriftQuestion {
  id: string
  purpose: string
  question: string
}

export interface DriftReport {
  status: "healthy" | "drifted"
  changes: DriftChange[]
  questions: DriftQuestion[]
}

export function slugify(s: string): string {
  return s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "")
}

export function camel(s: string): string {
  const words = s.split(/[^a-zA-Z0-9]+/).filter(Boolean)
  return words.map((w, i) => (i === 0 ? w.toLowerCase() : w[0].toUpperCase() + w.slice(1).toLowerCase())).join("")
}
