# ChatGPT in-app browser session, 3 September 2026

A real agent driving the deployed app, unrehearsed. Recorded because it proved
one claim outright and broke another, and the broken one had been invisible to
every test until an actual implementation called the tools.

Agent: ChatGPT desktop, Codex in-app browser (`iab`), via its `cua_repl` and
`webmcp` capabilities. Target: `https://yolo-learn.vercel.app`.

## What was proven

**Native registration works.** The banner read *"WebMCP detected on
`document.modelContext`. 11 tool(s) registered with the browser."* The agent
enumerated all eleven with full descriptions, input schemas and annotations,
including `readOnlyHint` and `untrustedContentHint`.

**Mid-session minting works, and this is the headline.** After learning, the
count went **11 to 12** and the agent's own tool notification listed a tool that
had not existed when the page loaded:

```json
{"name":"clinic_booking",
 "description":"Clinic booking at Northside Family Clinic. Learned on 9/3/2026
   by reading the page itself, with no demonstration and no stored values...",
 "inputSchema":{"properties":{
   "serviceType":{"enum":["checkup","dental cleaning","physical exam"]},
   "date":{"description":"Date, formatted YYYY-MM-DD"},
   "time":{"enum":["9:00 AM","10:00 AM",...]},
   "patientName":{...},"phone":{...}},
   "required":["serviceType","date","time","patientName","phone"]}}
```

No reload. The enum values were read off the page, not written by anyone.

**The rest of the loop ran end to end.** Learned 4 steps and 5 fields with no
demonstration; ran with supplied values; stopped at the approval gate listing
every value; switched to v2; reported **4 changes, 3 automatic, 1 question**;
healed with `INS-99812`; ran again on v2 and reached the `Book appointment`
gate with `Insurance ID: INS-99812` included. The agent stopped and asked
before submitting, both times, unprompted.

## What broke

**Every native tool invocation failed.** Discovery worked perfectly and
invocation threw on every single call:

```
tools.call('learn_site', {})   -> Error: Cannot read properties of undefined (reading 'aborted')
tools.call('clinic_booking',…) -> Error: Cannot read properties of undefined (reading 'aborted')
```

The agent fell back to clicking the UI each time, which is why the run still
completed and why the transcript reads as a success. It was not one.

**Cause, and it was ours.** The spec declares
`execute(inputObject, options)` with `options.signal` required. Every tool
began `const bad = aborted(signal)`, reading `.aborted` off it. ChatGPT's
bridge passes an options object with **no signal**, so `signal` was
`undefined`.

**Why no test caught it.** All 194 tests called `execute` the way the spec says
to. Correct-by-the-spec is not the same as correct-against-implementations, and
on an experimental API the gap between those two is where the bugs live.

**Fix.** One wrapper at the registration boundary normalises both arguments, so
it covers every current tool and every tool added later:

```ts
function tolerant(tool) {
  return { ...tool,
    execute: (args, options) =>
      tool.execute(args ?? {}, { signal: options?.signal ?? NEVER_ABORTS }) }
}
```

Six tests now call the tools the way the transcript showed they are really
called: options with no signal, no options at all, and no arguments at all.
Verified to fail without the fix.

## What it also exposed about the UI

The agent ran with theme `system` on a dark OS. In that state no `data-theme`
attribute exists, dark tokens arrive through `prefers-color-scheme`, and an
override written as `:root[data-theme="dark"] button:hover` never matches. The
hover background fell through to a hardcoded `#000` while the text stayed
`var(--page)`, which in dark is near-black. Black on black.

Hover now reads `var(--action-hover)`, defined in all three theme states.

## The honest reading

Judged on the claim, this is a pass: a tool that did not exist was created by
reading a page, appeared to a real agent mid-session with a correct schema, and
survived a redesign with exactly one question.

Judged on robustness, it was a failure that looked like a pass, and it took a
real implementation to reveal it. The tool list rendering perfectly is exactly
what made it hard to notice.
