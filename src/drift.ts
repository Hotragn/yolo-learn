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
import { healsFromPage } from "./drift-taxonomy"

// Deterministic drift detection. No ML, no heuristics, no guessing.
//
// Steps are matched by intent, fields by purpose - never by selector, label or
// position, all of which are exactly what a redesign changes. Renames,
// reorders, removals and wording changes carry no new information, so they
// heal from the site model alone. The only thing the app genuinely cannot know
// is a value it has never been told, so that - and only that - becomes a
// question for the human.

/** Order-sensitive option comparison. A reordered list is still a changed list. */
function sameOptions(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i])
}

function squash(v: string): string {
  return v.trim().replace(/\s+/g, " ").toLowerCase()
}

/**
 * The value this task relies on, when the page no longer offers it.
 *
 * The case that used to fail silently, and the reason OPTIONS_CHANGED exists.
 * A select that drops "dental cleaning" leaves a stored task pointing at a
 * choice the page will not accept, and filling it submits an empty field with
 * no error at all. Detecting it turns a silent wrong answer into one question.
 */
export function rejectedChoice(flow: TaughtFlow, field: FieldSpec): string | undefined {
  if (!field.options?.length) return undefined
  const stored = storedValue(flow, field.purpose)
  if (!stored) return undefined
  return field.options.some((o) => squash(o) === squash(stored)) ? undefined : stored
}

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

function questionFor(field: FieldSpec, rejected?: string): DriftQuestion {
  const id = `q_${field.purpose.replace(/[^a-z0-9]+/gi, "_")}`
  // A withdrawn choice is a different question from a brand new field, and
  // saying which one it is saves the user working it out.
  if (rejected) {
    return {
      id,
      purpose: field.purpose,
      label: field.label,
      question:
        `"${field.label}" no longer offers "${rejected}", which this task used to pick. ` +
        `Choose from: ${(field.options ?? []).join(", ")}.`,
    }
  }
  return {
    id,
    purpose: field.purpose,
    label: field.label,
    question: `The site now asks for "${field.label}". What should I answer?`,
  }
}

