import type { RemoteMemory } from "./remote"

/**
 * A public URL that has been learned once becomes its own WebMCP tool.
 *
 * That is the part agents can actually call: not "please scrape this again",
 * but a named tool minted mid-session whose default execute is a cache lookup.
 * Re-reading is an explicit refresh, so the cost of visit two is a choice.
 */

/**
 * A short, stable digest of the full origin.
 *
 * The readable part of the name is built from the hostname, which is lossy:
 * it drops the scheme and the port, and slugging turns both "." and "-" into
 * "_". So https://example.com and http://example.com collided, as did
 * localhost:5173 and localhost:4173, and a-b.example.com and a.b.example.com.
 *
 * That is not cosmetic. registerTool rejects a duplicate name with
 * InvalidStateError, so a collision meant the second origin either failed to
 * mint or answered with the first one's memory. Appending a digest of the
 * WHOLE origin keeps the name readable and makes it unique, without needing to
 * know which other origins happen to be stored.
 */
function digest(origin: string): string {
  let h = 2166136261
  for (let i = 0; i < origin.length; i++) {
    h ^= origin.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return (h >>> 0).toString(36).slice(0, 4).padStart(4, "0")
}

export function toolNameForOrigin(origin: string): string {
  const raw = (origin ?? "").trim()
  // Digest the normalised ORIGIN, never the raw input. Memory is keyed by
  // origin, so passing https://site.com/a/b and https://site.com must name the
  // same tool; digesting the path would have split one memory across two.
  let canonical = raw
  let host = raw
  try {
    const parsed = new URL(raw)
    canonical = parsed.origin
    host = parsed.hostname
  } catch {
    /* already a host, or junk */
  }
  const slug = host
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "")

  if (!slug) return "remembered_site"
  // Room for the digest is reserved before truncating, or two long hosts would
  // truncate to the same 64 characters and collide again.
  const suffix = `_${digest(canonical)}`
  const room = 64 - "remembered_".length - suffix.length
  return `remembered_${slug.slice(0, room)}${suffix}`
}

export function rememberedDescription(memory: RemoteMemory): string {
  const fields = memory.steps.flatMap((s) =>
    s.fields.map((f) => f.label || f.purpose)
  )
  const fieldList = fields.length ? fields.join(", ") : "no readable fields"
  const kb = Math.round(memory.bytesRead / 1024)
  return (
    `Remembered task at ${memory.origin}. ${memory.steps.length} step(s): ${fieldList}. ` +
    `Default call returns this from memory and fetches nothing (first read cost ${kb}KB). ` +
    `Pass refresh=true to GET the page again and compare fingerprints. Read-only: never submits.`
  )
}
