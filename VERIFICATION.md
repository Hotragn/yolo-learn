# Verification report

Against BUILD.md section 9. Written 2026-09-02.

Commands: `npm test` (51 tests), `npm run typecheck`, `npm run build` — all green.
Browser QA driven through a headless Chromium against both the dev server and
the production build (`vite preview`).

---

## 1. WebMCP API surface (P0 task 1)

Verified against the [spec](https://webmachinelearning.github.io/webmcp/) and
[Chrome's docs](https://developer.chrome.com/docs/ai/webmcp). Three of
BUILD.md's assumptions were wrong, and one requirement was missing entirely.

| Assumption in BUILD.md | What the spec says | Consequence |
| --- | --- | --- |
| `registerTool(tool)` is sync and idempotent | Returns a `Promise` and **rejects with `InvalidStateError`** if the name exists | Two flows with the same name would have silently pointed one tool at the wrong flow. Names are now uniquified (`book_appointment_2`) and failures are reported. |
| Re-registering is harmless | Same as above | Re-mint after heal was dropped; delete/undo unregisters and re-registers explicitly. |
| Tools are removed by unregistering | No `unregisterTool` in the spec: **abort the `AbortSignal`** passed to `registerTool` | Delete now aborts the per-tool `AbortController`, with a best-effort `unregisterTool` fallback for builds that expose one. |
| *(not mentioned)* | **WebMCP is refused in documents that are not origin-keyed.** `Origin-Agent-Cluster: ?0` disables it; Chrome does not origin-key by default | **The deployed demo could not have registered anything.** The app now serves `Origin-Agent-Cluster: ?1` (`vite.config.ts`, `vercel.json`), and the banner reports it if the header goes missing. |

Confirmed correct as written in BUILD.md: `document.modelContext` is the entry
point (the earlier proposal used `navigator.modelContext`, so both are
feature-detected), `execute` is `Promise<any> (inputObject, {signal})`, and the
declarative attribute names `toolname` / `tooldescription` /
`toolparamdescription`.

Added from the spec: `annotations.readOnlyHint` and
`annotations.untrustedContentHint`, set honestly per tool; the `toolchange`
event, so the Tools view listens instead of polling on a 1s timer; `name`
attributes on the form controls, without which the declarative tool's schema
has no usable property keys. `toolautosubmit` is deliberately **not** used —
the human owns the submit.

## 2. The demo loop (section 4)

Passed three consecutive times: twice against the dev server, once against the
production build. **17 seconds** end to end on the production build, against a
90 second budget.

| Beat | Result |
| --- | --- |
| 1. Teach by hand, mark 2 fields changeable | 5 fields captured in step order with their demonstrated values |
| 2. Tool appears in `#/tools`, same session, no reload | Green flash naming `book_appointment`, auto-navigation, card highlighted, `new this session` badge, schema `{date, patientName}` |
| 3. Agent runs with new details, human approves | Dialog listed all 6 values before submit; approved → `Booking confirmed, reference NSC-2583` |
| 4. Switch to `#/site?v=2` | Redesign banner, wizard rebuilt in the new step order |
| 5. Health check | **Exactly 4 changes, exactly 1 question** — see below |
| 6. Answer, heal, run again | `healed and matches site v2.0`, then `Booking confirmed, reference NSC-3811` |

Beat 5 verbatim from `check_flow_health`:

```
4 changes since this flow was taught, 3 heal automatically, 1 needs an answer from you.
  RENAMED    "Your name" is now labeled "Full name (as on insurance card)"      auto
  NEW_FIELD  New field "Insurance ID" appeared in "enter patient details"       ASKS YOU
  WORDING    Button "Confirm booking" is now "Book appointment"                 auto
  REORDERED  Steps were reordered: "pick date and time" now comes before
             "choose service"                                                   auto
  Q: The site now asks for "Insurance ID". What should I answer?
```

One change per line of the site's own changelog, asserted by test.

## 3. Edge cases (section 6)

| Case | Result |
| --- | --- |
| Teach with zero fields marked changeable | Mints with 0 parameters, warns that every run books the same appointment, replays the demo exactly. Verified running it. |
| Run with missing params | Falls back to demonstrated values per field. Verified the dialog showed all 5 demo values. |
| Heal with an empty answer | Stays `drifted`, question re-asked. The UI gates the Heal button (`Answer to heal`, disabled) until answered. |
| Delete a flow mid-run | Run completes, the flow is **not** resurrected in storage, no console errors. (The original `{...getFlow(id)!}` would have thrown a `TypeError` here.) |
| Teach two flows with the same name | Auto-renamed `book_appointment_2`; both tools registered; no `InvalidStateError` |
| Reload during an agent run | Wizard resets clean, tools and flows re-registered, no errors. Verified with the approval dialog open at reload time. |
| Cold load with empty localStorage | Empty state renders, 6 built-in tools register, no errors. Also verified against corrupt and partial storage by unit test. |
| Firefox graceful degradation | **Verified by code path, not in Firefox.** The whole QA pass ran in a Chromium with no `document.modelContext`, which is the identical degradation path: amber banner naming the flag, every page functional, nothing thrown. |
| Chrome with the WebMCP flag | **Not verified — see limitations.** |
| ChatGPT desktop in-app browser | **Not verified — see limitations.** |

Additional cases found and fixed during QA, beyond the section 6 list:

- **A date-shaped string that is not a date.** `2026-13-99` and `2026-02-30`
  passed the regex, then submitted blank because a date input holds nothing it
  cannot parse. Dates now round-trip before they are accepted.
- **Navigating away mid-approval hung the agent's promise forever.** Unmount now
  settles it as a denial. A hung tool call is worse than a denied one.
- **Aborting mid-run** cancels between steps and during every animation pause,
  and resolves an open approval dialog as a denial.
- **Tool registration order** was non-deterministic under React's
  double-invoked mount effect; `initTools()` serializes it.

## 4. Keyboard and accessibility

Dialogs are `role="dialog" aria-modal="true"` with `aria-labelledby`; focus
moves to the primary action on open (verified: `Approve and submit`), Tab wraps
inside the dialog (verified both directions), Escape takes the safe path
(verified: denies the submit, `You denied the submit. Nothing was sent.`), and
focus returns to the trigger on close. Required fields carry the native
`required` attribute, so teach mode cannot capture a blank required field.
`prefers-reduced-motion` disables the animations.

## 5. Deviations from BUILD.md, with reasons

1. **Drift counts one reorder as one change**, not one per moved step. As
   written, a single swap produced 5 changes for a 4-line changelog and beat 5
   could not report "4 changes".
2. **Questions come from missing values, not missing fields.** As written,
   healing with an empty answer marked a flow `healthy` that could never run,
   with no question left to answer. Now the question survives until a real
   value exists.
3. **Site version is remembered, not parsed from `location.hash` on every
   read.** The Flow Library lives at `#/` with no `?v=` param, so as written it
   always measured drift against v1 — the drifted badge could never appear
   there — and a run started from `#/` silently downgraded to the old site.
4. **`never_run` is preserved** rather than being overwritten with `healthy`.
   Claiming health for something never executed is the fake confidence this app
   exists to replace.
5. **Parameters bind by field purpose only**, not by `(stepIntent, purpose)`, so
   a field that is renamed *and* relocated stays bound to its parameter.
6. **Tool arguments are normalized and rejected at the boundary**: select values
   are case-normalized to the canonical option, dates must be real dates, values
   are length-capped, and unknown keys are reported back as ignored. BUILD.md
   asked for untrusted-input handling without specifying the mechanism.
7. **`check_flow_health` / `run_flow` / `heal_flow` accept `flowName` as well as
   `flowId`**, and `check_flow_health` with no arguments checks every flow. An
   agent holds the tool name, not our internal id; this removes a round trip.
8. **Added a simulated agent console.** It calls the same registered tool
   objects with the same validation, the same `AbortSignal` and the same
   approval step. Without it, none of the claims in this document are
   demonstrable in a browser that lacks the flag — including for a judge. It
   defaults to collapsed when a real agent is present.
9. **Added files** beyond the section 8 tree: `src/Modal.tsx` (shared accessible
   dialog), `src/AgentConsole.tsx`, `src/__tests__/*` (51 tests),
   `vitest.config.ts`, `vercel.json`, this file.
10. **`getRegisteredTools()` is kept** for compatibility but the UI uses
    `getToolEntries()`, which carries the native/mirror state, the session-mint
    flag and any registration error.

## 6. Limitations — what is NOT verified

- **Chrome 149+ with `chrome://flags/#enable-webmcp-testing`.** No such build is
  available in this environment, so no tool has been registered with a real
  `document.modelContext`. The integration is written against the spec IDL and
  reports failures honestly rather than swallowing them: if `registerTool`
  rejects, the tool still works through the mirror and the card shows the
  error text. **This is the one thing to check by hand before submitting.**
- **The ChatGPT desktop in-app browser.** Same reason.
- **Firefox itself.** The degradation path is verified, the browser is not.
- **Vercel deployment.** Ready but not run: `vercel.json` is in place and the
  production build is verified locally, including the `Origin-Agent-Cluster`
  header. Creating the project needs a project name, and BUILD.md reserves
  naming for the founder.
- **`LICENSE` still reads `Copyright (c) 2026 [Founder Name]`**, as BUILD.md
  specified. Worth filling in before submitting.
