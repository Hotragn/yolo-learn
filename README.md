<p align="center">
  <img src="public/og.png" alt="Yolo Learn: it learns a website by itself, and heals when the site changes" width="820">
</p>

<h1 align="center">Yolo Learn</h1>

<p align="center">
  <strong>It learns a website by itself, mints a WebMCP tool live, and heals when the site changes.</strong>
</p>

<p align="center">
  <a href="https://yolo-learn.vercel.app"><img src="https://img.shields.io/badge/live%20demo-yolo--learn.vercel.app-7BD40A?style=flat-square&labelColor=0B1220" alt="Live demo"></a>
  <img src="https://img.shields.io/badge/tests-73%20passing-7BD40A?style=flat-square&labelColor=0B1220" alt="73 tests passing">
  <img src="https://img.shields.io/badge/Chrome%20149-7%2F7%20tools%20registered-7BD40A?style=flat-square&labelColor=0B1220" alt="Verified on Chrome 149">
  <img src="https://img.shields.io/badge/dependencies-react%20only-0B1220?style=flat-square" alt="React only">
  <img src="https://img.shields.io/badge/license-MIT-0B1220?style=flat-square" alt="MIT license">
</p>

<p align="center">
  <a href="https://yolo-learn.vercel.app"><strong>Open the live demo</strong></a> ·
  <a href="#the-loop-in-ninety-seconds">The loop</a> ·
  <a href="#architecture">Architecture</a> ·
  <a href="#reaching-a-site-it-does-not-own">Scaling to real sites</a> ·
  <a href="VERIFICATION.md">What was verified</a>
</p>

---

## Why this is hard

At a glance this looks like a form filler. It is worth thirty seconds on why it
is not, because every one of these is a place the obvious approach fails.

**Recording selectors is easy and useless.** That is Selenium, and it breaks the
first time somebody renames a class. The hard requirement is the opposite: store
a task so that renaming a field, reordering the steps and reworking a button
*carry no information at all*. That is why a field's identity comes from its
`name` attribute, which is what the server reads, and a step's identity comes
from its intent. Neither is something a redesign touches.

**Knowing what you do not know.** Anything can guess a value for `Insurance ID`.
Refusing to guess, asking exactly once, and then never asking again is a
constraint most demos quietly break in order to look smarter. A question
answered with an empty string stays open here, so no flow ever claims to be
healthy while being unrunnable.

**Walking a wizard you have never seen, without submitting it.** Discovery has
to press buttons on an unknown page and must never accidentally buy something.
It only advances through a button that clearly reads as *next*, or where a
`Step N of M` counter proves there is more to come. Everything else is treated
as terminal and left alone.

**Registering tools mid-session.** Almost every WebMCP demo hardcodes its tools
at page load. Minting one at runtime and having a live agent call it with no
reload is the actual new capability, and it is the part that took reading the
spec properly to get right.

---

## The loop, in ninety seconds

<img src="docs/shot-onboarding.png" alt="The Yolo Learn get started page" width="100%">

### 1. It reads the page

Press **Learn automatically**, or ask an agent to call `learn_site`. You fill in
nothing.

```
Learned "clinic_booking" by reading the page:
4 steps, 5 fields, no demonstration and no invented values.
notes: ["Stopped at step 4 of 4 without submitting."]
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

Every field is **required** on purpose. It read the shape of the task and stored
no values, because it has no business inventing somebody's name. Teach it by
hand instead and those same parameters become optional, falling back to what you
demonstrated.

<img src="docs/shot-mint.png" alt="A tool minted mid-session, badged new this session" width="100%">

### 2. The agent runs it. You hold the submit button.

<img src="docs/shot-confirm.png" alt="The approval dialog listing the exact values to be submitted" width="100%">

Every step animates on screen, then it stops. The dialog lists the exact values
and names the button it is about to press. Deny it, press <kbd>Esc</kbd>, or
navigate away, and nothing is sent.

### 3. The site gets redesigned. It heals.

Switch to `#/site?v=2`, the same clinic a year later.

<img src="docs/shot-heal.png" alt="Drift report showing four changes and one question" width="100%">

| What the redesign did | What happens |
| --- | --- |
| `Your name` becomes `Full name (as on insurance card)` | heals itself |
| the date step moves ahead of the service step | heals itself |
| `Confirm booking` becomes `Book appointment` | heals itself |
| **a new required `Insurance ID` appears** | **one question, asked once** |

Answer it. Run again. Green.

---

## Architecture

