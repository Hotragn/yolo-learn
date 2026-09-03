import { ReactNode, createContext, useCallback, useContext, useEffect, useMemo, useState } from "react"
import { camel, getActiveSiteModel, siteHash, TaughtFlow, uniqueName } from "./types"
import { flowNames, logEvent, upsertFlow } from "./store"
import { mintFlowTool } from "./webmcp"

export interface RecordedField {
  stepIntent: string
  fieldPurpose: string
  label: string
  value: string
  isParam: boolean
}

export interface MintedInfo {
  flowId: string
  name: string
  paramCount: number
  native: boolean
  error?: string
  at: number
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
  setAllParams: (on: boolean) => void
  setName: (name: string) => void
  /** nameOverride avoids a setState-then-read race when minting from the panel. */
  finalize: (nameOverride?: string) => Promise<TaughtFlow | null>
  reset: () => void
  minting: boolean
  /** Set for the rest of the session after a mint, so Tools can celebrate it. */
  justMinted: MintedInfo | null
  clearJustMinted: () => void
}

const TeachContext = createContext<TeachContextValue | null>(null)

export function useTeach(): TeachContextValue {
  const ctx = useContext(TeachContext)
  if (!ctx) throw new Error("useTeach outside provider")
  return ctx
}

// Module-level entry so WebMCP tools and deep links can trigger teach mode.
// A tool can fire before the provider has mounted, so the request is queued
// rather than dropped.
let beginTeachingFn: ((name?: string) => void) | null = null
let pending: { name?: string } | null = null

export function beginTeaching(name?: string) {
  if (beginTeachingFn) beginTeachingFn(name)
  else pending = { name }
}

const EMPTY: TeachState = { active: false, flowName: "", captured: [], done: false }

export function TeachProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<TeachState>(EMPTY)
  const [minting, setMinting] = useState(false)
  const [justMinted, setJustMinted] = useState<MintedInfo | null>(null)

  const start = useCallback((name?: string) => {
    setState({ active: true, flowName: name ?? "my_flow", captured: [], done: false })
    if (!location.hash.startsWith("#/site")) location.hash = siteHash("teach=1")
  }, [])

  // Registering the module hook in an effect keeps render side-effect free.
  useEffect(() => {
    beginTeachingFn = start
    if (pending) {
      const queued = pending
      pending = null
      start(queued.name)
    }
    return () => {
      if (beginTeachingFn === start) beginTeachingFn = null
    }
  }, [start])

  const finalize = useCallback(async (nameOverride?: string): Promise<TaughtFlow | null> => {
    const site = getActiveSiteModel()
    const captured = state.captured
    // registerTool rejects on a duplicate name, so uniqueness is settled here.
    const name = uniqueName(nameOverride ?? state.flowName, flowNames())
    const fieldsByPurpose = new Map(site.steps.flatMap((s) => s.fields).map((f) => [f.purpose, f]))

    const flow: TaughtFlow = {
      id: `flow_${Date.now()}`,
      name,
      intent: `${name.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase())} at Northside Family Clinic`,
      taughtAt: new Date().toISOString(),
      siteVersionAtTeach: site.version,
      params: captured
        .filter((c) => c.isParam)
        .map((c) => ({
          key: camel(c.fieldPurpose),
          label: c.label,
          type: fieldsByPurpose.get(c.fieldPurpose)?.type === "date" ? ("date" as const) : ("string" as const),
          sourceField: { stepIntent: c.stepIntent, fieldPurpose: c.fieldPurpose },
        })),
      steps: site.steps.map((s) => ({ ...s, fields: s.fields.map((f) => ({ ...f })) })),
      fieldValues: Object.fromEntries(captured.map((c) => [c.fieldPurpose, c.value])),
      status: "never_run",
      runCount: 0,
      lastRunAt: null,
      lastHealedAt: null,
      runs: [],
    }

    setMinting(true)
    try {
      upsertFlow(flow)
      const outcome = await mintFlowTool(flow.id, { mintedThisSession: true })
      logEvent("teach", `Taught "${flow.name}" from one demonstration on site v${site.version}`)
      logEvent(
        "mint",
        `Minted tool "${flow.name}" with ${flow.params.length} parameter(s)` +
          (outcome?.native ? " and registered it with the browser" : " (mirror registry only)")
      )
      setJustMinted({
        flowId: flow.id,
        name: flow.name,
        paramCount: flow.params.length,
        native: !!outcome?.native,
        error: outcome?.error,
        at: Date.now(),
      })
      setState(EMPTY)
      location.hash = "#/tools"
      return flow
    } finally {
      setMinting(false)
    }
  }, [state.captured, state.flowName])

  const value = useMemo<TeachContextValue>(
    () => ({
      ...state,
      minting,
      justMinted,
      clearJustMinted: () => setJustMinted(null),
      recordField: (f) =>
        setState((s) => {
          const i = s.captured.findIndex((c) => c.fieldPurpose === f.fieldPurpose)
          if (i < 0) return { ...s, captured: [...s.captured, f] }
          const next = [...s.captured]
          // Keep the checkbox the user already set while they edit the value.
          next[i] = { ...f, isParam: next[i].isParam }
          return { ...s, captured: next }
        }),
      complete: () => setState((s) => ({ ...s, done: true })),
      toggleParam: (fieldPurpose) =>
        setState((s) => ({
          ...s,
          captured: s.captured.map((c) => (c.fieldPurpose === fieldPurpose ? { ...c, isParam: !c.isParam } : c)),
        })),
      setAllParams: (on) =>
        setState((s) => ({ ...s, captured: s.captured.map((c) => ({ ...c, isParam: on })) })),
      setName: (name) => setState((s) => ({ ...s, flowName: name })),
      finalize,
      reset: () => setState(EMPTY),
    }),
    [state, minting, justMinted, finalize]
  )

  return <TeachContext.Provider value={value}>{children}</TeachContext.Provider>
}
