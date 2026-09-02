import { DriftChange, DriftQuestion, DriftReport, SiteModel, TaughtFlow } from "./types"

// Deterministic drift detection: match steps by intent, fields by purpose.
// Renamed/reordered/removed/wording changes auto-heal.
// Only new required fields generate a human question.

export function detectDrift(flow: TaughtFlow, current: SiteModel): DriftReport {
  const changes: DriftChange[] = []
  const questions: DriftQuestion[] = []

  for (const curStep of current.steps) {
    const taughtStep = flow.steps.find((s) => s.intent === curStep.intent)
    if (!taughtStep) {
      changes.push({ type: "REMOVED_STEP", description: `Step "${curStep.intent}" is new since this flow was taught`, autoHealable: false })
      continue
    }
    for (const curField of curStep.fields) {
      const taughtField = taughtStep.fields.find((f) => f.purpose === curField.purpose)
      if (!taughtField) {
        changes.push({ type: "NEW_FIELD", description: `New field "${curField.label}" appeared in "${curStep.intent}"`, autoHealable: false })
        if (curField.required) {
          questions.push({
            id: `q_${curField.purpose}`,
            purpose: curField.purpose,
            question: `The site now asks for "${curField.label}". What should I answer?`,
          })
        }
      } else if (taughtField.label !== curField.label) {
        changes.push({ type: "RENAMED", description: `"${taughtField.label}" is now labeled "${curField.label}"`, autoHealable: true })
      }
    }
    for (const taughtField of taughtStep.fields) {
      if (!curStep.fields.some((f) => f.purpose === taughtField.purpose)) {
        changes.push({ type: "REMOVED_FIELD", description: `Field "${taughtField.label}" was removed from "${curStep.intent}"`, autoHealable: true })
      }
    }
    if (taughtStep.submitLabel !== curStep.submitLabel) {
      changes.push({ type: "WORDING", description: `Button "${taughtStep.submitLabel}" is now "${curStep.submitLabel}"`, autoHealable: true })
    }
    if (taughtStep.order !== curStep.order) {
      changes.push({ type: "REORDERED", description: `"${curStep.intent}" moved from step ${taughtStep.order} to step ${curStep.order}`, autoHealable: true })
    }
  }

  for (const taughtStep of flow.steps) {
    if (!current.steps.some((s) => s.intent === taughtStep.intent)) {
      changes.push({ type: "REMOVED_STEP", description: `Step "${taughtStep.intent}" no longer exists on the site`, autoHealable: true })
    }
  }

  return { status: changes.length ? "drifted" : "healthy", changes, questions }
}

export function healFlow(flow: TaughtFlow, current: SiteModel, answers: Record<string, string>): TaughtFlow {
  const fieldAnswers: Record<string, string> = { ...(flow.fieldAnswers ?? {}) }
  for (const q of detectDrift(flow, current).questions) {
    if (answers[q.id]) fieldAnswers[q.purpose] = answers[q.id]
  }
  return {
    ...flow,
    steps: current.steps.map((s) => ({ ...s, fields: s.fields.map((f) => ({ ...f })) })),
    fieldAnswers,
    status: "healthy",
    lastHealedAt: new Date().toISOString(),
  }
}
