import { useState } from "react"
import { learnUrl, LearnUrlResult, recallRemote } from "./remote"
import { EXAMPLE_PUBLIC_FORM } from "./page-fetch"
import { logEvent } from "./store"
import { IconAlert, IconCheck, IconCopy, IconRemember } from "./icons"

function looksLikeUrl(value: string): boolean {
  try {
    const u = new URL(value)
    return u.protocol === "http:" || u.protocol === "https:"
  } catch {
    return false
  }
}

/**
 * Paste a public URL (or the pages you already opened). First visit reads.
 * Next visit is a cache hit and fetches nothing.
 */
export function LearnUrlPanel({ compact = false }: { compact?: boolean }) {
  const [url, setUrl] = useState("")
  const [trail, setTrail] = useState("")
  const [showTrail, setShowTrail] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [remote, setRemote] = useState<LearnUrlResult | null>(null)

  const [copied, setCopied] = useState(false)

  const run = async (force = false) => {
    const extra = trail
      .split(/\n/)
      .map((l) => l.trim())
      .filter(Boolean)
    const pages = [url.trim(), ...extra].filter(Boolean)
    const first = pages[0] ?? ""
    setError(null)
    if (!force) setRemote(null)
    if (!first) {
      setError("Enter a public http or https URL.")
      return
    }
    if (!looksLikeUrl(first)) {
      setError("That is not a valid http(s) URL.")
      return
    }
    setBusy(true)
    try {
      const recalled = recallRemote(first)
      const out =
        force || extra.length > 0 || recalled.state !== "hit"
          ? await learnUrl(first, { pages: extra.length ? pages : undefined, force })
          : await learnUrl(first)
      setRemote(out)
      logEvent("learn", out.summary)
      if (out.ok) setError(null)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className={"url-learn" + (compact ? " compact" : "")} data-tour="url-learn">
      {!compact ? (
        <>
          <h2 className="section-head">
            <IconRemember size={17} /> Read a public site, then skip the re-read
          </h2>
          <p className="sub">
            Paste a URL. If the first GET has no fields, we run the page JavaScript in headless Chrome (read-only) and
            learn what it drew. Login, OAuth, and POST are still refused. GitHub-style SPAs that never paint a form
            will still come back empty.
          </p>
        </>
      ) : (
        <p className="sub">
          Paste a public URL. If the HTML is an empty JavaScript shell, we render it once in headless Chrome, then
          remember the fields. Next visit fetches nothing.
        </p>
      )}

      <form
        className="url-bar"
        onSubmit={(e) => {
          e.preventDefault()
          void run()
        }}
      >
        <div className="field">
          <span id="url-learn-label">
            Public page <small>fetched read-only, remembered after the first visit</small>
          </span>
          <div className="url-row">
            <input
              type="url"
              autoComplete="url"
              aria-labelledby="url-learn-label"
              value={url}
              onChange={(e) => {
                setUrl(e.target.value)
                setError(null)
              }}
              aria-invalid={!!error}
              aria-describedby={error ? "url-learn-error" : undefined}
            />
            <button className="primary" type="submit" disabled={busy}>
              <IconRemember size={17} />
              {busy ? "Reading..." : "Remember this site"}
            </button>
          </div>
        </div>
        <button
          type="button"
          className="link trail-toggle"
          onClick={() => {
            setUrl(EXAMPLE_PUBLIC_FORM)
            setError(null)
          }}
        >
          Use a known-good example (W3C survey)
        </button>
        <button
          type="button"
          className="link trail-toggle"
          onClick={() => setShowTrail((v) => !v)}
        >
          {showTrail ? "Hide extra pages" : "I already clicked through. Add those URLs."}
        </button>
        {showTrail && (
          <label className="field">
            <span>
              Pages you opened <small>same site, one per line, in order</small>
            </span>
            <textarea
              rows={3}
              className="any-input"
              spellCheck={false}
              value={trail}
              onChange={(e) => setTrail(e.target.value)}
            />
          </label>
        )}
        {error && (
          <p className="hint-warn" id="url-learn-error" role="alert">
            <IconAlert size={15} />
            <span>{error}</span>
          </p>
        )}
      </form>

      {remote && (
        <section className={"any-result " + (remote.ok ? "ok" : "bad")}>
          <p className="any-msg">
            {remote.ok ? <IconCheck size={17} /> : <IconAlert size={17} />}
            <span>{remote.summary}</span>
          </p>
          {remote.ok && remote.cached && (
            <p className="explain-note">Cache hit. This visit fetched nothing.</p>
          )}
          {remote.ok && !remote.cached && remote.bytesRead > 0 && (
            <p className="explain-note">
              First visit read {Math.round(remote.bytesRead / 1024)}KB. The next call to this origin fetches nothing.
            </p>
          )}
          {remote.ok && remote.steps.length > 0 && (
            <table className="any-table">
              <thead>
                <tr>
                  <th>Step</th>
                  <th>URL</th>
                  <th>Fields learned</th>
                </tr>
              </thead>
              <tbody>
                {remote.steps.map((s) => (
                  <tr key={s.url + s.order}>
                    <td>{s.intent}</td>
                    <td>
                      <code>{s.url.replace(/^https?:\/\//, "")}</code>
                    </td>
                    <td>
                      {s.fields.length === 0
                        ? "none"
                        : s.fields.map((f, i) => (
                            <span key={i} className="field-chip">
                              {f.label || f.purpose}
                              {f.required && <small title="required"> *</small>}
                            </span>
                          ))}
                        {s.refused.length > 0 && (
                        <span className="refused-note" title="Refused (sensitive)">
                          {" "}
                          - refused {s.refused.length}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {remote.ok && remote.toolName && (
            <div className="shared-mem">
              <p>
                <b>WebMCP tool minted</b>{" "}
                <code>{remote.toolName}</code>
                <button
                  type="button"
                  className="link"
                  onClick={() => {
                    void navigator.clipboard.writeText(remote.toolName!)
                    setCopied(true)
                    setTimeout(() => setCopied(false), 1500)
                  }}
                >
                  <IconCopy size={14} /> {copied ? "Copied" : "Copy name"}
                </button>
              </p>
              <p className="explain-note">
                An agent can call this now. Default execute is a cache hit (no fetch). Pass refresh=true only to
                re-read and see if the shape moved.
              </p>
              <div className="row">
                <button type="button" disabled={busy} onClick={() => void run(true)}>
                  Check if the shape moved
                </button>
              </div>
            </div>
          )}
          {!remote.ok && (
            <p className="explain-note">
              <button
                type="button"
                className="link"
                onClick={() => {
                  setUrl(EXAMPLE_PUBLIC_FORM)
                  setRemote(null)
                  setError(null)
                }}
              >
                Switch to the W3C survey example
              </button>
              , then click Remember this site. That page is a real HTML form and is what we test against.
            </p>
          )}
        </section>
      )}
    </section>
  )
}
