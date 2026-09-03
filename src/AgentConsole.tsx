import { useEffect, useMemo, useRef, useState } from "react"
import { executeToolByName, getToolEntries, subscribeTools, ToolEntry, webmcpStatus } from "./webmcp"
import { getFlow } from "./store"
import { storedValue } from "./drift"

interface SchemaProp {
  type?: string
  description?: string
  enum?: string[]
}

function propsOf(entry: ToolEntry): [string, SchemaProp][] {
  const props = (entry.tool.inputSchema?.properties ?? {}) as Record<string, SchemaProp>
  return Object.entries(props)
}

/**
 * A simulated agent, for browsers where WebMCP is not enabled.
 *
 * It does not fake any intelligence: it calls the very same registered tool
 * objects a real agent calls, with the same untrusted-argument path and the
 * same AbortSignal. It exists so the demo, and the deny/cancel edge cases, can
 * be exercised anywhere - and so nobody has to take the claim on faith.
 *
 * Rendered outside the router so a run that navigates to the demo site does
 * not unmount the console mid-call.
 */
export function AgentConsole() {
  const [entries, setEntries] = useState<ToolEntry[]>(getToolEntries)
  const [open, setOpen] = useState(false)
  const [selected, setSelected] = useState("list_flows")
  const [args, setArgs] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ tool: string; at: string; output: string } | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => subscribeTools(() => setEntries(getToolEntries())), [])

  // Default the console open only when there is no real agent to drive it.
  const native = webmcpStatus().available
  useEffect(() => {
    if (!native) setOpen(true)
  }, [native])

  const entry = useMemo(() => entries.find((e) => e.tool.name === selected) ?? entries[0], [entries, selected])

  useEffect(() => {
    setArgs({})
  }, [selected])

  const run = async () => {
    if (!entry) return
    const controller = new AbortController()
    abortRef.current = controller
    setBusy(true)
    setResult(null)
    try {
      const payload: Record<string, unknown> = {}
      for (const [key, prop] of propsOf(entry)) {
        const raw = args[key]
        if (raw == null || raw.trim() === "") continue
        if (prop.type === "object" || prop.type === "array") {
          try {
            payload[key] = JSON.parse(raw)
          } catch {
            setResult({ tool: entry.tool.name, at: new Date().toLocaleTimeString(), output: `${key} is not valid JSON.` })
            setBusy(false)
            return
          }
        } else {
          payload[key] = raw
        }
      }
      const output = await executeToolByName(entry.tool.name, payload, controller.signal)
      setResult({
        tool: entry.tool.name,
        at: new Date().toLocaleTimeString(),
        output: JSON.stringify(output, null, 2),
      })
    } catch (err) {
      setResult({
        tool: entry.tool.name,
        at: new Date().toLocaleTimeString(),
        output: `The tool threw: ${err instanceof Error ? err.message : String(err)}`,
      })
    } finally {
      setBusy(false)
      abortRef.current = null
    }
  }

  const flowTools = entries.filter((e) => e.flowId)
  const builtIns = entries.filter((e) => !e.flowId)

  return (
    <section className={"console" + (open ? " open" : "")} aria-label="Simulated agent console">
      <button className="console-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span>Simulated agent {open ? "▾" : "▸"}</span>
        <small>
          {native
            ? "a real agent is connected; this calls the same tools"
            : "no WebMCP agent in this browser, so drive the demo from here"}
        </small>
      </button>

      {open && (
        <div className="console-body">
          <p className="sub">
            Calls the registered tool objects directly, with the same argument validation and cancellation a browser
            agent uses. Nothing here bypasses the approval step.
          </p>

          <label className="field">
            <span>Tool</span>
            <select value={entry?.tool.name ?? ""} onChange={(e) => setSelected(e.target.value)}>
              {flowTools.length > 0 && (
                <optgroup label="Taught flows">
                  {flowTools.map((e) => (
                    <option key={e.tool.name} value={e.tool.name}>
                      {e.tool.name}
                    </option>
                  ))}
                </optgroup>
              )}
              <optgroup label="Built-in">
                {builtIns.map((e) => (
                  <option key={e.tool.name} value={e.tool.name}>
                    {e.tool.name}
                  </option>
                ))}
              </optgroup>
            </select>
          </label>

          {entry && (
            <>
              {propsOf(entry).length === 0 ? (
                <p className="sub">This tool takes no arguments.</p>
              ) : (
                propsOf(entry).map(([key, prop]) => {
                  const flow = entry.flowId ? getFlow(entry.flowId) : undefined
                  const param = flow?.params.find((p) => p.key === key)
                  const demo = param && flow ? storedValue(flow, param.sourceField.fieldPurpose) : undefined
                  return (
                    <label className="field" key={key}>
                      <span>
                        {key} <small>{prop.description}</small>
                      </span>
                      {prop.enum?.length ? (
                        <select value={args[key] ?? ""} onChange={(e) => setArgs((a) => ({ ...a, [key]: e.target.value }))}>
                          <option value="">{demo ? `leave empty to reuse "${demo}"` : "not supplied"}</option>
                          {prop.enum.map((o) => (
                            <option key={o} value={o}>
                              {o}
                            </option>
                          ))}
                        </select>
                      ) : prop.type === "object" || prop.type === "array" ? (
                        <textarea
                          rows={3}
                          placeholder={prop.type === "array" ? '[{"questionId":"q_insurance_id","answer":"INS-1"}]' : "{}"}
                          value={args[key] ?? ""}
                          onChange={(e) => setArgs((a) => ({ ...a, [key]: e.target.value }))}
                        />
                      ) : (
                        <input
                          value={args[key] ?? ""}
                          placeholder={demo ? `leave empty to reuse "${demo}"` : "not supplied"}
                          onChange={(e) => setArgs((a) => ({ ...a, [key]: e.target.value }))}
                        />
                      )}
                    </label>
                  )
                })
              )}

              <div className="row">
                <button className="primary" onClick={() => void run()} disabled={busy}>
                  {busy ? "Running..." : `Call ${entry.tool.name}`}
                </button>
                {busy && (
                  <button className="deny" onClick={() => abortRef.current?.abort()}>
                    Cancel (abort signal)
                  </button>
                )}
              </div>
            </>
          )}

          {result && (
            <div className="console-result">
              <small>
                {result.tool} at {result.at}
              </small>
              <pre>{result.output}</pre>
            </div>
          )}
        </div>
      )}
    </section>
  )
}
