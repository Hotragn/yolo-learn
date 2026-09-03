// WebMCP integration layer.
//
// VERIFIED 2026-09-02 against the WebMCP specification
// (webmachinelearning.github.io/webmcp) and the Chrome documentation
// (developer.chrome.com/docs/ai/webmcp). What the spec actually says, and what
// this file therefore does differently from a naive integration:
//
//   1. The entry point is `document.modelContext` (`partial interface Document`,
//      [SecureContext]). An earlier revision of the proposal used
//      `navigator.modelContext`, and shipping builds disagree, so both are
//      feature-detected.
//   2. `registerTool(tool, options)` returns a Promise and REJECTS - it is not
//      a synchronous, idempotent call. It rejects with InvalidStateError when a
//      tool of that name is already registered, so every tool name must be
//      unique before it is offered.
//   3. There is no unregisterTool in the spec. A tool is removed by aborting
//      the AbortSignal passed in `options.signal`.
//   4. Both register and getTools reject with SecurityError unless the document
//      is origin-keyed. That is why the app ships an `Origin-Agent-Cluster: ?1`
//      response header (see vite.config.ts and vercel.json); without it, the
//      deployed site cannot register anything.
//   5. execute is `Promise<any> (object inputObject, {AbortSignal signal})`.
//   6. `annotations.readOnlyHint` / `annotations.untrustedContentHint` are part
//      of the tool descriptor and are set honestly below.
//   7. Tool changes propagate through the `toolchange` event, so the Tools view
//      listens instead of polling.

import { coerceValue, getActiveSiteModel, TaughtFlow } from "./types"
import { getFlow, loadFlows, logEvent, patchFlow } from "./store"
import { detectDrift, effectiveStatus, healFlow, storedValue } from "./drift"
import { normalizeParams, runFlowInteractive } from "./runner"
import { beginTeaching } from "./TeachMode"

export interface ToolAnnotations {
  readOnlyHint?: boolean
  untrustedContentHint?: boolean
}

export interface WebMCPTool {
  name: string
  description: string
  inputSchema: { type: "object"; properties: Record<string, unknown>; required?: string[] }
  annotations?: ToolAnnotations
  execute(args: Record<string, unknown>, options: { signal: AbortSignal }): Promise<unknown>
}

interface ModelContextLike {
  registerTool(tool: WebMCPTool, options?: { signal?: AbortSignal; exposedTo?: string[] }): unknown
  unregisterTool?(name: string): unknown
  addEventListener?(type: string, listener: () => void): void
}

declare global {
  interface Document {
    modelContext?: ModelContextLike
  }
  interface Navigator {
    modelContext?: ModelContextLike
  }
}

function modelContext(): { mc: ModelContextLike; entryPoint: "document" | "navigator" } | null {
  if (typeof document === "undefined") return null
  if (document.modelContext) return { mc: document.modelContext, entryPoint: "document" }
  if (typeof navigator !== "undefined" && navigator.modelContext) {
    return { mc: navigator.modelContext, entryPoint: "navigator" }
  }
  return null
}

export function webmcpAvailable(): boolean {
  return modelContext() !== null
}

export interface WebMCPStatus {
  available: boolean
  entryPoint: "document" | "navigator" | null
  /** WebMCP is refused outright in documents that are not origin-keyed. */
  originIsolated: boolean
  nativeCount: number
  lastError: string | null
}

let lastError: string | null = null

export function webmcpStatus(): WebMCPStatus {
  const ctx = modelContext()
  return {
    available: !!ctx,
    entryPoint: ctx?.entryPoint ?? null,
    originIsolated: typeof window !== "undefined" ? window.originAgentCluster !== false : false,
    nativeCount: [...registry.values()].filter((e) => e.native).length,
    lastError,
  }
}

// --- mirror registry -----------------------------------------------------
// Kept in lockstep with the native registry so the Tools view, the built-in
// agent simulator and browsers without WebMCP all see the same tools.

export interface ToolEntry {
  tool: WebMCPTool
  native: boolean
  mintedThisSession: boolean
  flowId?: string
  error?: string
}

