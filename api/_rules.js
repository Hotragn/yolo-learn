/**
 * The rule ids the shared memory will accept.
 *
 * This is an allow-list, not documentation. /api/memory is a public write
 * endpoint, so anything a caller sends is untrusted, and the defence is to
 * store nothing that is not on this list: no free text, no rule names, no
 * element selectors, no details. A poisoned write can therefore only skew a
 * count for a rule that already exists, and cannot put a single character of
 * attacker-controlled content into anybody's page.
 *
 * src/__tests__/shared-memory.test.ts asserts this list matches the rules the
 * lenses actually emit, so the two cannot drift apart.
 */
export const KNOWN_RULE_IDS = [
  "wcag-4.1.2",
  "wcag-1.1.1",
  "wcag-3.3.2",
  "wcag-1.3.1",
  "wcag-1.4.3",
  "wcag-1.4.11",
  "wcag-2.5.8",
  "html-id-unique",
  "html-form-owner",
  "yolo-ungated-submit",
  "yolo-dead-end",
  "yolo-unreachable-required",
  "yolo-scale-drift",
  "yolo-tiny-text",
]

export const KNOWN_RULE_SET = new Set(KNOWN_RULE_IDS)
