import { useCallback, useEffect, useState } from "react"
import { FieldSpec, getActiveSiteModel, TaughtFlow } from "./types"
import { setRunExecutor, RunResult } from "./runner"
import { beginTeaching, useTeach } from "./TeachMode"

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

function valueFor(flow: TaughtFlow, params: Record<string, unknown>, stepIntent: string, field: FieldSpec): string | undefined {
  const p = flow.params.find(
    (x) => x.sourceField.stepIntent === stepIntent && x.sourceField.fieldPurpose === field.purpose
  )
  if (p && params[p.key] != null) return String(params[p.key])
  if (flow.fieldValues[field.purpose]) return flow.fieldValues[field.purpose]
  if (flow.fieldAnswers?.[field.purpose]) return flow.fieldAnswers[field.purpose]
  return undefined
}

export default function SiteApp() {
  const site = getActiveSiteModel()
  const teach = useTeach()
  const [stepIndex, setStepIndex] = useState(0)
  const [values, setValues] = useState<Record<string, string>>({})
  const [flash, setFlash] = useState<string | null>(null)
  const [agentNote, setAgentNote] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<null | { resolve: (ok: boolean) => void }>(null)
  const [highlight, setHighlight] = useState(false)

  // Deep link: #/site?teach=1 activates teach mode without an agent
  useEffect(() => {
    const qs = new URLSearchParams(location.hash.split("?")[1] ?? "")
    if (qs.get("teach") === "1" && !teach.active) beginTeaching("book_appointment")
  }, [])

  const step = site.steps[stepIndex]

  // Agent run executor: drives this same wizard with animation + human confirm.
  useEffect(() => {
    setRunExecutor(async (flow, params, signal): Promise<RunResult> => {
      setAgentNote("Agent is running your flow...")
      const model = getActiveSiteModel()
      for (let i = 0; i < model.steps.length; i++) {
        if (signal.aborted) {
          setAgentNote(null)
          return { ok: false, confirmedByHuman: false, stepsExecuted: i, message: "Cancelled" }
        }
        setStepIndex(i)
        setHighlight(true)
        for (const field of model.steps[i].fields) {
          const v = valueFor(flow, params, model.steps[i].intent, field)
          if (v == null && field.required) {
            setAgentNote(null)
            setHighlight(false)
            return {
              ok: false, confirmedByHuman: false, stepsExecuted: i, needsHealing: true,
              message: `The site now requires "${field.label}" and the flow has no answer for it. Heal the flow first.`,
            }
          }
          if (v != null) setValues((prev) => ({ ...prev, [field.purpose]: v }))
        }
        await sleep(700)
        if (i < model.steps.length - 1) {
          setHighlight(false)
          await sleep(200)
        }
      }
      const approved = await new Promise<boolean>((resolve) => setConfirm({ resolve }))
      setAgentNote(null)
      setHighlight(false)
      if (!approved) {
        return { ok: false, confirmedByHuman: false, stepsExecuted: model.steps.length, message: "Human rejected the submit" }
      }
      const ref = `NSC-${Math.floor(1000 + Math.random() * 9000)}`
      setFlash(`Booked. Confirmation ${ref}`)
      setStepIndex(0)
      setValues({})
      return { ok: true, confirmedByHuman: true, stepsExecuted: model.steps.length, message: `Booking confirmed (${ref})` }
    })
    return () => setRunExecutor(null)
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
          isParam: true,
        })
      }
    },
    [step, teach]
  )

  const advance = () => {
    if (stepIndex < site.steps.length - 1) {
      setStepIndex(stepIndex + 1)
    } else if (teach.active) {
      teach.complete()
    } else {
      setFlash(`Booked. Confirmation NSC-${Math.floor(1000 + Math.random() * 9000)}`)
      setStepIndex(0)
      setValues({})
    }
  }

  return (
    <div className="site-wrap">
      {site.version === "2.0" && (
        <div className="banner">We've updated our booking experience. v{site.version}</div>
      )}
      <div className="site-head">
        <h2>Northside Family Clinic</h2>
        <div className="version-switch">
          <a href="#/site?v=1" className={site.version === "1.0" ? "on" : ""}>v1</a>
          <a href="#/site?v=2" className={site.version === "2.0" ? "on" : ""}>v2</a>
          <a href="#/">library</a>
        </div>
      </div>

      {teach.active && !teach.done && <div className="teach-badge">Recording your demonstration</div>}
      {agentNote && <div className="agent-note">Agent: {agentNote}</div>}
      {flash && <div className="flash">{flash}</div>}

      <div className={"wizard " + (highlight ? "highlight" : "")}>
        <div className="steps-bar">
          {site.steps.map((s, i) => (
            <span key={s.intent} className={i === stepIndex ? "on" : i < stepIndex ? "done" : ""}>
              {i + 1}
            </span>
          ))}
        </div>
        <h3>
          Step {stepIndex + 1}: {step.intent}
        </h3>
        {/* Declarative WebMCP exposure: verify attribute names against the current spec */}
        <form
          toolname="clinic_booking_form"
          tooldescription="Book an appointment at Northside Family Clinic"
          onSubmit={(e) => {
            e.preventDefault()
            advance()
          }}
        >
          {step.fields.map((f) => (
            <label key={f.purpose} className="field">
              <span>
                {f.label}
                {f.required ? " *" : ""}
              </span>
              {f.type === "select" ? (
                <select
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
                  toolparamdescription={f.label}
                  type={f.type === "tel" ? "tel" : f.type === "date" ? "date" : "text"}
                  value={values[f.purpose] ?? ""}
                  onChange={(e) => setField(f, e.target.value)}
                />
              )}
            </label>
          ))}
          <button type="submit">{step.submitLabel}</button>
        </form>
      </div>

      {teach.done && <FinalizePanel />}

      {confirm && (
        <div className="modal-backdrop">
          <div className="modal">
            <h3>Agent wants to submit</h3>
            <p>Your agent finished the booking flow and is waiting for your approval to submit.</p>
            <div className="modal-actions">
              <button
                className="deny"
                onClick={() => {
                  confirm.resolve(false)
                  setConfirm(null)
                }}
              >
                Deny
              </button>
              <button
                className="primary"
                onClick={() => {
                  confirm.resolve(true)
                  setConfirm(null)
                }}
              >
                Approve
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function FinalizePanel() {
  const teach = useTeach()
  const [name, setName] = useState(teach.flowName)
  return (
    <div className="modal-backdrop">
      <div className="modal">
        <h3>Create the tool</h3>
        <p>Your demonstration was captured. Mark which fields the agent may change.</p>
        {teach.captured.map((c) => (
          <label key={c.fieldPurpose} className="param-row">
            <input type="checkbox" checked={c.isParam} onChange={() => teach.toggleParam(c.fieldPurpose)} />
            <span>
              <b>{c.label}</b> <small>(demo value: {c.value || "none"})</small>
            </span>
          </label>
        ))}
        <label className="field">
          <span>Tool name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <div className="modal-actions">
          <button className="deny" onClick={() => teach.reset()}>
            Discard
          </button>
          <button
            className="primary"
            onClick={() => {
              teach.setName(name)
              teach.finalize()
            }}
          >
            Mint tool
          </button>
        </div>
      </div>
    </div>
  )
}