const registry = new Map<string, ToolEntry>()
const listeners = new Set<() => void>()

function emit() {
  for (const l of [...listeners]) {
    try { l() } catch (err) { console.error("tool listener failed", err) }
  }
}

export function subscribeTools(l: () => void): () => void {
  listeners.add(l)
  return () => { listeners.delete(l) }
}

export function getToolEntries(): ToolEntry[] {
  return [...registry.values()]
}

export function getRegisteredTools(): WebMCPTool[] {
  return [...registry.values()].map((e) => e.tool)
}

export function isToolRegistered(name: string): boolean {
  return registry.has(name)
}

const controllers = new Map<string, AbortController>()
let nativeChangeHookAttached = false

function attachNativeChangeHook() {
  if (nativeChangeHookAttached) return
  const ctx = modelContext()
  if (!ctx?.mc.addEventListener) return
  nativeChangeHookAttached = true
  try {
    ctx.mc.addEventListener("toolchange", () => emit())
  } catch {
    nativeChangeHookAttached = false
  }
}

export interface RegisterOutcome {
  name: string
  native: boolean
  error?: string
}

export async function registerTool(
  tool: WebMCPTool,
  opts: { mintedThisSession?: boolean; flowId?: string } = {}
): Promise<RegisterOutcome> {
  if (registry.has(tool.name)) {
    return { name: tool.name, native: registry.get(tool.name)!.native, error: "already registered" }
  }

  const ctx = modelContext()
  let native = false
  let error: string | undefined

  if (ctx) {
    const controller = new AbortController()
    try {
      // registerTool returns a Promise. Awaiting it is the only way to learn
      // that the name collided or that the document is not origin-keyed.
      await ctx.mc.registerTool(tool, { signal: controller.signal })
      controllers.set(tool.name, controller)
      native = true
      attachNativeChangeHook()
    } catch (err) {
      error = err instanceof Error ? `${err.name}: ${err.message}` : String(err)
      lastError = error
    }
  }

  registry.set(tool.name, {
    tool,
    native,
    mintedThisSession: !!opts.mintedThisSession,
    flowId: opts.flowId,
    error,
  })
  emit()
  return { name: tool.name, native, error }
}

export function unregisterTool(name: string) {
  const controller = controllers.get(name)
  if (controller) {
    controller.abort()
    controllers.delete(name)
  } else {
    // Some builds expose an explicit remover; harmless if absent.
    try { modelContext()?.mc.unregisterTool?.(name) } catch { /* best effort */ }
  }
  registry.delete(name)
  emit()
}

/** Run a tool through the mirror, exactly as an agent would. */
export async function executeToolByName(
  name: string,
  args: Record<string, unknown>,
  signal?: AbortSignal
): Promise<unknown> {
  const entry = registry.get(name)
  if (!entry) return { error: `No tool named "${name}" is registered.` }
  const controller = new AbortController()
  if (signal) signal.addEventListener("abort", () => controller.abort(), { once: true })
  return entry.tool.execute(args, { signal: controller.signal })
}

// --- argument validation: tool args are untrusted input ------------------

type Bad = { error: string }
const isBad = (v: unknown): v is Bad => !!v && typeof v === "object" && "error" in (v as object)

function aborted(signal: AbortSignal): Bad | null {
  return signal.aborted ? { error: "Cancelled before the tool ran." } : null
}

/**
 * Agents hold the tool name, not our internal id, so accept either. Returning
 * the list of known flows on a miss saves a round trip.
 */
function resolveFlow(args: Record<string, unknown>): TaughtFlow | Bad {
  const id = coerceValue(args.flowId).trim()
  const name = coerceValue(args.flowName ?? args.name).trim()
  const flows = loadFlows()
  if (!id && !name) {
    return { error: `Pass flowId or flowName. Known flows: ${flows.map((f) => f.name).join(", ") || "none yet"}` }
  }
  const found =
    (id && flows.find((f) => f.id === id)) ||
    (name && flows.find((f) => f.name === name)) ||
    (name && flows.find((f) => f.name.toLowerCase() === name.toLowerCase()))
  if (!found) {
    return { error: `No flow matches "${id || name}". Known flows: ${flows.map((f) => f.name).join(", ") || "none yet"}` }
  }
  return found
}

