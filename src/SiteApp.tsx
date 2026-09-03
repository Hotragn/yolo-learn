import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { fieldName, FieldSpec, getActiveSiteModel, siteHash, slugify, syncSiteVersion } from "./types"
import {
  ActiveRun,
  finishRun,
  PlanItem,
  planFor,
  resumableRun,
  resumeRun,
  RunResult,
  saveRun,
  setRunDriver,
  setSiteReset,
  sideEffectOf,
} from "./runner"
import { learnCurrentSite } from "./learn"
import { getFlow, logEvent, subscribe } from "./store"
import { recallForPage } from "./recall"
import { beginTeaching, useTeach } from "./TeachMode"
import { Modal } from "./Modal"
import { IconAlert, IconCheck, IconRead, IconRecord, IconTerminal, IconTrash, IconUndo } from "./icons"

interface ConfirmState {
  resolve: (ok: boolean) => void
  plan: PlanItem[]
  submitLabel: string
}

type Notice = { kind: "ok" | "warn"; text: string }

const STEP_PAUSE = 420
const FIELD_PAUSE = 130

/** A sleep that gives up the moment the agent's AbortSignal fires. */
function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve()
    const timer = setTimeout(finish, ms)
    function finish() {
      clearTimeout(timer)
      signal.removeEventListener("abort", finish)
      resolve()
    }
    signal.addEventListener("abort", finish, { once: true })
  })
}

const bookingRef = () => `NSC-${Math.floor(1000 + Math.random() * 9000)}`

