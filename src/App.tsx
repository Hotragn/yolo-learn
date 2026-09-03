import { useCallback, useEffect, useMemo, useState } from "react"
import { getActiveSiteModel, syncSiteVersion, TaughtFlow } from "./types"
import {
  DeletedFlow,
  deleteFlow,
  getAudit,
  getFlow,
  loadFlows,
  logEvent,
  patchFlow,
  restoreFlow,
  subscribe,
  updateFlows,
} from "./store"
import { detectDrift, effectiveStatus, healFlow, storedValue } from "./drift"
import {
  executeToolByName,
  getToolEntries,
  mintFlowTool,
  mintStoredFlows,
  registerStaticTools,
  subscribeTools,
  ToolEntry,
  unmintFlow,
  webmcpStatus,
} from "./webmcp"
import { TeachProvider, useTeach } from "./TeachMode"
import { AgentConsole } from "./AgentConsole"
import { Modal } from "./Modal"
import SiteApp from "./SiteApp"

function useHashRoute() {
  const [hash, setHash] = useState(location.hash || "#/")
  useEffect(() => {
    const onChange = () => {
      // The URL is what sets the site version; everything else reads the
      // remembered value, so drift is measured against the version on screen.
      syncSiteVersion()
      setHash(location.hash || "#/")
    }
    window.addEventListener("hashchange", onChange)
    return () => window.removeEventListener("hashchange", onChange)
  }, [])
  const [path] = hash.replace(/^#/, "").split("?")
  return { path: path || "/" }
}

export default function App() {
  const { path } = useHashRoute()

  useEffect(() => {
    void (async () => {
      await registerStaticTools()
      // The browser's tool registry does not survive a reload, but taught
      // flows do. Re-mint them so a returning user's tools are all present.
      await mintStoredFlows()
    })()
    // A stable handle for scripted QA and for anyone who wants to drive the
    // tools from devtools. It exposes nothing the agent cannot already call.
    ;(window as unknown as Record<string, unknown>).agentMemory = {
      callTool: executeToolByName,
      tools: getToolEntries,
      status: webmcpStatus,
      flows: loadFlows,
    }
  }, [])

  return (
    <TeachProvider>
      <div className="shell">
        <header>
          <nav aria-label="Main">
            <a href="#/" aria-current={path === "/"}>
              Flow Library
            </a>
            <a href="#/site" aria-current={path === "/site"}>
              Demo Site
            </a>
            <a href="#/tools" aria-current={path === "/tools"}>
              Tools
            </a>
          </nav>
          <SiteVersionPill />
        </header>
        <WebmcpBanner />
        {path === "/site" ? <SiteApp /> : path === "/tools" ? <ToolsView /> : <Library />}
        <AgentConsole />
        <footer className="foot">
          Fictional clinic, local-only storage, no backend. Every submit is approved by you.
        </footer>
      </div>
    </TeachProvider>
  )
}

function SiteVersionPill() {
  const site = getActiveSiteModel()
  return (
    <span className={"site-pill" + (site.version === "2.0" ? " v2" : "")}>
      Demo site v{site.version}
      {site.version === "2.0" ? " (redesigned)" : ""}
    </span>
  )
}

function WebmcpBanner() {
  const [status, setStatus] = useState(webmcpStatus)
  useEffect(() => subscribeTools(() => setStatus(webmcpStatus())), [])

  if (status.available && status.originIsolated && !status.lastError) {
    return (
      <p className="detect ok">
        WebMCP detected on <code>{status.entryPoint}.modelContext</code>. {status.nativeCount} tool(s) registered with
        the browser.
      </p>
    )
  }
  if (status.available && !status.originIsolated) {
    return (
      <p className="detect bad">
        WebMCP is present but this document is not origin-keyed, so registration is refused. The page must be served
        with <code>Origin-Agent-Cluster: ?1</code>.
      </p>
    )
  }
  return (
    <p className="detect warn">
      No WebMCP agent in this browser. Enable <code>chrome://flags/#enable-webmcp-testing</code> in Chrome 149+, or open
      this page in the ChatGPT desktop browser. Everything still works here, and the simulated agent below calls the
      same tools.
      {status.lastError && <> Last registration error: <code>{status.lastError}</code>.</>}
    </p>
  )
}

// --- flow library --------------------------------------------------------

function Library() {
  const [flows, setFlows] = useState<TaughtFlow[]>([])
  const [healId, setHealId] = useState<string | null>(null)
  const [runId, setRunId] = useState<string | null>(null)
  const [undo, setUndo] = useState<DeletedFlow | null>(null)

  const refresh = useCallback(() => {
    const site = getActiveSiteModel()
    // One pass, one write, one notification. Repairing statuses one flow at a
    // time re-enters this listener and can clobber concurrent updates.
    updateFlows((f) => {
      const status = effectiveStatus(f, detectDrift(f, site))
      return status === f.status ? f : { ...f, status }
    })
    setFlows(loadFlows())
  }, [])

  useEffect(() => {
    refresh()
    return subscribe(refresh)
  }, [refresh])

  useEffect(() => {
    if (!undo) return
    const t = setTimeout(() => setUndo(null), 20000)
    return () => clearTimeout(t)
  }, [undo])

  const remove = (flow: TaughtFlow) => {
    const deleted = deleteFlow(flow.id)
    if (!deleted) return
    unmintFlow(flow.name)
    logEvent("delete", `Deleted "${flow.name}" and unregistered its tool`)
    setUndo(deleted)
  }

  const undoDelete = () => {
    if (!undo) return
    restoreFlow(undo)
    void mintFlowTool(undo.flow.id)
    logEvent("teach", `Restored "${undo.flow.name}" and re-registered its tool`)
    setUndo(null)
  }

  return (
    <main>
      <h1>Your taught flows</h1>
      <p className="sub">
        Demonstrate a task once on the demo site and this app mints a WebMCP tool your agent can call. When the site
        changes, the flow tells you exactly what changed and heals with one answer.
      </p>

      {undo && (
        <div className="undo" role="status">
          Deleted <b>{undo.flow.name}</b>.
          <button className="link" onClick={undoDelete}>
            Undo
          </button>
        </div>
      )}

      <div className="cards">
        {flows.length === 0 && (
          <div className="card empty">
            <b>Nothing taught yet.</b>
            <p className="sub">
              A taught flow is a task you have done by hand once: the app watches, remembers it by intent rather than by
              CSS selector, and gives your agent a tool for it.
            </p>
            <a className="cta" href="#/site?teach=1">
              Teach your first flow
            </a>
          </div>
        )}
        {flows.map((f) => (
          <FlowCard key={f.id} flow={f} onHeal={() => setHealId(f.id)} onRun={() => setRunId(f.id)} onDelete={() => remove(f)} />
        ))}
      </div>

      {healId && <HealDialog flowId={healId} onDone={() => setHealId(null)} />}
      {runId && <RunDialog flowId={runId} onDone={() => setRunId(null)} />}
      <AuditTrail />
    </main>
  )
}

function FlowCard({
  flow,
  onHeal,
  onRun,
  onDelete,
}: {
  flow: TaughtFlow
  onHeal: () => void
  onRun: () => void
  onDelete: () => void
}) {
  const report = useMemo(() => detectDrift(flow, getActiveSiteModel()), [flow])
  const prompt = useMemo(() => {
    const withValues = flow.params
      .map((p) => `${p.key}: ${storedValue(flow, p.sourceField.fieldPurpose) ?? "your value"}`)
      .join(", ")
    return flow.params.length
      ? `Check the health of my "${flow.name}" flow, then run it with ${withValues}.`
      : `Check the health of my "${flow.name}" flow, then run it.`
  }, [flow])

  return (
    <div className="card">
      <div className="card-head">
        <b>{flow.name}</b>
        <span className={"badge " + flow.status}>{flow.status.replace("_", " ")}</span>
      </div>
      <p className="meta">
        Taught {new Date(flow.taughtAt).toLocaleDateString()} on site v{flow.siteVersionAtTeach}
        {" · "}
        {flow.params.length} parameter{flow.params.length === 1 ? "" : "s"}
        {" · "}
        run {flow.runCount}x
      </p>
      {flow.params.length > 0 && (
        <p className="params">
          {flow.params.map((p) => (
            <code key={p.key}>{p.key}</code>
          ))}
        </p>
      )}
      <p className={"health " + report.status}>{report.summary}</p>

      {flow.runs && flow.runs.length > 0 && (
        <ul className="runs">
          {flow.runs.map((r, i) => (
            <li key={i} className={r.ok ? "ok" : "bad"}>
              <small>{new Date(r.at).toLocaleString()}</small> {r.message}
            </li>
          ))}
        </ul>
      )}

      <div className="row">
        <button className="primary" onClick={onRun}>
          Run with agent
        </button>
        {report.status === "drifted" && (
          <button onClick={onHeal}>{report.questions.length ? "Heal (1 question)" : "Heal"}</button>
        )}
        <button
          onClick={() => {
            navigator.clipboard?.writeText(prompt)
            logEvent("run", `Copied an agent prompt for ${flow.name}`)
          }}
          title={prompt}
        >
          Copy agent prompt
        </button>
        <button className="deny" onClick={onDelete}>
          Delete
        </button>
      </div>
    </div>
  )
}

function RunDialog({ flowId, onDone }: { flowId: string; onDone: () => void }) {
  const flow = getFlow(flowId)
  const [args, setArgs] = useState<Record<string, string>>({})
  if (!flow) return null

  const site = getActiveSiteModel()
  const fields = site.steps.flatMap((s) => s.fields)

  const go = () => {
    const payload: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(args)) if (v.trim()) payload[k] = v.trim()
    onDone()
    // Fire and forget: the run navigates to the demo site, where the user
    // watches it happen and approves the submit. The outcome lands in the
    // audit trail.
    void executeToolByName(flow.name, payload)
  }

  return (
    <Modal title={`Run ${flow.name}`} onEscape={onDone} escapeHint="cancel">
      <p>
        Your agent will fill the booking wizard on screen and stop for your approval. Leave a value empty to reuse what
        you demonstrated.
      </p>
      {flow.params.length === 0 && (
        <p className="sub">This flow has no parameters, so it replays your demonstration exactly.</p>
      )}
      {flow.params.map((p) => {
        const field = fields.find((f) => f.purpose === p.sourceField.fieldPurpose)
        const demo = storedValue(flow, p.sourceField.fieldPurpose)
        return (
          <label className="field" key={p.key}>
            <span>
              {field?.label ?? p.label} <small>({p.key})</small>
            </span>
            {field?.options?.length ? (
              <select value={args[p.key] ?? ""} onChange={(e) => setArgs((a) => ({ ...a, [p.key]: e.target.value }))}>
                <option value="">{demo ? `reuse "${demo}"` : "choose"}</option>
                {field.options.map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </select>
            ) : (
              <input
                type={field?.type === "date" ? "date" : "text"}
                value={args[p.key] ?? ""}
                placeholder={demo ? `reuse "${demo}"` : ""}
                onChange={(e) => setArgs((a) => ({ ...a, [p.key]: e.target.value }))}
              />
            )}
          </label>
        )
      })}
      <div className="modal-actions">
        <button onClick={onDone}>Cancel</button>
        <button className="primary" data-autofocus="true" onClick={go}>
          Run it
        </button>
      </div>
    </Modal>
  )
}

function HealDialog({ flowId, onDone }: { flowId: string; onDone: () => void }) {
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const flow = getFlow(flowId)
  if (!flow) return null

  const site = getActiveSiteModel()
  const report = detectDrift(flow, site)
  const missing = report.questions.filter((q) => !(answers[q.id] ?? "").trim())

  const heal = () => {
    const { flow: healed, applied, remainingQuestions } = healFlow(flow, site, answers)
    if (!patchFlow(flow.id, healed)) return onDone()
    logEvent(
      "heal",
      remainingQuestions.length
        ? `Healed ${flow.name} partially; still needs ${remainingQuestions.map((q) => q.label).join(", ")}`
        : `Healed ${flow.name}${applied.length ? ` with an answer for ${applied.join(", ")}` : ""}`
    )
    onDone()
  }

  return (
    <Modal title={`Heal ${flow.name}`} onEscape={onDone} escapeHint="close without healing">
      <p className="health drifted">{report.summary}</p>
      <ul className="changes">
        {report.changes.map((c, i) => (
          <li key={i}>
            <span className={"tag " + (c.autoHealable ? "auto" : "ask")}>{c.autoHealable ? "auto" : "asks you"}</span>{" "}
            {c.description}
          </li>
        ))}
      </ul>

      {report.questions.length === 0 ? (
        <p className="sub">Nothing to ask. Healing snapshots the new layout and the flow is ready to run.</p>
      ) : (
        <>
          <p className="sub">
            The app will not invent a value it has never been told, so it asks. Once, and then it remembers.
          </p>
          {report.questions.map((q) => (
            <label key={q.id} className="field">
              <span>{q.question}</span>
              <input
                data-autofocus="true"
                value={answers[q.id] ?? ""}
                onChange={(e) => setAnswers((a) => ({ ...a, [q.id]: e.target.value }))}
              />
            </label>
          ))}
        </>
      )}

      <div className="modal-actions">
        <button onClick={onDone}>Later</button>
        <button className="primary" onClick={heal} disabled={missing.length > 0}>
          {missing.length > 0 ? "Answer to heal" : "Heal flow"}
        </button>
      </div>
    </Modal>
  )
}

// --- live tool registry --------------------------------------------------

function ToolsView() {
  const [entries, setEntries] = useState<ToolEntry[]>(getToolEntries)
  const teach = useTeach()
  useEffect(() => subscribeTools(() => setEntries(getToolEntries())), [])

  const minted = teach.justMinted
  const fresh = minted && Date.now() - minted.at < 10000

  useEffect(() => {
    if (!fresh) return
    const t = setTimeout(() => teach.clearJustMinted(), 10000)
    return () => clearTimeout(t)
  }, [fresh, teach])

  const flowTools = entries.filter((e) => e.flowId)
  const builtIns = entries.filter((e) => !e.flowId)

  return (
    <main>
      {fresh && minted && (
        <div className="mint-flash" role="status">
          <b>Tool minted: {minted.name}</b>
          <span>
            {minted.paramCount} parameter{minted.paramCount === 1 ? "" : "s"}. Live in this session
            {minted.native ? ", registered with the browser" : ""}, with no reload.
          </span>
          {minted.error && <small>Browser registration said: {minted.error}</small>}
        </div>
      )}

      <h1>Registered tools</h1>
      <p className="sub">
        The live registry. Teaching a flow adds a tool here mid-session, and your agent can call it immediately without
        a reload.
      </p>

      <h2>From your taught flows</h2>
      <div className="cards">
        {flowTools.length === 0 && (
          <div className="card empty">
            No minted tools yet. <a href="#/site?teach=1">Teach a flow</a> and one appears here instantly.
          </div>
        )}
        {flowTools.map((e) => (
          <ToolCard key={e.tool.name} entry={e} highlight={!!fresh && minted?.name === e.tool.name} />
        ))}
      </div>

      <h2>Built in</h2>
      <div className="cards">
        {builtIns.map((e) => (
          <ToolCard key={e.tool.name} entry={e} highlight={false} />
        ))}
      </div>
    </main>
  )
}

function ToolCard({ entry, highlight }: { entry: ToolEntry; highlight: boolean }) {
  const params = Object.keys(entry.tool.inputSchema?.properties ?? {})
  return (
    <div className={"card tool" + (highlight ? " just-minted" : "")}>
      <div className="card-head">
        <b>{entry.tool.name}</b>
        {entry.mintedThisSession && <span className="badge new">new this session</span>}
      </div>
      <p>{entry.tool.description}</p>
      <p className="params">
        {params.length === 0 ? <small>no parameters</small> : params.map((p) => <code key={p}>{p}</code>)}
      </p>
      <small className={entry.native ? "native yes" : "native no"}>
        {entry.native ? "registered with the browser" : "mirror registry only"}
        {entry.tool.annotations?.readOnlyHint ? " · read only" : ""}
        {entry.error ? ` · ${entry.error}` : ""}
      </small>
    </div>
  )
}

// --- audit trail ---------------------------------------------------------

function AuditTrail() {
  const [events, setEvents] = useState(getAudit)
  useEffect(() => subscribe(() => setEvents(getAudit())), [])
  return (
    <section className="audit">
      <h2>Audit trail</h2>
      {events.length === 0 ? (
        <p className="sub">Empty. Teaching, running, drifting and healing all get recorded here.</p>
      ) : (
        <ul>
          {events.slice(0, 12).map((e, i) => (
            <li key={i}>
              <small>{new Date(e.at).toLocaleTimeString()}</small>{" "}
              <span className={"tag " + e.type}>{e.type}</span> {e.detail}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
