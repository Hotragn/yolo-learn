import { readFormFromHTML, StaticReadResult } from "./discover"
import { explainReadFailure, fetchRemotePage } from "./page-fetch"

/**
 * Read a task that spans several pages, on a site nobody here wrote.
 *
 * This is the honest version of "point it at a real checkout". It READS and
 * never acts:
 *
 *   - GET only. It never POSTs, never submits a form, never fills a field on
 *     anyone's site. A checkout is somebody's order pipeline, and the correct
 *     number of orders for a demo to create is zero.
 *   - Same origin only, so it cannot wander off the flow it was pointed at.
 *   - Depth capped and visited-set deduped, so a page that links to itself
 *     ends the walk instead of spinning.
 *
 * What it produces is the SHAPE of a multi-page task: which steps exist, what
 * each one asks for, and where each field's purpose came from. That is the
 * thing the drift engine stores, so this is the same reading the clinic gets,
 * pointed at reality.
 */

export interface CrawlStep {
  order: number
  url: string
  intent: string
  submitLabel: string
  formCount: number
  fields: { label: string; purpose: string; from: string; required: boolean }[]
  refused: string[]
  /** Why the walk continued from here, or why it stopped. */
  advancedBy?: string
}

export interface CrawlResult {
  ok: boolean
  startUrl: string
  origin: string
  steps: CrawlStep[]
  notes: string[]
  stoppedBecause: string
  /** Markup actually read, so the cost of a first visit is a number. */
  bytesRead: number
}

const NEXT_TEXT = /^\s*(next|continue|proceed|checkout|check\s*out|start|begin|get\s+started|sign\s*up|register|apply)\b/i
const MAX_STEPS = 6
const MAX_HTML = 400_000

function parse(html: string): Document {
  return new DOMParser().parseFromString(html.slice(0, MAX_HTML), "text/html")
}

function sameOrigin(candidate: string, origin: string): boolean {
  try {
    return new URL(candidate).origin === origin
  } catch {
    return false
  }
}

/**
 * Where does this page continue to?
 *
 * A GET form's action is the strongest signal, because that is literally the
 * page saying "submitting me takes you here" without any state change. A link
 * whose text reads like a next step is the fallback. A POST form is never
 * followed: that is the boundary between reading a flow and driving one.
 */
function findNext(doc: Document, base: string, origin: string): { url: string; why: string } | null {
  for (const form of [...doc.querySelectorAll("form")]) {
    const method = (form.getAttribute("method") ?? "get").toLowerCase()
    const action = form.getAttribute("action")
    if (method !== "get" || !action) continue
    try {
      const url = new URL(action, base).toString()
      if (sameOrigin(url, origin)) return { url, why: `the GET form's action (${action})` }
    } catch {
      /* unparseable action */
    }
  }

  for (const link of [...doc.querySelectorAll("a[href]")]) {
    const text = link.textContent ?? ""
    if (!NEXT_TEXT.test(text)) continue
    try {
      const url = new URL(link.getAttribute("href")!, base).toString()
      if (sameOrigin(url, origin) && !url.includes("#")) {
        return { url, why: `a link reading "${text.trim().slice(0, 30)}"` }
      }
    } catch {
      /* unparseable href */
    }
  }
  return null
}

export function toStep(order: number, url: string, read: StaticReadResult): CrawlStep {
  return {
    order,
    url,
    intent: read.intent || "unnamed step",
    submitLabel: read.submitLabel,
    formCount: read.formCount,
    // provenance carries where each purpose was read from, which is the part
    // worth showing: it is what makes the reading checkable by eye.
    fields: read.provenance.map((f) => ({
      label: f.label,
      purpose: f.purpose,
      from: f.from,
      required: !!f.required,
    })),
    refused: read.refused ?? [],
  }
}