export default function SiteApp() {
  const site = getActiveSiteModel()
  const teach = useTeach()
  const [stepIndex, setStepIndex] = useState(0)
  const [values, setValues] = useState<Record<string, string>>({})
  const [notice, setNotice] = useState<Notice | null>(null)
  const [agentNote, setAgentNote] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<ConfirmState | null>(null)
  const [highlight, setHighlight] = useState(false)
  const [filling, setFilling] = useState<string | null>(null)
  const [running, setRunning] = useState(false)
  const [resumed, setResumed] = useState(false)
  const [learning, setLearning] = useState(false)
  const formRef = useRef<HTMLFormElement>(null)
  // Mirrors `confirm` so unmount can settle a pending approval. Leaving the
  // page while the dialog is open would otherwise hang the agent's promise
  // forever, and a hung tool call is worse than a denied one.
  const pendingConfirm = useRef<ConfirmState | null>(null)
  const localAbort = useRef<AbortController | null>(null)

  /**
   * Ask the human. Extracted because the gate now fires at every irreversible
   * step rather than once at the end. An abort while the dialog is open
   * resolves it as a denial instead of hanging whoever is waiting.
   */
  const askApproval = useCallback(
    (plan: PlanItem[], submitLabel: string, signal: AbortSignal) =>
      new Promise<boolean>((resolve) => {
        let settled = false
        const settle = (ok: boolean) => {
          if (settled) return
          settled = true
          signal.removeEventListener("abort", onAbort)
          pendingConfirm.current = null
          setConfirm(null)
          resolve(ok)
        }
        function onAbort() {
          settle(false)
        }
        signal.addEventListener("abort", onAbort, { once: true })
        const state: ConfirmState = { plan, submitLabel, resolve: settle }
        pendingConfirm.current = state
        setConfirm(state)
      }),
    []
  )

  const resetWizard = useCallback(() => {
    setStepIndex(0)
    setValues({})
    setHighlight(false)
    setFilling(null)
    setAgentNote(null)
    pendingConfirm.current = null
    setConfirm(null)
  }, [])

  // Deep link: #/site?teach=1 activates teach mode without an agent.
  // This has to react to hash changes, not just to mounting: following the
  // "or demonstrate it yourself" link while already on the site page changes
  // the hash without remounting, and a mount-only check silently did nothing.
  useEffect(() => {
    const check = () => {
      const qs = new URLSearchParams(location.hash.split("?")[1] ?? "")
      if (qs.get("teach") === "1" && !teach.active && !teach.done) beginTeaching("book_appointment")
    }
    check()
    window.addEventListener("hashchange", check)
    return () => window.removeEventListener("hashchange", check)
  }, [teach.active, teach.done])

  // Switching site version rebuilds the wizard, so stale step state cannot
  // point past the end of a shorter flow.
  useEffect(() => {
    resetWizard()
  }, [site.version, resetWizard])

  useEffect(() => {
    if (!notice) return
    const t = setTimeout(() => setNotice(null), 8000)
    return () => clearTimeout(t)
  }, [notice])

  // Autonomous discovery walks this wizard, so it needs a way to rewind it
  // before it starts and to tidy up when it finishes.
  useEffect(() => {
    setSiteReset(resetWizard)
    return () => setSiteReset(null)
  }, [resetWizard])

  const step = site.steps[Math.min(stepIndex, site.steps.length - 1)]

  /**
   * The run driver. One step at a time, persisting after each, so a document
   * teardown cannot lose the run.
   *
   * The previous version was a single in-memory loop: correct for one
   * document, and gone the moment the page reloaded. This version reads its
   * position from the persisted run, which is what makes it resumable.
   */
  const drive = useCallback(
    async (run: ActiveRun, signal: AbortSignal): Promise<RunResult> => {
      const model = getActiveSiteModel()
      const flow = getFlow(run.flowId)
      if (!flow) {
        return finishRun(run, {
          ok: false,
          confirmedByHuman: false,
          stepsExecuted: run.stepIndex,
          message: `The "${run.toolName}" flow was deleted, so the run could not continue.`,
        })
      }

      const { items, blocked } = planFor(flow, run.params, model)
      if (blocked) {
        // Whose problem this is depends on whether the flow exposes the field
        // as a parameter. Telling an agent to heal a flow when all it had to
        // do was pass a value sends it down the wrong path.
        return finishRun(run, {
          ok: false,
          confirmedByHuman: false,
          stepsExecuted: 0,
          needsHealing: !blocked.paramKey,
          message: blocked.paramKey
            ? `The site requires "${blocked.label}". Call this tool again with the "${blocked.paramKey}" parameter set.`
            : `The site requires "${blocked.label}" and this flow has no value for it. Heal the flow, then run it again.`,
        })
      }

      if (signal.aborted) {
        return finishRun(run, {
          ok: false,
          confirmedByHuman: false,
          stepsExecuted: 0,
          message: "Cancelled before the run started.",
        })
      }

      setRunning(true)
      setNotice(null)
      // Restore whatever a previous life already typed, rather than starting over.
      setValues({ ...run.filled })
      setResumed(run.resumeCount > 0)
      setAgentNote(
        run.resumeCount > 0
          ? `picking up at step ${run.stepIndex + 1} after the page was torn down`
          : "filling in your flow, step by step"
      )

      let current = run
      const submitted = Object.fromEntries(items.map((p) => [p.label, p.value]))

      try {
        for (let i = current.stepIndex; i < model.steps.length; i++) {
          if (signal.aborted) {
            resetWizard()
            return finishRun(current, {
              ok: false,
              confirmedByHuman: false,
              stepsExecuted: i,
              message: "Cancelled mid-run.",
            })
          }

          setStepIndex(i)
          setHighlight(true)
          const stepItems = items.filter((p) => p.stepIndex === i)
          for (const item of stepItems) {
            setFilling(item.purpose)
            setValues((prev) => ({ ...prev, [item.purpose]: item.value }))
            setAgentNote(`typing "${item.value}" into ${item.label}`)
            await wait(FIELD_PAUSE, signal)
          }
          setFilling(null)
          if (!model.steps[i].fields.length) setAgentNote(`reviewing ${model.steps[i].intent}`)

          // Checkpoint. If the document dies after this line, the run picks up
          // from this step rather than from the beginning.
          current = saveRun({
            ...current,
            stepIndex: i,
            filled: { ...current.filled, ...Object.fromEntries(stepItems.map((p) => [p.purpose, p.value])) },
            status: "running",
            message: `at step ${i + 1} of ${model.steps.length}`,
          })

          await wait(STEP_PAUSE, signal)

          // The gate belongs at every irreversible step, not only at the end.
          // Once a flow spans pages the earlier steps have already committed,
          // so one approval at the finish would be approving the wrong thing.
          if (sideEffectOf(model.steps[i]) === "irreversible") {
            current = saveRun({
              ...current,
              status: "awaiting_approval",
              message: `waiting for you to approve "${model.steps[i].submitLabel}"`,
            })
            setAgentNote(`waiting for you to approve "${model.steps[i].submitLabel}"`)

            const approved = await askApproval(items, model.steps[i].submitLabel, signal)
            if (!approved) {
              resetWizard()
              setNotice({
                kind: "warn",
                text: signal.aborted ? "Run cancelled. Nothing was submitted." : "You denied the submit. Nothing was sent.",
              })
              return finishRun(current, {
                ok: false,
                confirmedByHuman: false,
                stepsExecuted: i + 1,
                message: signal.aborted
                  ? "Cancelled while waiting for approval. Nothing was submitted."
                  : "The user denied the submit. Nothing was submitted.",
                submitted,
              })
            }
          }

          if (i < model.steps.length - 1) setHighlight(false)
        }

        const reference = bookingRef()
        resetWizard()
        setNotice({ kind: "ok", text: `Booked. Confirmation ${reference}` })
        return finishRun(current, {
          ok: true,
          confirmedByHuman: true,
          stepsExecuted: model.steps.length,
          message: `Booking confirmed, reference ${reference}`,
          submitted,
          reference,
        })
      } finally {
        setRunning(false)
        setAgentNote(null)
        setHighlight(false)
        setFilling(null)
      }
    },
    [resetWizard, askApproval]
  )

  useEffect(() => {
    setRunDriver(drive)
    return () => {
      setRunDriver(null)
      // Leaving the demo site inside the app is a denial: the JS context
      // survives, so somebody is still waiting on an answer. A page teardown
      // is different, and deliberately leaves the run resumable, because
      // React never gets to run this cleanup in that case.
      pendingConfirm.current?.resolve(false)
    }
  }, [drive])

  // Pick up a run that a page teardown interrupted. Nobody is awaiting this
  // one by definition, so the outcome goes to the flow's history instead.
  useEffect(() => {
    const pending = resumableRun()
    if (!pending) return
    const controller = new AbortController()
    localAbort.current = controller
    void resumeRun(controller.signal)
    return () => controller.abort()
  }, [])


  // The declarative WebMCP form fires these when an agent pre-fills or
  // abandons it, which is worth showing in the audit trail.
  useEffect(() => {
    const node = formRef.current
    if (!node) return
    const onActivated = () => logEvent("run", "An agent pre-filled the booking form declaratively")
    const onCancel = () => logEvent("run", "An agent abandoned the declarative booking form")
    node.addEventListener("toolactivated", onActivated)
    node.addEventListener("toolcancel", onCancel)
    return () => {
      node.removeEventListener("toolactivated", onActivated)
      node.removeEventListener("toolcancel", onCancel)
    }
  }, [])

  const setField = useCallback(
    (field: FieldSpec, value: string) => {
      setValues((v) => ({ ...v, [field.purpose]: value }))
      if (teach.active) {
        teach.recordField({
          stepIntent: step.intent,
          fieldPurpose: field.purpose,
          label: field.label,
          value,
          isParam: false,
        })
      }
    },
    [step, teach]
  )

  const advance = () => {
    if (stepIndex < site.steps.length - 1) {
      setStepIndex(stepIndex + 1)
      return
    }
    if (teach.active) {
      teach.complete()
      return
    }
    const reference = bookingRef()
    setNotice({ kind: "ok", text: `Booked. Confirmation ${reference}` })
    logEvent("confirm", `You booked by hand, reference ${reference}`)
    resetWizard()
  }

  const learnThisPage = async () => {
    setLearning(true)
    setNotice(null)
    try {
      const outcome = await learnCurrentSite({ onProgress: (note) => setAgentNote(note) })
      setAgentNote(null)
      if (!outcome.ok) {
        setNotice({ kind: "warn", text: outcome.summary })
        return
      }
      location.hash = "#/tools"
    } finally {
      setLearning(false)
      setAgentNote(null)
    }
  }

  const teachHint = useMemo(() => {
    if (!teach.active) return null
    const remaining = site.steps.length - 1 - stepIndex
    if (remaining > 0) return `Fill this step the way you normally would, then continue. ${remaining} step(s) to go.`
    return "Last step. Finish the booking and you can mint the tool."
  }, [teach.active, site.steps.length, stepIndex])

  return (
    <div className="site-wrap">
      {site.version === "2.0" && (
        <div className="banner" role="status">
          <IconAlert size={16} />
          <span>
            <b>We have updated our booking experience.</b> Version {site.version} is now live.
          </span>
        </div>
      )}
      <p className="fake-notice">
        <span className="fake-badge">not real</span>
        This is an invented clinic, built so there is a website to learn. No booking is ever sent.
      </p>

      <div className="site-head">
        <h2>Northside Family Clinic</h2>
        <nav className="version-switch" aria-label="Demo site version">
          <a href="#/site?v=1" className={site.version === "1.0" ? "on" : ""} aria-current={site.version === "1.0"}>
            v1
          </a>
          <a href="#/site?v=2" className={site.version === "2.0" ? "on" : ""} aria-current={site.version === "2.0"}>
            v2
          </a>
        </nav>
      </div>
      <p className="sub site-tagline">
        {site.version === "2.0"
          ? "The same clinic, one year later, after a redesign."
          : "A fictional clinic. Book an appointment in four steps."}
      </p>

      {teach.active && !teach.done && (
        <div className="teach-badge" role="status">
          <IconRecord className="rec" size={16} />
          <span>Recording your demonstration. {teachHint}</span>
        </div>
      )}
      {resumed && (
        <div className="resumed" role="status">
          <IconUndo size={16} />
          <span>
            <b>This run survived a page teardown.</b> Its state was stored outside the document, so it picked up at
            the step it had reached instead of starting again.
          </span>
        </div>
      )}
      {agentNote && (
        <div className="agent-note" role="status">
          <IconTerminal size={16} />
          <span>{agentNote}</span>
        </div>
      )}
      {notice && (
        <div className={notice.kind === "ok" ? "flash" : "flash warn"} role="status">
          {notice.kind === "ok" ? <IconCheck size={16} /> : <IconAlert size={16} />}
          <span>{notice.text}</span>
        </div>
      )}

      {!teach.active && !running && (
        <RecallPanel learning={learning} onLearn={() => void learnThisPage()} />
      )}

      <div
        className={"wizard" + (highlight ? " highlight" : "") + (running ? " running" : "")}
        aria-busy={running || learning}
        data-site-version={site.version}
      >
        <ol className="steps-bar">
          {site.steps.map((s, i) => (
            <li key={s.intent} className={i === stepIndex ? "on" : i < stepIndex ? "done" : ""}>
              <span className="dot">{i + 1}</span>
              <span className="step-name">{s.intent}</span>
            </li>
          ))}
        </ol>
        <h3>
          Step {stepIndex + 1} of {site.steps.length}: {step.intent}
        </h3>

        {/*
          Declarative WebMCP: verified attribute names are toolname,
          tooldescription and toolparamdescription. toolautosubmit is
          deliberately omitted - the human owns the submit.
        */}
        <form
          ref={formRef}
          toolname="clinic_booking_form"
          tooldescription="Fill in the fields of the booking step currently on screen at Northside Family Clinic. This handles one step only and never submits by itself. To perform a whole booking the user has already demonstrated, call that flow's own tool instead."
          onSubmit={(e) => {
            e.preventDefault()
            advance()
          }}
        >
          {step.fields.length === 0 && (
            <p className="review">
              Nothing left to enter.{" "}
              {Object.keys(values).length > 0
                ? "Review your answers above and confirm."
                : "Confirm to finish the booking."}
            </p>
          )}
          {step.fields.map((f) => (
            <label key={f.purpose} className={"field" + (filling === f.purpose ? " filling" : "")}>
              <span>
                {f.label}
                {f.required ? <em aria-hidden="true"> *</em> : ""}
              </span>
              {f.type === "select" ? (
                <select
                  name={fieldName(f.purpose)}
                  required={!!f.required}
                  toolparamdescription={f.label}
                  value={values[f.purpose] ?? ""}
                  onChange={(e) => setField(f, e.target.value)}
                >
                  <option value="">Choose...</option>
                  {(f.options ?? []).map((o) => (
                    <option key={o} value={o}>
                      {o}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  name={fieldName(f.purpose)}
                  required={!!f.required}
                  toolparamdescription={f.label}
                  type={f.type === "tel" ? "tel" : f.type === "date" ? "date" : "text"}
                  value={values[f.purpose] ?? ""}
                  onChange={(e) => setField(f, e.target.value)}
                />
              )}
            </label>
          ))}
          <div className="row wizard-actions">
            {stepIndex > 0 && !running && (
              <button type="button" onClick={() => setStepIndex(stepIndex - 1)}>
                Back
              </button>
            )}
            <button type="submit" className="primary" disabled={running}>
              {step.submitLabel}
            </button>
          </div>
        </form>
      </div>

      {teach.done && <FinalizePanel />}

      {confirm && (
        <Modal
          title="Your agent is ready to submit"
          onEscape={() => confirm.resolve(false)}
          escapeHint="deny"
        >
          <p>
            Nothing has been sent yet. This is exactly what will be submitted when you approve
            {confirm.plan.length === 0 ? "." : ":"}
          </p>
          {confirm.plan.length > 0 && (
            <dl className="submit-preview">
              {confirm.plan.map((p) => (
                <div key={p.purpose}>
                  <dt>{p.label}</dt>
                  <dd>{p.value}</dd>
                </div>
              ))}
            </dl>
          )}
          <p className="sub">
            Approving clicks <b>{confirm.submitLabel}</b> on the clinic site.
          </p>
          <div className="modal-actions">
            <button className="deny" onClick={() => confirm.resolve(false)}>
              Deny
            </button>
            <button className="primary" data-autofocus="true" onClick={() => confirm.resolve(true)}>
              <IconCheck size={16} />
              Approve and submit
            </button>
          </div>
        </Modal>
      )}
    </div>
  )
}

/**
 * What this app already knows about the page in front of it.
 *
 * Three states, one action each. Before this existed the panel always offered
 * to learn, so visiting the site twice minted a duplicate flow.
 */
function RecallPanel({ learning, onLearn }: { learning: boolean; onLearn: () => void }) {
  const [recall, setRecall] = useState(recallForPage)
  useEffect(() => {
    const refresh = () => {
      // Child effects register before parent effects, so this hashchange
      // listener runs before App's does. Without syncing first, a switch to
      // ?v=2 would recall against the previous version and report a hit on a
      // page that had just changed.
      syncSiteVersion()
      setRecall(recallForPage())
    }
    refresh()
    const offStore = subscribe(refresh)
    window.addEventListener("hashchange", refresh)
    return () => {
      offStore()
      window.removeEventListener("hashchange", refresh)
    }
  }, [])

  const stale = recall.flows.filter((f) => f.state === "stale")
  const questions = stale.flatMap((f) => f.questions ?? [])

  if (recall.state === "miss") {
    return (
      <div className="recall miss">
        <div className="recall-head">
          <IconRead size={17} />
          <b>Nothing known about this page yet</b>
          <span className="fp">cache miss</span>
        </div>
        <span>
          It can read the form, walk the steps with throwaway values, and mint a tool from what it finds. No
          demonstration. It will not press a button unless that button says "next".
        </span>
        <div className="row">
          <button className="primary" onClick={onLearn} disabled={learning}>
            <IconRead size={17} />
            {learning ? "Reading the page..." : "Learn automatically"}
          </button>
          <a className="ghost-link" href={siteHash("teach=1")}>
            watch me fill it in
          </a>
        </div>
      </div>
    )
  }

  if (recall.state === "hit") {
    return (
      <div className="recall hit">
        <div className="recall-head">
          <IconCheck size={17} />
          <b>Already known: {recall.flows.map((f) => f.name).join(", ")}</b>
          <span className="fp">cache hit · {recall.fingerprint}</span>
        </div>
        <span>
          The page still hashes to what was stored, so there is nothing to re-read and nothing to ask. Run it from
          your flows, or ask an agent to.
        </span>
        <div className="row">
          <a className="cta" href="#/flows">
            Go to flows
          </a>
          <a className="ghost-link" href={siteHash("teach=1")}>
            teach another flow here
          </a>
        </div>
      </div>
    )
  }

  return (
    <div className="recall stale">
      <div className="recall-head">
        <IconAlert size={17} />
        <b>Known, but this page changed</b>
        <span className="fp">cache stale · {recall.fingerprint}</span>
      </div>
      <span>
        {stale.map((f) => f.name).join(", ")} no longer matches.{" "}
        {stale.flatMap((f) => f.changes ?? []).length} change(s) detected,{" "}
        {questions.length === 0 ? "none need an answer" : `${questions.length} needs an answer`}. Everything else
        re-reads from the page.
      </span>
      <div className="row">
        <a className="cta" href="#/flows">
          Heal it
        </a>
      </div>
    </div>
  )
}

function FinalizePanel() {
  const teach = useTeach()
  const [name, setName] = useState(teach.flowName)
  const slug = slugify(name) || "my_flow"
  const chosen = teach.captured.filter((c) => c.isParam)

  return (
    <Modal title="Mint a tool from that demonstration" onEscape={teach.reset} escapeHint="discard">
      {teach.captured.length === 0 ? (
        <p>
          Nothing was captured, because no field was filled in. Discard this and demonstrate the task again, filling
          the form as you go.
        </p>
      ) : (
        <>
          <p>
            Captured {teach.captured.length} field(s). Tick the values your agent may change on each run. Everything
            else replays exactly as you demonstrated it.
          </p>
          <div className="row param-tools">
            <button type="button" onClick={() => teach.setAllParams(true)}>
              Select all
            </button>
            <button type="button" onClick={() => teach.setAllParams(false)}>
              Select none
            </button>
          </div>
          <div className="param-list">
            {teach.captured.map((c) => (
              <label key={c.fieldPurpose} className="param-row">
                <input type="checkbox" checked={c.isParam} onChange={() => teach.toggleParam(c.fieldPurpose)} />
                <span>
                  <b>{c.label}</b>
                  <small>you entered: {c.value || "nothing"}</small>
                </span>
              </label>
            ))}
          </div>
        </>
      )}

      <label className="field">
        <span>Tool name</span>
        <input value={name} data-autofocus="true" onChange={(e) => setName(e.target.value)} />
      </label>
      <p className="sub">
        Your agent will call it <code>{slug}</code> with {chosen.length} parameter(s)
        {chosen.length ? `: ${chosen.map((c) => c.label).join(", ")}` : " and replay your demo values"}.
      </p>
      {chosen.length === 0 && teach.captured.length > 0 && (
        <p className="hint-warn">
          <IconAlert size={15} />
          <span>
            With nothing ticked, every run books the exact same appointment. Tick at least one value to let the agent
            vary it.
          </span>
        </p>
      )}

      <div className="modal-actions">
        <button className="deny" onClick={teach.reset} disabled={teach.minting}>
          <IconTrash size={16} />
          Discard
        </button>
        <button className="primary" disabled={teach.minting} onClick={() => void teach.finalize(name)}>
          {teach.minting ? "Minting..." : "Mint tool"}
        </button>
      </div>
    </Modal>
  )
}
