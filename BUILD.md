# BUILD.md — Full Project Brief

You are the senior software engineer on this project. You own it end to end:
architecture decisions, implementation, testing, polish, and deployment. Treat
this document as your complete specification and contract. Work autonomously,
make sound engineering tradeoffs, and deliver a fully tested, deployed product.
The founder reviews the result, not the process.

---

## 1. Mission

Build a submission for the OpenAI WebMCP Challenge: an agent-memory app where
the user demonstrates a task once on a demo site, the app mints a WebMCP tool
live (dynamic tool registration mid-session), the agent runs the taught flow
with human confirmation, and when the site ships a redesigned v2 (renamed
field, new required field, reordered steps, changed button text) the agent
detects drift, asks exactly one question, heals the flow, and runs it green.
Deterministic healing, no ML.

Pitch line: agents today start every session from zero and break when the web
changes. This one remembers, and heals.

Why it matters: bots break when applications change, not if. RPA maintenance
runs 30-50% of original build cost per year. Users know their own repetitive
flows on the long tail of the web, but no developer will write tools for those
sites. This app lets the user be the developer.

## 2. Working Method

Discipline before speed. Three practices, always:

### Plan Lock (before every milestone)

1. Reframe: restate the goal in one sentence and the definition of done
2. List tasks: smallest reversible steps, each a commit
3. Name risks: what could break the demo loop? What depends on the
   experimental API?
4. Sequence: do the risky unknown first, never last
5. Only then write code. After the milestone, a one-paragraph retro.

### Specialist Eyes (invoke these lenses at the right moments)

- Frontend Engineer: the minting moment is the product. Green flash, tool
  name, auto-navigate to #/tools with the new card highlighted. 16px+ text,
  one accent color, calm infrastructure feel. Plain CSS only, no frameworks.
- Adversarial Reviewer: before calling anything done, attack it. Can you demo
  every claim live? Test the edge cases listed in section 6. Anything not in
  the demo loop is a liability: cut it or hide it.

### End-to-End QA (before every deploy)

Run the full demo loop from section 4 in a real browser, no shortcuts. Deny
once, approve once. Reload to confirm persistence. The loop is done when it
passes twice in a row.

## 3. Product Spec

### Architecture

Single-origin SPA. The memory app and the demo site are one app, hash routes:
#/ Flow Library, #/site demo site (v1 or v2 via ?v=), #/tools live registry.
localStorage persistence. Static hosting on Vercel. No backend, no accounts,
no cloud sync, no mobile.

### Stack

Vite + React + TypeScript. No state library. No UI framework, plain CSS.

### Demo site: Northside Family Clinic (fictional)

4-step booking wizard: choose service, pick date/time, patient details,
confirm.

v1 to v2 drift events:
- Field renamed: "Your name" becomes "Full name (as on insurance card)"
- New required field: "Insurance ID" in patient details
- Steps reordered: pick date/time now comes before choosing service
- Button text: "Confirm booking" becomes "Book appointment"

v2 shows a visible redesign banner, like real SaaS updates.

### WebMCP tools

Static, registered at load: list_flows, check_flow_health, run_flow,
heal_flow, get_site_info, start_teaching. Every execution validates arguments
as untrusted input and honors the AbortSignal.

Dynamic, per taught flow: document.modelContext.registerTool() called on teach
completion. Tool name is the flow slug. inputSchema is built from the fields
the user marked changeable. Tool-change propagation mid-session is the core
magic moment: it must work in the same session without a reload.

Declarative: the site booking form carries toolname and tooldescription
attributes, inputs carry toolparamdescription. The exact attribute names are
assumed per the draft spec: verify them (P0 task 1) and adjust if the current
spec differs.

### Semantic map

Flows store steps by intent and fields by purpose, never selectors alone.
Params reference (stepIntent, fieldPurpose). fieldValues holds demo values
from the demonstration, fieldAnswers holds healed answers.

### Drift engine (deterministic)

Match steps by intent, fields by purpose. RENAMED, REORDERED, REMOVED_FIELD,
REMOVED_STEP, WORDING changes auto-heal. Only NEW required fields generate
one human question. Healing snapshots the current site model into the flow
and records the answer.

### Run engine

An agent tool calls runner.ts, which navigates to #/site. The SiteApp
executor animates each step, fills values (params override taught values,
then fieldAnswers), returns needsHealing when a required field has no value,
shows an Approve/Deny modal before submit, and resolves the tool promise with
the outcome. Human confirmation before every submit, always.

## 4. The Demo Loop (the definition of "working")

1. Open #/site?teach=1, book an appointment by hand, mark 2 fields
   changeable, mint the tool
2. The new tool appears in #/tools, same session, no reload
3. The agent runs the flow with new details, the human approves the submit
   modal, booking confirmed
4. Switch to #/site?v=2 (the one-year-later redesign)
5. The agent checks flow health: 4 changes detected in plain English,
   exactly 1 question (insurance ID)
6. Answer it, heal, run again, green

The full loop must complete in under 90 seconds and pass twice in a row
before any deploy counts.

## 5. Build Order

Complete every item in a level before starting the next. No skipping, no
partial credit.

### P0

1. Verify the WebMCP API surface against the live docs
   (developer.chrome.com/docs/ai/webmcp/build-tools and
   webmachinelearning.github.io/webmcp): registerTool signature and tool
   object shape, declarative attribute names, tool-change propagation,
   permissions/origin requirements. Write a probe tool, confirm no console
   errors in Chrome with chrome://flags/#enable-webmcp-testing, delete the
   probe, commit the verified layer.
