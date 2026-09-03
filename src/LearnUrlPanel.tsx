import { useEffect, useState } from "react"
import { learnFromHtml, learnUrl, LearnUrlResult, recallRemote } from "./remote"
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

function captureBookmarklet(origin: string) {
  const dest = JSON.stringify(origin)
  const ingest = JSON.stringify(`${origin}/api/ingest`)
  const fallback = JSON.stringify(`${origin}/#/any?capture=1`)
  return (
    "javascript:void((function(){var html=document.documentElement.outerHTML;var url=location.href;" +
    `fetch(${ingest},{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({url:url,html:html})})` +
    ".then(function(r){return r.json()}).then(function(d){if(d&&d.id){window.open(" +
    dest +
    "+'/#/any?snap='+d.id,'_blank')}else{throw new Error('no id')}}).catch(function(){var w=window.open(" +
    fallback +
    ",'_blank');var send=function(){try{w.postMessage({source:'yolo-capture',url:url,html:html}," +
    dest +
    ")}catch(e){}};setTimeout(send,600);setTimeout(send,1800);});})())"
  )
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
  const [copiedMark, setCopiedMark] = useState(false)
  const [waitingCapture, setWaitingCapture] = useState(false)

  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      const d = e.data as { source?: string; url?: string; html?: string }
      if (d?.source !== "yolo-capture" || typeof d.url !== "string" || typeof d.html !== "string") return
      setWaitingCapture(false)
      setUrl(d.url)
      setBusy(true)
      void learnFromHtml(d.url, d.html).then((out) => {
        setRemote(out)
        logEvent("learn", out.summary)
        setBusy(false)
      })
    }
    window.addEventListener("message", onMsg)
    return () => window.removeEventListener("message", onMsg)
  }, [])

  useEffect(() => {
    const qs = new URLSearchParams(location.hash.split("?")[1] ?? "")
    if (qs.get("capture") === "1") setWaitingCapture(true)
    const snap = qs.get("snap")
    if (!snap) return
    let cancelled = false
    setBusy(true)
    void (async () => {
      try {
        const r = await fetch(`/api/ingest?id=${encodeURIComponent(snap)}`)
        const d = (await r.json()) as { html?: string; url?: string; error?: string }
        if (cancelled) return
        if (d.html && d.url) {
          setUrl(d.url)
          const out = await learnFromHtml(d.url, d.html)
          if (!cancelled) {
            setRemote(out)
            logEvent("learn", out.summary)
          }
        } else if (!cancelled) setError(d.error || "That snapshot expired. Capture the page again.")
      } finally {
        if (!cancelled) setBusy(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

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
            Paste a URL for a public page. For a logged-in dashboard, capture the tab you already signed into: cookies
            stay in that browser. We still refuse passwords and never POST.
          </p>
        </>
      ) : (
        <p className="sub">
          Public URL, or capture a logged-in tab with the bookmarklet. Next visit fetches nothing.
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
          onClick={() => {
            void navigator.clipboard.writeText(captureBookmarklet(location.origin))
            setCopiedMark(true)
            setTimeout(() => setCopiedMark(false), 2000)
          }}
        >
          {copiedMark ? "Copied capture bookmarklet" : "Copy bookmarklet (logged-in tab)"}
        </button>
        {waitingCapture && (
          <p className="explain-note">Waiting for a snapshot from the tab you captured. Keep this window open.</p>
        )}
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
