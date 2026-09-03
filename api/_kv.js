/**
 * A key-value store, or nothing at all.
 *
 * Talks to Upstash Redis over its REST API, which means no driver, no
 * connection pool and no npm dependency: two environment variables and fetch.
 * That matters for a project whose only runtime dependencies are React.
 *
 * The important property is that EVERYTHING degrades. When the variables are
 * absent, every call returns null and the callers fall back to browser-local
 * behaviour. Nothing breaks, no feature disappears from the UI without saying
 * why, and the deployment works with no store configured at all.
 *
 * Set up with either:
 *   vercel storage add            (pick Upstash Redis, free tier)
 * or by pasting the two values from upstash.com into the project's env vars:
 *   KV_REST_API_URL / KV_REST_API_TOKEN        (what Vercel injects)
 *   UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN   (Upstash's own names)
 */

const URL_ENV = ["KV_REST_API_URL", "UPSTASH_REDIS_REST_URL", "REDIS_REST_URL"]
const TOKEN_ENV = ["KV_REST_API_TOKEN", "UPSTASH_REDIS_REST_TOKEN", "REDIS_REST_TOKEN"]

function firstEnv(names) {
  for (const n of names) {
    const v = process.env[n]
    if (v && v.trim()) return v.trim()
  }
  return null
}

export function kvConfigured() {
  return !!(firstEnv(URL_ENV) && firstEnv(TOKEN_ENV))
}

/**
 * Run one Redis command. Returns null on any failure, deliberately: a store
 * that is down must not take the endpoint down with it.
 */
async function command(args, timeoutMs = 2500) {
  const url = firstEnv(URL_ENV)
  const token = firstEnv(TOKEN_ENV)
  if (!url || !token) return null

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(url, {
      method: "POST",
      signal: controller.signal,
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(args),
    })
    if (!response.ok) return null
    const json = await response.json()
    return json && "result" in json ? json.result : null
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

export async function kvGet(key) {
  const raw = await command(["GET", key])
  if (typeof raw !== "string") return null
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

export async function kvSet(key, value, ttlSeconds) {
  const body = JSON.stringify(value)
  const args = ttlSeconds ? ["SET", key, body, "EX", String(ttlSeconds)] : ["SET", key, body]
  return (await command(args)) === "OK"
}

/**
 * Increment a counter that expires, which is the whole of rate limiting.
 * Returns null when there is no store, so the caller can fall back rather than
 * fail open silently.
 */
export async function kvIncrWithTtl(key, ttlSeconds) {
  const count = await command(["INCR", key])
  if (typeof count !== "number") return null
  if (count === 1) await command(["EXPIRE", key, String(ttlSeconds)])
  return count
}