<img src="docs/architecture.svg" alt="Yolo Learn architecture: read, remember, mint, run, heal" width="100%">

| Module | Job |
| --- | --- |
| [`discover.ts`](src/discover.ts) | Reads a wizard out of the live DOM. **Never imports the site model.** |
| [`drift.ts`](src/drift.ts) | Deterministic drift detection and healing |
| [`learn.ts`](src/learn.ts) | Turns a discovery into a flow and a tool |
| [`webmcp.ts`](src/webmcp.ts) | The verified WebMCP layer |
| [`runner.ts`](src/runner.ts) | Run orchestration and untrusted-argument handling |
| [`store.ts`](src/store.ts) | The semantic map, in `localStorage` |
| [`SiteApp.tsx`](src/SiteApp.tsx) | The demo clinic and the on-screen executor |

`discover.ts` importing the site model would make the whole claim a lie, so it
does not. It gets exactly what a screen reader would get.

---

## Reaching a site it does not own

This is the honest part, and the question a reviewer should ask first.

**WebMCP tools belong to a document.** The demo works because Yolo Learn *is*
the clinic: same origin, same document. That is a demo harness, not a product.
Getting onto a page you do not own is not a WebMCP problem, it is a delivery
problem, and there are exactly three answers.

<img src="docs/scaling.svg" alt="Three delivery shapes, multi-page flows, and multi-flow storage" width="100%">

The cross-origin parts of the spec (`exposedTo`, `getTools({fromOrigins})`,
`<iframe allow="tools">`) federate tools between **consenting** origins. They do
not let you read an arbitrary site, so they are not an answer to the long tail.
A content script is.

### What multi-page costs

A page navigation destroys all JavaScript state, so three things change:

1. **A step gains a route.** `route: { pathname, match }`, recorded during
   discovery. A route that no longer resolves is a new drift type,
   `ROUTE_CHANGED`.
2. **The runner becomes resumable.** Run state (`runId`, `stepIndex`, `params`)
   moves out of the page. Every page load asks whether there is an active run
   whose next step matches this route.
3. **The approval gate moves per step.** One approval at the end is correct for a
   single-document wizard and wrong the moment a flow spans pages. Steps gain
   `sideEffect: none | reversible | irreversible`, and the run stops at every
   irreversible boundary.

### What multi-flow costs

Almost nothing, which is the useful finding. Tools register per document, so two
different clinics can both own a `book_appointment` tool without colliding, and
within one origin names are already uniqued. Per-flow schemas, drift, health,
healing and run history all exist. The only missing piece is an `origin` field
and grouping in the library.

---

## Edge cases

Honest status. **Handled** means it is implemented and tested. **Designed** means
the behaviour is specified above but not yet coded.

| Case | Status | Behaviour |
| --- | --- | --- |
| Learn the same site twice | Handled | Second tool becomes `clinic_booking_2`, no `InvalidStateError` |
| Learn a layout never seen before | Handled | Verified on v2: 6 fields in the new order |
| Page has no form | Handled | Reported, not thrown |
| Page never advances | Handled | Walk ends with "the page stopped advancing" |
| Button is not a next button | Handled | Refused and reported. Never clicked |
| Login wall mid-flow | Handled | Credentials refused. Walk stops, tells you to sign in |
| Password or card field | Handled | Refused outright. Never read, never filled, never stored |
| Missing required parameter | Handled | Names the parameter to pass. Does not falsely claim drift |
| Empty answer to a question | Handled | Stays drifted, question re-asked |
| Flow deleted mid-run | Handled | Run completes, flow not resurrected |
| Reload mid-run | Handled | Clean reset, tools re-minted |
| Navigate away mid-approval | Handled | Settles as a denial, never hangs the agent |
| Agent aborts mid-run | Handled | Cancels between steps and inside every pause |
| Corrupt `localStorage` | Handled | Bad entries dropped rather than crashing |
| Hostile tool arguments | Handled | Coerced, length-capped, enum-checked, real-date-checked |
| Flow spans several pages | Designed | Route per step, resumable runner, per-step gate |
| Site changes its URLs | Designed | `ROUTE_CHANGED` drift |
| SPA route change with no page load | Designed | Observe `pushState` and `popstate` |
| Options loaded asynchronously | Designed | Wait for the option list to settle before reading |
| Two layouts behind one URL (A/B test) | Designed | Store variants per step intent |
| CAPTCHA or bot check | Designed | Stop and hand to the human. Never solve one |
| Concurrent runs in several tabs | Designed | One active run per origin, held in the background |
| Server-side validation failure | Designed | Feed the site's own error text back as a question |

