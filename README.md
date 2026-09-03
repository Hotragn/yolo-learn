<p align="center">
  <img src="public/og.png" alt="Yolo Learn — it learns a website by itself, and heals when the site changes" width="820">
</p>

<h1 align="center">Yolo Learn</h1>

<p align="center">
  <strong>It learns a website by itself, mints a WebMCP tool live, and heals when the site changes.</strong>
</p>

<p align="center">
  <a href="https://yolo-learn.vercel.app"><img src="https://img.shields.io/badge/live%20demo-yolo--learn.vercel.app-7BD40A?style=flat-square&labelColor=0B1220" alt="Live demo"></a>
  <img src="https://img.shields.io/badge/tests-73%20passing-7BD40A?style=flat-square&labelColor=0B1220" alt="73 tests passing">
  <img src="https://img.shields.io/badge/WebMCP-Chrome%20149%2B-0B1220?style=flat-square" alt="WebMCP Chrome 149+">
  <img src="https://img.shields.io/badge/license-MIT-0B1220?style=flat-square" alt="MIT license">
  <img src="https://img.shields.io/badge/backend-none-0B1220?style=flat-square" alt="No backend">
</p>

---

Agents start every session from zero, and they break when the web changes. Not
*if* — RPA maintenance runs 30–50% of the original build cost every year, and it
is spent on exactly one thing: somebody renamed a field.

**Yolo Learn** does two things nobody demos together:

1. **It learns a task on a site with no human demonstration.** It reads the page
   — labels, field names, required flags, option lists — walks the wizard, and
   mints a WebMCP tool for what it found. Mid-session, no reload.
2. **It survives the redesign.** A year later the site renames a field, reorders
   the steps, reworks a button and adds a required one. It reports all four in
   plain English, asks **exactly one** question, heals, and runs green.

Built for the **OpenAI WebMCP Challenge**. Deterministic healing — no ML, no
guessing, no invented confidence.

<p align="center">
  <a href="https://yolo-learn.vercel.app"><strong>Open the live demo →</strong></a>
</p>

---

## The loop, in about ninety seconds

<img src="docs/shot-onboarding.png" alt="The Yolo Learn get-started page" width="100%">

### 1 · It learns the site by itself

Open the demo site and press **Learn automatically** — or ask an agent to call
`learn_site`. Nothing is filled in by you.

```
Learned "clinic_booking" by reading the page:
4 steps, 5 fields, no demonstration and no invented values.
```

It walks the four-step booking wizard and mints a tool with a real JSON Schema,
enums and required fields included:

```json
{
  "serviceType": { "enum": ["checkup", "dental cleaning", "physical exam"] },
  "date":        { "description": "Date, formatted YYYY-MM-DD" },
  "time":        { "enum": ["9:00 AM", "10:00 AM", "..."] },
  "patientName": { "description": "Patient name" },
  "phone":       { "description": "Phone" },
  "required": ["serviceType", "date", "time", "patientName", "phone"]
}
```

Every field is **required** here, on purpose: the app read the shape of the task
and stored no values, because it has no business inventing somebody's name.
Teach it by hand instead and those same parameters become optional, falling back
to what you demonstrated.

<img src="docs/shot-mint.png" alt="A tool minted mid-session, badged new this session" width="100%">

### 2 · The agent runs it, and you hold the submit button

<img src="docs/shot-confirm.png" alt="The approval dialog listing the exact values to be submitted" width="100%">

Every step is animated on screen, then it stops. The dialog lists the exact
values and names the button it is about to press. Deny it, press <kbd>Esc</kbd>,
or navigate away and nothing is sent.

### 3 · The site is redesigned. It heals.

Switch to `#/site?v=2` — the same clinic a year later.

<img src="docs/shot-heal.png" alt="Drift report showing four changes and one question" width="100%">

| What the redesign did | What happens |
| --- | --- |
| `Your name` → `Full name (as on insurance card)` | heals itself |
| date/time step moved before service | heals itself |
| `Confirm booking` → `Book appointment` | heals itself |
| **new required `Insurance ID`** | **one question, asked once** |

Answer it. Run again. Green.

## Why it heals instead of breaking

A flow is stored as **intent and purpose — never as selectors**. Steps match by
intent, fields match by purpose, and a field's purpose comes from its `name`
attribute, because that is what the server reads and therefore the one thing a
visual redesign does not rewrite.

So the four things a redesign does to a form carry no new information, and heal
from the page itself. The one thing the app genuinely cannot know is a value
nobody has ever given it. That — and only that — becomes a question.

Two consequences worth stating plainly:

- **A question answered with an empty string stays open.** No flow ever reports
  itself healthy while being unrunnable.
- **A declared parameter is never a question.** It belongs in the tool's input
  schema, marked required when there is no stored fallback, so the agent is told
  up front instead of finding out by failing.

