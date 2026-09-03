# Verification report

**Live:** https://yolo-learn.vercel.app
**Repo:** https://github.com/Hotragn/yolo-learn (public, MIT)

`npm test` (106 tests), `npm run typecheck`, `npm run build` - all green. Browser
QA driven through a headless Chromium against the dev server, the local
production build (`vite preview`), and the live Vercel deployment.

**Native WebMCP is confirmed working.** On Chrome 149 with
`chrome://flags/#enable-webmcp-testing` enabled, live production reports:

> WebMCP detected on `document.modelContext`. **7 tool(s) registered with the browser.**

That single line settles three things at once:

1. `document.modelContext` is the live entry point - the primary detection path
   is correct, and the `navigator.modelContext` fallback is not what fired.
2. All seven built-in tools registered without an `InvalidStateError`, so the
   name-uniquing holds against a real registry.
3. `Origin-Agent-Cluster: ?1` is landing in production. Without it, every one of
   those `registerTool()` calls would have rejected with `SecurityError` and the
   banner would have been red - which is the requirement BUILD.md never
   mentioned and the reason it is shipped in `vercel.json`.

---

## 1. Autonomous learning

The headline capability: learn a task on a site with **no human
demonstration**. [`src/discover.ts`](src/discover.ts) reads the live DOM and
deliberately never imports the site model in `types.ts` - if it read our own
fixture, "it can learn a page nobody described to it" would be a lie.

What it reads, in priority order:

| Signal | Used for | Why |
| --- | --- | --- |
| `name` attribute | field purpose | It is what the server reads, so a visual redesign does not rewrite it |
| `autocomplete` token | field purpose, fallback | Standardised and semantic |
| `element.labels` | human label | The DOM's own answer; covers wrapping and `for`/`id` |
| `required`, `type`, `<option>` values | schema | Straight from the markup |
| `toolname` / `tooldescription` | tool naming | The declarative WebMCP contract |
| `Step N of M` heading | terminal-step detection | Proof there is more to come |

**Verified on the live production build:**

```
learn_site → Learned "clinic_booking" by reading the page:
             4 steps, 5 fields, no demonstration and no invented values.
notes      → ["Stopped at step 4 of 4 without submitting."]
```

Learning **v2 directly** - a layout it has never seen - discovers the redesigned
shape correctly, including the field that does not exist in v1:

```
steps  → pick date and time > choose service > enter patient details > confirm booking
params → date, time, serviceType, patientName, phone, insuranceId
```

### The three rules that keep it honest

1. **It will not press a button it does not understand.** It advances only
   through a label matching `next|continue|proceed|forward|onward`, or where a
   `Step N of M` counter proves there is more to come. Anything else is terminal
   and never clicked - so discovery cannot trip a real submit. Verified: on both
   site versions it stops at step 4 without pressing `Confirm booking` /
   `Book appointment`, and a fixture whose button reads `Place order` is refused.
2. **It invents nothing.** Discovery stores the shape of the task and zero
   values. The throwaway probes it types to satisfy native validation are
   reported separately, written to the audit trail, and discarded.
3. **It cannot loop.** A page that stops advancing ends the walk with
   `"the page stopped advancing"` rather than spinning to `maxSteps`.

### Consequence for the drift engine

An autonomously learned flow has every field as a parameter and no values, so
the question rule had to change: **a declared parameter is never a question.**
It belongs in the tool's `inputSchema`, marked `required` when there is no
stored fallback, so the agent is told up front instead of finding out by
failing. That makes the two learning paths differ in exactly the right way:

| | Learned autonomously | Taught by demonstration |
| --- | --- | --- |
| Stored values | none | every field the user filled |
| `inputSchema.required` | every parameter | none - omitting one reuses the demo value |
| Verified call with `{}` | names the missing parameter | replays `checkup / 2026-09-11 / 10:00 AM / Jane Doe / 555-0142` |
| Questions after v2 redesign | 1 (insurance ID) | 1 (insurance ID) |

## 2. WebMCP API surface