function flowSummary(f: TaughtFlow) {
  return {
    id: f.id,
    name: f.name,
    toolName: f.name,
    intent: f.intent,
    status: f.status,
    taughtAt: f.taughtAt,
    taughtOnSiteVersion: f.siteVersionAtTeach,
    runCount: f.runCount,
    lastRunAt: f.lastRunAt,
    lastHealedAt: f.lastHealedAt,
    parameters: f.params.map((p) => ({ key: p.key, describes: p.label })),
  }
}

/** Refresh the stored health of a flow and report what the site looks like now. */
function driftGuard(flow: TaughtFlow) {
  const report = detectDrift(flow, getActiveSiteModel())
  const status = effectiveStatus(flow, report)
  if (status !== flow.status) {
    patchFlow(flow.id, { status })
    if (status === "drifted") logEvent("drift", `Drift detected in ${flow.name}: ${report.summary}`)
  }
  return report
}

function recordRun(flowId: string, ok: boolean, message: string) {
  const flow = getFlow(flowId)
  if (!flow) return // deleted mid-run; nothing to record
  const runs = [{ at: new Date().toISOString(), ok, message }, ...(flow.runs ?? [])].slice(0, 3)
  patchFlow(flowId, {
    runs,
    runCount: ok ? flow.runCount + 1 : flow.runCount,
    lastRunAt: new Date().toISOString(),
    status: ok ? "healthy" : flow.status,
  })
}

// --- static tools --------------------------------------------------------

let staticRegistered = false