## Run it

```
npm install
npm run dev
```

| Route | What it is |
| --- | --- |
| `#/` | Get started |
| `#/flows` | Your learned flows, health, run history |
| `#/site` | The demo clinic, v1 |
| `#/site?v=2` | The same clinic, one year later |
| `#/site?teach=1` | Teach mode, if you want your own values remembered |
| `#/tools` | The live WebMCP registry |

```
npm test          # 73 unit tests
npm run typecheck
npm run build
```

## Test it with a real agent

- **Chrome 149+** — enable `chrome://flags/#enable-webmcp-testing`, relaunch.
- **ChatGPT desktop app** — open the deployed URL in the in-app browser.

Then ask: *“Learn the site, then run the flow you just learned.”*

**No WebMCP in your browser?** Nothing breaks. Every page still works, and the
**Simulated agent** panel at the bottom calls the same registered tool objects a
real agent calls — same argument validation, same `AbortSignal`, same approval
step. It exists so none of the claims above have to be taken on faith.

### WebMCP notes worth knowing

Verified against the [spec](https://webmachinelearning.github.io/webmcp/) and
[Chrome's docs](https://developer.chrome.com/docs/ai/webmcp). Four things that
bite:

- The entry point is `document.modelContext`. An earlier revision of the
  proposal used `navigator.modelContext`, so both are feature-detected.
- `registerTool()` returns a **Promise** and **rejects with `InvalidStateError`**
  if the name is taken — so flow names are made unique before they are offered.
- Tools are removed by aborting the `AbortSignal` passed to `registerTool`, not
  by an `unregisterTool` method.
- **WebMCP is refused in documents that are not origin-keyed.** This app ships
  `Origin-Agent-Cluster: ?1` (`vite.config.ts` for dev, `vercel.json` for
  production). Without that header, registration fails with `SecurityError` —
  the banner at the top of the app tells you if that ever happens.

Declarative attributes used on the booking form: `toolname`, `tooldescription`,
`toolparamdescription`. `toolautosubmit` is deliberately **not** used: the human
owns the submit.

## The tools an agent sees

| Tool | What it does |
| --- | --- |
| `learn_site` | **Learn this page autonomously.** No demonstration. |
| `list_flows` | What is known, with health and parameters |
| `check_flow_health` | Plain-English drift report and any questions |
| `run_flow` | Run a flow; the human approves the submit |
| `heal_flow` | Apply answers and re-read the site |
| `get_site_info` | Current site version and changelog |
| `start_teaching` | Teach mode, for when you want your own values kept |
| *`<flow name>`* | Minted per learned flow, schema built from what it found |

Read-only tools carry `readOnlyHint`; anything echoing stored user content
carries `untrustedContentHint`.

## What it will not do

- **Submit without you.** Every run stops at an approval dialog listing the exact
  values.
- **Press a button it does not understand.** Discovery only advances through a
  button that clearly reads as *next* / *continue* / *proceed*, or where a
  `Step N of M` counter proves there is more to come. Anything else is treated as
  terminal and never clicked, so learning cannot trip a real submit.
- **Invent your details.** Autonomous learning stores the shape of the task and
  no values. The throwaway values it types to walk the wizard are recorded in the
  audit trail and discarded.
- **Trust its input.** Tool arguments are coerced, length-capped, checked against
  the live option lists, and date values must be real calendar dates — then
  rejected with a message saying what is allowed.
- **Send your data anywhere.** Single origin, hash routing, `localStorage` only.
  No backend, no accounts, no telemetry. The clinic is fictional and no booking
  is real.

## How it is built

Vite + React + TypeScript, plain CSS, no state library, no UI framework, no icon
dependency (the icons are hand-written SVG in [`src/icons.tsx`](src/icons.tsx)).

| File | Job |
| --- | --- |
| [`src/discover.ts`](src/discover.ts) | Reads a wizard out of the live DOM. Never imports the site model. |
| [`src/drift.ts`](src/drift.ts) | Deterministic drift detection and healing |
| [`src/webmcp.ts`](src/webmcp.ts) | The verified WebMCP layer |
| [`src/learn.ts`](src/learn.ts) | Turns a discovery into a flow and a tool |
| [`src/runner.ts`](src/runner.ts) | Run orchestration and untrusted-argument handling |
| [`src/SiteApp.tsx`](src/SiteApp.tsx) | The demo clinic and the on-screen executor |

[`VERIFICATION.md`](VERIFICATION.md) records what was tested and how, every edge
case result, and — explicitly — what is *not* verified.

---

<p align="center">
  Built by <a href="https://github.com/Hotragn">Hotragn Pettugani</a> ·
  <a href="https://hotragnpettugani.design">hotragnpettugani.design</a> ·
  MIT licensed
</p>
