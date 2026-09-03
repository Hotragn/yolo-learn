/**
 * The minting moment, decoupled from whichever path produced it.
 *
 * A tool can be minted from a human demonstration (inside React) or from
 * autonomous discovery (from a WebMCP tool call, outside React entirely).
 * Both announce here, so the Tools view celebrates identically either way.
 */

export type MintSource = "demonstration" | "autonomous" | "url"

export interface MintedInfo {
  flowId: string
  name: string
  paramCount: number
  native: boolean
  source: MintSource
  error?: string
  at: number
}

let latest: MintedInfo | null = null
const listeners = new Set<() => void>()

function emit() {
  for (const l of [...listeners]) {
    try { l() } catch (err) { console.error("mint listener failed", err) }
  }
}

export function announceMint(info: Omit<MintedInfo, "at">) {
  latest = { ...info, at: Date.now() }
  emit()
}

export function getLastMint(): MintedInfo | null {
  return latest
}

export function clearLastMint() {
  if (!latest) return
  latest = null
  emit()
}

export function subscribeMint(l: () => void): () => void {
  listeners.add(l)
  return () => { listeners.delete(l) }
}
