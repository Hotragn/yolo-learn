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
