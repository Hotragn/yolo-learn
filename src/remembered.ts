import type { RemoteMemory } from "./remote"

/**
 * A public URL that has been learned once becomes its own WebMCP tool.
 *
 * That is the part agents can actually call: not "please scrape this again",
 * but a named tool minted mid-session whose default execute is a cache lookup.
 * Re-reading is an explicit refresh, so the cost of visit two is a choice.
 */

export function toolNameForOrigin(origin: string): string {
  let host = origin
  try {
    host = new URL(origin).hostname
  } catch {
    /* already a host, or junk */
  }
  const slug = host
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
  return (`remembered_${slug || "site"}`).slice(0, 64)
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