export async function registerStaticTools(): Promise<void> {
  if (staticRegistered) return
  staticRegistered = true

  await registerTool({
    name: "list_flows",
    description:
      "List the flows this user has taught, with their health status and the parameters each one accepts. " +
      "Call this first: each taught flow also exists as its own tool, named after the flow.",
    inputSchema: { type: "object", properties: {} },
    annotations: { readOnlyHint: true, untrustedContentHint: true },
    execute: async (_args, { signal }) => {
      const bad = aborted(signal)
      if (bad) return bad
      const flows = loadFlows()
      return {
        summary: flows.length
          ? `${flows.length} taught flow(s): ${flows.map((f) => `${f.name} (${f.status})`).join(", ")}`
          : "No flows taught yet. Call start_teaching to have the user demonstrate one.",
        siteVersion: getActiveSiteModel().version,
        flows: flows.map(flowSummary),
      }
    },
  })

  await registerTool({
    name: "check_flow_health",
    description:
      "Compare a taught flow against the demo site as it looks right now. Returns every change in plain " +
      "English, which changes heal by themselves, and the questions that need an answer from the user. " +
      "Omit the arguments to check every flow at once.",
    inputSchema: {
      type: "object",
      properties: {
        flowId: { type: "string", description: "Flow id from list_flows" },
        flowName: { type: "string", description: "Flow name, if you do not have the id" },
      },
    },
    annotations: { readOnlyHint: true, untrustedContentHint: true },
    execute: async (args, { signal }) => {
      const bad = aborted(signal)
      if (bad) return bad
      const site = getActiveSiteModel()

      if (!coerceValue(args.flowId).trim() && !coerceValue(args.flowName ?? args.name).trim()) {
        const all = loadFlows().map((f) => ({ flow: f.name, ...detectDrift(f, site) }))
        return {
          summary: all.length ? `Checked ${all.length} flow(s) against site v${site.version}.` : "No flows to check.",
          siteVersion: site.version,
          reports: all,
        }
      }

      const flow = resolveFlow(args)
      if (isBad(flow)) return flow
      const report = driftGuard(flow)
      return {
        ...report,
        flow: flow.name,
        siteVersion: site.version,
        nextStep: report.questions.length
          ? "Ask the user these questions, then call heal_flow with their answers."
          : report.changes.length
            ? "Everything here heals automatically. Call heal_flow, then run the flow."
            : "Nothing to do. The flow can run as taught.",
      }
    },
  })

  await registerTool({
    name: "run_flow",
    description:
      "Run a taught flow on the demo site. Every step is animated on screen and the user must approve the " +
      "final submit before anything is sent. Values you do not supply fall back to what the user demonstrated.",
    inputSchema: {
      type: "object",
      properties: {
        flowId: { type: "string", description: "Flow id from list_flows" },
        flowName: { type: "string", description: "Flow name, if you do not have the id" },
        params: { type: "object", description: "Parameter values, keyed as listed by list_flows" },
      },
    },
    annotations: { readOnlyHint: false, untrustedContentHint: true },
    execute: async (args, { signal }) => {
      const bad = aborted(signal)
      if (bad) return bad
      const flow = resolveFlow(args)
      if (isBad(flow)) return flow

      const report = driftGuard(flow)
      if (report.questions.length > 0) {
        return {
          ...report,
          needsHealing: true,
          summary: `${flow.name} cannot run yet: ${report.summary}`,
          message: "The site changed since this flow was learned. Ask the user these questions, then call heal_flow.",
        }
      }

      const raw = args.params && typeof args.params === "object" ? (args.params as Record<string, unknown>) : {}
      const { params, errors, ignoredKeys } = normalizeParams(flow, raw, getActiveSiteModel())
      if (errors.length) return { error: errors.join(" "), summary: "Nothing was submitted." }

      const result = await runFlowInteractive(flow, params, signal)
      recordRun(flow.id, result.ok, result.message)
      if (result.ok) {
        logEvent("run", `Ran ${flow.name}: ${result.message}`)
        logEvent("confirm", `Human approved the submit for ${flow.name}`)
      } else {
        logEvent("run", `${flow.name} did not complete: ${result.message}`)
      }
      return {
        summary: result.message,
        ...result,
        ...(ignoredKeys.length ? { ignoredParams: ignoredKeys } : {}),
      }
    },
  })

  await registerTool({
    name: "heal_flow",
    description:
      "Repair a drifted flow so it matches the site as it looks now. Renames, reorders, removals and reworded " +
      "buttons are healed from the site itself. Pass the user's answers for anything check_flow_health asked about.",
    inputSchema: {
      type: "object",
      properties: {
        flowId: { type: "string", description: "Flow id from list_flows" },
        flowName: { type: "string", description: "Flow name, if you do not have the id" },
        answers: {
          type: "array",
          description: "One entry per question from check_flow_health",
          items: {
            type: "object",
            properties: {
              questionId: { type: "string" },
              answer: { type: "string" },
            },
            required: ["questionId", "answer"],
          },
        },
      },
    },
    annotations: { readOnlyHint: false, untrustedContentHint: true },
    execute: async (args, { signal }) => {
      const bad = aborted(signal)
      if (bad) return bad
      const flow = resolveFlow(args)
      if (isBad(flow)) return flow

      const answers = parseAnswers(args.answers)
      if (isBad(answers)) return answers

      const { flow: healed, applied, remainingQuestions } = healFlow(flow, getActiveSiteModel(), answers)
      if (!getFlow(flow.id)) return { error: "The flow was deleted before it could be healed." }
      patchFlow(flow.id, healed)
      logEvent("heal", `Healed ${flow.name}${applied.length ? ` with an answer for ${applied.join(", ")}` : ""}`)

      return {
        summary: remainingQuestions.length
          ? `${flow.name} still needs an answer for ${remainingQuestions.map((q) => q.label).join(", ")}.`
          : `${flow.name} is healed and matches site v${getActiveSiteModel().version}. It is ready to run.`,
        flow: flowSummary(healed),
        appliedAnswersFor: applied,
        remainingQuestions,
      }
    },
  })

  await registerTool({
    name: "get_site_info",
    description: "Report the demo site's current version and its changelog, so you can explain what changed.",
    inputSchema: { type: "object", properties: {} },
    annotations: { readOnlyHint: true },
    execute: async (_args, { signal }) => {
      const bad = aborted(signal)
      if (bad) return bad
      const site = getActiveSiteModel()
      return {
        summary: `Northside Family Clinic booking, site v${site.version}, ${site.steps.length} steps.`,
        version: site.version,
        changelog: site.changelog,
        steps: site.steps.map((s) => ({
          order: s.order,
          intent: s.intent,
          submitLabel: s.submitLabel,
          fields: s.fields.map((f) => ({ label: f.label, required: !!f.required, options: f.options })),
        })),
      }
    },
  })

  await registerTool({
    name: "learn_site",
    description:
      "Learn the task on the current page autonomously, with no human demonstration. Reads the form the way a " +
      "screen reader would - labels, field names, required flags, option lists - walks the wizard with throwaway " +
      "values, and mints a tool for what it found. Every field it discovers becomes a parameter you supply at call " +
      "time; it never invents a person's details. Use this first on a site the user has not taught. It will not " +
      "press a button unless that button clearly means \"next\", so it cannot submit anything.",
    inputSchema: { type: "object", properties: {} },
    annotations: { readOnlyHint: false, untrustedContentHint: true },
    execute: async (_args, { signal }) => {
      const bad = aborted(signal)
      if (bad) return bad
      // Imported lazily: learn.ts needs mintFlowTool from this module, and a
      // dynamic import keeps that cycle out of the module graph.
      const { learnCurrentSite } = await import("./learn")
      return learnCurrentSite({ signal })
    },
  })

  await registerTool({
    name: "start_teaching",
    description:
      "Put the page into teach mode so the user can demonstrate a task by hand, and remember the values they " +
      "enter. Prefer learn_site when you only need the shape of the task; use this when the user wants their own " +
      "details replayed on every run. Either way the app mints a tool immediately, in this same session.",
    inputSchema: {
      type: "object",
      properties: {
        flowName: { type: "string", description: "Short snake_case name, for example book_appointment" },
      },
    },
    annotations: { readOnlyHint: false },
    execute: async (args, { signal }) => {
      const bad = aborted(signal)
      if (bad) return bad
      const name = coerceValue(args.flowName).trim() || "my_flow"
      beginTeaching(name)
      return {
        summary: "Teach mode is on. Ask the user to complete the task on screen, then mint the tool.",
        teachMode: true,
        flowName: name,
      }
    },
  })
}

