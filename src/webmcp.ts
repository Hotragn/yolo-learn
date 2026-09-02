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
