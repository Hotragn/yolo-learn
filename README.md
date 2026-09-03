<p align="center">
  <img src="public/og.png" alt="Yolo Learn" width="720">
</p>

<h1 align="center">Yolo Learn</h1>

<p align="center">
  Agents re-read every site from scratch, then break when the page moves.<br>
  This remembers the <em>task</em>, mints a WebMCP tool, and heals the memory.
</p>

<p align="center">
  <a href="https://yolo-learn.vercel.app"><img src="https://img.shields.io/badge/live-yolo--learn.vercel.app-0B1220?style=flat-square" alt="Live"></a>
  <img src="https://img.shields.io/badge/OpenAI-WebMCP%20Challenge-412991?style=flat-square" alt="OpenAI WebMCP Challenge">
  <img src="https://img.shields.io/badge/WebMCP-registerTool-7BD40A?style=flat-square&labelColor=0B1220" alt="WebMCP">
  <img src="https://img.shields.io/badge/TypeScript-3178C6?style=flat-square&logo=typescript&logoColor=white" alt="TypeScript">
  <img src="https://img.shields.io/badge/React-18-61DAFB?style=flat-square&logo=react&logoColor=0B1220" alt="React">
  <img src="https://img.shields.io/badge/tests-224-passing-7BD40A?style=flat-square&labelColor=0B1220" alt="224 tests">
  <img src="https://img.shields.io/badge/license-MIT-0B1220?style=flat-square" alt="MIT">
</p>

<p align="center">
  <a href="https://yolo-learn.vercel.app"><strong>Live demo</strong></a>
  ·
  <a href="#the-problem">The problem</a>
  ·
  <a href="#webmcp">WebMCP</a>
  ·
  <a href="src/webmcp.ts"><code>src/webmcp.ts</code></a>
</p>

---

## The problem

People already know their own repetitive flows: book this clinic, renew this permit, order from this supplier. No vendor will ship an official agent tool for those pages. So today an agent **drives the DOM from zero on every visit**. That is slow, expensive, and it silently dies the first time someone renames a field.

This is not “a WebMCP feature.” WebMCP only does one thing well: `registerTool()` on a document, including **mid-session**. The product is the layer above that:

1. **Learn the task once** (read the page, or watch the human click through).
2. **Skip the re-read** on the next visit (`recall_page` / `recall_url`: no fetch if the shape is unchanged).
3. **Heal** when the shape did change, instead of throwing the memory away.

Same origin is required for a minted tool the agent can call. That is why the demo clinic lives here. A public URL you paste is fetched read-only (GET). No browser extension.

## Time on a revisit

| | First visit | Visit two, same task |
| --- | --- | --- |
| Agent scraping the page again | Full read | Full read again |
| Yolo Learn | Read once, store shape | **Cache hit. 0 bytes fetched** |

Keyed on origin + fingerprint of step intents and field purposes, not on headlines or CSS.

## Demo (video)

<p align="center">
  <img src="docs/demo.gif" alt="Learn, mint, run, redesign, heal" width="720">
</p>

<p align="center"><sub>Real tool calls, not a mock. You still approve each submit. For Devpost, upload this loop to YouTube (under 3 minutes, with audio).</sub></p>

[Just learned](https://yolo-learn.vercel.app/#/?demo=learned) · [Drifted](https://yolo-learn.vercel.app/#/?demo=drifted) · [Healed](https://yolo-learn.vercel.app/#/?demo=healed)

Still of the architecture (not a full-page screenshot):

<p align="center">
  <img src="docs/architecture.svg" alt="Read, remember, mint, run, heal" width="640">
</p>

---

## WebMCP

Judges score **WebMCP Leverage** first: a working, non-trivial `registerTool` path they can read. That file is [`src/webmcp.ts`](src/webmcp.ts).

```ts
await document.modelContext.registerTool(
  {
    name: "clinic_booking",
    description: "...",
    inputSchema: { type: "object", properties, required },
    annotations: { readOnlyHint: false, untrustedContentHint: true },
    execute: async (args, { signal }) => { /* untrusted args, abort, human gate */ },
  },
  { signal: controller.signal }
)
```

What that file actually handles: `document` then `navigator` feature-detect; `registerTool` is a Promise and rejects `InvalidStateError` on duplicate names; unregister is aborting the signal; `Origin-Agent-Cluster: ?1` or Chrome returns `SecurityError`; execute must not crash when an implementation omits `signal`.

| Tool | Why it exists |
| --- | --- |
| `recall_page` / `recall_url` | Do I already know this? Call first. A hit is the time saving. |
| `learn_site` / `learn_url` | First visit. `pages` = URLs the user already opened by hand. |
| `remembered_<host>` | Minted mid-session after a public URL is learned. Call it instead of fetching. `refresh=true` re-reads. |
| `start_teaching` | Human fills the clinic; the app watches. |
| `run_flow` / minted name | Drive the task. Human owns irreversible steps. |
| `check_flow_health` / `heal_flow` | Redesign. At most one question. |
| `get_run_status` | The agent’s promise died on navigation. |
| `audit_page` / `audit_url` | Measure, cite a rule, do not guess. |

### Try it

Chrome 149+: `chrome://flags/#enable-webmcp-testing`, then [yolo-learn.vercel.app](https://yolo-learn.vercel.app). Ask: *Learn the clinic, then run it.* Or paste a public URL on the home page.

No flag: the simulated agent at the bottom calls the **same** registered objects.

---

## Clinic vs a URL you paste

**Northside Family Clinic stays.** Booking plus a real v2 redesign (rename, reorder, new required field, new button) is the heal loop. Inventing a different demo would throw that away.

**Your site:** home page or `#/any` — paste the URL. If the first GET has no fields, the fetch function runs the page JavaScript in headless Chrome (read-only) and learns what it drew. It still will not POST or log in.

**Audit:** `#/audit` — W3C’s own before/after pages are the control.

---

## Run

```
npm install
npm run dev
```

`npm test` · `npm run typecheck` · `npm run build` · `npm run check:ssrf`

MIT · [Hotragn Pettugani](https://github.com/Hotragn)
