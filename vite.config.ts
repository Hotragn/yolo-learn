import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"

// WebMCP is refused in documents that are not origin-keyed: registerTool and
// getTools reject with SecurityError unless the agent cluster is origin-keyed.
// Chrome does not origin-key by default, so the header is mandatory rather than
// a hardening extra - locally and in production (see vercel.json).
const webmcpHeaders = {
  "Origin-Agent-Cluster": "?1",
}

export default defineConfig({
  plugins: [react()],
  server: { headers: webmcpHeaders },
  preview: { headers: webmcpHeaders },
})