---

## Run it

```
npm install
npm run dev
```

| Route | What it is |
| --- | --- |
| `#/` | Get started |
| `#/flows` | Learned flows, health, run history |
| `#/site` | The demo clinic, v1 |
| `#/site?v=2` | The same clinic, one year later |
| `#/site?teach=1` | Teach mode, when you want your own values remembered |
| `#/tools` | The live WebMCP registry |

```
npm test          # 73 unit tests
npm run typecheck
npm run build
```

## Test it with a real agent

- **Chrome 149+**: enable `chrome://flags/#enable-webmcp-testing`, relaunch.
  **Confirmed working.** The banner turns green and reports
  `WebMCP detected on document.modelContext. 7 tool(s) registered with the browser.`
- **ChatGPT desktop app**: open the deployed URL in the in-app browser.

Then ask: *"Learn the site, then run the flow you just learned."*

**No WebMCP in your browser?** Nothing breaks. Every page still works, and the
**Simulated agent** panel at the bottom calls the same registered tool objects a
real agent calls, with the same argument validation, the same `AbortSignal` and
the same approval step. It exists so none of the claims here have to be taken on
faith.

### WebMCP notes worth knowing

Verified against the [spec](https://webmachinelearning.github.io/webmcp/) and
[Chrome's docs](https://developer.chrome.com/docs/ai/webmcp). Four things bite:

- The entry point is `document.modelContext`. An earlier revision of the proposal
  used `navigator.modelContext`, so both are feature-detected.
- `registerTool()` returns a **Promise** and **rejects with `InvalidStateError`**
  if the name is taken. Flow names are made unique before they are offered.
- Tools are removed by aborting the `AbortSignal` passed to `registerTool`, not
  by an `unregisterTool` method.
- **WebMCP is refused in documents that are not origin-keyed.** This app ships
  `Origin-Agent-Cluster: ?1` (`vite.config.ts` for dev, `vercel.json` for
  production). Without that header, registration fails with `SecurityError`. The
  banner at the top of the app tells you if that ever happens.

Declarative attributes used on the booking form: `toolname`, `tooldescription`,
`toolparamdescription`. `toolautosubmit` is deliberately **not** used, because
the human owns the submit.

## The tools an agent sees

| Tool | What it does |
| --- | --- |
| `learn_site` | **Learn this page autonomously.** No demonstration |
| `list_flows` | What is known, with health and parameters |
| `check_flow_health` | Plain-English drift report and any questions |
| `run_flow` | Run a flow. The human approves the submit |
| `heal_flow` | Apply answers and re-read the site |
| `get_site_info` | Current site version and changelog |
| `start_teaching` | Teach mode, for when you want your own values kept |
| *`<flow name>`* | Minted per learned flow, schema built from what it found |

Read-only tools carry `readOnlyHint`. Anything echoing stored user content
carries `untrustedContentHint`.

## What it will not do

- **Submit without you.** Every run stops at an approval dialog listing the exact
  values.
- **Press a button it does not understand.** Only *next*, *continue* or
  *proceed*, or where a step counter proves there is more to come.
- **Touch a password or a card.** Credential and payment fields are refused while
  learning. A step that is nothing but a sign-in wall ends the walk.
- **Invent your details.** It stores the shape of a task, not values. The
  throwaway values it types to walk a wizard go in the audit trail and are
  discarded.
- **Trust its input.** Arguments are coerced, length-capped, checked against the
  live option lists, and dates must be real calendar dates.
- **Send your data anywhere.** Single origin, `localStorage` only. No backend, no
  accounts, no telemetry. The clinic is fictional and no booking is real.

## How it is built

Vite, React and TypeScript. Plain CSS with custom properties, no UI framework,
no state library, and no icon dependency: the icon set is hand-written SVG in
[`src/icons.tsx`](src/icons.tsx), one glyph per beat of the product story. Type
is self-hosted Geist. Dark mode follows `prefers-color-scheme` with a manual
override.

[`VERIFICATION.md`](VERIFICATION.md) records what was tested and how, every edge
case result, the deviations from the original brief with reasons, and explicitly
what is **not** verified.

---

<p align="center">
  Built by <a href="https://github.com/Hotragn">Hotragn Pettugani</a> ·
  <a href="https://hotragnpettugani.design">hotragnpettugani.design</a> ·
  MIT licensed
</p>
