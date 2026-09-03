# Agent Memory That Heals (working title, founder picks final name)

Agents start every session from zero, and they break when the web changes.
This one remembers, and heals.

Teach it a task once by doing the task yourself. It mints a WebMCP tool on the
spot — live, mid-session, no reload. When the site ships a redesign a year
later, the flow detects exactly what changed, asks one question, heals, and
runs green.

Built for the OpenAI WebMCP Challenge. Deterministic healing, no ML.

## The demo loop

1. **Teach.** Open `#/site?teach=1` and book an appointment by hand. Tick the
   values your agent may change each run.
2. **Mint.** The tool appears in `#/tools` in the same session, badged
   `new this session`.
3. **Run.** The agent fills the wizard on screen and stops. You approve the
   submit, and see the exact values first.
4. **Redesign.** Switch to `#/site?v=2` — the same clinic, one year later.
5. **Diagnose.** `check_flow_health` reports **4 changes in plain English and
   exactly 1 question**: the new insurance ID it has never been told.
6. **Heal.** Answer once. Run again. Green.

Under 90 seconds, start to finish.

## Why it heals instead of breaking

A flow is stored as **intent and purpose, never as selectors**. Steps match by
intent, fields by purpose. So the four things a redesign does to a form carry
no new information and heal from the site itself:

| Redesign event | Handled by |
| --- | --- |
| Field renamed (`Your name` → `Full name (as on insurance card)`) | auto |
| Steps reordered (date/time now before service) | auto |
| Button reworded (`Confirm booking` → `Book appointment`) | auto |
| Field removed | auto |
| **New required field** (`Insurance ID`) | **one question, asked once** |

The one thing the app genuinely cannot know is a value nobody has ever given
it. That, and only that, becomes a question. No guessing, no ML, no invented
confidence — and a question answered with an empty string stays open rather
than leaving a flow that reports itself healthy but cannot run.

## Run it

```
npm install
npm run dev
```

- Flow Library: `#/`
- Demo site: `#/site` (v1) and `#/site?v=2` (the one-year-later redesign)
- Teach mode: `#/site?teach=1`
- Live tool registry: `#/tools`

```
npm test          # 50 unit tests: drift engine, argument validation, storage
npm run typecheck
npm run build
```

## Test it with a real agent

- **Chrome 149+**: enable `chrome://flags/#enable-webmcp-testing` and relaunch.
- **ChatGPT desktop app**: open the deployed URL in the in-app browser.

Ask the agent: *"Check the health of my book_appointment flow, then run it."*

**No WebMCP in your browser?** Nothing breaks. Every page still works, and the
**Simulated agent** panel at the bottom calls the same registered tool objects
a real agent calls — same argument validation, same `AbortSignal`, same
approval step. It exists so none of the claims above have to be taken on faith.

### WebMCP notes worth knowing

Verified against the [spec](https://webmachinelearning.github.io/webmcp/) and
[Chrome's docs](https://developer.chrome.com/docs/ai/webmcp) on 2026-09-02:

- The entry point is `document.modelContext`. An earlier revision of the
  proposal used `navigator.modelContext`, so both are feature-detected.
- `registerTool()` returns a **Promise** and **rejects with
  `InvalidStateError`** if the name is already taken — so flow names are made
  unique before they are offered.
- Tools are removed by aborting the `AbortSignal` passed to `registerTool`,
  not by an `unregisterTool` method.
- **WebMCP is refused in documents that are not origin-keyed.** The app is
  served with `Origin-Agent-Cluster: ?1` (`vite.config.ts` for dev,
  `vercel.json` for production). Without that header, registration fails with
  `SecurityError` — the banner at the top of the app tells you if that happens.
- Declarative attributes used on the booking form: `toolname`,
  `tooldescription`, `toolparamdescription`. `toolautosubmit` is deliberately
  **not** used: the human owns the submit.

## Tools the agent sees

| Tool | What it does |
| --- | --- |
| `list_flows` | What the user has taught, with health and parameters |
| `check_flow_health` | Plain-English drift report and any questions |
| `run_flow` | Run a flow; the human approves the submit |
| `heal_flow` | Apply answers and re-snapshot the site |
| `get_site_info` | Current site version and changelog |
| `start_teaching` | Put the page into teach mode |
| *`<your flow name>`* | Minted per taught flow, schema built from the values you ticked |

Read-only tools are marked `readOnlyHint`; anything echoing stored user content
is marked `untrustedContentHint`.

## Guarantees

- **A human approves every submit**, always, with the exact values shown first.
- All tool arguments are treated as untrusted: coerced, length-capped,
  validated against the live field options, and rejected with a message that
  says what is allowed.
- Single origin, hash routing, `localStorage` only. No backend, no accounts, no
  telemetry, no cloud sync.
- Fictional clinic. No real bookings are made and no data leaves the browser.

Stack: Vite + React + TypeScript, plain CSS, no state library, MIT licensed.
