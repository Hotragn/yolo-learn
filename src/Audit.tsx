import { useCallback, useState } from "react"
import { Finding, Lens, LensReport } from "./audit/lenses"
import {
  auditDocument,
  auditHTML,
  AuditResult,
  auditUrl,
  contributeSharedMemory,
  forgetAudits,
  readSharedMemory,
  SharedMemory,
  splitAuditKey,
} from "./audit/run"
import { logEvent } from "./store"
import { IconAlert, IconCheck, IconDrift, IconHeal, IconRead, IconRefuse, IconRemember, IconRun } from "./icons"

const LENS_META: Record<Lens, { title: string; job: string }> = {
  bugs: { title: "Bug scout", job: "structure and semantics: names, ids, form owners, heading outline" },
  workflow: { title: "Workflow checker", job: "can the task actually be completed, and is anything committing ungated" },
  theme: { title: "Theme critic", job: "measured contrast, target sizes, and scale consistency" },
}

const ORDER: Lens[] = ["bugs", "workflow", "theme"]

/**
 * Three lenses over one page, and a diagram of them working.
 *
 * The diagram is inline SVG rather than a 3D scene on purpose: it has a job,
 * which is to show which lens is running and what each one came back with. A
 * WebGL library would be several hundred kilobytes to say the same thing less
 * clearly.
 */
function Orchestration({ active, reports }: { active: Lens | null; reports: LensReport[] }) {
  const countFor = (lens: Lens) => reports.find((r) => r.lens === lens)?.findings.length
  const done = (lens: Lens) => reports.some((r) => r.lens === lens)

  return (
    <svg className="orch" viewBox="0 0 640 210" role="img" aria-label="Three lenses reading the page and reporting back">
      <g className="orch-wire">
        {[52, 105, 158].map((y, i) => (
          <path
            key={i}
            d={`M120 105 C 180 105, 180 ${y}, 240 ${y}`}
            className={active === ORDER[i] ? "on" : done(ORDER[i]) ? "was" : ""}
          />
        ))}
        {[52, 105, 158].map((y, i) => (
          <path
            key={"r" + i}
            d={`M420 ${y} C 480 ${y}, 480 105, 540 105`}
            className={done(ORDER[i]) ? "was" : ""}
          />
        ))}
      </g>

      <g className="orch-node">
        <rect x="30" y="80" width="90" height="50" rx="10" />
        <text x="75" y="102">the page</text>
        <text x="75" y="118" className="sub">
          one DOM
        </text>
      </g>

      {ORDER.map((lens, i) => {
        const y = [52, 105, 158][i]
        const n = countFor(lens)
        return (
          <g
            key={lens}
            className={"orch-node lens" + (active === lens ? " on" : done(lens) ? " was" : "")}
          >
            <rect x="240" y={y - 22} width="180" height="44" rx="10" />
            <text x="330" y={y - 3}>
              {LENS_META[lens].title}
            </text>
            <text x="330" y={y + 13} className="sub">
              {active === lens ? "reading..." : n == null ? "waiting" : `${n} finding${n === 1 ? "" : "s"}`}
            </text>
          </g>
        )
      })}

      <g className={"orch-node" + (reports.length === ORDER.length ? " was" : "")}>
        <rect x="540" y="80" width="80" height="50" rx="10" />
        <text x="580" y="102">report</text>
        <text x="580" y="118" className="sub">
          cross-checked
        </text>
      </g>
    </svg>
  )
}

function SourceBadge({ finding }: { finding: Finding }) {
  const standard = finding.rule.source !== "house rule"
  return standard ? (
    <a className="src std" href={finding.rule.url} target="_blank" rel="noreferrer noopener">
      {finding.rule.source} {finding.rule.id.replace(/^wcag-/, "SC ").replace(/^html-/, "")}
    </a>
  ) : (
    <span className="src house">our preference, not a standard</span>
  )
}