export function detectDrift(flow: TaughtFlow, current: SiteModel): DriftReport {
  const changes: DriftChange[] = []
  const questions: DriftQuestion[] = []

  // A field the flow declares as a parameter is the caller's responsibility:
  // it is in the tool's input schema, marked required when there is no stored
  // fallback, so asking the human about it would be asking the wrong party.
  // This is what lets an autonomously learned flow - every field a parameter,
  // no invented values - come out of discovery with nothing to ask.
  const parameterised = new Set(flow.params.map((p) => p.sourceField.fieldPurpose))
  // Required, not supplied by a parameter, and either nothing stored OR a
  // stored value the page no longer offers. That second case is the one that
  // used to submit an empty field with no error.
  const needsAnswer = (f: FieldSpec) =>
    !!f.required &&
    !parameterised.has(f.purpose) &&
    (storedValue(flow, f.purpose) === undefined || rejectedChoice(flow, f) !== undefined)

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
        continue
      }

      // Independent checks rather than an else-if chain: a real release
      // happily renames a field AND changes its choices at the same time.
      if (taughtField.label !== curField.label) {
        changes.push({
          type: "RENAMED",
          description: `"${taughtField.label}" is now labeled "${curField.label}"`,
          autoHealable: healsFromPage("RENAMED"),
        })
      }

      if (taughtField.type !== curField.type) {
        changes.push({
          type: "TYPE_CHANGED",
          description: `"${curField.label}" changed from ${taughtField.type} to ${curField.type}`,
          autoHealable: healsFromPage("TYPE_CHANGED"),
        })
      }

      const before = taughtField.options ?? []
      const after = curField.options ?? []
      if (!sameOptions(before, after)) {
        const gone = before.filter((o) => !after.includes(o))
        const added = after.filter((o) => !before.includes(o))
        const rejected = rejectedChoice(flow, curField)
        const parts: string[] = []
        if (added.length) parts.push(`added ${added.join(", ")}`)
        if (gone.length) parts.push(`dropped ${gone.join(", ")}`)
        changes.push({
          type: "OPTIONS_CHANGED",
          description:
            `Choices for "${curField.label}" changed: ${parts.join(" and ")}` +
            (rejected ? `. This task used "${rejected}", which is no longer offered` : ""),
          // Overrides the taxonomy default on purpose: a longer list is just
          // readable, but a list that dropped OUR value needs a human.
          autoHealable: !rejected,
        })
      }

      if (!taughtField.required && curField.required) {
        changes.push({
          type: "REQUIRED_ADDED",
          description: `"${curField.label}" is now required`,
          autoHealable: !needsAnswer(curField),
        })
      } else if (taughtField.required && !curField.required) {
        changes.push({
          type: "REQUIRED_RELAXED",
          description: `"${curField.label}" is no longer required`,
          autoHealable: healsFromPage("REQUIRED_RELAXED"),
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

    // A step that moved to a different URL. Auto-healable, because the new
    // route is right there on the page: the flow just has to be told.
    const was = taughtStep.route
    const now = curStep.route
    if (was && now && (was.path !== now.path || was.hash !== now.hash)) {
      changes.push({
        type: "ROUTE_CHANGED",
        description:
          `Step "${curStep.intent}" moved from ${was.hash ?? was.path} to ${now.hash ?? now.path}`,
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
        questions.push(questionFor(field, rejectedChoice(flow, field)))
      }
    }
  }

  const status = changes.length || questions.length ? "drifted" : "healthy"
  return { status, summary: summarize(changes, questions), changes, questions }
}

/**
 * A digest of a page's structure: step order, intents, button labels, and each
 * field's purpose, type, requiredness and option list.
 *
 * This is the ETag in the cache. Two pages that hash the same are the same
 * task as far as this app is concerned, so a match means there is nothing to
 * diff and nothing to heal. Deliberately does NOT include labels: a rename is
 * drift the engine heals from the page, not a different task.
 */
export function fingerprintSteps(steps: StepSpec[]): string {
  const canonical = steps
    .map((step) =>
      [
        step.order,
        step.intent,
        step.submitLabel,
        step.fields
          .map((f) => `${f.purpose}:${f.type}:${f.required ? 1 : 0}:${(f.options ?? []).join("|")}`)
          .join(";"),
      ].join("~")
    )
    .join("//")

  // FNV-1a. Deterministic, dependency-free, and this is a cache key rather
  // than a security boundary, so a 32-bit non-cryptographic hash is right.
  let hash = 0x811c9dc5
  for (let i = 0; i < canonical.length; i++) {
    hash ^= canonical.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, "0")
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
  // "learned" covers both paths; "taught" would be wrong for a flow that was
  // discovered by reading the page.
  const parts = [`${changes.length} change${changes.length === 1 ? "" : "s"} since this flow was learned`]
  const auto = changes.filter((c) => c.autoHealable).length
  if (auto) parts.push(`${auto} heal${auto === 1 ? "s" : ""} automatically`)
  parts.push(
    questions.length
      ? `${questions.length} need${questions.length === 1 ? "s" : ""} an answer from you`
      : "nothing needs an answer"
  )
  return parts.join(", ") + "."
}

/** Alias so recall.ts can name the report's parts without importing types.ts. */
export type DriftReportOf = DriftReport

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
    // Healing re-reads the page, so the cached fingerprint has to move with it.
    // Leaving the old one would keep the flow permanently stale.
    structureFingerprint: fingerprintSteps(current.steps),
    lastHealedAt: new Date().toISOString(),
    status: "healthy",
  }

  const after = detectDrift(healed, current)
  healed.status = after.status === "healthy" ? "healthy" : "drifted"
  return { flow: healed, applied, remainingQuestions: after.questions }
}
