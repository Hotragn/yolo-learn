import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { fieldName, FieldSpec, getActiveSiteModel, slugify } from "./types"
import { valueForField } from "./drift"
import { setRunExecutor, RunResult } from "./runner"
import { logEvent } from "./store"
import { beginTeaching, useTeach } from "./TeachMode"
import { Modal } from "./Modal"

interface PlanItem {
  stepIndex: number
  purpose: string
  label: string
  value: string
}

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
  const formRef = useRef<HTMLFormElement>(null)
  // Mirrors `confirm` so unmount can settle a pending approval. Leaving the
  // page while the dialog is open would otherwise hang the agent's promise
  // forever, and a hung tool call is worse than a denied one.
  const pendingConfirm = useRef<ConfirmState | null>(null)

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
  useEffect(() => {
    const qs = new URLSearchParams(location.hash.split("?")[1] ?? "")
    if (qs.get("teach") === "1" && !teach.active && !teach.done) beginTeaching("book_appointment")
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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

  const step = site.steps[Math.min(stepIndex, site.steps.length - 1)]

  // The agent's run executor. It drives this same wizard on screen, so the
  // human watches every keystroke and holds the only submit button.
  useEffect(() => {
    setRunExecutor(async (flow, params, signal): Promise<RunResult> => {
      const model = getActiveSiteModel()

      // Pre-flight the whole plan before touching the form. Bailing out
      // half-filled would leave the wizard in a state the user has to undo.
      const plan: PlanItem[] = []
      for (let i = 0; i < model.steps.length; i++) {
        for (const field of model.steps[i].fields) {
          const value = valueForField(flow, params, field)
          if (value == null || value === "") {
            if (field.required) {
              return {
                ok: false,
                confirmedByHuman: false,
                stepsExecuted: 0,
                needsHealing: true,
                message: `The site requires "${field.label}" and this flow has no value for it. Heal the flow, then run it again.`,
              }
            }
            continue
          }
          plan.push({ stepIndex: i, purpose: field.purpose, label: field.label, value })
        }
      }

      if (signal.aborted) {
        return { ok: false, confirmedByHuman: false, stepsExecuted: 0, message: "Cancelled before the run started." }
      }

      setRunning(true)
      setValues({})
      setNotice(null)
      setAgentNote("filling in your flow, step by step")

      try {
        for (let i = 0; i < model.steps.length; i++) {
          if (signal.aborted) {
            resetWizard()
            return { ok: false, confirmedByHuman: false, stepsExecuted: i, message: "Cancelled mid-run." }
          }
          setStepIndex(i)
          setHighlight(true)
          for (const item of plan.filter((p) => p.stepIndex === i)) {
            setFilling(item.purpose)
            setValues((prev) => ({ ...prev, [item.purpose]: item.value }))
            setAgentNote(`typing "${item.value}" into ${item.label}`)
            await wait(FIELD_PAUSE, signal)
          }
          setFilling(null)
          if (!model.steps[i].fields.length) setAgentNote(`reviewing ${model.steps[i].intent}`)
          await wait(STEP_PAUSE, signal)
          if (i < model.steps.length - 1) setHighlight(false)
        }

        if (signal.aborted) {
          resetWizard()
          return {
            ok: false,
            confirmedByHuman: false,
            stepsExecuted: model.steps.length,
            message: "Cancelled before asking for approval.",
          }
        }

        const submitLabel = model.steps[model.steps.length - 1].submitLabel
        setAgentNote("waiting for you to approve the submit")

        // Human confirmation before every submit, always. An abort while the
        // dialog is open resolves it as a denial instead of hanging the agent.
        const approved = await new Promise<boolean>((resolve) => {
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
        })

        const submitted = Object.fromEntries(plan.map((p) => [p.label, p.value]))

        if (!approved) {
          resetWizard()
          setNotice({ kind: "warn", text: signal.aborted ? "Run cancelled. Nothing was submitted." : "You denied the submit. Nothing was sent." })
          return {
            ok: false,
            confirmedByHuman: false,
            stepsExecuted: model.steps.length,
            message: signal.aborted
              ? "Cancelled while waiting for approval. Nothing was submitted."
              : "The user denied the submit. Nothing was submitted.",
            submitted,
          }
        }

        const reference = bookingRef()
        resetWizard()
        setNotice({ kind: "ok", text: `Booked. Confirmation ${reference}` })
        return {
          ok: true,
          confirmedByHuman: true,
          stepsExecuted: model.steps.length,
          message: `Booking confirmed, reference ${reference}`,
          submitted,
          reference,
        }
      } finally {
        setRunning(false)
        setAgentNote(null)
        setHighlight(false)
        setFilling(null)
      }
    })
    return () => {
      setRunExecutor(null)
      // Navigating away from the demo site mid-run counts as a denial:
      // nothing was submitted and the agent gets an answer, not a hang.
      pendingConfirm.current?.resolve(false)
    }
  }, [resetWizard])

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
          <b>We have updated our booking experience.</b> Version {site.version} is now live.
        </div>
      )}
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
          <span className="rec" aria-hidden="true" /> Recording your demonstration. {teachHint}
        </div>
      )}
      {agentNote && (
        <div className="agent-note" role="status">
          <b>Agent:</b> {agentNote}
        </div>
      )}
      {notice && (
        <div className={notice.kind === "ok" ? "flash" : "flash warn"} role="status">
          {notice.text}
        </div>
      )}

      <div className={"wizard" + (highlight ? " highlight" : "") + (running ? " running" : "")} aria-busy={running}>
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
              Approve and submit
            </button>
          </div>
        </Modal>
      )}
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
          With nothing ticked, every run books the exact same appointment. Tick at least one value to let the agent vary
          it.
        </p>
      )}

      <div className="modal-actions">
        <button className="deny" onClick={teach.reset} disabled={teach.minting}>
          Discard
        </button>
        <button className="primary" disabled={teach.minting} onClick={() => void teach.finalize(name)}>
          {teach.minting ? "Minting..." : "Mint tool"}
        </button>
      </div>
    </Modal>
  )
}
