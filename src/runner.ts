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