2. Scaffold with Vite (commands in section 8), create every file from
   section 8 exactly, npm run dev with zero TypeScript errors.
3. Demo loop beats 1-3 green (teach, mint, agent run, confirm).
4. Demo loop beats 4-6 green (drift, question, heal, green run).
5. Deploy to Vercel, verify a cold load in a fresh browser with no cache.

### P1 (after all of P0 is green)

- Minting success animation: green flash with the tool name, auto-navigate
  to #/tools with the new card highlighted and a "new this session" badge
- Tools view: badge and highlight for session-minted tools
- Confirm modal: show the exact values the agent is about to submit
- Empty states and microcopy pass
- Abort handling: Deny and cancellation fully clean up wizard state
- Agent-facing polish: tool descriptions written so the agent reliably
  picks the right tool on the first try

### P2 (after all of P1 is green)

- Run history per flow (last 3 runs with timestamps)
- Keyboard accessibility pass
- Multiple flows teach and run without name collisions
- Undo for delete

## 6. Edge Cases (must all pass before you call it done)

- Teach with zero fields marked changeable
- Run with missing params
- Heal with an empty answer
- Delete a flow mid-run
- Teach two flows with the same name
- Reload during an agent run
- Cold load with empty localStorage
- Firefox (graceful degradation banner shows, nothing crashes)
- Chrome with the WebMCP flag: everything works natively
- ChatGPT desktop in-app browser: everything works natively

## 7. Non-Negotiables

- Single origin, hash routing, no backend, localStorage only
- Human confirmation before every submit, always
- Treat all tool arguments as untrusted input
- Deterministic healing only, no ML, no fake intelligence claims
- Fictional brands only (Northside Family Clinic), no third-party trademarks
- Do not rename the project, the founder picks the name
- Small commits with clear messages
- Never cut confirmations or the minting moment

## 8. Complete Source

Create every file below exactly as written. Do not improvise contents.

```bash
npm create vite@latest . -- --template react-ts
npm install
# create the files below, then:
npm run dev
```

File tree:

```text
.
├── BUILD.md
├── README.md
├── LICENSE
├── index.html
├── .gitignore
└── src/
    ├── main.tsx
    ├── App.tsx
    ├── SiteApp.tsx
    ├── TeachMode.tsx
    ├── webmcp.ts
    ├── drift.ts
    ├── runner.ts
    ├── store.ts
    ├── types.ts
    └── styles.css
```

### index.html

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Agent Memory That Heals</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

### .gitignore

```text
node_modules
dist
.DS_Store
*.local
```

### LICENSE

```text
MIT License

Copyright (c) 2026 [Founder Name]

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

### README.md

```markdown
# Agent Memory That Heals (working title, founder picks final name)

Teach your agent once. It remembers forever. When the site changes, it detects
drift, asks one question, and heals itself.

Built for the OpenAI WebMCP Challenge.

## Run it

    npm install
    npm run dev

- Flow Library: #/
- Demo site: #/site (v1) and #/site?v=2 (the one-year-later redesign)
- Teach mode: #/site?teach=1
- Live tool registry: #/tools

## Test with WebMCP

- Chrome 149+: enable chrome://flags/#enable-webmcp-testing
- ChatGPT desktop app: open the deployed URL in the in-app browser

Stack: Vite + React + TypeScript, hash routing, localStorage, no backend, MIT.
```

### src/main.tsx

```tsx
import React from "react"
import ReactDOM from "react-dom/client"
import App from "./App"
import "./styles.css"

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
```

### src/types.ts

```ts
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
```

### src/store.ts

```ts
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
```

### src/drift.ts

```ts
import { DriftChange, DriftQuestion, DriftReport, SiteModel, TaughtFlow } from "./types"

// Deterministic drift detection: match steps by intent, fields by purpose.
// Renamed/reordered/removed/wording changes auto-heal.
// Only new required fields generate a human question.

export function detectDrift(flow: TaughtFlow, current: SiteModel): DriftReport {
  const changes: DriftChange[] = []
  const questions: DriftQuestion[] = []

  for (const curStep of current.steps) {
    const taughtStep = flow.steps.find((s) => s.intent === curStep.intent)
    if (!taughtStep) {
      changes.push({ type: "REMOVED_STEP", description: `Step "${curStep.intent}" is new since this flow was taught`, autoHealable: false })
      continue
    }
    for (const curField of curStep.fields) {
      const taughtField = taughtStep.fields.find((f) => f.purpose === curField.purpose)
      if (!taughtField) {
        changes.push({ type: "NEW_FIELD", description: `New field "${curField.label}" appeared in "${curStep.intent}"`, autoHealable: false })
        if (curField.required) {
          questions.push({
            id: `q_${curField.purpose}`,
            purpose: curField.purpose,
            question: `The site now asks for "${curField.label}". What should I answer?`,
          })
        }
      } else if (taughtField.label !== curField.label) {
        changes.push({ type: "RENAMED", description: `"${taughtField.label}" is now labeled "${curField.label}"`, autoHealable: true })
      }
    }
    for (const taughtField of taughtStep.fields) {
      if (!curStep.fields.some((f) => f.purpose === taughtField.purpose)) {
        changes.push({ type: "REMOVED_FIELD", description: `Field "${taughtField.label}" was removed from "${curStep.intent}"`, autoHealable: true })
      }
    }
    if (taughtStep.submitLabel !== curStep.submitLabel) {
      changes.push({ type: "WORDING", description: `Button "${taughtStep.submitLabel}" is now "${curStep.submitLabel}"`, autoHealable: true })
    }
    if (taughtStep.order !== curStep.order) {
      changes.push({ type: "REORDERED", description: `"${curStep.intent}" moved from step ${taughtStep.order} to step ${curStep.order}`, autoHealable: true })
    }
  }

  for (const taughtStep of flow.steps) {
    if (!current.steps.some((s) => s.intent === taughtStep.intent)) {
      changes.push({ type: "REMOVED_STEP", description: `Step "${taughtStep.intent}" no longer exists on the site`, autoHealable: true })
    }
  }

  return { status: changes.length ? "drifted" : "healthy", changes, questions }
}