function FindingRow({ f }: { f: Finding }) {
  return (
    <li className={"finding sev-" + f.severity}>
      <div className="finding-head">
        <span className={"sev " + f.severity}>{f.severity}</span>
        <b>{f.rule.name}</b>
        <SourceBadge finding={f} />
        {f.corroboratedBy?.length ? (
          <span className="corrob" title="Another lens reached the same element independently">
            also flagged by {f.corroboratedBy.join(", ")}
          </span>
        ) : null}
      </div>
      <p className="finding-el">
        <code>{f.element}</code>
        {f.measured && (
          <span className="measured">
            measured <b>{f.measured}</b>
            {f.threshold && <> against <b>{f.threshold}</b></>}
          </span>
        )}
      </p>
      <p className="finding-detail">{f.detail}</p>
    </li>
  )
}

const SAMPLE = `<main style="background:#ffffff;font-family:system-ui">
  <h1 style="font-size:28px">Renew your permit</h1>
  <h4 style="font-size:15px">Step one</h4>
  <form>
    <p style="color:#aaaaaa;font-size:11px">All fields are required.</p>
    <input name="permit_ref" placeholder="Permit number" required>
    <input name="vehicle_reg" required>
    <input name="zone" required disabled value="A">
    <img src="seal.png">
    <button style="width:18px;height:18px">Pay now</button>
  </form>
  <div id="dup"></div><div id="dup"></div>
</main>`

const SUGGESTED = [
  {
    label: "W3C, built badly",
    href: "https://www.w3.org/WAI/demos/bad/before/home.html",
  },
  {
    label: "W3C, built properly",
    href: "https://www.w3.org/WAI/demos/bad/after/home.html",
  },
]

