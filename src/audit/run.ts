import { safeGetItem, safeSetItem } from "../types"
import { Finding, Lens, LensReport, runLenses } from "./lenses"

/**
 * Running the lenses, and remembering what they found.
 *
 * Two things here are load-bearing.
 *
 * First, contrast and target size need LAYOUT. A document from DOMParser has
 * no view, so getComputedStyle resolves nothing and getBoundingClientRect
 * returns zeroes - which is exactly why the theme lens declines to guess on
 * parsed markup. To measure pasted HTML properly it has to be rendered, so it
 * goes into a sandboxed iframe with scripts disabled: real layout, real
 * cascade, and the pasted page's own JavaScript never runs.
 *
 * Second, the memory is a diff, not a cache of prose. A second audit of the
 * same page reports what got fixed, what is new, and what is still open. That
 * is the part that makes a second run cheaper than the first, and it is
 * checkable rather than asserted.
 */

// Ceiling for the load event on a real page with inlined CSS and remote
// images. The old code waited a flat 1200ms and did not wait for load at all.
const RENDER_LOAD_CEILING_MS = 6000
// After load, only enough slack to catch a DOM that has not flushed yet.
// Waiting the full ceiling again would make an empty page take twelve seconds
// to report that it is empty.
const RENDER_SETTLE_MS = 800

export interface AuditResult {
  reports: LensReport[]
  totals: { findings: number; unknowns: number; checked: number; corroborated: number }
  bySeverity: { high: number; medium: number; low: number }
  /** Present from the second audit of the same page onwards. */
  diff?: AuditDiff
  notes: string[]
  /**
   * Identifies the page that was audited: label plus a fingerprint of its
   * structure. Returned rather than left internal because callers need it and
   * cannot rederive it: doing so means fingerprinting the audited document,
   * which the caller does not have a handle on.
   */
  key: string
  /** True when the page never rendered, so no lens ran. Never means "clean". */
  renderFailed?: boolean
}

export interface AuditDiff {
  previousAt: string
  fixed: Finding[]
  appeared: Finding[]
  stillOpen: number
}

// NOT "audit.v1": store.ts already owns that key for the audit trail, and the
// two silently overwrote each other. The diff never fired and the trail was
// being corrupted, which is a good argument for namespacing storage keys by
// the module that owns them.
const MEMORY_KEY = "audit.lenses.v1"

/** A finding's identity, stable across runs so a diff means something. */
function identity(f: Finding): string {
  return `${f.rule.id}|${f.element}`
}

interface StoredAudit {
  at: string
  ids: string[]
  findings: Finding[]
}

type Memory = Record<string, StoredAudit>

function loadMemory(): Memory {
  try {
    const parsed = JSON.parse(safeGetItem(MEMORY_KEY) ?? "{}")
    return parsed && typeof parsed === "object" ? (parsed as Memory) : {}
  } catch {
    return {}
  }
}

export function rememberAudit(key: string, findings: Finding[]) {
  const memory = loadMemory()
  memory[key] = { at: new Date().toISOString(), ids: findings.map(identity), findings }
  safeSetItem(MEMORY_KEY, JSON.stringify(memory))
}

export function recallAudit(key: string): StoredAudit | null {
  return loadMemory()[key] ?? null
}

export function forgetAudits() {
  safeSetItem(MEMORY_KEY, "{}")
}

export function auditMemoryKeys(): { key: string; at: string; findings: number }[] {
  return Object.entries(loadMemory()).map(([key, v]) => ({ key, at: v.at, findings: v.ids.length }))
}

/**
 * A key that changes when the page's structure changes but not when its content
 * does, so revisiting the same page is a hit and a redesign is a miss.
 */
export function auditKey(doc: Document, label: string): string {
  const shape = [...doc.querySelectorAll("form, input, select, textarea, button, h1, h2, h3")]
    .map((el) => `${el.tagName}${el.getAttribute("name") ?? ""}${(el as HTMLInputElement).type ?? ""}`)
    .join(">")
  let hash = 0
  for (let i = 0; i < shape.length; i++) hash = (hash * 31 + shape.charCodeAt(i)) | 0
  return `${label}#${(hash >>> 0).toString(36)}`
}

