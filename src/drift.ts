import {
  coerceValue,
  DriftChange,
  DriftQuestion,
  DriftReport,
  FieldSpec,
  SiteModel,
  StepSpec,
  TaughtFlow,
} from "./types"

// Deterministic drift detection. No ML, no heuristics, no guessing.
//
// Steps are matched by intent, fields by purpose - never by selector, label or
// position, all of which are exactly what a redesign changes. Renames,
// reorders, removals and wording changes carry no new information, so they
// heal from the site model alone. The only thing the app genuinely cannot know
// is a value it has never been told, so that - and only that - becomes a
// question for the human.

/** A value the flow already knows for this purpose, from the demo or from healing. */
export function storedValue(flow: TaughtFlow, purpose: string): string | undefined {
  const demo = flow.fieldValues?.[purpose]
  if (demo != null && demo !== "") return demo
  const answer = flow.fieldAnswers?.[purpose]
  if (answer != null && answer !== "") return answer
  return undefined
}

/**
 * The value the runner will type into a field.
 * Precedence: this run's params, then the demonstrated value, then a healed answer.
 * Params are matched by purpose, not by step, so a field that moves to another
 * step in a redesign stays bound to its parameter.
 */
export function valueForField(
  flow: TaughtFlow,
  params: Record<string, unknown>,
  field: FieldSpec
): string | undefined {
  const param = flow.params.find((p) => p.sourceField.fieldPurpose === field.purpose)
  if (param) {
    const raw = params[param.key]
    if (raw != null && coerceValue(raw) !== "") return coerceValue(raw)
  }
  return storedValue(flow, field.purpose)
}

function commonIntents(flow: TaughtFlow, current: SiteModel): { taught: string[]; now: string[] } {
  const taughtIntents = flow.steps.map((s) => s.intent)
  const currentIntents = current.steps.map((s) => s.intent)
  return {
    taught: taughtIntents.filter((i) => currentIntents.includes(i)),
    now: currentIntents.filter((i) => taughtIntents.includes(i)),
  }
}

function questionFor(field: FieldSpec): DriftQuestion {
  return {
    id: `q_${field.purpose.replace(/[^a-z0-9]+/gi, "_")}`,
    purpose: field.purpose,
    label: field.label,
    question: `The site now asks for "${field.label}". What should I answer?`,
  }
}