export function Audit() {
  const [active, setActive] = useState<Lens | null>(null)
  const [reports, setReports] = useState<LensReport[]>([])
  const [result, setResult] = useState<AuditResult | null>(null)
  const [html, setHtml] = useState("")
  const [url, setUrl] = useState("")
  const [urlError, setUrlError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [shared, setShared] = useState<SharedMemory | null>(null)

  // Reveal the lenses one at a time. They are fast enough to finish in a frame,
  // and a report that appears instantly hides which lens said what.
  const reveal = useCallback(async (final: AuditResult) => {
    setReports([])
    for (const lens of ORDER) {
      const report = final.reports.find((r) => r.lens === lens)
      if (!report) continue
      setActive(lens)
      await new Promise((r) => setTimeout(r, 420))
      setReports((prev) => [...prev, report])
    }
    setActive(null)
    setResult(final)
  }, [])

  const runOnThisPage = async () => {
    setBusy(true)
    setResult(null)
    try {
      const out = auditDocument(document, { label: location.origin + "/audit-self" })
      logEvent("learn", `Audited this page: ${out.totals.findings} finding(s) across 3 lenses`)
      await reveal(out)
    } finally {
      setBusy(false)
    }
  }

  const runOnUrl = async () => {
    if (!url.trim()) {
      setUrlError("Enter a public http or https URL.")
      return
    }
    setUrlError(null)
    setBusy(true)
    setResult(null)
    try {
      const out = await auditUrl(url.trim())
      logEvent("learn", `Audited ${url.trim()}: ${out.totals.findings} finding(s)`)

      // Use the key the audit itself produced. Rederiving it here fingerprinted
      // THIS page's DOM rather than the audited one, which collapsed every
      // audited URL onto a single fingerprint.
      const parts = splitAuditKey(out.key)
      if (parts) {
        const before = await readSharedMemory(parts.origin, parts.fingerprint)
        setShared(before)
        void contributeSharedMemory(parts.origin, parts.fingerprint, out)
      } else {
        setShared(null)
      }

      await reveal(out)
    } finally {
      setBusy(false)
    }
  }

  const runOnHTML = async () => {
    if (!html.trim()) return
    setBusy(true)
    setResult(null)
    try {
      const out = await auditHTML(html, { label: "pasted" })
      logEvent("learn", `Audited pasted markup: ${out.totals.findings} finding(s) across 3 lenses`)
      await reveal(out)
    } finally {
      setBusy(false)
    }
  }

  return (
    <main>
      <h1>Three lenses over one page</h1>
      <p className="sub">
        Not one agent guessing. Three specialist passes over the same DOM, each answering a different question, each
        citing the rule it used. Where a rule is ours rather than published, it says so.
      </p>

      <Orchestration active={active} reports={reports} />

      <div className="lens-legend">
        {ORDER.map((l) => (
          <div key={l}>
            <b>{LENS_META[l].title}</b>
            <span>{LENS_META[l].job}</span>
          </div>
        ))}
      </div>

      <form
        className="url-bar"
        onSubmit={(e) => {
          e.preventDefault()
          void runOnUrl()
        }}
      >
        <label className="field">
          <span>
            Audit a live page <small>any public URL, no extension and nothing to install</small>
          </span>
          <div className="url-row">
            <input
              type="url"
              autoComplete="url"
              value={url}
              onChange={(e) => {
                setUrl(e.target.value)
                setUrlError(null)
              }}
            />
            <button className="primary" type="submit" disabled={busy || !url.trim()}>
              <IconRead size={17} /> {busy ? "Reading..." : "Audit it"}
            </button>
          </div>
        </label>
        {urlError && (
          <p className="hint-warn" role="alert">
            <IconAlert size={15} />
            <span>{urlError}</span>
          </p>
        )}
        <p className="row" style={{ marginTop: 8, flexWrap: "wrap", gap: 8 }}>
          {SUGGESTED.map((s) => (
            <button
              key={s.href}
              type="button"
              onClick={() => {
                setUrl(s.href)
                setUrlError(null)
              }}
            >
              {s.label}
            </button>
          ))}
        </p>
        <p className="explain-note">
          Static HTML only. Client-rendered pages look empty because their JavaScript never runs. Private addresses are
          refused.
        </p>
      </form>

      <div className="row audit-actions">
        <button className="primary" onClick={() => void runOnThisPage()} disabled={busy}>
          <IconRun size={17} /> Audit this page
        </button>
        <button onClick={() => void runOnHTML()} disabled={busy || !html.trim()}>
          <IconRead size={17} /> Audit the markup below
        </button>
        <button type="button" onClick={() => setHtml(SAMPLE)} disabled={busy}>
          Load a broken example
        </button>
        <button
          type="button"
          onClick={() => {
            forgetAudits()
            setResult(null)
            setReports([])
          }}
          disabled={busy}
        >
          Forget what it remembers
        </button>
      </div>

      <label className="field">
        <span>
          Markup to audit
        </span>
        <textarea rows={9} className="any-input" spellCheck={false} value={html} onChange={(e) => setHtml(e.target.value)} />
      </label>

      {result && (
        <>
          <h2>What came back</h2>
          <dl className="any-meta">
            <div>
              <dt>Findings</dt>
              <dd>{result.totals.findings}</dd>
            </div>
            <div>
              <dt>Checks made</dt>
              <dd>{result.totals.checked}</dd>
            </div>
            <div>
              <dt>Not computable</dt>
              <dd>{result.totals.unknowns}</dd>
            </div>
            <div>
              <dt>Corroborated</dt>
              <dd>{result.totals.corroborated}</dd>
            </div>
            <div>
              <dt>Severity</dt>
              <dd>
                {result.bySeverity.high} high, {result.bySeverity.medium} medium, {result.bySeverity.low} low
              </dd>
            </div>
          </dl>

          {result.diff && (
            <div className="audit-diff">
              <p>
                <IconHeal size={17} />
                <span>
                  <b>Seen before.</b> Compared with {new Date(result.diff.previousAt).toLocaleString()}:{" "}
                  <b>{result.diff.fixed.length} fixed</b>, <b>{result.diff.appeared.length} new</b>,{" "}
                  {result.diff.stillOpen} still open. That is what the memory buys: the second look is a diff, not a
                  re-read.
                </span>
              </p>
              {result.diff.fixed.length > 0 && (
                <ul className="diff-list">
                  {result.diff.fixed.slice(0, 5).map((f, i) => (
                    <li key={i}>
                      <IconCheck size={14} /> fixed: {f.rule.name} on <code>{f.element}</code>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {shared && (
            <div className={"shared-mem" + (shared.configured ? "" : " off")}>
              <p>
                <IconRemember size={17} />
                {shared.configured && shared.record ? (
                  <span>
                    <b>
                      This page shape has been audited {shared.record.audits}{" "}
                      time{shared.record.audits === 1 ? "" : "s"} before
                    </b>
                    , most recently {new Date(shared.record.lastAt).toLocaleString()}. Commonly trips:{" "}
                    {Object.entries(shared.record.rules)
                      .sort((a, b) => b[1] - a[1])
                      .slice(0, 4)
                      .map(([id, n]) => `${id} (${n})`)
                      .join(", ")}
                    . A hint only: the lenses above re-ran from scratch.
                  </span>
                ) : shared.configured ? (
                  <span>
                    <b>Nobody has audited this page shape before.</b> The next person to look will see that you did,
                    as counts against rule ids and nothing else.
                  </span>
                ) : (
                  <span>
                    <b>No shared store on this deployment</b>, so audits are remembered in your browser only.{" "}
                    {shared.reason}
                  </span>
                )}
              </p>
            </div>
          )}

          {result.reports.map((r) => (
            <section key={r.lens} className="lens-report">
              <h3>
                {LENS_META[r.lens].title}
                <span className="lens-count">
                  {r.findings.length} finding{r.findings.length === 1 ? "" : "s"} from {r.checked} check
                  {r.checked === 1 ? "" : "s"}
                </span>
              </h3>
              {r.findings.length === 0 ? (
                <p className="sub">
                  <IconCheck size={15} /> Nothing found by this lens.
                </p>
              ) : (
                <ul className="findings">
                  {r.findings
                    .slice()
                    .sort((a, b) => ({ high: 0, medium: 1, low: 2 })[a.severity] - ({ high: 0, medium: 1, low: 2 })[b.severity])
                    .map((f, i) => (
                      <FindingRow key={i} f={f} />
                    ))}
                </ul>
              )}
              {r.unknowns.length > 0 && (
                <div className="unknowns">
                  <p>
                    <IconDrift size={16} />
                    <span>
                      <b>{r.unknowns.length} could not be computed</b> and are counted separately rather than as passes.
                    </span>
                  </p>
                  <ul>
                    {r.unknowns.slice(0, 4).map((u, i) => (
                      <li key={i}>
                        <code>{u.element}</code> {u.detail}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </section>
          ))}

          {result.notes.length > 0 && (
            <div className="audit-notes">
              <p>
                <IconAlert size={16} />
                <b>What this run could not do</b>
              </p>
              <ul>
                {result.notes.map((n, i) => (
                  <li key={i}>{n}</li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}

      <h2>Why three, and why not one that thinks</h2>
      <div className="explainer">
        <div className="explain-card is-product">
          <span className="explain-tag">What the lenses do</span>
          <p>
            Each one measures something a published rule defines, so a finding can show its working: a contrast ratio
            against SC 1.4.3, an accessible name against the ARIA computation order, a duplicate id against the HTML
            spec. Two lenses reaching the same element independently is marked as corroborated.
          </p>
        </div>
        <div className="explain-card">
          <span className="explain-tag">What they refuse to do</span>
          <p>
            <IconRefuse size={15} /> Guess. A gradient behind text makes the ratio genuinely uncomputable, so it is
            reported as unknown, never as a pass. Preferences of ours are labelled as preferences. Nothing here claims
            to reason about your product.
          </p>
        </div>
      </div>
    </main>
  )
}