function summarise(reports: LensReport[], notes: string[], diff?: AuditDiff, key = ""): AuditResult {
  const findings = reports.flatMap((r) => r.findings)
  return {
    reports,
    totals: {
      findings: findings.length,
      unknowns: reports.reduce((n, r) => n + r.unknowns.length, 0),
      checked: reports.reduce((n, r) => n + r.checked, 0),
      corroborated: findings.filter((f) => f.corroboratedBy?.length).length,
    },
    bySeverity: {
      high: findings.filter((f) => f.severity === "high").length,
      medium: findings.filter((f) => f.severity === "medium").length,
      low: findings.filter((f) => f.severity === "low").length,
    },
    diff,
    notes: [...notes, ...reports.flatMap((r) => r.notes)],
    key,
  }
}

function diffAgainst(previous: StoredAudit | null, findings: Finding[]): AuditDiff | undefined {
  if (!previous) return undefined
  const now = new Set(findings.map(identity))
  const before = new Set(previous.ids)
  return {
    previousAt: previous.at,
    fixed: previous.findings.filter((f) => !now.has(identity(f))),
    appeared: findings.filter((f) => !before.has(identity(f))),
    stillOpen: findings.filter((f) => before.has(identity(f))).length,
  }
}

export interface RunOptions {
  lenses?: Lens[]
  /** Label for the memory key. The origin for a live page, a name for pasted HTML. */
  label?: string
  remember?: boolean
}

/** Audit the live document. */
export function auditDocument(doc: Document, options: RunOptions = {}): AuditResult {
  const lenses = options.lenses ?? ["bugs", "workflow", "theme"]
  const label = options.label ?? location.origin + location.pathname
  const reports = runLenses(doc, lenses)
  const findings = reports.flatMap((r) => r.findings)
  const key = auditKey(doc, label)
  const diff = diffAgainst(recallAudit(key), findings)
  if (options.remember !== false) rememberAudit(key, findings)
  return summarise(reports, [], diff, key)
}

/**
 * Audit a string of HTML by rendering it first.
 *
 * The iframe is sandboxed WITHOUT allow-scripts, so nothing in the pasted
 * markup executes. allow-same-origin is needed to read the resulting document,
 * and is safe precisely because scripts are off.
 */
export async function auditHTML(html: string, options: RunOptions = {}): Promise<AuditResult> {
  const frame = document.createElement("iframe")
  frame.setAttribute("sandbox", "allow-same-origin")
  frame.setAttribute("aria-hidden", "true")
  frame.setAttribute("tabindex", "-1")
  // Off-screen but genuinely laid out: display:none would take layout away and
  // put us back to guessing.
  frame.style.cssText =
    "position:fixed;left:-10000px;top:0;width:1280px;height:900px;border:0;visibility:hidden;"
  frame.srcdoc = html

  // A blind 1200ms timeout used to race the load event here, and on a real
  // page with inlined stylesheets and remote images the timeout usually won.
  // The frame was then measured before its body existed, which produced an
  // audit with zero findings: indistinguishable from a clean page. So wait for
  // the load event, then poll until there is actually something to measure.
  const loaded = new Promise<void>((resolve) => {
    frame.addEventListener("load", () => resolve(), { once: true })
    setTimeout(resolve, RENDER_LOAD_CEILING_MS)
  })

  document.body.appendChild(frame)
  try {
    await loaded
    const deadline = Date.now() + RENDER_SETTLE_MS
    while (Date.now() < deadline) {
      const body = frame.contentDocument?.body
      if (body && body.childElementCount > 0) break
      await new Promise((r) => setTimeout(r, 60))
    }

    const doc = frame.contentDocument
    if (!doc || !doc.body || doc.body.childElementCount === 0) {
      // Loud, not quiet. Reporting zero findings for a page that never
      // rendered would be the exact failure this project refuses elsewhere:
      // something uncomputable presented as something that passed.
      return {
        ...summarise([], [
          "RENDER FAILED. The markup never produced a document, so NOTHING was measured.",
          "This is not a clean result. Zero findings here means zero checks ran, not zero problems.",
        ]),
        renderFailed: true,
      }
    }
    const lenses = options.lenses ?? ["bugs", "workflow", "theme"]
    const reports = runLenses(doc, lenses)
    const findings = reports.flatMap((r) => r.findings)
    const label = options.label ?? "pasted"
    const key = auditKey(doc, label)
    const diff = diffAgainst(recallAudit(key), findings)
    if (options.remember !== false) rememberAudit(key, findings)

    return summarise(reports, [
      "Rendered in a sandboxed frame with scripts disabled, so layout and the cascade are real and the pasted page's own JavaScript never ran.",
      "Inline styles and <style> blocks apply. A stylesheet linked by a relative URL will not resolve, so some colours may differ from the real site.",
    ], diff, key)
  } finally {
    frame.remove()
  }
}