export function healFlow(flow: TaughtFlow, current: SiteModel, answers: Record<string, string>): TaughtFlow {
  const fieldAnswers: Record<string, string> = { ...(flow.fieldAnswers ?? {}) }
  for (const q of detectDrift(flow, current).questions) {
    if (answers[q.id]) fieldAnswers[q.purpose] = answers[q.id]
  }
  return {
    ...flow,
    steps: current.steps.map((s) => ({ ...s, fields: s.fields.map((f) => ({ ...f })) })),
    fieldAnswers,
    status: "healthy",
    lastHealedAt: new Date().toISOString(),
  }
}
```

### src/runner.ts

```ts
import { TaughtFlow } from "./types"

export interface RunResult {
  ok: boolean
  confirmedByHuman: boolean
  stepsExecuted: number
  message: string
  needsHealing?: boolean
}

type Executor = (flow: TaughtFlow, params: Record<string, unknown>, signal: AbortSignal) => Promise<RunResult>

let executor: Executor | null = null

export function setRunExecutor(fn: Executor | null) { executor = fn }

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export async function runFlowInteractive(
  flow: TaughtFlow,
  params: Record<string, unknown>,
  signal: AbortSignal
): Promise<RunResult> {
  if (!location.hash.startsWith("#/site")) location.hash = "#/site"
  const started = Date.now()
  while (!executor && Date.now() - started < 5000) await sleep(100)
  if (!executor) return { ok: false, confirmedByHuman: false, stepsExecuted: 0, message: "Site view not available" }
  return executor(flow, params, signal)
}
```

### src/webmcp.ts

```ts
// WebMCP integration layer.
// VERIFY FIRST: WebMCP is experimental. Confirm the registerTool signature,
// declarative attribute names, and tool-change propagation against Chrome docs
// (developer.chrome.com/docs/ai/webmcp/build-tools) and the spec
// (webmachinelearning.github.io/webmcp). Adjust here if needed.

import { getActiveSiteModel, TaughtFlow } from "./types"
import { getFlow, loadFlows, logEvent, upsertFlow } from "./store"
import { detectDrift, healFlow } from "./drift"
import { runFlowInteractive } from "./runner"
import { beginTeaching } from "./TeachMode"

export interface WebMCPTool {
  name: string
  description: string
  inputSchema: { type: "object"; properties: Record<string, unknown>; required?: string[] }
  execute(args: Record<string, unknown>, options: { signal: AbortSignal }): Promise<unknown>
}

declare global {
  interface Document {
    modelContext?: { registerTool(tool: WebMCPTool): unknown }
  }
}

// Mirror registry so the Tools view can show registered tools
// even in browsers without WebMCP support.
const registered = new Map<string, WebMCPTool>()

export function getRegisteredTools(): WebMCPTool[] { return [...registered.values()] }

export function webmcpAvailable(): boolean {
  return typeof document !== "undefined" && !!document.modelContext
}

export function registerTool(tool: WebMCPTool): boolean {
  if (registered.has(tool.name)) return true
  const native = webmcpAvailable()
  if (native) document.modelContext!.registerTool(tool)
  registered.set(tool.name, tool)
  return native
}

// --- validation helpers: tool args are untrusted input ---

function str(args: Record<string, unknown>, key: string): string {
  const v = args[key]
  if (typeof v !== "string" || !v.trim()) throw new Error(`${key} must be a non-empty string`)
  return v
}

function flowSummary(f: TaughtFlow) {
  return {
    id: f.id, name: f.name, intent: f.intent, status: f.status,
    taughtAt: f.taughtAt, runCount: f.runCount, lastHealedAt: f.lastHealedAt,
  }
}

function driftGuard(flow: TaughtFlow) {
  const report = detectDrift(flow, getActiveSiteModel())
  if (report.status === "drifted") {
    upsertFlow({ ...flow, status: "drifted" })
    logEvent("drift", `Drift detected in ${flow.name}: ${report.changes.length} change(s)`)
  } else if (flow.status !== "healthy") {
    upsertFlow({ ...flow, status: "healthy" })
  }
  return report
}

let staticRegistered = false

