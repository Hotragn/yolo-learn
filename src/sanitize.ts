/**
 * Strip everything personal out of a page snapshot before it is read.
 *
 * This handles HTML captured from a tab the user is LOGGED IN TO, which is the
 * most sensitive input this app accepts. The snapshot of a signed-in page
 * contains the user's own data in `value` attributes, their text inside
 * textareas, and session and CSRF tokens in hidden inputs. None of that is
 * needed: the only thing wanted is the SHAPE of the task, which lives in
 * labels, names, types and required flags.
 *
 * So the rule is subtractive rather than selective. Rather than hunting for
 * the fields that look dangerous and hoping the list is complete, it removes
 * every category of content that could carry a person's data, and keeps only
 * structure. Getting the danger list wrong then costs nothing, because the
 * values were already gone.
 *
 * Nothing here is a substitute for the architecture: `learnFromHtml` stores
 * only the extracted shape, never the markup. This is the second line, and it
 * is written as though it were the only one.
 */

/** Credential and payment autocomplete tokens, per the HTML spec's names. */
export const SENSITIVE_AUTOCOMPLETE =
  /^(current-password|new-password|one-time-code|cc-name|cc-number|cc-exp|cc-exp-month|cc-exp-year|cc-csc|cc-type)/i

/**
 * Field names that mean a credential or a national identifier, however spelled.
 *
 * `pin` uses an explicit non-alphanumeric boundary rather than `\b`, because
 * `_` is a word character: `\bpin\b` does not match `one_time_pin` or
 * `atm_pin`, which is exactly how such a field gets named. The lookarounds
 * still refuse `pineapple` and `spinning`.
 */
export const SENSITIVE_NAME =
  /(password|passwd|pwd|passcode|cvv|cvc|csc|card.?num|cardnumber|ccnum|ssn|social.?security|sort.?code|iban|routing|secret|token|otp|mfa|2fa|(?<![a-z0-9])pin(?![a-z0-9])|security.?(code|answer)|auth)/i

/**
 * An attribute run, quote-aware.
 *
 * `[^>]*` looks correct and is not: a ">" inside a quoted value ends the match
 * early, so `value="<b>Real Person</b>"` truncated the tag and left the name
 * behind in the output as text. That is legal HTML and precisely what a bio
 * field on a signed-in page contains. This consumes quoted runs whole before
 * it will accept a closing ">".
 */
const ATTRS = `(?:"[^"]*"|'[^']*'|[^>"'])*`

const TAG_WITH_ATTRS = new RegExp(`<(input|textarea|select|button)\\b(${ATTRS})>`, "gi")
const TEXTAREA_BODY = new RegExp(`(<textarea\\b${ATTRS}>)[\\s\\S]*?(</textarea\\s*>)`, "gi")
const OPTION_TAG = new RegExp(`<option\\b(${ATTRS})>`, "gi")

const ATTR = (name: string) => new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'>]+))`, "i")

function attrValue(attrs: string, name: string): string {
  const m = attrs.match(ATTR(name))
  return (m?.[1] ?? m?.[2] ?? m?.[3] ?? "").trim()
}

/** Does this control carry a credential, a card, or an identifier? */
export function attrsAreSensitive(attrs: string): boolean {
  const type = attrValue(attrs, "type").toLowerCase()
  if (type === "password") return true
  // Hidden inputs are where CSRF and session tokens live, and they contribute
  // nothing to the shape of a task, so they always go.
  if (type === "hidden") return true
  if (SENSITIVE_AUTOCOMPLETE.test(attrValue(attrs, "autocomplete"))) return true
  return SENSITIVE_NAME.test(`${attrValue(attrs, "name")} ${attrValue(attrs, "id")}`)
}

/**
 * Remove a `value`, `checked` or `selected` attribute from a control.
 *
 * On a signed-in page these hold the person's name, address, phone number and
 * whatever else the site already knows about them. The task's shape does not
 * depend on any of it.
 */
function dropValues(attrs: string): string {
  return attrs
    .replace(/\bvalue\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'>]+)/gi, "")
    .replace(/\b(checked|selected)(\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'>]+))?/gi, "")
    .replace(/\s{2,}/g, " ")
}

/**
 * An option's `value` is part of the site's vocabulary rather than the user's
 * data, so it stays; only the selection is removed.
 */
function dropValuesKeepOption(attrs: string): string {
  return attrs.replace(/\bselected(\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'>]+))?/gi, "").replace(/\s{2,}/g, " ")
}

export function stripSensitiveMarkup(html: string): string {
  if (!html) return ""

  let out = html
    // Scripts can carry bootstrapped user state as JSON. They never run in the
    // sandbox anyway and contribute nothing to a form's shape.
    .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, "")
    .replace(/<script\b[^>]*\/?>/gi, "")
    // Textarea content is, by definition, something a person typed.
    .replace(TEXTAREA_BODY, "$1$2")
    // Option labels are the site's vocabulary and are wanted; their selected
    // state is the user's choice and is not.
    .replace(OPTION_TAG, (_m: string, attrs: string) => `<option${dropValuesKeepOption(attrs)}>`)

  out = out.replace(TAG_WITH_ATTRS, (_whole: string, tag: string, attrs: string) => {
    if (attrsAreSensitive(attrs)) return ""
    return `<${tag}${dropValues(attrs)}>`
  })

  return out
}
