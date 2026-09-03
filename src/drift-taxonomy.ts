import { ChangeType } from "./types"

/**
 * The drift taxonomy: every way a page can move, and who repairs it.
 *
 * This exists as a registry rather than as eight inline string literals for
 * three reasons. It is the thing an agent needs in order to EXPLAIN a change
 * rather than just report one. It is testable, so a change type cannot be
 * added without saying where its repair comes from. And it states the
 * governing principle once instead of scattering a boolean across the
 * detector:
 *
 *   A change heals from the page when the new truth is ON the page.
 *   A change needs a human when it requires a value nobody has ever supplied.
 *
 * That single rule decides every row below. A rename heals because the new
 * label is right there. A new required field cannot, because no amount of
 * reading the page tells you somebody's insurance number. Everything else is
 * an application of that distinction, which is also why this app asks exactly
 * one question about the v2 redesign instead of four.
 */

export type HealedBy = "page" | "human"

export interface ChangeKind {
  id: ChangeType
  /** Short label for a UI chip. */
  label: string
  /** What actually happened to the page. */
  meaning: string
  /** Where the repair comes from, by default. */
  healedBy: HealedBy
  /** Why it is classified that way, in one sentence. */
  why: string
}

export const CHANGES: Record<ChangeType, ChangeKind> = {
  RENAMED: {
    id: "RENAMED",
    label: "renamed",
    meaning: "A field kept its purpose but got a new visible label.",
    healedBy: "page",
    why: "The new label is on the page, and the purpose it maps to never moved.",
  },
  REORDERED: {
    id: "REORDERED",
    label: "reordered",
    meaning: "The steps are in a different sequence.",
    healedBy: "page",
    why: "Order is read from the page; the task itself is unchanged.",
  },
  WORDING: {
    id: "WORDING",
    label: "reworded",
    meaning: "A button says something different.",
    healedBy: "page",
    why: "The new wording is on the page, and no stored value depends on it.",
  },
  REMOVED_FIELD: {
    id: "REMOVED_FIELD",
    label: "field removed",
    meaning: "A field the task used to fill is gone.",
    healedBy: "page",
    why: "Nothing needs supplying for a field that no longer exists.",
  },
  REMOVED_STEP: {
    id: "REMOVED_STEP",
    label: "step removed",
    meaning: "A whole step disappeared.",
    healedBy: "page",
    why: "The remaining steps are still readable, so the task simply got shorter.",
  },
  NEW_STEP: {
    id: "NEW_STEP",
    label: "step added",
    meaning: "A step exists that was not there before.",
    healedBy: "page",
    why: "The step's shape is readable; only its required fields can need an answer.",
  },
  ROUTE_CHANGED: {
    id: "ROUTE_CHANGED",
    label: "moved",
    meaning: "A step lives at a different URL.",
    healedBy: "page",
    why: "The new address is where the page was found, so it is already known.",
  },
  NEW_FIELD: {
    id: "NEW_FIELD",
    label: "field added",
    meaning: "A field appeared that the task has never filled.",
    healedBy: "human",
    why: "If it is required, no amount of reading the page reveals what to put in it.",
  },
  TYPE_CHANGED: {
    id: "TYPE_CHANGED",
    label: "type changed",
    meaning: "A field changed kind, for example free text became a fixed list.",
    healedBy: "page",
    why:
      "The new kind is readable. It only needs a human when the stored value is no longer " +
      "acceptable to it, which is reported as a rejected value rather than as this change.",
  },
  OPTIONS_CHANGED: {
    id: "OPTIONS_CHANGED",
    label: "choices changed",
    meaning: "A list of choices gained or lost entries.",
    healedBy: "page",
    why:
      "A longer or shorter list is just readable. It escalates to a human only when the value " +
      "this task used to pick is no longer on it.",
  },
  REQUIRED_ADDED: {
    id: "REQUIRED_ADDED",
    label: "now required",
    meaning: "A field that used to be optional must now be filled.",
    healedBy: "human",
    why: "Optional fields are often left empty, so becoming required can expose a value nobody supplied.",
  },
  REQUIRED_RELAXED: {
    id: "REQUIRED_RELAXED",
    label: "no longer required",
    meaning: "A field that had to be filled is now optional.",
    healedBy: "page",
    why: "Fewer obligations never needs an answer.",
  },
}

/** Every change type, for docs and for the agent-facing taxonomy tool. */
export function taxonomy(): ChangeKind[] {
  return Object.values(CHANGES)
}

export function describeChange(type: ChangeType): ChangeKind {
  return CHANGES[type]
}

/**
 * The default source of repair for a change type.
 *
 * Detectors may override this for a specific instance: a changed option list
 * heals from the page in general, but not when the option this task relied on
 * is the one that vanished.
 */
export function healsFromPage(type: ChangeType): boolean {
  return CHANGES[type].healedBy === "page"
}