export function registerStaticTools() {
  if (staticRegistered) return
  staticRegistered = true

  registerTool({
    name: "list_flows",
    description: "List the user's saved taught flows with health status. Always call this first to see what the user has taught.",
    inputSchema: { type: "object", properties: {} },
    execute: async () => loadFlows().map(flowSummary),
  })

  registerTool({
    name: "check_flow_health",
    description: "Check a taught flow against the current site version. Returns detected changes in plain English and any questions that need a human answer.",
    inputSchema: {
      type: "object",
      properties: { flowId: { type: "string", description: "ID of the flow to check" } },
      required: ["flowId"],
    },
    execute: async (args) => {
      const flow = getFlow(str(args, "flowId"))
      if (!flow) return { error: "flow not found" }
      return detectDrift(flow, getActiveSiteModel())
    },
  })

  registerTool({
    name: "run_flow",
    description: "Execute a taught flow on the site with the given parameters. The human sees every step on screen and must approve the final submit.",
    inputSchema: {
      type: "object",
      properties: {
        flowId: { type: "string" },
        params: { type: "object", description: "Parameter values matching the flow's minted schema" },
      },
      required: ["flowId"],
    },
    execute: async (args, { signal }) => {
      const flow = getFlow(str(args, "flowId"))
      if (!flow) return { error: "flow not found" }
      const report = driftGuard(flow)
      if (report.questions.length > 0) {
        return {
          needsHealing: true,
          message: "The site changed since this flow was taught. Share the questions with the user and call heal_flow with their answers.",
          report,
        }
      }
      const params = args.params && typeof args.params === "object" ? (args.params as Record<string, unknown>) : {}
      const result = await runFlowInteractive(flow, params, signal)
      if (result.ok) {
        upsertFlow({ ...getFlow(flow.id)!, status: "healthy", runCount: flow.runCount + 1, lastRunAt: new Date().toISOString() })
        logEvent("run", `Ran ${flow.name}: ${result.message}`)
        logEvent("confirm", `Human approved ${flow.name} run`)
      }
      return result
    },
  })

  registerTool({
    name: "heal_flow",
    description: "Apply the user's answers to repair a drifted flow so it matches the current site. Call after check_flow_health returns questions.",
    inputSchema: {
      type: "object",
      properties: {
        flowId: { type: "string" },
        answers: { type: "array", description: "Array of {questionId, answer} from the user", items: { type: "object" } },
      },
      required: ["flowId", "answers"],
    },
    execute: async (args) => {
      const flow = getFlow(str(args, "flowId"))
      if (!flow) return { error: "flow not found" }
      const raw = args.answers
      if (!Array.isArray(raw)) return { error: "answers must be an array" }
      const answers: Record<string, string> = {}
      for (const a of raw) {
        if (a && typeof a === "object" && typeof (a as Record<string, unknown>).questionId === "string") {
          const rec = a as Record<string, unknown>
          answers[rec.questionId as string] = String(rec.answer ?? "")
        }
      }
      const healed = healFlow(flow, getActiveSiteModel(), answers)
      upsertFlow(healed)
      logEvent("heal", `Healed ${flow.name} with ${Object.keys(answers).length} answer(s)`)
      return flowSummary(healed)
    },
  })

  registerTool({
    name: "get_site_info",
    description: "Get the demo site's current version and changelog.",
    inputSchema: { type: "object", properties: {} },
    execute: async () => {
      const site = getActiveSiteModel()
      return { version: site.version, changelog: site.changelog }
    },
  })

  registerTool({
    name: "start_teaching",
    description: "Enter teach mode so the user can demonstrate a new flow by hand. Navigates the page to the site in teach mode.",
    inputSchema: {
      type: "object",
      properties: { flowName: { type: "string", description: "Short name like book_appointment" } },
    },
    execute: async (args) => {
      const name = typeof args.flowName === "string" && args.flowName ? args.flowName : "my_flow"
      beginTeaching(name)
      return { teachMode: true, message: "Teach mode started. Ask the user to demonstrate the task." }
    },
  })
}

// --- dynamic minting: the magic moment ---

export function mintFlowTool(flowId: string): boolean {
  const flow = getFlow(flowId)
  if (!flow) return false
  const properties: Record<string, unknown> = {}
  const required: string[] = []
  for (const p of flow.params) {
    properties[p.key] = { type: "string", description: p.label }
    required.push(p.key)
  }
  return registerTool({
    name: flow.name,
    description: `${flow.intent}, exactly as the user demonstrated it. Parameters: ${flow.params.map((p) => p.label).join(", ")}. The human approves the final submit on screen.`,
    inputSchema: { type: "object", properties, required },
    execute: async (args, { signal }) => {
      const fresh = getFlow(flowId)
      if (!fresh) return { error: "flow not found" }
      const report = driftGuard(fresh)
      if (report.questions.length > 0) {
        return { needsHealing: true, message: "Site changed. Heal the flow first.", report }
      }
      const params: Record<string, unknown> = {}
      for (const p of fresh.params) {
        if (args[p.key] != null) params[p.key] = String(args[p.key])
      }
      const result = await runFlowInteractive(fresh, params, signal)
      if (result.ok) {
        upsertFlow({ ...getFlow(flowId)!, status: "healthy", runCount: fresh.runCount + 1, lastRunAt: new Date().toISOString() })
        logEvent("run", `Agent ran ${fresh.name} via minted tool: ${result.message}`)
      }
      return result
    },
  })
}
```

### src/TeachMode.tsx

```tsx
import { ReactNode, createContext, useContext, useState } from "react"
import { camel, getActiveSiteModel, slugify, TaughtFlow } from "./types"
import { logEvent, upsertFlow } from "./store"
import { mintFlowTool } from "./webmcp"

export interface RecordedField {
  stepIntent: string
  fieldPurpose: string
  label: string
  value: string
  isParam: boolean
}

interface TeachState {
  active: boolean
  flowName: string
  captured: RecordedField[]
  done: boolean
}

interface TeachContextValue extends TeachState {
  recordField: (f: RecordedField) => void
  complete: () => void
  toggleParam: (fieldPurpose: string) => void
  setName: (name: string) => void
  finalize: () => TaughtFlow | null
  reset: () => void
}

const TeachContext = createContext<TeachContextValue | null>(null)

export function useTeach(): TeachContextValue {
  const ctx = useContext(TeachContext)
  if (!ctx) throw new Error("useTeach outside provider")
  return ctx
}