Verified against the [spec](https://webmachinelearning.github.io/webmcp/) and
[Chrome's docs](https://developer.chrome.com/docs/ai/webmcp). Three of BUILD.md's
assumptions were wrong, and one requirement was missing entirely.

| Assumption in BUILD.md | What the spec says | Consequence |
| --- | --- | --- |
| `registerTool(tool)` is sync and idempotent | Returns a `Promise` and **rejects with `InvalidStateError`** if the name exists | Two flows with the same name would have silently pointed one tool at the wrong flow. Names are uniquified (`clinic_booking_2`) and failures reported. |
| Re-registering is harmless | Same as above | Delete/undo unregisters and re-registers explicitly. |
| Tools are removed by unregistering | No `unregisterTool` in the spec: **abort the `AbortSignal`** passed to `registerTool` | Delete aborts the per-tool `AbortController`, with a best-effort `unregisterTool` fallback. |
| *(not mentioned)* | **WebMCP is refused in documents that are not origin-keyed** | **The deployed demo could not have registered anything.** The app serves `Origin-Agent-Cluster: ?1` (`vite.config.ts`, `vercel.json`), and the banner reports it if the header goes missing. |

Confirmed correct as written: `document.modelContext` is the entry point (the
earlier proposal used `navigator.modelContext`, so both are feature-detected),
`execute` is `Promise<any> (inputObject, {signal})`, and the declarative
attribute names. Added from the spec: `readOnlyHint` / `untrustedContentHint`,
the `toolchange` event (so the Tools view listens instead of polling on a
timer), and `name` attributes on form controls - without which the declarative
tool's schema has no usable property keys. `toolautosubmit` is deliberately not
used: the human owns the submit.

## 3. The demo loop

Both loops passed repeatedly, most recently **twice consecutively against the
live production deployment** from cleared storage.

| Loop | Time | Result |
| --- | --- | --- |
| Autonomous (learn → run → v2 → heal → run) | **16s** | green |
| Taught (demonstrate → mint → run → v2 → heal → run) | **18-19s** | green |

Budget was 90 seconds.

Beat 5 verbatim from `check_flow_health`, unchanged by either path:

```
4 changes since this flow was learned, 3 heal automatically, 1 needs an answer from you.
  RENAMED    "Your name" is now labeled "Full name (as on insurance card)"      auto
  NEW_FIELD  New field "Insurance ID" appeared in "enter patient details"       ASKS YOU
  WORDING    Button "Confirm booking" is now "Book appointment"                 auto
  REORDERED  Steps were reordered: "pick date and time" now comes before
             "choose service"                                                   auto
  Q: The site now asks for "Insurance ID". What should I answer?
```

One change per line of the site's own changelog, asserted by test.

## 4. Edge cases

| Case | Result |
| --- | --- |
| Learn the same site twice | Auto-renamed `clinic_booking_2`; both tools registered; no `InvalidStateError` |
| Learn on v2 directly | 6 fields discovered in v2's order, including `insurance id` |
| Learn from a page with no form | Reported, not thrown (unit-tested); the tool navigates to the site first |
| Discovery on a stalling page | Ends with "the page stopped advancing" instead of looping |
| Auto-learned flow called with a missing required parameter | Names the parameter to pass; does **not** falsely claim drift |
| Teach with zero fields marked changeable | Mints with 0 parameters, warns honestly, replays the demo |
| Run with missing params (taught flow) | Falls back to demonstrated values per field |
| Heal with an empty answer | Stays `drifted`, question re-asked; the Heal button stays gated |
| Delete a flow mid-run | Run completes, flow not resurrected, no console errors |
| Two flows with the same name | Auto-renamed; both registered |
| Reload during an agent run | Wizard resets clean, tools and flows re-registered, no errors |
| Navigate away mid-approval | Settles as a denial rather than hanging the agent's promise |
| Abort mid-run | Cancels between steps and during every animation pause |
| Cold load with empty localStorage | Empty state, 7 built-in tools register, no errors |
| Corrupt / partial localStorage | Bad entries dropped rather than crashing the UI (unit-tested) |
| Theme choice | Persists across reload; `system` follows `prefers-color-scheme` |
| Onboarding checklist | Ticks itself to 3/3 from real flow state |
| Reset demo data | Clears flows, unregisters tools, empties the audit trail |
| Firefox graceful degradation | **Verified by code path, not in Firefox.** All QA ran in a Chromium with no `document.modelContext` - the identical degradation path: amber banner naming the flag, every page functional, nothing thrown. |
| Chrome 149 with the WebMCP flag | **Verified.** Green banner, `document.modelContext`, 7 of 7 tools registered natively |
| ChatGPT desktop in-app browser | **Not verified - see limitations** |

### Bugs the browser pass found that unit tests could not

- **`?teach=1` only worked on a fresh mount.** Following "or demonstrate it
  yourself" while already on the site page changed the hash without remounting,
  so teach mode silently never started. The check now listens for `hashchange`.
- **`CSS.escape` is not guaranteed to exist**, and discovery crashed on any input
  with an `id` but no wrapping label. Replaced with `element.labels`, which is
  the correct DOM API for both association styles.
- **`offsetParent` is null wherever there is no layout engine**, which would make
  discovery skip every field. Visibility now uses computed style and only trusts
  the layout signal when the document demonstrably has layout.
- **An auto-learned tool described itself as "taught by the user by demonstrating
  it once"**, and claimed omitted parameters would reuse a demonstrated value.
  Neither was true. The description now branches on provenance.
- **A date-shaped string that is not a date** (`2026-13-99`, `2026-02-30`) passed
  validation and submitted blank. Dates now round-trip before being accepted.
- **Long identifiers overflowed their card** (`document.modelContext.registerTool`).
- **React's double-invoked mount effect** let tool registration interleave;
  `initTools()` serializes it.

## 5. Accessibility and theme

Dialogs are `role="dialog" aria-modal="true"` with `aria-labelledby`; focus moves
to the primary action on open (verified: `Approve and submit`), Tab wraps inside
the dialog in both directions, <kbd>Esc</kbd> always takes the safe path
(verified: denies the submit), and focus returns to the trigger on close.
Required fields carry the native `required` attribute, so teach mode cannot
capture a blank required field. `prefers-reduced-motion` disables animation.

The Slate + Signal Lime theme uses lime as a **fill, never as text on a light
surface**: `#7BD40A` on white is about 1.9:1, so buttons put near-black ink *on*
lime (about 11:1) and lime-coloured text uses a darkened `--accent-ink` (about
7.7:1). On dark surfaces the raw lime is safe. Dark mode follows
`prefers-color-scheme` with a manual override that persists.

## 6. Deviations from BUILD.md, with reasons

1. **Autonomous learning was added.** BUILD.md's loop starts with a human
   demonstration. Requiring a person to demonstrate a four-field booking form is
   the weakest part of the pitch, so `learn_site` reads the page instead.
   Teaching is kept for when the user wants their own values replayed.
2. **A declared parameter is never a question.** Required for (1) to work, and
   correct regardless: the input schema is the right place to say it.
3. **Parameters are `required` in the schema only when there is no fallback.**
   Self-documenting, and it tells the agent before it fails.
4. **One reorder counts as one change**, not one per moved step. As written, a
   single swap produced 5 changes for a 4-line changelog.
5. **Questions come from missing values, not missing fields.** As written,
   healing with an empty answer marked a flow healthy that could never run.
6. **Site version is remembered, not parsed from `location.hash` on every read.**
   The library lives at a route with no `?v=`, so as written it always measured
   drift against v1 and a run started there silently downgraded the site.
7. **`never_run` is preserved** rather than overwritten with `healthy`.
8. **Parameters bind by field purpose only**, so a field that is renamed *and*
   relocated stays bound.
9. **Tool arguments are normalized at the boundary**: options case-normalized to
   the canonical value, real-date checking, length caps, unknown keys reported
   back as ignored.
10. **`flowName` is accepted alongside `flowId`**, and `check_flow_health` with no
    arguments checks every flow. An agent holds the name, not our internal id.
11. **A simulated agent console was added.** It calls the same registered tool
    objects with the same validation, `AbortSignal` and approval step. Without
    it, none of these claims are demonstrable in a browser lacking the flag.
12. **Routes changed**: `#/` is now a get-started page and the flow library moved
    to `#/flows`. BUILD.md put the library at `#/`, but a submission with no
    front door explains itself to nobody.
13. **Added files** beyond the section 8 tree: `discover.ts`, `learn.ts`,
    `minted.ts`, `icons.tsx`, `Modal.tsx`, `AgentConsole.tsx`, `__tests__/*`,
    `vitest.config.ts`, `vercel.json`, and this file.

## 6b. The resumable runner

Built after the multi-page analysis, and verified by tearing the page down
rather than by reasoning about it.

| Property | How it was verified |
| --- | --- |
| Run state outlives the document | Hard reload mid-run. Same `runId`, same `stepIndex` (3), same 5 filled values, back at the approval gate |
| The human gate survives too | After the reload the approval dialog is present again and the run reads `awaiting_approval` |
| An agent can recover a lost promise | `get_run_status` returned step 4 of 4 with `resumedAfterTeardown: 1` |
| The outcome is durable | `done`, reference `NSC-5268`, written to the flow's run history |
| Gates sit at irreversible steps | Test asserts exactly one gate on both site versions, on `confirm booking` |
| Unrecognised wording is gated | `classifySideEffect` returns irreversible for anything not clearly navigation |
| Concurrency | A second run while one is in flight is refused, via both the minted tool and `run_flow` |
| Per-tab isolation | Run state is `sessionStorage`; a test asserts it is not in `localStorage` |
| No regression | The 9-beat guided run is still green after the runner was rewritten under it |

Deliberately **not** claimed: this has never been pointed at a real
multi-document site. The demo is one document with hash routes, so no true
navigation happens in it. A full reload is a strictly harsher teardown than a
navigation, which is why that is what was tested, but "works on a real
checkout" remains unproven.

## 7. Limitations - what is NOT verified

- **The ChatGPT desktop in-app browser.** Not tested. Native registration is
  confirmed on Chrome 149 (see the top of this document), so the remaining risk
  is specific to that browser's WebMCP build rather than to this integration.
- **Firefox itself.** The degradation path is verified; the browser is not.
- **A real multi-document flow.** The resumable runner is built and tested
  against a document teardown, but the demo site is a single document, so
  nothing here has crossed a real page navigation.
- **Discovery against arbitrary real-world sites.** It is unit-tested against
  fixtures with markup the demo site does not use (labels by `for`/`id`,
  `autocomplete` with no `name`, no headings, hidden and disabled controls,
  stalling pages) and verified live on both versions of the demo clinic. It has
  not been pointed at a third-party site.
