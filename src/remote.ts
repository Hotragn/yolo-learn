import { safeGetItem, safeSetItem } from "./types"
import { CrawlResult, readFlowAcrossPages, readPagesInOrder, toStep } from "./crawl"
import { readFormFromHTML } from "./discover"
import { toolNameForOrigin } from "./remembered"
import { stripSensitiveMarkup } from "./sanitize"

/**
 * Memory for real sites, so a page is read once rather than once per visit.
 *
 * This is the claim that matters for cost: an agent driving a site by reading
 * the accessibility tree pays for that read on every single visit, forever. A
 * cache hit here costs one hash and returns the shape immediately.
 *
 * Keyed by origin plus a fingerprint of the SHAPE, not of the bytes. Page
 * content changes constantly - a headline, a timestamp, a promo - and none of
 * that changes what the task is. The fingerprint is built from step intents
 * and field purposes only, so a hit survives ordinary churn and a miss means
 * the task itself actually moved.
 */

const KEY = "remote.v1"
const MAX_ENTRIES = 40

export interface RemoteMemory {
  origin: string
  startUrl: string
  fingerprint: string
  learnedAt: string
  steps: CrawlResult["steps"]
  /** Bytes of markup read to learn it, so the saving can be stated in numbers. */
  bytesRead: number
  visits: number
}

/** Shape only: intents and purposes. Content churn must not invalidate a task. */
export function fingerprintOf(steps: CrawlResult["steps"]): string {
  const shape = steps
    .map((s) => `${s.intent}|${s.fields.map((f) => f.purpose).sort().join(",")}`)
    .join(";")
  let h = 0
  for (let i = 0; i < shape.length; i++) {
    h = (h * 31 + shape.charCodeAt(i)) | 0
  }
  return (h >>> 0).toString(16)
}

function load(): Record<string, RemoteMemory> {
  try {
    const parsed = JSON.parse(safeGetItem(KEY) ?? "{}")
    return parsed && typeof parsed === "object" ? (parsed as Record<string, RemoteMemory>) : {}
  } catch {
    return {}
  }
}

function save(all: Record<string, RemoteMemory>) {
  const entries = Object.entries(all)
  // Oldest out first, so a long session cannot fill localStorage.
  if (entries.length > MAX_ENTRIES) {
    entries.sort((a, b) => (a[1].learnedAt < b[1].learnedAt ? 1 : -1))
    all = Object.fromEntries(entries.slice(0, MAX_ENTRIES))
  }
  safeSetItem(KEY, JSON.stringify(all))
}

function originOf(url: string): string | null {
  try {
    return new URL(url).origin
  } catch {
    return null
  }
}

export function forgetRemote() {
  safeSetItem(KEY, "{}")
}

export function knownRemotes(): RemoteMemory[] {
  return Object.values(load()).sort((a, b) => (a.learnedAt < b.learnedAt ? 1 : -1))
}

export interface RecallResult {
  state: "miss" | "hit"
  origin: string
  memory?: RemoteMemory
  summary: string
}

/**
 * Ask whether this site's task is already known, without reading it.
 *
 * Deliberately does NOT fetch. The whole point is that a hit costs nothing: a
 * lookup that had to fetch the page first would save no time at all.
 */
export function recallRemote(url: string): RecallResult {
  const origin = originOf(url)
  if (!origin) return { state: "miss", origin: "", summary: "That is not a URL." }
  const memory = load()[origin]
  if (!memory) {
    return {
      state: "miss",
      origin,
      summary: `Nothing known about ${origin}. Call learn_url to read it once.`,
    }
  }
  return {
    state: "hit",
    origin,
    memory,
    summary:
      `${origin} is already known: ${memory.steps.length} step(s), ` +
      `${memory.steps.reduce((n, s) => n + s.fields.length, 0)} field(s), learned ` +
      `${new Date(memory.learnedAt).toLocaleString()}. Nothing needs re-reading. ` +
      `Reading it the first time cost ${Math.round(memory.bytesRead / 1024)}KB of markup; this hit cost none.`,
  }
}

export interface LearnUrlResult {
  ok: boolean
  cached: boolean
  origin: string
  fingerprint?: string
  steps: CrawlResult["steps"]
  notes: string[]
  stoppedBecause?: string
  bytesRead: number
  summary: string
  /** Named WebMCP tool minted for this origin after a successful read. */
  toolName?: string
}

/**
 * Learn a real site's task once, then serve it from memory.
 *
 * `force` re-reads and compares, which is how a shape change is detected: same
 * origin, different fingerprint means the task moved.
 */