export async function readFlowAcrossPages(
  startUrl: string,
  opts: { maxSteps?: number; onProgress?: (note: string) => void } = {}
): Promise<CrawlResult> {
  const maxSteps = Math.min(opts.maxSteps ?? MAX_STEPS, MAX_STEPS)
  const progress = opts.onProgress ?? (() => {})
  const notes: string[] = []
  const steps: CrawlStep[] = []
  const seen = new Set<string>()

  let origin: string
  try {
    origin = new URL(startUrl).origin
  } catch {
    return { ok: false, startUrl, origin: "", steps, notes, bytesRead: 0, stoppedBecause: "That is not a URL." }
  }

  let url = startUrl
  let bytesRead = 0
  let stoppedBecause = `Reached the ${maxSteps}-page cap.`

  for (let i = 0; i < maxSteps; i++) {
    if (seen.has(url)) {
      stoppedBecause = "The flow looped back to a page already read."
      break
    }
    seen.add(url)

    progress(`reading page ${i + 1}: ${url.replace(origin, "")}`)
    const page = await fetchRemotePage(url)
    if (page.error || !page.html) {
      stoppedBecause = explainReadFailure(page.error ?? "That page returned nothing.")
      break
    }

    bytesRead += page.html.length
    const landed = page.finalUrl ?? url
    if (!sameOrigin(landed, origin)) {
      stoppedBecause = `The flow left ${origin}, so the walk stopped rather than following it off-site.`
      break
    }

    const read = readFormFromHTML(page.html)
    if (read.ok) {
      steps.push(toStep(steps.length + 1, landed, read))
    } else if (steps.length === 0) {
      stoppedBecause = explainReadFailure(read.message || "No form on the first page.")
      break
    } else {
      notes.push(`Page ${i + 1} had no readable form, so it is not counted as a step.`)
    }

    const next = findNext(parse(page.html), landed, origin)
    if (!next) {
      stoppedBecause =
        "No GET form action and no next-looking link, so there was nowhere to continue that did not require submitting something."
      break
    }
    if (steps.length) steps[steps.length - 1].advancedBy = next.why
    url = next.url
  }

  notes.push("Read-only: GET requests only, nothing submitted and no field filled on the target site.")
  if (steps.some((s) => s.refused.length)) {
    notes.push("Credential and payment fields were refused, not read.")
  }

  return {
    ok: steps.length > 0,
    startUrl,
    origin,
    steps,
    notes,
    bytesRead,
    stoppedBecause,
  }
}

const MAX_TRAIL = 8

/**
 * Learn the pages the user already opened, in the order they opened them.
 *
 * There is no extension and nothing injects into the other tab. After they
 * navigate by hand they paste the URLs. This still only GETs, still never
 * submits, and will not follow a URL off the first origin.
 */
export async function readPagesInOrder(
  urls: string[],
  opts: { onProgress?: (note: string) => void } = {}
): Promise<CrawlResult> {
  const progress = opts.onProgress ?? (() => {})
  const cleaned = [...new Set(urls.map((u) => u.trim()).filter(Boolean))].slice(0, MAX_TRAIL)
  if (cleaned.length === 0) {
    return {
      ok: false,
      startUrl: "",
      origin: "",
      steps: [],
      notes: [],
      bytesRead: 0,
      stoppedBecause: "Paste at least one http(s) URL, one per line.",
    }
  }

  let origin: string
  try {
    origin = new URL(cleaned[0]).origin
  } catch {
    return {
      ok: false,
      startUrl: cleaned[0],
      origin: "",
      steps: [],
      notes: [],
      bytesRead: 0,
      stoppedBecause: "The first line is not a URL.",
    }
  }

  const notes: string[] = []
  const steps: CrawlStep[] = []
  const seen = new Set<string>()
  let bytesRead = 0
  let stoppedBecause = `Read ${cleaned.length} page(s) you opened.`

  for (let i = 0; i < cleaned.length; i++) {
    const raw = cleaned[i]
    let url: string
    try {
      url = new URL(raw).toString()
    } catch {
      notes.push(`Skipped "${raw}": not a URL.`)
      continue
    }
    if (!sameOrigin(url, origin)) {
      notes.push(`Skipped ${url}: not on ${origin}.`)
      continue
    }
    if (seen.has(url)) continue
    seen.add(url)

    progress(`reading page you opened (${i + 1}/${cleaned.length})`)
    const page = await fetchRemotePage(url)
    if (page.error || !page.html) {
      stoppedBecause = explainReadFailure(page.error ?? "That page returned nothing.")
      break
    }
    bytesRead += page.html.length
    const landed = page.finalUrl ?? url
    if (!sameOrigin(landed, origin)) {
      notes.push(`Skipped ${landed}: left ${origin}.`)
      continue
    }
    const read = readFormFromHTML(page.html)
    if (read.ok) {
      const step = toStep(steps.length + 1, landed, read)
      if (i + 1 < cleaned.length) step.advancedBy = "next URL you pasted"
      steps.push(step)
    } else {
      notes.push(`${landed} had no readable form.`)
    }
  }

  notes.push("Read-only: GET requests only, from the pages you listed. Nothing submitted.")
  // The auto-walk says this and the hand-navigated trail did not, so pasting a
  // sign-in page dropped its password field silently. Refusing to read
  // something is worth saying out loud, or it looks like it was simply missed.
  if (steps.some((s) => s.refused.length)) {
    notes.push("Credential and payment fields were refused, not read.")
  }
  if (steps.length === 0 && /no readable form/i.test(notes.join(" "))) {
    stoppedBecause = explainReadFailure("No form controls in there.")
  }
  return {
    ok: steps.length > 0,
    startUrl: cleaned[0],
    origin,
    steps,
    notes,
    bytesRead,
    stoppedBecause,
  }
}