// --- auditing a public URL ----------------------------------------------

export interface FetchedPage {
  html?: string
  finalUrl?: string
  redirected?: boolean
  bytes?: number
  notes?: string[]
  error?: string
}

/**
 * Audit a public URL.
 *
 * The division of labour matters: a serverless function does the one thing a
 * static page cannot, which is read another origin, and hands back markup. The
 * measuring still happens here, in the sandboxed iframe, so layout and the
 * cascade are the browser's own rather than a headless simulation of them.
 *
 * The honest limit is that no JavaScript from the target ever runs, so a page
 * that renders its content client-side will look close to empty. That is
 * stated in the result rather than left to be discovered.
 */
export async function auditUrl(url: string, options: RunOptions = {}): Promise<AuditResult & { page?: FetchedPage }> {
  let page: FetchedPage
  try {
    const response = await fetch(`/api/fetch-page?url=${encodeURIComponent(url)}`)
    page = (await response.json()) as FetchedPage
  } catch (err) {
    return {
      ...summarise([], [`Could not reach the fetch endpoint: ${err instanceof Error ? err.message : String(err)}`]),
    }
  }

  if (page.error || !page.html) {
    return { ...summarise([], [page.error ?? "Nothing came back from that URL."]), page }
  }

  const origin = (() => {
    try {
      return new URL(page.finalUrl ?? url).origin
    } catch {
      return url
    }
  })()

  const result = await auditHTML(page.html, { ...options, label: origin })
  const bodyText = page.html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim()

  return {
    ...result,
    page,
    key: result.key,
    notes: [
      `Fetched ${page.finalUrl}${page.redirected ? " (after a redirect)" : ""}, ${Math.round((page.bytes ?? 0) / 1024)}KB.`,
      ...(page.notes ?? []),
      "No JavaScript from the target ran, so anything it renders client-side is not measured here." +
        (bodyText.length < 400 ? " This page returned very little static text, which usually means exactly that." : ""),
      !/<form[\s>]/i.test(page.html ?? "")
        ? "No <form> in the static HTML. A JS-only page cannot be audited here. Use the W3C before/after demos, or paste markup of a real form."
        : "",
      ...result.notes,
    ].filter((n): n is string => !!n),
  }
}


// --- shared memory ------------------------------------------------------

export interface SharedRecord {
  audits: number
  lastAt: string
  lastCounts: { high: number; medium: number; low: number }
  rules: Record<string, number>
}

export interface SharedMemory {
  configured: boolean
  reason?: string
  record?: SharedRecord | null
}

/**
 * What previous audits of this page shape found, across everyone.
 *
 * A hint and nothing more: the lenses always re-run locally, and none of this
 * is ever shown as a finding. It exists so the second person to look at a page
 * knows it has been looked at, and what it usually trips on.
 *
 * Every failure path returns "not configured" rather than throwing, so a
 * missing or broken store costs nothing.
 */
export async function readSharedMemory(origin: string, fingerprint: string): Promise<SharedMemory> {
  try {
    const response = await fetch(
      `/api/memory?origin=${encodeURIComponent(origin)}&fingerprint=${encodeURIComponent(fingerprint)}`
    )
    if (!response.ok) return { configured: false }
    return (await response.json()) as SharedMemory
  } catch {
    return { configured: false }
  }
}

/** Contribute rule ids and counts. Never element text, never anything personal. */
export async function contributeSharedMemory(
  origin: string,
  fingerprint: string,
  result: AuditResult
): Promise<void> {
  try {
    const ruleIds = [...new Set(result.reports.flatMap((r) => r.findings.map((f) => f.rule.id)))]
    await fetch("/api/memory", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ origin, fingerprint, ruleIds, counts: result.bySeverity }),
    })
  } catch {
    // A store that is unreachable must not break an audit that already worked.
  }
}

/** Split an audit key back into the two parts the endpoint validates. */
export function splitAuditKey(key: string): { origin: string; fingerprint: string } | null {
  const hash = key.lastIndexOf("#")
  if (hash < 0) return null
  const origin = key.slice(0, hash)
  const fingerprint = key.slice(hash + 1)
  if (!/^https?:\/\/[a-z0-9.-]+(:\d+)?$/i.test(origin)) return null
  if (!/^[a-z0-9]{1,16}$/i.test(fingerprint)) return null
  return { origin, fingerprint }
}