export async function learnUrl(
  url: string,
  opts: { force?: boolean; pages?: string[]; onProgress?: (n: string) => void } = {}
): Promise<LearnUrlResult> {
  const trail = (opts.pages ?? []).map((p) => p.trim()).filter(Boolean)
  const start = trail[0] || url
  const origin = originOf(start)
  if (!origin) {
    return { ok: false, cached: false, origin: "", steps: [], notes: [], bytesRead: 0, summary: "That is not a URL." }
  }

  if (!opts.force && trail.length === 0) {
    const recalled = recallRemote(start)
    if (recalled.state === "hit" && recalled.memory) {
      const all = load()
      all[origin] = { ...recalled.memory, visits: recalled.memory.visits + 1 }
      save(all)
      const hit: LearnUrlResult = {
        ok: true,
        cached: true,
        origin,
        fingerprint: recalled.memory.fingerprint,
        steps: recalled.memory.steps,
        notes: ["Served from memory. No page was fetched and no markup was read."],
        bytesRead: 0,
        summary: recalled.summary,
        toolName: toolNameForOrigin(origin),
      }
      await mintRememberedFor(origin)
      return hit
    }
  }

  const crawl = trail.length
    ? await readPagesInOrder(trail, { onProgress: opts.onProgress })
    : await readFlowAcrossPages(start, { onProgress: opts.onProgress })
  if (!crawl.ok) {
    return {
      ok: false,
      cached: false,
      origin,
      steps: [],
      notes: crawl.notes,
      stoppedBecause: crawl.stoppedBecause,
      bytesRead: 0,
      summary: `Could not read a task at ${origin}: ${crawl.stoppedBecause}`,
    }
  }

  const fingerprint = fingerprintOf(crawl.steps)
  const previous = load()[origin]
  const bytesRead = crawl.bytesRead

  const all = load()
  all[origin] = {
    origin,
    startUrl: start,
    fingerprint,
    learnedAt: new Date().toISOString(),
    steps: crawl.steps,
    bytesRead,
    visits: (previous?.visits ?? 0) + 1,
  }
  save(all)

  const moved = previous && previous.fingerprint !== fingerprint
  await mintRememberedFor(origin)
  return {
    ok: true,
    cached: false,
    origin,
    fingerprint,
    steps: crawl.steps,
    notes: crawl.notes,
    stoppedBecause: crawl.stoppedBecause,
    bytesRead,
    summary:
      `Read ${origin} across ${crawl.steps.length} page(s): ` +
      `${crawl.steps.reduce((n, s) => n + s.fields.length, 0)} field(s), ${Math.round(bytesRead / 1024)}KB of markup. ` +
      (moved
        ? `The shape CHANGED since last time (${previous!.fingerprint} to ${fingerprint}), so the stored task moved.`
        : `Stored as ${fingerprint}. The next visit is a free cache hit.`),
    toolName: toolNameForOrigin(origin),
  }
}

/**
 * Learn from HTML painted in the user's own browser (logged-in tab, OAuth done).
 * Cookies never leave that tab. Password and card fields are stripped first.
 */
export async function learnFromHtml(pageUrl: string, html: string): Promise<LearnUrlResult> {
  const origin = originOf(pageUrl)
  if (!origin) {
    return { ok: false, cached: false, origin: "", steps: [], notes: [], bytesRead: 0, summary: "That is not a URL." }
  }
  const cleaned = stripSensitiveMarkup(html)
  const read = readFormFromHTML(cleaned)
  if (!read.ok) {
    return {
      ok: false,
      cached: false,
      origin,
      steps: [],
      notes: ["Snapshot came from your browser. Cookies were not sent here."],
      bytesRead: cleaned.length,
      summary: `Could not read a task in that snapshot: ${read.message}`,
    }
  }
  const steps = [
    {
      ...toStep(1, pageUrl, read),
      advancedBy: "snapshot from your browser; the session stayed on your machine",
    },
  ]
  const fingerprint = fingerprintOf(steps)
  const previous = load()[origin]
  const all = load()
  all[origin] = {
    origin,
    startUrl: pageUrl,
    fingerprint,
    learnedAt: new Date().toISOString(),
    steps,
    bytesRead: cleaned.length,
    visits: (previous?.visits ?? 0) + 1,
  }
  save(all)
  await mintRememberedFor(origin)
  return {
    ok: true,
    cached: false,
    origin,
    fingerprint,
    steps,
    notes: [
      "Learned from a snapshot taken in your browser. Cookies and passwords were not sent to our server.",
    ],
    bytesRead: cleaned.length,
    summary:
      `Read a snapshot of ${origin}: ${steps[0].fields.length} field(s). ` +
      `Stored as ${fingerprint}. An agent can call ${toolNameForOrigin(origin)} without fetching.`,
    toolName: toolNameForOrigin(origin),
  }
}

async function mintRememberedFor(origin: string) {
  try {
    const { mintRememberedTool } = await import("./webmcp")
    await mintRememberedTool(origin)
  } catch {
    /* Memory is already stored. Minting is how an agent sees it. */
  }
}
