import { defineConfig, type PreviewServer, type ViteDevServer } from "vite"
import react from "@vitejs/plugin-react"
import type { IncomingMessage, ServerResponse } from "node:http"

// WebMCP is refused in documents that are not origin-keyed: registerTool and
// getTools reject with SecurityError unless the agent cluster is origin-keyed.
// Chrome does not origin-key by default, so the header is mandatory rather than
// a hardening extra - locally and in production (see vercel.json).
const webmcpHeaders = {
  "Origin-Agent-Cluster": "?1",
}

/**
 * Vercel serves /api/fetch-page.js in production. Vite's SPA fallback would
 * otherwise return index.html, and learn_url would fail parsing "<!doctype".
 */
function mountFetchPage(server: ViteDevServer | PreviewServer) {
  server.middlewares.use(async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    const path = req.url?.split("?")[0]
    if (path !== "/api/fetch-page") return next()
    const { default: handler } = await import("./api/fetch-page.js")
    const url = new URL(req.url ?? "", "http://local.dev")
    const fakeReq = {
      query: Object.fromEntries(url.searchParams),
      headers: req.headers,
    }
    const fakeRes = {
      setHeader: (k: string, v: string) => res.setHeader(k, v),
      status(code: number) {
        res.statusCode = code
        return this
      },
      json(body: unknown) {
        res.setHeader("content-type", "application/json; charset=utf-8")
        res.end(JSON.stringify(body))
      },
    }
    try {
      await handler(fakeReq, fakeRes)
    } catch (err) {
      if (!res.writableEnded) {
        res.statusCode = 200
        res.setHeader("content-type", "application/json; charset=utf-8")
        res.end(
          JSON.stringify({
            error: err instanceof Error ? err.message : "Could not fetch that page.",
          })
        )
      }
    }
  })
}

export default defineConfig({
  plugins: [
    react(),
    {
      name: "yolo-learn-api-dev",
      configureServer: mountFetchPage,
      configurePreviewServer: mountFetchPage,
    },
  ],
  server: { headers: webmcpHeaders },
  preview: { headers: webmcpHeaders },
})