// Module-level entry so WebMCP tools and deep links can trigger teach mode.
let beginTeachingFn: ((name?: string) => void) | null = null
export function beginTeaching(name?: string) { beginTeachingFn?.(name) }

export function TeachProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<TeachState>({ active: false, flowName: "", captured: [], done: false })

  beginTeachingFn = (name?: string) => {
    setState({ active: true, flowName: name ?? "my_flow", captured: [], done: false })
    location.hash = "#/site?teach=1"
  }

  const value: TeachContextValue = {
    ...state,
    recordField: (f) =>
      setState((s) => ({ ...s, captured: [...s.captured.filter((c) => c.fieldPurpose !== f.fieldPurpose), f] })),
    complete: () => setState((s) => ({ ...s, done: true })),
    toggleParam: (fieldPurpose) =>
      setState((s) => ({ ...s, captured: s.captured.map((c) => (c.fieldPurpose === fieldPurpose ? { ...c, isParam: !c.isParam } : c)) })),
    setName: (name) => setState((s) => ({ ...s, flowName: name })),
    finalize: () => {
      const site = getActiveSiteModel()
      const flow: TaughtFlow = {
        id: `flow_${Date.now()}`,
        name: slugify(state.flowName) || "my_flow",
        intent: `Perform the task the user demonstrated on the clinic site`,
        taughtAt: new Date().toISOString(),
        siteVersionAtTeach: site.version,
        params: state.captured
          .filter((c) => c.isParam)
          .map((c) => ({
            key: camel(c.fieldPurpose),
            label: c.label,
            type: "string",
            sourceField: { stepIntent: c.stepIntent, fieldPurpose: c.fieldPurpose },
          })),
        steps: site.steps.map((s) => ({ ...s, fields: s.fields.map((f) => ({ ...f })) })),
        fieldValues: Object.fromEntries(state.captured.map((c) => [c.fieldPurpose, c.value])),
        status: "never_run",
        runCount: 0,
        lastRunAt: null,
        lastHealedAt: null,
      }
      upsertFlow(flow)
      const nativeOk = mintFlowTool(flow.id)
      logEvent("teach", `Taught "${flow.name}" with ${flow.params.length} parameter(s). Tool minted${nativeOk ? " (native WebMCP)" : " (mirror only)"}`)
      setState({ active: false, flowName: "", captured: [], done: false })
      location.hash = "#/"
      return flow
    },
    reset: () => setState({ active: false, flowName: "", captured: [], done: false }),
  }

  return <TeachContext.Provider value={value}>{children}</TeachContext.Provider>
}
```

### src/SiteApp.tsx

```tsx
import { useCallback, useEffect, useState } from "react"
import { FieldSpec, getActiveSiteModel, TaughtFlow } from "./types"
import { setRunExecutor, RunResult } from "./runner"
import { beginTeaching, useTeach } from "./TeachMode"

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

function valueFor(flow: TaughtFlow, params: Record<string, unknown>, stepIntent: string, field: FieldSpec): string | undefined {
  const p = flow.params.find(
    (x) => x.sourceField.stepIntent === stepIntent && x.sourceField.fieldPurpose === field.purpose
  )
  if (p && params[p.key] != null) return String(params[p.key])
  if (flow.fieldValues[field.purpose]) return flow.fieldValues[field.purpose]
  if (flow.fieldAnswers?.[field.purpose]) return flow.fieldAnswers[field.purpose]
  return undefined
}

