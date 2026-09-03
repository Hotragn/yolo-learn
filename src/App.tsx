import { useCallback, useEffect, useMemo, useState } from "react"
import { getActiveSiteModel, safeGetItem, safeSetItem, syncSiteVersion, TaughtFlow } from "./types"
import {
  clearAll,
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
  initTools,
  mintFlowTool,
  subscribeTools,
  ToolEntry,
  unmintFlow,
  webmcpStatus,
} from "./webmcp"
import { clearLastMint, getLastMint, subscribeMint } from "./minted"
import { DemoSeed, getGuided, resetGuided, runGuidedDemo, seedDemo, subscribeGuided } from "./guided"
import { TeachProvider } from "./TeachMode"
import { AgentConsole } from "./AgentConsole"
import { Modal } from "./Modal"
import SiteApp from "./SiteApp"
import { AnyForm } from "./AnyForm"
import { Audit } from "./Audit"
import { hasSeenTour, markTourSeen, Tour } from "./Tour"
import {
  IconAlert,
  IconArrowRight,
  IconCheck,
  IconCopy,
  IconHeal,
  IconMint,
  IconMoon,
  IconRead,
  IconNoInvent,
  IconNoKey,
  IconNoSend,
  IconNoSubmit,
  IconRefuse,
  IconRemember,
  IconRun,
  IconSun,
  IconSystem,
  IconTerminal,
  IconTrash,
  IconUndo,
  Logo,
} from "./icons"

const PRODUCT = "Yolo Learn"

// --- theme --------------------------------------------------------------

type ThemeChoice = "system" | "light" | "dark"
const THEME_KEY = "theme.v1"

function applyTheme(choice: ThemeChoice) {
  const root = document.documentElement
  if (choice === "system") root.removeAttribute("data-theme")
  else root.setAttribute("data-theme", choice)
}

function useTheme() {
  const [choice, setChoice] = useState<ThemeChoice>(() => {
    const stored = safeGetItem(THEME_KEY)
    return stored === "light" || stored === "dark" ? stored : "system"
  })
  useEffect(() => {
    applyTheme(choice)
    safeSetItem(THEME_KEY, choice)
  }, [choice])
  const cycle = () => setChoice(choice === "system" ? "light" : choice === "light" ? "dark" : "system")
  return { choice, cycle }
}

