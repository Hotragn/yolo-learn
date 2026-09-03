import { useState } from "react"
import { learnUrl, LearnUrlResult, recallRemote } from "./remote"
import { logEvent } from "./store"
import { IconAlert, IconCheck, IconRemember } from "./icons"

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

  const run = async () => {
    const extra = trail
      .split(/\n/)
      .map((l) => l.trim())
      .filter(Boolean)
    const pages = [url.trim(), ...extra].filter(Boolean)
    const first = pages[0] ?? ""
    setError(null)
    setRemote(null)
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
        recalled.state === "hit" && extra.length === 0
          ? await learnUrl(first)
          : await learnUrl(first, { pages })
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
            Paste a URL. The first visit fetches static HTML and stores the shape of the task. The next visit is a
            lookup: no fetch, no re-walk. Open the site yourself if you want, click through, then add those URLs
            below. GET only. Nothing is submitted on the target.
          </p>
        </>
      ) : (
        <p className="sub">
          Paste a public URL. First visit reads and stores the task. Next visit fetches nothing.
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
                          {" "}— refused {s.refused.length}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      )}
    </section>
  )
}