export default function SiteApp() {
  const site = getActiveSiteModel()
  const teach = useTeach()
  const [stepIndex, setStepIndex] = useState(0)
  const [values, setValues] = useState<Record<string, string>>({})
  const [flash, setFlash] = useState<string | null>(null)
  const [agentNote, setAgentNote] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<null | { resolve: (ok: boolean) => void }>(null)
  const [highlight, setHighlight] = useState(false)

  // Deep link: #/site?teach=1 activates teach mode without an agent
  useEffect(() => {
    const qs = new URLSearchParams(location.hash.split("?")[1] ?? "")
    if (qs.get("teach") === "1" && !teach.active) beginTeaching("book_appointment")
  }, [])

  const step = site.steps[stepIndex]

  // Agent run executor: drives this same wizard with animation + human confirm.
  useEffect(() => {
    setRunExecutor(async (flow, params, signal): Promise<RunResult> => {
      setAgentNote("Agent is running your flow...")
      const model = getActiveSiteModel()
      for (let i = 0; i < model.steps.length; i++) {
        if (signal.aborted) {
          setAgentNote(null)
          return { ok: false, confirmedByHuman: false, stepsExecuted: i, message: "Cancelled" }
        }
        setStepIndex(i)
        setHighlight(true)
        for (const field of model.steps[i].fields) {
          const v = valueFor(flow, params, model.steps[i].intent, field)
          if (v == null && field.required) {
            setAgentNote(null)
            setHighlight(false)
            return {
              ok: false, confirmedByHuman: false, stepsExecuted: i, needsHealing: true,
              message: `The site now requires "${field.label}" and the flow has no answer for it. Heal the flow first.`,
            }
          }
          if (v != null) setValues((prev) => ({ ...prev, [field.purpose]: v }))
        }
        await sleep(700)
        if (i < model.steps.length - 1) {
          setHighlight(false)
          await sleep(200)
        }
      }
      const approved = await new Promise<boolean>((resolve) => setConfirm({ resolve }))
      setAgentNote(null)
      setHighlight(false)
      if (!approved) {
        return { ok: false, confirmedByHuman: false, stepsExecuted: model.steps.length, message: "Human rejected the submit" }
      }
      const ref = `NSC-${Math.floor(1000 + Math.random() * 9000)}`
      setFlash(`Booked. Confirmation ${ref}`)
      setStepIndex(0)
      setValues({})
      return { ok: true, confirmedByHuman: true, stepsExecuted: model.steps.length, message: `Booking confirmed (${ref})` }
    })
    return () => setRunExecutor(null)
  }, [])

  const setField = useCallback(
    (field: FieldSpec, value: string) => {
      setValues((v) => ({ ...v, [field.purpose]: value }))
      if (teach.active) {
        teach.recordField({
          stepIntent: step.intent,
          fieldPurpose: field.purpose,
          label: field.label,
          value,
          isParam: true,
        })
      }
    },
    [step, teach]
  )

  const advance = () => {
    if (stepIndex < site.steps.length - 1) {
      setStepIndex(stepIndex + 1)
    } else if (teach.active) {
      teach.complete()
    } else {
      setFlash(`Booked. Confirmation NSC-${Math.floor(1000 + Math.random() * 9000)}`)
      setStepIndex(0)
      setValues({})
    }
  }

  return (
    <div className="site-wrap">
      {site.version === "2.0" && (
        <div className="banner">We've updated our booking experience. v{site.version}</div>
      )}
      <div className="site-head">
        <h2>Northside Family Clinic</h2>
        <div className="version-switch">
          <a href="#/site?v=1" className={site.version === "1.0" ? "on" : ""}>v1</a>
          <a href="#/site?v=2" className={site.version === "2.0" ? "on" : ""}>v2</a>
          <a href="#/">library</a>
        </div>
      </div>

      {teach.active && !teach.done && <div className="teach-badge">Recording your demonstration</div>}
      {agentNote && <div className="agent-note">Agent: {agentNote}</div>}
      {flash && <div className="flash">{flash}</div>}

      <div className={"wizard " + (highlight ? "highlight" : "")}>
        <div className="steps-bar">
          {site.steps.map((s, i) => (
            <span key={s.intent} className={i === stepIndex ? "on" : i < stepIndex ? "done" : ""}>
              {i + 1}
            </span>
          ))}
        </div>
        <h3>
          Step {stepIndex + 1}: {step.intent}
        </h3>
        {/* Declarative WebMCP exposure: verify attribute names against the current spec */}
        <form
          toolname="clinic_booking_form"
          tooldescription="Book an appointment at Northside Family Clinic"
          onSubmit={(e) => {
            e.preventDefault()
            advance()
          }}
        >
          {step.fields.map((f) => (
            <label key={f.purpose} className="field">
              <span>
                {f.label}
                {f.required ? " *" : ""}
              </span>
              {f.type === "select" ? (
                <select
                  toolparamdescription={f.label}
                  value={values[f.purpose] ?? ""}
                  onChange={(e) => setField(f, e.target.value)}
                >
                  <option value="">Choose...</option>
                  {(f.options ?? []).map((o) => (
                    <option key={o} value={o}>
                      {o}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  toolparamdescription={f.label}
                  type={f.type === "tel" ? "tel" : f.type === "date" ? "date" : "text"}
                  value={values[f.purpose] ?? ""}
                  onChange={(e) => setField(f, e.target.value)}
                />
              )}
            </label>
          ))}
          <button type="submit">{step.submitLabel}</button>
        </form>
      </div>

      {teach.done && <FinalizePanel />}

      {confirm && (
        <div className="modal-backdrop">
          <div className="modal">
            <h3>Agent wants to submit</h3>
            <p>Your agent finished the booking flow and is waiting for your approval to submit.</p>
            <div className="modal-actions">
              <button
                className="deny"
                onClick={() => {
                  confirm.resolve(false)
                  setConfirm(null)
                }}
              >
                Deny
              </button>
              <button
                className="primary"
                onClick={() => {
                  confirm.resolve(true)
                  setConfirm(null)
                }}
              >
                Approve
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function FinalizePanel() {
  const teach = useTeach()
  const [name, setName] = useState(teach.flowName)
  return (
    <div className="modal-backdrop">
      <div className="modal">
        <h3>Create the tool</h3>
        <p>Your demonstration was captured. Mark which fields the agent may change.</p>
        {teach.captured.map((c) => (
          <label key={c.fieldPurpose} className="param-row">
            <input type="checkbox" checked={c.isParam} onChange={() => teach.toggleParam(c.fieldPurpose)} />
            <span>
              <b>{c.label}</b> <small>(demo value: {c.value || "none"})</small>
            </span>
          </label>
        ))}
        <label className="field">
          <span>Tool name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <div className="modal-actions">
          <button className="deny" onClick={() => teach.reset()}>
            Discard
          </button>
          <button
            className="primary"
            onClick={() => {
              teach.setName(name)
              teach.finalize()
            }}
          >
            Mint tool
          </button>
        </div>
      </div>
    </div>
  )
}
```

### src/App.tsx

```tsx
import { useEffect, useState } from "react"
import { getActiveSiteModel, TaughtFlow } from "./types"
import { deleteFlow, getAudit, loadFlows, logEvent, subscribe, upsertFlow } from "./store"
import { detectDrift, healFlow } from "./drift"
import { getRegisteredTools, registerStaticTools, webmcpAvailable } from "./webmcp"
import { TeachProvider } from "./TeachMode"
import SiteApp from "./SiteApp"

function useHashRoute() {
  const [hash, setHash] = useState(location.hash || "#/")
  useEffect(() => {
    const f = () => setHash(location.hash || "#/")
    window.addEventListener("hashchange", f)
    return () => window.removeEventListener("hashchange", f)
  }, [])
  const [path, qs] = hash.replace(/^#/, "").split("?")
  return { path, query: new URLSearchParams(qs ?? "") }
}

export default function App() {
  useEffect(() => {
    registerStaticTools()
  }, [])
  const { path } = useHashRoute()
  return (
    <TeachProvider>
      <div className="shell">
        <header>
          <a href="#/">Flow Library</a>
          <a href="#/site">Demo Site</a>
          <a href="#/tools">Tools</a>
          {!webmcpAvailable() && (
            <span className="warn">WebMCP not detected. Use Chrome with the flag, or ChatGPT desktop.</span>
          )}
        </header>
        {path === "/site" ? <SiteApp /> : path === "/tools" ? <ToolsView /> : <Library />}
      </div>
    </TeachProvider>
  )
}

function Library() {
  const [flows, setFlows] = useState<TaughtFlow[]>([])
  const [healId, setHealId] = useState<string | null>(null)
  const refresh = () => {
    const site = getActiveSiteModel()
    loadFlows().forEach((f) => {
      const status = detectDrift(f, site).status
      if (status !== f.status) upsertFlow({ ...f, status })
    })
    setFlows(loadFlows())
  }
  useEffect(() => {
    refresh()
    return subscribe(refresh)
  }, [])

  return (
    <main>
      <h1>Your taught flows</h1>
      <p className="sub">
        Demonstrate a task once on the demo site. The app mints a WebMCP tool your agent can call.
        If the site changes, the flow heals with one answer.
      </p>
      <div className="cards">
        {flows.length === 0 && (
          <div className="card empty">
            Nothing yet. <a href="#/site?teach=1">Teach your first flow</a>
          </div>
        )}
        {flows.map((f) => (
          <div key={f.id} className="card">
            <div className="card-head">
              <b>{f.name}</b>
              <span className={"badge " + f.status}>{f.status.replace("_", " ")}</span>
            </div>
            <p>
              {f.params.length} parameter(s). Taught on v{f.siteVersionAtTeach}. Run {f.runCount}x
              {f.lastHealedAt ? ". Healed " + new Date(f.lastHealedAt).toLocaleDateString() : ""}
            </p>
            <div className="row">
              <button
                onClick={() => {
                  navigator.clipboard?.writeText(
                    "Run my " + f.name + " flow: service checkup, next Friday, 10:00 AM, patient name Jane Doe"
                  )
                  logEvent("run", "Suggested agent prompt copied for " + f.name)
                }}
                title="Copies a prompt you can paste to your agent"
              >
                Run (via agent)
              </button>
              {f.status === "drifted" && (
                <button className="primary" onClick={() => setHealId(f.id)}>
                  Heal
                </button>
              )}
              <button
                className="deny"
                onClick={() => {
                  deleteFlow(f.id)
                  logEvent("delete", "Deleted " + f.name)
                  refresh()
                }}
              >
                Delete
              </button>
            </div>
          </div>
        ))}
      </div>
      {healId && <HealView flowId={healId} onDone={() => { setHealId(null); refresh() }} />}
      <AuditTrail />
    </main>
  )
}

function HealView({ flowId, onDone }: { flowId: string; onDone: () => void }) {
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const flow = loadFlows().find((f) => f.id === flowId)
  if (!flow) return null
  const report = detectDrift(flow, getActiveSiteModel())
  return (
    <div className="modal-backdrop">
      <div className="modal">
        <h3>Heal this flow: {flow.name}</h3>
        <p>The site changed since you taught this. Detected:</p>
        <ul className="changes">
          {report.changes.map((c, i) => (
            <li key={i}>
              <span className={"tag " + (c.autoHealable ? "auto" : "ask")}>{c.type}</span> {c.description}
            </li>
          ))}
        </ul>
        {report.questions.map((q) => (
          <label key={q.id} className="field">
            <span>{q.question}</span>
            <input
              value={answers[q.id] ?? ""}
              onChange={(e) => setAnswers((a) => ({ ...a, [q.id]: e.target.value }))}
            />
          </label>
        ))}
        <div className="modal-actions">
          <button className="deny" onClick={onDone}>
            Later
          </button>
          <button
            className="primary"
            onClick={() => {
              const healed = healFlow(flow, getActiveSiteModel(), answers)
              upsertFlow(healed)
              logEvent("heal", "Healed " + flow.name + " from the UI")
              onDone()
            }}
          >
            Heal flow
          </button>
        </div>
      </div>
    </div>
  )
}

function ToolsView() {
  const [, force] = useState(0)
  useEffect(() => {
    const t = setInterval(() => force((n) => n + 1), 1000)
    return () => clearInterval(t)
  }, [])
  const tools = getRegisteredTools()
  return (
    <main>
      <h1>Registered tools</h1>
      <p className="sub">
        Live registry. Taught flows mint new tools here mid-session. The agent sees them without a reload.
      </p>
      <div className="cards">
        {tools.map((t) => (
          <div key={t.name} className="card">
            <b>{t.name}</b>
            <p>{t.description}</p>
            <small>{Object.keys(t.inputSchema.properties ?? {}).length} parameter(s)</small>
          </div>
        ))}
      </div>
    </main>
  )
}

function AuditTrail() {
  const [events, setEvents] = useState(getAudit())
  useEffect(() => subscribe(() => setEvents(getAudit())), [])
  return (
    <section className="audit">
      <h2>Audit trail</h2>
      {events.length === 0 && <p className="sub">Nothing yet.</p>}
      <ul>
        {events.slice(0, 12).map((e, i) => (
          <li key={i}>
            <small>{new Date(e.at).toLocaleTimeString()}</small>{" "}
            <span className={"tag " + e.type}>{e.type}</span> {e.detail}
          </li>
        ))}
      </ul>
    </section>
  )
}
```

### src/styles.css

```css
* { box-sizing: border-box; }
body { margin: 0; font-family: system-ui, -apple-system, "Segoe UI", sans-serif; background: #f7faf9; color: #12312d; }
a { color: #0f766e; }
.shell { max-width: 860px; margin: 0 auto; padding: 16px; }
header { display: flex; gap: 18px; align-items: center; padding: 12px 0; border-bottom: 1px solid #d8e6e2; margin-bottom: 20px; }
header a { text-decoration: none; font-weight: 600; }
.warn { color: #b45309; font-size: 13px; }
h1 { font-size: 26px; margin: 8px 0; }
h2 { font-size: 18px; }
.sub { color: #4a6b66; }
.cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(250px, 1fr)); gap: 14px; }
.card { background: #fff; border: 1px solid #d8e6e2; border-radius: 12px; padding: 16px; box-shadow: 0 1px 2px rgba(18, 49, 45, 0.05); }
.card.empty { grid-column: 1 / -1; }
.card-head { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
.badge { font-size: 12px; padding: 2px 10px; border-radius: 999px; }
.badge.healthy { background: #d1fae5; color: #065f46; }
.badge.drifted { background: #fef3c7; color: #92400e; }
.badge.never_run { background: #e5e7eb; color: #374151; }
.row { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 8px; }
button { border: 1px solid #cbd5d1; background: #fff; color: #12312d; padding: 8px 14px; border-radius: 8px; cursor: pointer; font-weight: 600; }
button.primary { background: #0f766e; border-color: #0f766e; color: #fff; }
button.deny { color: #b91c1c; border-color: #f3c8c8; }
input, select { width: 100%; padding: 9px 10px; border: 1px solid #cbd5d1; border-radius: 8px; font-size: 15px; background: #fff; }
.field { display: block; margin: 10px 0; }
.field span { display: block; font-size: 13px; margin-bottom: 4px; color: #33554f; }
.site-wrap { max-width: 560px; margin: 0 auto; }
.site-head { display: flex; justify-content: space-between; align-items: baseline; gap: 10px; }
.version-switch a { margin-left: 8px; text-decoration: none; font-size: 13px; padding: 3px 8px; border-radius: 6px; }
.version-switch a.on { background: #0f766e; color: #fff; }
.banner { background: #ecfdf5; border: 1px solid #a7f3d0; color: #065f46; padding: 10px 14px; border-radius: 10px; margin-bottom: 14px; font-weight: 600; }
.teach-badge { background: #fee2e2; color: #991b1b; padding: 8px 12px; border-radius: 8px; font-weight: 600; margin-bottom: 12px; }
.agent-note { background: #e0f2fe; color: #075985; padding: 8px 12px; border-radius: 8px; margin-bottom: 12px; }
.flash { background: #d1fae5; color: #065f46; padding: 10px 12px; border-radius: 8px; margin-bottom: 12px; font-weight: 600; }
.wizard { background: #fff; border: 1px solid #d8e6e2; border-radius: 14px; padding: 20px; transition: box-shadow 0.3s; }
.wizard.highlight { box-shadow: 0 0 0 3px #0f766e; }
.steps-bar { display: flex; gap: 6px; margin-bottom: 12px; }
.steps-bar span { width: 26px; height: 26px; border-radius: 50%; display: grid; place-items: center; background: #e5e7eb; color: #6b7280; font-size: 13px; font-weight: 700; }
.steps-bar span.on { background: #0f766e; color: #fff; }
.steps-bar span.done { background: #99f6e4; color: #134e4a; }
.modal-backdrop { position: fixed; inset: 0; background: rgba(18, 49, 45, 0.45); display: grid; place-items: center; z-index: 50; padding: 16px; }
.modal { background: #fff; border-radius: 14px; padding: 22px; max-width: 460px; width: 100%; max-height: 85vh; overflow: auto; }
.modal-actions { display: flex; gap: 10px; justify-content: flex-end; margin-top: 14px; }
.param-row { display: flex; gap: 8px; align-items: center; margin: 6px 0; }
.param-row input { width: auto; }
.changes { padding-left: 18px; }
.changes li { margin: 6px 0; }
.tag { font-size: 11px; font-weight: 700; padding: 2px 7px; border-radius: 6px; }
.tag.auto, .tag.teach, .tag.run, .tag.heal, .tag.confirm { background: #d1fae5; color: #065f46; }
.tag.ask, .tag.drift, .tag.delete { background: #fef3c7; color: #92400e; }
.audit { margin-top: 32px; border-top: 1px solid #d8e6e2; padding-top: 12px; }
.audit ul { padding-left: 18px; }
.audit li { margin: 5px 0; }
```

## 9. Definition of Done

The project is complete when all of the following are true:

- The full demo loop (section 4) passes twice in a row in Chrome with the
  WebMCP flag and in the ChatGPT desktop in-app browser
- Every edge case in section 6 passes
- All of P0 and P1 complete (P2 only if everything else is green)
- npm run build completes with zero errors
- Deployed to Vercel, cold loads in a fresh browser with no cache
- Repo is public with the MIT license visible in the About section
- README accurately reflects what the app does
- Firefox shows the graceful degradation banner without crashing

When done, report back with: the live URL, the repo URL, a summary of what
was verified (demo loop results per browser, edge case results), and any
deviations from this spec with reasons.