/** Answers arrive as an array of {questionId, answer} or as a plain map. */
function parseAnswers(raw: unknown): Record<string, string> | Bad {
  const answers: Record<string, string> = {}
  if (raw == null) return answers
  if (Array.isArray(raw)) {
    for (const a of raw) {
      if (a && typeof a === "object") {
        const rec = a as Record<string, unknown>
        const key = coerceValue(rec.questionId ?? rec.id ?? rec.purpose).trim()
        if (key) answers[key] = coerceValue(rec.answer ?? rec.value)
      }
    }
    return answers
  }
  if (typeof raw === "object") {
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) answers[k] = coerceValue(v)
    return answers
  }
  return { error: "answers must be an array of {questionId, answer} objects, or an object keyed by question id." }
}

// --- dynamic minting: the magic moment -----------------------------------

function mintedDescription(flow: TaughtFlow): string {
  const when = new Date(flow.taughtAt).toLocaleDateString()
  const paramList = flow.params.length
    ? flow.params.map((p) => `${p.key} (${p.sourceField.fieldPurpose})`).join(", ")
    : "no parameters"

  // How the flow was learned changes what is true about its parameters, so it
  // has to change the description too. An autonomously learned flow stored no
  // values at all, and telling an agent it can omit a parameter and get the
  // demonstrated one back would simply be false.
  const provenance =
    flow.learnedBy === "autonomous"
      ? `Learned on ${when} by reading the page itself, with no demonstration and no stored values, ` +
        `so every parameter has to be supplied.`
      : `Taught on ${when} by the user demonstrating it once. Any parameter you omit falls back to the value ` +
        `they demonstrated.`

  return (
    `${flow.intent}. ${provenance} Parameters: ${paramList}. ` +
    `Prefer this over filling the booking form step by step. The user approves the final submit on screen.`
  )
}