export function detectDrift(flow: TaughtFlow, current: SiteModel): DriftReport {
  const changes: DriftChange[] = []
  const questions: DriftQuestion[] = []
  const needsAnswer = (f: FieldSpec) => !!f.required && storedValue(flow, f.purpose) === undefined

  const taughtByIntent = new Map<string, StepSpec>(flow.steps.map((s) => [s.intent, s]))

  for (const curStep of current.steps) {
    const taughtStep = taughtByIntent.get(curStep.intent)

    if (!taughtStep) {
      const unanswered = curStep.fields.filter(needsAnswer)
      changes.push({
        type: "NEW_STEP",
        description: `A new step "${curStep.intent}" was added to the site`,
        autoHealable: unanswered.length === 0,
      })
      continue
    }

    for (const curField of curStep.fields) {
      const taughtField = taughtStep.fields.find((f) => f.purpose === curField.purpose)
      if (!taughtField) {
        changes.push({
          type: "NEW_FIELD",
          description: `New field "${curField.label}" appeared in "${curStep.intent}"`,
          autoHealable: !needsAnswer(curField),
        })
      } else if (taughtField.label !== curField.label) {
        changes.push({
          type: "RENAMED",
          description: `"${taughtField.label}" is now labeled "${curField.label}"`,
          autoHealable: true,
        })
      }
    }

    for (const taughtField of taughtStep.fields) {
      if (!curStep.fields.some((f) => f.purpose === taughtField.purpose)) {
        changes.push({
          type: "REMOVED_FIELD",
          description: `Field "${taughtField.label}" was removed from "${curStep.intent}"`,
          autoHealable: true,
        })
      }
    }

    if (taughtStep.submitLabel !== curStep.submitLabel) {
      changes.push({
        type: "WORDING",
        description: `Button "${taughtStep.submitLabel}" is now "${curStep.submitLabel}"`,
        autoHealable: true,
      })
    }
  }

  for (const taughtStep of flow.steps) {
    if (!current.steps.some((s) => s.intent === taughtStep.intent)) {
      changes.push({
        type: "REMOVED_STEP",
        description: `Step "${taughtStep.intent}" no longer exists on the site`,
        autoHealable: true,
      })
    }
  }

  // One reorder is one change. Reporting it per-step would double-count a
  // single swap and misstate what actually happened.
  const { taught, now } = commonIntents(flow, current)
  const firstDiff = now.findIndex((intent, i) => intent !== taught[i])
  if (firstDiff >= 0) {
    changes.push({
      type: "REORDERED",
      description: `Steps were reordered: "${now[firstDiff]}" now comes before "${taught[firstDiff]}"`,
      autoHealable: true,
    })
  }

  // Questions come from missing values, not from missing fields. A field the
  // user answered once needs no second answer, and a field healed with an
  // empty answer is still unanswered - so it gets asked again instead of
  // leaving the flow permanently stuck as "healthy but unrunnable".
  for (const curStep of current.steps) {
    for (const field of curStep.fields) {
      if (needsAnswer(field) && !questions.some((q) => q.purpose === field.purpose)) {
        questions.push(questionFor(field))
      }
    }
  }

  const status = changes.length || questions.length ? "drifted" : "healthy"
  return { status, summary: summarize(changes, questions), changes, questions }
}

/**
 * A flow that has never run is "never run", not "healthy" - claiming health
 * for something untested would be exactly the kind of fake confidence this
 * app exists to replace.
 */
export function effectiveStatus(flow: TaughtFlow, report: DriftReport): TaughtFlow["status"] {
  if (report.status === "drifted") return "drifted"
  return flow.runCount > 0 ? "healthy" : "never_run"
}

function summarize(changes: DriftChange[], questions: DriftQuestion[]): string {
  if (!changes.length && !questions.length) return "No changes. This flow still matches the site."
  const parts = [`${changes.length} change${changes.length === 1 ? "" : "s"} since this flow was taught`]
  const auto = changes.filter((c) => c.autoHealable).length
  if (auto) parts.push(`${auto} heal${auto === 1 ? "s" : ""} automatically`)
  parts.push(
    questions.length
      ? `${questions.length} need${questions.length === 1 ? "s" : ""} an answer from you`
      : "nothing needs an answer"
  )
  return parts.join(", ") + "."
}

export interface HealResult {
  flow: TaughtFlow
  applied: string[]
  remainingQuestions: DriftQuestion[]
}

/**
 * Snapshot the current site into the flow and record the human's answers.
 * The healed status is recomputed rather than asserted: an empty or missing
 * answer leaves the flow drifted with the question still open.
 */
export function healFlow(flow: TaughtFlow, current: SiteModel, answers: Record<string, string>): HealResult {
  const before = detectDrift(flow, current)
  const fieldAnswers: Record<string, string> = { ...(flow.fieldAnswers ?? {}) }
  const applied: string[] = []

  for (const q of before.questions) {
    const raw = answers[q.id] ?? answers[q.purpose]
    const value = coerceValue(raw).trim()
    if (value) {
      fieldAnswers[q.purpose] = value
      applied.push(q.label)
    }
  }

  const healed: TaughtFlow = {
    ...flow,
    steps: current.steps.map((s) => ({ ...s, fields: s.fields.map((f) => ({ ...f })) })),
    fieldAnswers,
    lastHealedAt: new Date().toISOString(),
    status: "healthy",
  }

  const after = detectDrift(healed, current)
  healed.status = after.status === "healthy" ? "healthy" : "drifted"
  return { flow: healed, applied, remainingQuestions: after.questions }
}
