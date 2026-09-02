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