// --- routing ------------------------------------------------------------

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
  const theme = useTheme()
  const [seeding, setSeeding] = useState<DemoSeed | null>(null)
  const [tour, setTour] = useState(false)

  // First visit gets the walkthrough, once. A reviewer landing cold has no
  // idea what "Flows" or "Tools" mean, and the interface should say so itself
  // rather than making them read the README first.
  useEffect(() => {
    if (hasSeenTour()) return
    if (location.hash.includes("demo=")) return markTourSeen()
    const t = setTimeout(() => setTour(true), 700)
    return () => clearTimeout(t)
  }, [])

  // Deep links so any beat of the story is one click away. A reviewer who
  // abandons the loop halfway would otherwise never reach the payoff.
  useEffect(() => {
    const qs = new URLSearchParams(location.hash.split("?")[1] ?? "")
    const want = qs.get("demo")
    if (want !== "learned" && want !== "drifted" && want !== "healed") return
    setSeeding(want)
    void (async () => {
      await initTools()
      const ok = await seedDemo(want)
      setSeeding(null)
      location.hash = ok ? "#/flows" : "#/"
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    // The browser's tool registry does not survive a reload, but taught flows
    // do, so initTools re-mints them for a returning user.
    void initTools()
    // A stable handle for scripted QA and for anyone who wants to drive the
    // tools from devtools. It exposes nothing the agent cannot already call.
    ;(window as unknown as Record<string, unknown>).agentMemory = {
      callTool: executeToolByName,
      tools: getToolEntries,
      status: webmcpStatus,
      flows: loadFlows,
    }
  }, [])

  const ThemeIcon = theme.choice === "light" ? IconSun : theme.choice === "dark" ? IconMoon : IconSystem

  return (
    <TeachProvider>
      <div className="shell">
        <header>
          <a className="brand" href="#/" data-tour="brand">
            <Logo size={28} />
            <span className="brand-name">
              Yolo <span>Learn</span>
            </span>
          </a>
          <nav aria-label="Main">
            <a href="#/" aria-current={path === "/"}>
              Get started
            </a>
            <a href="#/flows" aria-current={path === "/flows"} data-tour="nav-flows">
              What it learned
            </a>
            <a href="#/site" aria-current={path === "/site"} data-tour="nav-site">
              Demo clinic
            </a>
            <a href="#/tools" aria-current={path === "/tools"} data-tour="nav-tools">
              Agent tools
            </a>
            <a href="#/audit" aria-current={path === "/audit"} data-tour="nav-audit">
              Audit
            </a>
          </nav>
          <div className="head-right">
            <SiteVersionPill />
            <button className="tour-launch" onClick={() => setTour(true)} title="Take the tour">
              Tour
            </button>
            <button
              className="theme-toggle"
              onClick={theme.cycle}
              title={`Theme: ${theme.choice}. Click to change.`}
              aria-label={`Theme: ${theme.choice}. Click to change.`}
            >
              <ThemeIcon size={17} />
            </button>
          </div>
        </header>

        <WebmcpBanner />
        <GuidedDock />

        {seeding && (
          <p className="detect ok" data-tour="detect">
            <IconRead size={16} />
            <span>Setting up the "{seeding}" state by actually learning the page. One moment.</span>
          </p>
        )}

        {path === "/audit" ? (
          <Audit />
        ) : path === "/any" ? (
          <AnyForm />
        ) : path === "/site" ? (
          <SiteApp />
        ) : path === "/tools" ? (
          <ToolsView />
        ) : path === "/flows" ? (
          <Library />
        ) : (
          <Onboarding />
        )}

        <AgentConsole />

        {tour && <Tour onClose={() => setTour(false)} />}

        <footer className="foot">
          <span>
            {PRODUCT} - fictional clinic, local-only storage, no backend. Every submit is approved by you.
          </span>
          <span>
            Built by{" "}
            <a href="https://github.com/Hotragn" rel="noreferrer noopener">
              Hotragn Pettugani
            </a>{" "}
            ·{" "}
            <a href="https://github.com/Hotragn/yolo-learn" rel="noreferrer noopener">
              source
            </a>
          </span>
        </footer>
      </div>
    </TeachProvider>
  )
}

function SiteVersionPill() {
  const site = getActiveSiteModel()
  return (
    <span className={"site-pill" + (site.version === "2.0" ? " v2" : "")}>
      site v{site.version}
      {site.version === "2.0" ? " · redesigned" : ""}
    </span>
  )
}

function WebmcpBanner() {
  const [status, setStatus] = useState(webmcpStatus)
  useEffect(() => subscribeTools(() => setStatus(webmcpStatus())), [])

  if (status.available && status.originIsolated && !status.lastError) {
    return (
      <p className="detect ok" data-tour="detect">
        <IconCheck size={16} />
        <span>
          WebMCP detected on <code>{status.entryPoint}.modelContext</code>. {status.nativeCount} tool(s) registered with
          the browser.
        </span>
      </p>
    )
  }
  if (status.available && !status.originIsolated) {
    return (
      <p className="detect bad" data-tour="detect">
        <IconAlert size={16} />
        <span>
          WebMCP is present but this document is not origin-keyed, so registration is refused. The page must be served
          with <code>Origin-Agent-Cluster: ?1</code>.
        </span>
      </p>
    )
  }
  return (
    <p className="detect warn" data-tour="detect">
      <IconAlert size={16} />
      <span>
        No WebMCP agent in this browser. Enable <code>chrome://flags/#enable-webmcp-testing</code> in Chrome 149+, or
        open this page in the ChatGPT desktop browser. Everything still works, and the simulated agent at the bottom
        calls the same tools.
        {status.lastError && (
          <>
            {" "}
            Last registration error: <code>{status.lastError}</code>.
          </>
        )}
      </span>
    </p>
  )
}

// --- onboarding ---------------------------------------------------------

function useFlows(): TaughtFlow[] {
  const [flows, setFlows] = useState<TaughtFlow[]>(loadFlows)
  useEffect(() => subscribe(() => setFlows(loadFlows())), [])
  return flows
}

function Onboarding() {
  const flows = useFlows()
  const site = getActiveSiteModel()

  const taught = flows.length > 0
  const ran = flows.some((f) => f.runCount > 0)
  const healed = flows.some((f) => !!f.lastHealedAt)
  const doneCount = [taught, ran, healed].filter(Boolean).length

  return (
    <main>
      <section className="hero">
        <p className="eyebrow">OpenAI WebMCP Challenge</p>
        <h1>Teach an AI agent to use a website. Once.</h1>
        <p className="hero-lead">
          Agents cannot use websites they were not built for, and they break when a site changes.{" "}
          <b>{PRODUCT}</b> reads a site itself, and audits it.
        </p>
        <div className="hero-actions">
          <a className="cta" href="#/site" data-tour="learn">
            <IconRead size={18} />
            Let it learn the demo clinic
          </a>
          <a className="ghost-link" href="#/site?teach=1">
            or teach it by hand
          </a>
        </div>
      </section>

      <h2 data-tour="explainer">What you are looking at</h2>
      <p className="sub">
        This one page is deliberately two things, because a WebMCP tool belongs to the page that registers it. They
        have to share an address.
      </p>
      <div className="explainer">
        <div className="explain-card is-product">
          <span className="explain-tag">The product</span>
          <h3>{PRODUCT}</h3>
          <p>
            Reads a website's forms by itself, remembers the task by what each field is <em>for</em>, and hands your
            AI agent a tool it can call. When the site changes, it says what changed and repairs itself.
          </p>
        </div>
        <div className="explain-card">
          <span className="explain-tag">Something to point it at</span>
          <h3>
            Northside Family Clinic <span className="fake-badge">not real</span>
          </h3>
          <p>
            A pretend appointment-booking site, invented for this demo. There is no clinic, no booking is ever sent,
            and nothing leaves your browser.
          </p>
          <p>
            It exists so there is a website to learn. It also has a <b>version 2</b>, redesigned the way a real site
            would be a year later, which is how you can watch the repair actually happen.
          </p>
        </div>
      </div>
      <p className="explain-note">
        In short: press the button, watch it read the fake clinic, then switch the clinic to v2 and watch it survive.{" "}
        Suspicious that we broke our own site on purpose? <a href="#/any">Paste in a real form</a> and watch the same
        code read that instead.
      </p>


      <GuidedPanel />


      <h2 className="section-head">
        <IconRemember size={17} /> Two things it does
      </h2>
      <p className="sub">
        Both work on a page nobody here wrote. Neither needs an extension or an account.
      </p>
      <div className="explainer does">
        <div className="explain-card">
          <span className="explain-tag">One</span>
          <h3>Learn a task, and survive the redesign</h3>
          <p>
            It reads a booking form by itself and mints a WebMCP tool your agent can call. A year later the site
            renames a field, reorders the steps and adds a required one. It reports all four in plain English, asks
            exactly one question, and runs green again.
          </p>
          <a className="cta small" href="#/site">
            <IconRead size={16} /> Watch it learn the clinic
          </a>
        </div>
        <div className="explain-card">
          <span className="explain-tag">Two</span>
          <h3>Audit any page, with three lenses</h3>
          <p>
            Paste a URL. Three specialist passes read the same DOM: structure and semantics, whether the task can
            actually be completed, and measured contrast and target sizes. Every finding cites the rule it used, and
            says whether that rule is a published standard or a preference of ours.
          </p>
          <a className="cta small" href="#/audit">
            <IconRun size={16} /> Audit a real URL
          </a>
        </div>
      </div>

      <h2 className="section-head">
        <IconCheck size={17} /> It agrees with W3C about W3C&apos;s own pages
      </h2>
      <p className="sub">
        The W3C publishes a matched pair for its Before and After Demonstration: the same page, once built badly and
        once built properly. Nobody here wrote either version, which is what makes it worth measuring against.
      </p>
      <div className="proof">
        <table className="any-table">
          <thead>
            <tr>
              <th>W3C page</th>
              <th>Findings</th>
              <th>High</th>
              <th>Medium</th>
              <th>Low</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>
                <a href="https://www.w3.org/WAI/demos/bad/before/home.html" rel="noreferrer noopener">
                  before
                </a>{" "}
                <small>deliberately inaccessible</small>
              </td>
              <td>
                <b>44</b>
              </td>
              <td>8</td>
              <td>33</td>
              <td>3</td>
            </tr>
            <tr>
              <td>
                <a href="https://www.w3.org/WAI/demos/bad/after/home.html" rel="noreferrer noopener">
                  after
                </a>{" "}
                <small>the accessible version</small>
              </td>
              <td>
                <b>3</b>
              </td>
              <td>
                <b>0</b>
              </td>
              <td>
                <b>0</b>
              </td>
              <td>3</td>
            </tr>
          </tbody>
        </table>
        <p className="explain-note">
          Forty-four down to three. High from eight to zero, medium from thirty-three to zero. The three that survive
          on the fixed page are house-rule preferences, not standards. Run it yourself on{" "}
          <a href="#/audit">the audit page</a>; the numbers are not baked in anywhere.
        </p>
      </div>

      <h2 className="section-head">
        <IconRead size={17} /> How it works
      </h2>
      <div className="how">
        <div className="how-step lead">
          <IconRead size={22} />
          <b>It reads the page</b>
          <p>
            Labels, field names, required flags and option lists, straight out of the DOM. Nothing is demonstrated and
            nothing is invented: it learns the shape of the task and stores no values of its own.
          </p>
          <p className="how-aside">
            Credential and payment fields are refused outright, never read and never filled.
          </p>
        </div>
        <div className="how-rest">
          <div className="how-step">
            <IconMint size={20} />
            <b>A tool appears mid-session</b>
            <p>
              <code>registerTool()</code> is called on the spot, so an agent can call the new tool with no reload.
            </p>
          </div>
          <div className="how-step">
            <IconHeal size={20} />
            <b>It survives the redesign</b>
            <p>Steps are remembered by intent and fields by purpose, never by CSS selector.</p>
          </div>
        </div>
      </div>

      <h2 className="section-head">
        <IconCheck size={17} /> Try the loop
      </h2>
      <p className="sub">
        Three things to see, in about ninety seconds. This list ticks itself as you go.{" "}
        <span className="progress-line">{doneCount}/3 done</span>
      </p>
      <ol className="checklist">
        <ChecklistItem
          done={taught}
          title="Learn a flow"
          note={
            taught
              ? `${flows.length} flow(s) known: ${flows.map((f) => f.name).join(", ")}`
              : "Open the clinic and press Learn automatically. It reads the four-step booking form by itself."
          }
          href="#/site"
          cta="Open the clinic"
        />
        <ChecklistItem
          done={ran}
          title="Let an agent run it, and approve the submit"
          note={
            ran
              ? "Done. You saw the exact values before anything was sent."
              : "Run it from What it learned, or from the simulated agent below. Nothing is submitted without you."
          }
          href="#/flows"
          cta="Go to flows"
        />
        <ChecklistItem
          done={healed}
          title="Break the site, then heal the flow"
          note={
            healed
              ? "Done. It survived the redesign with one answer."
              : `Switch the clinic to v2, the same clinic a year later, then check the flow's health. Site is on v${site.version} now.`
          }
          href="#/site?v=2"
          cta="Switch to v2"
        />
      </ol>

      <h2 className="section-head">
        <IconRefuse size={17} /> What it will not do
      </h2>
      <dl className="wont">
        <div>
          <dt>
            <IconNoSubmit size={17} /> Submit without you
          </dt>
          <dd>
            Every run stops at an approval dialog listing the exact values. Deny it, press Escape, or navigate away and
            nothing is sent.
          </dd>
        </div>
        <div>
          <dt>
            <IconNoInvent size={17} /> Invent your details
          </dt>
          <dd>
            It stores the shape of a task, not values. If the site asks for something nobody has ever supplied, it asks
            once instead of guessing.
          </dd>
        </div>
        <div>
          <dt>
            <IconNoKey size={17} /> Touch a password or a card
          </dt>
          <dd>
            Credential and payment fields are refused while learning. If a step is nothing but a sign-in wall, it stops
            and tells you to sign in first.
          </dd>
        </div>
        <div>
          <dt>
            <IconNoSend size={17} /> Send anything anywhere
          </dt>
          <dd>
            Single origin, <code>localStorage</code> only. No backend, no accounts, no telemetry. The clinic is
            fictional and no booking is real.
          </dd>
        </div>
      </dl>

      {taught && (
        <div className="row" style={{ marginTop: 26 }}>
          <a className="cta" href="#/flows">
            Your flows ({flows.length})
            <IconArrowRight size={18} />
          </a>
        </div>
      )}
    </main>
  )
}

/**
 * Hands-free run of the whole story. Every beat is a real tool call against
 * real storage, so this is a demo of the system rather than a video of it. The
 * approval dialog still belongs to the human, which is why the script visibly
 * waits for it.
 */
function useGuided() {
  const [g, setG] = useState(getGuided)
  useEffect(() => subscribeGuided(() => setG(getGuided())), [])
  return g
}

/** The pitch and the start button, inline on the get-started page. */
function GuidedPanel() {
  const g = useGuided()
  return (
    <section className={"guided" + (g.running ? " running" : "")}>
      <div className="guided-head" data-tour="guided">
        <div>
          <b>Watch the whole thing run</b>
          <span>
            Nine beats, about forty seconds. Every one is a real tool call, not a recording. You still approve each
            submit, which is why it stops and waits for you twice.
          </span>
        </div>
        <div className="row">
          <button className="primary big" onClick={() => void runGuidedDemo()} disabled={g.running}>
            <IconRun size={17} />
            {g.running ? "Running..." : g.finishedAt ? "Run it again" : "Run the guided demo"}
          </button>
        </div>
      </div>
    </section>
  )
}

/**
 * Sticky, and rendered outside the router, because the run navigates to the
 * demo site and back. An inline panel would unmount exactly when the beats
 * start getting interesting.
 */
function GuidedDock() {
  const g = useGuided()
  if (!g.running && !g.finishedAt) return null

  const done = g.beats.filter((b) => b.state === "done").length
  const failed = g.beats.some((b) => b.state === "failed")
  const active = g.beats.find((b) => b.state === "active")

  return (
    <section className={"dock" + (g.running ? " running" : "")} aria-live="polite">
      <div className="dock-head">
        <b>
          {g.running ? (
            <>
              <span className="spin" /> {active ? active.title : "Running"}
            </>
          ) : failed ? (
            <>
              <IconAlert size={15} /> Run stopped early
            </>
          ) : (
            <>
              <IconCheck size={15} /> All {done} beats green
            </>
          )}
        </b>
        <span className="dock-count">{done}/{g.beats.length}</span>
        {!g.running && (
          <button className="link" onClick={resetGuided}>
            <IconUndo size={14} /> clear
          </button>
        )}
      </div>

      <ol className="beats">
        {g.beats.map((b) => (
          <li key={b.id} className={b.state}>
            <span className="bt">
              {b.state === "done" ? (
                <IconCheck size={13} />
              ) : b.state === "failed" ? (
                <IconAlert size={13} />
              ) : b.state === "active" ? (
                <span className="spin" />
              ) : null}
            </span>
            <span className="bl">{b.title}</span>
            <span className="bd">{b.result ?? b.detail}</span>
          </li>
        ))}
      </ol>

      {g.awaitingApproval && (
        <p className="guided-wait">
          <IconAlert size={15} />
          <span>Waiting for you. The script cannot get past the approval dialog.</span>
        </p>
      )}
    </section>
  )
}

function ChecklistItem({
  done,
  title,
  note,
  href,
  cta,
}: {
  done: boolean
  title: string
  note: string
  href: string
  cta: string
}) {
  return (
    <li className={done ? "done" : ""}>
      <span className="tick">
        <IconCheck size={15} />
      </span>
      <span>
        <span className="ck-title">{title}</span>
        <br />
        <span className="ck-note">{note}</span>
      </span>
      {!done && (
        <a className="ghost-link" href={href}>
          {cta}
        </a>
      )}
    </li>
  )
}

// --- flow library -------------------------------------------------------

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
      <h1>Your flows</h1>
      <p className="sub">
        Each flow is a task {PRODUCT} knows how to do on the clinic site, stored by intent and purpose rather than by
        selector. Each one is also a WebMCP tool your agent can call by name.
      </p>

      {undo && (
        <div className="undo" role="status">
          <IconTrash size={16} />
          <span>
            Deleted <b>{undo.flow.name}</b> and unregistered its tool.
          </span>
          <button className="link" onClick={undoDelete}>
            Undo
          </button>
        </div>
      )}

      <div className="cards">
        {flows.length === 0 && (
          <div className="card empty">
            <b>No flows yet.</b>
            <p className="sub">
              The fastest way to see this work is to let it learn the clinic by itself. It reads the form and mints
              a tool without you filling anything in.
            </p>
            <div className="row">
              <a className="cta" href="#/site">
                <IconRead size={18} />
                Learn the clinic
              </a>
              <a className="ghost-link" href="#/site?teach=1">
                or demonstrate it yourself
              </a>
            </div>
          </div>
        )}
        {flows.map((f) => (
          <FlowCard
            key={f.id}
            flow={f}
            onHeal={() => setHealId(f.id)}
            onRun={() => setRunId(f.id)}
            onDelete={() => remove(f)}
          />
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
  const [copied, setCopied] = useState(false)

  const prompt = useMemo(() => {
    const withValues = flow.params
      .map((p) => `${p.key}: ${storedValue(flow, p.sourceField.fieldPurpose) ?? "<your value>"}`)
      .join(", ")
    return flow.params.length
      ? `Check the health of my "${flow.name}" flow, then run it with ${withValues}.`
      : `Check the health of my "${flow.name}" flow, then run it.`
  }, [flow])

  return (
    <div className="card">
      <div className="card-head">
        <b>{flow.name}</b>
        <span className="badges">
          {flow.learnedBy === "autonomous" && (
            <span className="badge auto" title="Learned by reading the page, with no demonstration">
              <IconRead size={12} /> auto-learned
            </span>
          )}
          <span className={"badge " + flow.status}>{flow.status.replace("_", " ")}</span>
        </span>
      </div>

      <p className="meta">
        {flow.learnedBy === "autonomous" ? "Learned" : "Taught"} {new Date(flow.taughtAt).toLocaleDateString()} on site
        v{flow.siteVersionAtTeach} · {flow.params.length} parameter{flow.params.length === 1 ? "" : "s"} · run{" "}
        {flow.runCount}×
      </p>

      {flow.params.length > 0 && (
        <p className="params">
          {flow.params.map((p) => {
            const required = storedValue(flow, p.sourceField.fieldPurpose) === undefined
            return (
              <code
                key={p.key}
                className={required ? "req" : ""}
                title={required ? "Required: no stored fallback value" : "Optional: falls back to the stored value"}
              >
                {p.key}
                {required ? "*" : ""}
              </code>
            )
          })}
        </p>
      )}

      <p className={"health " + report.status}>
        {report.status === "healthy" ? <IconCheck size={15} /> : <IconAlert size={15} />}
        <span>{report.summary}</span>
      </p>

      <details className="reveal">
        <summary>What it remembers</summary>
        <ul className="step-map">
          {flow.steps.map((s) => (
            <li key={s.intent}>
              <span className="si">
                step {s.order} · {s.intent}
              </span>
              <br />
              <span className="sf">
                {s.fields.length ? s.fields.map((f) => f.purpose).join(", ") : "nothing to enter"} → “{s.submitLabel}”
              </span>
            </li>
          ))}
        </ul>
      </details>

      {flow.runs && flow.runs.length > 0 && (
        <ul className="runs">
          {flow.runs.map((r, i) => (
            <li key={i} className={r.ok ? "ok" : "bad"}>
              <time>{new Date(r.at).toLocaleTimeString()}</time>
              <span title={r.message}>{r.message}</span>
            </li>
          ))}
        </ul>
      )}

      <div className="row">
        <button className="primary" onClick={onRun}>
          <IconRun size={16} />
          Run with agent
        </button>
        {report.status === "drifted" && (
          <button onClick={onHeal}>
            <IconHeal size={16} />
            {report.questions.length ? `Heal (${report.questions.length} question)` : "Heal"}
          </button>
        )}
        <button
          onClick={() => {
            navigator.clipboard?.writeText(prompt)
            setCopied(true)
            setTimeout(() => setCopied(false), 2000)
            logEvent("run", `Copied an agent prompt for ${flow.name}`)
          }}
          title={prompt}
        >
          {copied ? <IconCheck size={16} /> : <IconCopy size={16} />}
          {copied ? "Copied" : "Copy prompt"}
        </button>
        <button className="deny" onClick={onDelete} aria-label={`Delete ${flow.name}`}>
          <IconTrash size={16} />
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
  const missingRequired = flow.params.filter(
    (p) => storedValue(flow, p.sourceField.fieldPurpose) === undefined && !(args[p.key] ?? "").trim()
  )

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
        Your agent will fill the booking wizard on screen and stop for your approval. Nothing is submitted until you say
        so.
      </p>
      {flow.params.length === 0 && (
        <p className="sub">This flow has no parameters, so it replays the demonstration exactly.</p>
      )}
      {flow.params.map((p) => {
        const field = fields.find((f) => f.purpose === p.sourceField.fieldPurpose)
        const demo = storedValue(flow, p.sourceField.fieldPurpose)
        return (
          <label className="field" key={p.key}>
            <span>
              {field?.label ?? p.label} <small>{p.key}</small>
              {demo === undefined ? <em> *</em> : null}
            </span>
            {field?.options?.length ? (
              <select value={args[p.key] ?? ""} onChange={(e) => setArgs((a) => ({ ...a, [p.key]: e.target.value }))}>
                <option value="">{demo ? `reuse “${demo}”` : "choose one"}</option>
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
                placeholder={demo ? `reuse “${demo}”` : "no stored value, please supply one"}
                onChange={(e) => setArgs((a) => ({ ...a, [p.key]: e.target.value }))}
              />
            )}
          </label>
        )
      })}
      {missingRequired.length > 0 && (
        <p className="hint-warn">
          <IconAlert size={15} />
          <span>
            This flow was learned by reading the page, so it stored no values of its own.{" "}
            {missingRequired.map((p) => p.key).join(", ")} still need{missingRequired.length === 1 ? "s" : ""} a value.
          </span>
        </p>
      )}
      <div className="modal-actions">
        <button onClick={onDone}>Cancel</button>
        <button className="primary" data-autofocus="true" onClick={go} disabled={missingRequired.length > 0}>
          <IconRun size={16} />
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
      <p className="health drifted">
        <IconAlert size={15} />
        <span>{report.summary}</span>
      </p>
      <ul className="changes">
        {report.changes.map((c, i) => (
          <li key={i}>
            <span className={"tag " + (c.autoHealable ? "auto" : "ask")}>{c.autoHealable ? "auto" : "asks you"}</span>
            <span>{c.description}</span>
          </li>
        ))}
      </ul>

      {report.questions.length === 0 ? (
        <p className="sub">Nothing to ask. Healing re-reads the new layout and the flow is ready to run.</p>
      ) : (
        <>
          <p className="sub">
            It will not invent a value it has never been told, so it asks. Once, and then it remembers.
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
          <IconHeal size={16} />
          {missing.length > 0 ? "Answer to heal" : "Heal flow"}
        </button>
      </div>
    </Modal>
  )
}

// --- live tool registry -------------------------------------------------

function ToolsView() {
  const [entries, setEntries] = useState<ToolEntry[]>(getToolEntries)
  const [minted, setMinted] = useState(getLastMint)
  useEffect(() => subscribeTools(() => setEntries(getToolEntries())), [])
  useEffect(() => subscribeMint(() => setMinted(getLastMint())), [])

  const fresh = !!minted && Date.now() - minted.at < 12000
  useEffect(() => {
    if (!fresh) return
    const t = setTimeout(clearLastMint, 12000)
    return () => clearTimeout(t)
  }, [fresh])

  const flowTools = entries.filter((e) => e.flowId)
  const builtIns = entries.filter((e) => !e.flowId)

  return (
    <main>
      {fresh && minted && (
        <div className="mint-flash" role="status">
          <IconMint className="spark" size={22} />
          <div>
            <b>{minted.name}</b>
            <p>
              Tool minted with {minted.paramCount} parameter{minted.paramCount === 1 ? "" : "s"}, live in this session
              with no reload
              {minted.source === "autonomous" ? ", from reading the page alone" : ", from your demonstration"}
              {minted.native ? ", registered with the browser" : ""}.
            </p>
            {minted.error && <small>Browser registration said: {minted.error}</small>}
          </div>
        </div>
      )}

      <h1>Registered tools</h1>
      <p className="sub">
        The live WebMCP registry. Learning a flow adds a tool here mid-session, and an agent can call it immediately
        without a reload.
      </p>

      <h2 className="section-head">
        <IconRemember size={17} /> From learned flows
      </h2>
      <div className="cards">
        {flowTools.length === 0 && (
          <div className="card empty">
            <b>Nothing minted yet.</b>
            <p className="sub">Learn a flow and a tool appears here instantly.</p>
            <div className="row">
              <a className="cta" href="#/site">
                <IconRead size={18} /> Learn the clinic
              </a>
            </div>
          </div>
        )}
        {flowTools.map((e) => (
          <ToolCard key={e.tool.name} entry={e} highlight={fresh && minted?.name === e.tool.name} />
        ))}
      </div>

      <h2 className="section-head">
        <IconMint size={17} /> Built in
      </h2>
      <div className="cards">
        {builtIns.map((e) => (
          <ToolCard key={e.tool.name} entry={e} highlight={false} />
        ))}
      </div>
    </main>
  )
}

function ToolCard({ entry, highlight }: { entry: ToolEntry; highlight: boolean }) {
  const schema = entry.tool.inputSchema ?? { type: "object", properties: {} }
  const params = Object.keys(schema.properties ?? {})
  const required = new Set(schema.required ?? [])
  // Where there is no WebMCP at all, the banner already says so once. Saying
  // "mirror registry only" on every card would just be noise; it only carries
  // information when an agent is present and this tool failed to register.
  const showRegistration = webmcpStatus().available
  const notes = [
    showRegistration ? (entry.native ? "registered with the browser" : "mirror registry only") : null,
    entry.tool.annotations?.readOnlyHint ? "read only" : null,
    entry.error ?? null,
  ].filter(Boolean)

  return (
    <div className={"card tool" + (highlight ? " just-minted" : "")}>
      <div className="card-head">
        <b>{entry.tool.name}</b>
        {entry.mintedThisSession && (
          <span className="badge new">
            <IconCheck size={12} /> new this session
          </span>
        )}
      </div>
      <p>{entry.tool.description}</p>
      <p className="params">
        {params.length === 0 ? (
          <small className="native">no parameters</small>
        ) : (
          params.map((p) => (
            <code key={p} className={required.has(p) ? "req" : ""} title={required.has(p) ? "required" : "optional"}>
              {p}
              {required.has(p) ? "*" : ""}
            </code>
          ))
        )}
      </p>
      {notes.length > 0 && <small className={entry.native ? "native yes" : "native"}>{notes.join(" · ")}</small>}
    </div>
  )
}

// --- audit trail --------------------------------------------------------

function AuditTrail() {
  const [events, setEvents] = useState(getAudit)
  const [confirmReset, setConfirmReset] = useState(false)
  useEffect(() => subscribe(() => setEvents(getAudit())), [])

  const reset = () => {
    for (const flow of loadFlows()) unmintFlow(flow.name)
    clearAll()
    setConfirmReset(false)
    location.hash = "#/"
  }

  return (
    <section className="audit">
      <div className="audit-head">
        <h2 className="section-head">
          <IconTerminal size={17} /> Audit trail
        </h2>
        {(events.length > 0 || loadFlows().length > 0) && (
          <button onClick={() => setConfirmReset(true)}>
            <IconUndo size={15} />
            Reset demo data
          </button>
        )}
      </div>
      {events.length === 0 ? (
        <p className="sub">Empty. Learning, running, drifting and healing all get recorded here.</p>
      ) : (
        <ul>
          {events.slice(0, 12).map((e, i) => (
            <li key={i}>
              <time>{new Date(e.at).toLocaleTimeString()}</time>
              <span className={"tag " + e.type}>{e.type}</span>
              <span>{e.detail}</span>
            </li>
          ))}
        </ul>
      )}

      {confirmReset && (
        <Modal title="Reset demo data?" onEscape={() => setConfirmReset(false)} escapeHint="keep everything">
          <p>
            This clears every learned flow, unregisters their tools, and empties the audit trail, so you can run the
            demo from scratch. It only touches this browser's <code>localStorage</code>.
          </p>
          <div className="modal-actions">
            <button data-autofocus="true" onClick={() => setConfirmReset(false)}>
              Keep it
            </button>
            <button className="deny" onClick={reset}>
              <IconTrash size={16} />
              Reset everything
            </button>
          </div>
        </Modal>
      )}
    </section>
  )
}