export async function mintFlowTool(
  flowId: string,
  opts: { mintedThisSession?: boolean } = {}
): Promise<RegisterOutcome | null> {
  const flow = getFlow(flowId)
  if (!flow) return null

  const properties: Record<string, unknown> = {}
  const required: string[] = []
  for (const p of flow.params) {
    const field = getActiveSiteModel()
      .steps.flatMap((s) => s.fields)
      .find((f) => f.purpose === p.sourceField.fieldPurpose)
    // Describe the parameter by its purpose, not by the label it happened to
    // carry at teach time. Labels are exactly what a redesign rewrites, and a
    // baked-in label would go stale the moment the site changed.
    const purpose = p.sourceField.fieldPurpose.replace(/^./, (c) => c.toUpperCase())
    properties[p.key] = {
      type: "string",
      description: field?.options?.length
        ? `${purpose}. One of: ${field.options.join(", ")}`
        : field?.type === "date"
          ? `${purpose}, formatted YYYY-MM-DD`
          : purpose,
      ...(field?.options?.length ? { enum: field.options } : {}),
    }
    // Optional where a demonstrated value can stand in, required where the
    // app has nothing to fall back on. Saying so in the schema is how the
    // agent knows without having to try and fail.
    if (storedValue(flow, p.sourceField.fieldPurpose) === undefined) required.push(p.key)
  }

  return registerTool(
    {
      name: flow.name,
      description: mintedDescription(flow),
      inputSchema: { type: "object", properties, ...(required.length ? { required } : {}) },
      annotations: { readOnlyHint: false, untrustedContentHint: true },
      execute: async (args, { signal }) => {
        const bad = aborted(signal)
        if (bad) return bad
        const fresh = getFlow(flowId)
        if (!fresh) return { error: `The "${flow.name}" flow was deleted, so there is nothing to run.` }

        const report = driftGuard(fresh)
        if (report.questions.length > 0) {
          return {
            ...report,
            needsHealing: true,
            summary: `${fresh.name} cannot run yet: ${report.summary}`,
            message: "The site changed. Ask the user these questions, then call heal_flow before running again.",
            flowId,
          }
        }

        const { params, errors, ignoredKeys } = normalizeParams(fresh, args, getActiveSiteModel())
        if (errors.length) return { error: errors.join(" "), summary: "Nothing was submitted." }

        const result = await runFlowInteractive(fresh, params, signal)
        recordRun(flowId, result.ok, result.message)
        if (result.ok) {
          logEvent("run", `Agent ran ${fresh.name} via its minted tool: ${result.message}`)
          logEvent("confirm", `Human approved the submit for ${fresh.name}`)
        } else {
          logEvent("run", `${fresh.name} did not complete: ${result.message}`)
        }
        return {
          summary: result.message,
          ...result,
          ...(ignoredKeys.length ? { ignoredParams: ignoredKeys } : {}),
        }
      },
    },
    { mintedThisSession: opts.mintedThisSession, flowId }
  )
}

/**
 * The native registry does not survive a reload, but taught flows do. Re-mint
 * every stored flow at startup so a returning user's tools are all there.
 */
export async function mintStoredFlows(): Promise<void> {
  for (const flow of loadFlows()) {
    if (!registry.has(flow.name)) await mintFlowTool(flow.id)
  }
}

export function unmintFlow(name: string) {
  if (registry.has(name)) unregisterTool(name)
}

let initPromise: Promise<void> | null = null

/**
 * Register the built-ins, then re-mint stored flows. Serialized behind one
 * promise so React's double-invoked mount effect cannot interleave the two
 * passes and register tools out of order.
 */
export function initTools(): Promise<void> {
  if (!initPromise) {
    initPromise = (async () => {
      await registerStaticTools()
      await mintStoredFlows()
    })()
  }
  return initPromise
}
