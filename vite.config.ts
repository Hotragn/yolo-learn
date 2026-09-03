import { Buffer } from "node:buffer"
import { defineConfig, type PreviewServer, type ViteDevServer } from "vite"
import react from "@vitejs/plugin-react"
import type { IncomingMessage, ServerResponse } from "node:http"

const webmcpHeaders = {
  "Origin-Agent-Cluster": "?1",
}

function mountVercelApi(route: string, file: string) {
  return async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    const path = req.url?.split("?")[0]
    if (path !== route) return next()
    const { default: handler } = await import(file)
    const url = new URL(req.url ?? "", "http://local.dev")
    let body: Record<string, unknown> = {}
    if ((req.method ?? "GET").toUpperCase() === "POST") {
      const chunks: Buffer[] = []
      for await (const c of req) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c))
      try {
        body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}") as Record<string, unknown>
      } catch {
        body = {}
      }
    }
    const fakeReq = {
      method: req.method,
      query: Object.fromEntries(url.searchParams),
      headers: req.headers,
      body,
    }
    const fakeRes = {
      writableEnded: false,
      setHeader: (k: string, v: string) => res.setHeader(k, v),
      status(code: number) {
        res.statusCode = code
        return this
      },
      json(payload: unknown) {
        this.writableEnded = true
        res.setHeader("content-type", "application/json; charset=utf-8")
        res.end(JSON.stringify(payload))
      },
      end(payload?: string) {
        this.writableEnded = true
        if (payload) res.end(payload)
        else res.end()
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
            error: err instanceof Error ? err.message : "API error.",
          })
        )
      }
    }
  }
}

function mountApis(server: ViteDevServer | PreviewServer) {
  server.middlewares.use(mountVercelApi("/api/fetch-page", "./api/fetch-page.js"))
  server.middlewares.use(mountVercelApi("/api/ingest", "./api/ingest.js"))
}

export default defineConfig({
  plugins: [
    react(),
    {
      name: "yolo-learn-api-dev",
      configureServer: mountApis,
      configurePreviewServer: mountApis,
    },
  ],
  server: { headers: webmcpHeaders },
  preview: { headers: webmcpHeaders },
})
