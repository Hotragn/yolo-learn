import { camel, siteHash, TaughtFlow, uniqueName } from "./types"
import { flowNames, logEvent, upsertFlow } from "./store"
import { discoverFlow } from "./discover"
import { fingerprintSteps } from "./drift"
import { isSiteMounted, resetSite } from "./runner"
import { mintFlowTool } from "./webmcp"
import { announceMint } from "./minted"

export interface LearnOutcome {
  ok: boolean
  summary: string
  toolName?: string
  flowId?: string
  intent?: string
  steps?: { order: number; intent: string; submitLabel: string; fields: string[] }[]
  parameters?: { key: string; describes: string; required: boolean; oneOf?: string[] }[]
  notes?: string[]
  /** Credential or payment fields it refused to read. */
  refusedFields?: string[]
  native?: boolean
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * Learn the task on the demo site with no human demonstration.
 *
 * Discovery reads the DOM (see discover.ts); this function turns what it read
 * into a flow and a tool. The important choice here is what it does NOT store:
 * every field becomes a parameter with no value, because the app has no
 * business inventing somebody's name or insurance number. The probe values
 * discovery typed in order to walk the wizard are recorded in the audit trail
 * and thrown away.
 */
export async function learnCurrentSite(
  opts: { onProgress?: (note: string) => void; signal?: AbortSignal } = {}
): Promise<LearnOutcome> {
  const progress = opts.onProgress ?? (() => {})

  if (!location.hash.startsWith("#/site")) location.hash = siteHash()

  // Wait for the wizard to mount, then for a form to actually exist in the DOM.
  const deadline = Date.now() + 5000
  while (Date.now() < deadline && (!isSiteMounted() || !document.querySelector("form"))) {
    if (opts.signal?.aborted) return { ok: false, summary: "Cancelled before learning started." }
    await sleep(60)
  }
  if (!document.querySelector("form")) {
    return { ok: false, summary: "The demo site never rendered a form, so there was nothing to learn." }
  }

  // Start from step one so the walk sees the whole wizard.
  resetSite()
  await sleep(80)

  progress("reading the page")
  const result = await discoverFlow({ onProgress: progress })
  resetSite()

  if (!result.ok || !result.flow) return { ok: false, summary: result.message }
  const discovered = result.flow

  const name = uniqueName(discovered.toolName, flowNames())
  const fields = discovered.steps.flatMap((s) => s.fields.map((f) => ({ step: s.intent, field: f })))

  const flow: TaughtFlow = {
    id: `flow_${Date.now()}`,
    name,
    intent: discovered.intent,
    learnedBy: "autonomous",
    taughtAt: new Date().toISOString(),
    // Read off the page, not from our own site model, so the record reflects
    // what was actually on screen.
    siteVersionAtTeach:
      document.querySelector("[data-site-version]")?.getAttribute("data-site-version") ?? "unknown",
    origin: location.origin,
    structureFingerprint: fingerprintSteps(discovered.steps),
    // Everything it found becomes a parameter. Nothing is invented.
    params: fields.map(({ step, field }) => ({
      key: camel(field.purpose),
      label: field.label,
      type: field.type === "date" ? ("date" as const) : ("string" as const),
      sourceField: { stepIntent: step, fieldPurpose: field.purpose },
    })),
    steps: discovered.steps.map((s) => ({ ...s, fields: s.fields.map((f) => ({ ...f })) })),
    fieldValues: {},
    status: "never_run",
    runCount: 0,
    lastRunAt: null,
    lastHealedAt: null,
    runs: [],
  }

  upsertFlow(flow)
  const outcome = await mintFlowTool(flow.id, { mintedThisSession: true })

  logEvent(
    "learn",
    `Learned "${name}" autonomously by reading ${flow.steps.length} step(s) and ${flow.params.length} field(s). No demonstration.`
  )
  if (discovered.refused.length) {
    logEvent(
      "learn",
      `Refused to read ${discovered.refused.length} credential or payment field(s): ${discovered.refused.join(", ")}.`
    )
  }
  if (Object.keys(discovered.probes).length) {
    logEvent(
      "learn",
      `Walked the wizard with throwaway probe values (${Object.keys(discovered.probes).join(", ")}); none were kept.`
    )
  }
  logEvent(
    "mint",
    `Minted tool "${name}" with ${flow.params.length} parameter(s)` +
      (outcome?.native ? " and registered it with the browser" : " (mirror registry only)")
  )

  announceMint({
    flowId: flow.id,
    name,
    paramCount: flow.params.length,
    native: !!outcome?.native,
    source: "autonomous",
    error: outcome?.error,
  })

  return {
    ok: true,
    summary:
      `Learned "${name}" by reading the page: ${flow.steps.length} steps, ${flow.params.length} fields, ` +
      `no demonstration and no invented values. The tool is registered and ready to call.`,
    toolName: name,
    flowId: flow.id,
    intent: flow.intent,
    steps: discovered.steps.map((s) => ({
      order: s.order,
      intent: s.intent,
      submitLabel: s.submitLabel,
      fields: s.fields.map((f) => `${f.label}${f.required ? " (required)" : ""}`),
    })),
    parameters: flow.params.map((p) => {
      const field = fields.find((f) => f.field.purpose === p.sourceField.fieldPurpose)?.field
      return {
        key: p.key,
        describes: p.sourceField.fieldPurpose,
        required: !!field?.required,
        ...(field?.options?.length ? { oneOf: field.options } : {}),
      }
    }),
    notes: discovered.notes,
    refusedFields: discovered.refused,
    native: !!outcome?.native,
  }
}
