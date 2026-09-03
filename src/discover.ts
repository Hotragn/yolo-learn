import { classifySideEffect, FieldSpec, FieldType, slugify, StepSpec } from "./types"

/**
 * Autonomous flow discovery.
 *
 * Learns a multi-step form by reading the live DOM: labels, name attributes,
 * required flags, option lists, and the declarative WebMCP attributes. It
 * deliberately never imports the site model in types.ts - if it read our own
 * fixture the claim "it can learn a site nobody described to it" would be a
 * lie, and the whole point is that this works on a page it has never seen.
 *
 * Three rules keep it honest and safe:
 *
 *   1. It advances ONLY through a button whose label clearly means "next"
 *      (or where a "Step N of M" counter proves there is more to come). Any
 *      other button is treated as terminal and never clicked, so discovery
 *      cannot trip a real submit.
 *   2. The values it types are throwaway probes, used only to satisfy native
 *      validation so the next step will render. They are discarded.
 *   3. It stores no invented personal data. Every field it finds becomes a
 *      parameter the caller must supply, rather than a value the app made up.
 */

export interface DiscoveredFlow {
  intent: string
  toolName: string
  steps: StepSpec[]
  siteTitle: string
  /** Purpose -> probe value, for the audit trail. Never persisted as data. */
  probes: Record<string, string>
  notes: string[]
  /** Labels of credential or payment fields that were refused outright. */
  refused: string[]
}

export interface DiscoverResult {
  ok: boolean
  message: string
  flow?: DiscoveredFlow
}

const NEXT_LABEL = /^(next|continue|proceed|forward|onward)\b/i
const STEP_COUNTER = /step\s+(\d+)\s+of\s+(\d+)/i
// Real headings do use en and em dashes as separators, so the class has to
// match them. Written as unicode escapes so a copy-level dash purge cannot
// collapse them into an invalid range.
const STEP_PREFIX = /^\s*step\s+\d+(\s+of\s+\d+)?\s*[:.–—-]\s*/i

const settle = () =>
  new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resolve, 40)))
  })

/** React tracks its own value; the native setter plus events is what it listens for. */
function setNativeValue(el: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement, value: string) {
  const descriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), "value")
  if (descriptor?.set) descriptor.set.call(el, value)
  else el.value = value
  el.dispatchEvent(new Event("input", { bubbles: true }))
  el.dispatchEvent(new Event("change", { bubbles: true }))
}

function wizardForm(): HTMLFormElement | null {
  // A form carrying the declarative WebMCP attributes is telling us it is the
  // task, so prefer it. Fall back to the first form with controls.
  const declared = document.querySelector<HTMLFormElement>("form[toolname]")
  if (declared) return declared
  for (const form of document.querySelectorAll<HTMLFormElement>("form")) {
    if (form.querySelector("input, select, textarea")) return form
  }
  return document.querySelector("form")
}

function headingFor(form: HTMLFormElement): string {
  const scope = form.closest("section, div, main, article") ?? form.ownerDocument.body
  const heading = scope.querySelector("h1, h2, h3, h4, legend")
  return heading?.textContent?.trim() ?? ""
}

function intentFrom(form: HTMLFormElement, fields: FieldSpec[]): string {
  const heading = headingFor(form).replace(STEP_PREFIX, "").trim()
  if (heading) return heading.toLowerCase()
  const legend = form.querySelector("legend")?.textContent?.trim()
  if (legend) return legend.toLowerCase()
  // Nothing labelled the step, so describe it by what it asks for.
  return fields.length ? `provide ${fields.map((f) => f.purpose).join(", ")}` : "review and confirm"
}

/**
 * A field's purpose is the most stable identifier the page gives us. The name
 * attribute wins because it is what the server reads, so it survives visual
 * redesigns; a label is the first thing a redesign rewrites.
 */
function purposeOf(el: HTMLElement & { name?: string; id?: string }, label: string): string {
  const autocomplete = el.getAttribute("autocomplete")
  const fromName = el.name && el.name !== "select" ? slugify(el.name) : ""
  if (fromName) return fromName.replace(/_/g, " ")
  if (autocomplete && autocomplete !== "off" && autocomplete !== "on") {
    return autocomplete.replace(/^(shipping|billing)\s+/, "").replace(/-/g, " ")
  }
  if (el.id) return slugify(el.id).replace(/_/g, " ")
  return slugify(label).replace(/_/g, " ") || "field"
}

const stripRequiredMark = (text: string) => text.replace(/\s*\*\s*$/, "").trim()

/**
 * The human-readable text of a <label>, without the control it wraps.
 *
 * A wrapping label's textContent includes everything inside it, so a
 * <label>Year group <select><option>Year 3</option>...</select></label> reads
 * as "Year group Choose Year 3Year 4Year 5". Our own clinic happens to put its
 * text in a <span>, which is why this never showed up until the reader was
 * pointed at markup that does not.
 */
function labelText(labelEl: Element): string {
  const span = labelEl.querySelector("span")
  if (span?.textContent?.trim()) return stripRequiredMark(span.textContent)
  const clone = labelEl.cloneNode(true) as Element
  for (const control of clone.querySelectorAll("input, select, textarea, option, optgroup, button, datalist")) {
    control.remove()
  }
  return stripRequiredMark(clone.textContent ?? "")
}

function labelOf(el: HTMLElement): string {
  // element.labels is the DOM's own answer, and it covers both a wrapping
  // <label> and one associated by for/id. Hand-rolling that with a selector
  // needs CSS.escape, which is not guaranteed to exist and threw on real
  // markup that used an id.
  const labels = (el as HTMLInputElement).labels
  if (labels?.length) {
    const text = labelText(labels[0])
    if (text) return text
  }
  const wrapping = el.closest("label")
  if (wrapping) {
    const text = labelText(wrapping)
    if (text) return text
  }
  return (
    el.getAttribute("toolparamdescription") ??
    el.getAttribute("aria-label") ??
    el.getAttribute("placeholder") ??
    el.getAttribute("name") ??
    "Field"
  )
}

/**
 * Is this control actually on the page?
 *
 * offsetParent is the honest layout signal in a browser, but a DOM without a
 * layout engine reports null for everything, which would make discovery skip
 * every field. So the layout signal is only trusted when the document
 * demonstrably has layout.
 */
function isVisible(el: HTMLElement): boolean {
  if (el.hidden) return false
  if (el instanceof HTMLInputElement && el.type === "hidden") return false

  // Read display and visibility off the style ATTRIBUTE as well as the
  // computed style. A parsed document has no defaultView to compute in, so
  // relying on getComputedStyle alone let a display:none honeypot through as a
  // real field. Found by a test against markup with one in it.
  const inline = (el.getAttribute("style") ?? "").replace(/\s+/g, "").toLowerCase()
  if (inline.includes("display:none") || inline.includes("visibility:hidden")) return false

  const style = el.ownerDocument.defaultView?.getComputedStyle(el)
  if (style && (style.display === "none" || style.visibility === "hidden")) return false
  const hasLayout = el.ownerDocument.body.getBoundingClientRect().height > 0
  if (hasLayout && el.offsetParent === null) return false
  return true
}

/**
 * Fields this must never read, store, or fill.
 *
 * Discovery walks pages it has never seen, so sooner or later it meets a login
 * wall or a checkout form. A credential or a card number is not a "field it
 * learned" - it is something it has no business touching, and no amount of
 * user intent makes storing it acceptable. These are skipped entirely and
 * reported, so the flow stops with an explanation instead of quietly
 * capturing a password field's shape.
 */
const SENSITIVE_AUTOCOMPLETE =
  /^(current-password|new-password|cc-|one-time-code|cc-number|cc-exp|cc-csc)/i
const SENSITIVE_NAME = /(password|passwd|pwd|cvv|cvc|card.?number|ssn|secret|otp|pin)/i

export function isSensitive(el: HTMLElement): boolean {
  if (el instanceof HTMLInputElement && el.type === "password") return true
  const autocomplete = el.getAttribute("autocomplete") ?? ""
  if (SENSITIVE_AUTOCOMPLETE.test(autocomplete)) return true
  const name = `${el.getAttribute("name") ?? ""} ${el.getAttribute("id") ?? ""}`
  return SENSITIVE_NAME.test(name)
}

function typeOf(el: HTMLElement): FieldType {
  if (el instanceof HTMLSelectElement) return "select"
  const type = (el.getAttribute("type") ?? "text").toLowerCase()
  if (type === "date") return "date"
  if (type === "time") return "time"
  if (type === "tel") return "tel"
  return "text"
}

function readFields(form: HTMLFormElement, refused: string[]): FieldSpec[] {
  const fields: FieldSpec[] = []
  const controls = form.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(
    "input, select, textarea"
  )
  for (const el of controls) {
    if (el instanceof HTMLInputElement && ["submit", "button", "hidden", "image", "reset"].includes(el.type)) continue
    if (el.disabled || !isVisible(el)) continue
    if (isSensitive(el)) {
      const refusedLabel = labelOf(el)
      if (!refused.includes(refusedLabel)) refused.push(refusedLabel)
      continue
    }
    const label = labelOf(el)
    const purpose = purposeOf(el, label)
    if (fields.some((f) => f.purpose === purpose)) continue
    const options =
      el instanceof HTMLSelectElement ? [...el.options].map((o) => o.value).filter((v) => v !== "") : undefined
    fields.push({
      purpose,
      label,
      type: typeOf(el),
      ...(options?.length ? { options } : {}),
      required: el.required,
    })
  }
  return fields
}

function submitButton(form: HTMLFormElement): HTMLButtonElement | HTMLInputElement | null {
  return form.querySelector<HTMLButtonElement | HTMLInputElement>(
    'button[type="submit"], input[type="submit"], button:not([type])'
  )
}

function labelOfButton(btn: HTMLButtonElement | HTMLInputElement | null): string {
  if (!btn) return ""
  return (btn instanceof HTMLInputElement ? btn.value : btn.textContent ?? "").trim()
}

/** A probe only has to be valid, not meaningful. It is thrown away. */
function probeFor(field: FieldSpec): string {
  if (field.options?.length) return field.options[0]
  switch (field.type) {
    case "date": {
      const d = new Date()
      d.setDate(d.getDate() + 14)
      return d.toISOString().slice(0, 10)
    }
    case "time":
      return "10:00"
    case "tel":
      return "5550100"
    default:
      return field.purpose.includes("email") ? "probe@example.invalid" : "probe"
  }
}

function fillProbes(form: HTMLFormElement, fields: FieldSpec[], probes: Record<string, string>) {
  const controls = [
    ...form.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>("input, select, textarea"),
  ]
  for (const field of fields) {
    if (!field.required) continue
    const el = controls.find((c) => {
      if (c instanceof HTMLInputElement && ["submit", "button", "hidden"].includes(c.type)) return false
      return purposeOf(c, labelOf(c)) === field.purpose
    })
    if (!el || el.value) continue
    const probe = probeFor(field)
    setNativeValue(el, probe)
    probes[field.purpose] = probe
  }
}

function nameFrom(form: HTMLFormElement): string {
  const declared = form.getAttribute("toolname")
  if (declared) return slugify(declared).replace(/_?(form|wizard)$/, "") || slugify(declared)
  const title = document.querySelector("h2, h1")?.textContent ?? document.title
  return slugify(title).slice(0, 40) || "learned_flow"
}

export interface DiscoverOptions {
  maxSteps?: number
  /** Called before each step is read, for on-screen narration. */
  onProgress?: (note: string) => void
}

export async function discoverFlow(options: DiscoverOptions = {}): Promise<DiscoverResult> {
  const maxSteps = options.maxSteps ?? 12
  const progress = options.onProgress ?? (() => {})

  const first = wizardForm()
  if (!first) return { ok: false, message: "No form to learn on this page." }

  const steps: StepSpec[] = []
  const probes: Record<string, string> = {}
  const notes: string[] = []
  const refused: string[] = []
  const toolName = nameFrom(first)
  const siteTitle = document.querySelector("h2, h1")?.textContent?.trim() ?? document.title

  for (let index = 0; index < maxSteps; index++) {
    const form = wizardForm()
    if (!form) {
      notes.push("The form disappeared before the walk finished.")
      break
    }

    const heading = headingFor(form)
    const fields = readFields(form, refused)
    const intent = intentFrom(form, fields)
    const submit = submitButton(form)
    const submitLabel = labelOfButton(submit)

    if (steps.some((s) => s.intent === intent)) {
      notes.push(`Stopped at "${intent}": the page stopped advancing.`)
      break
    }

    // A step whose only inputs were refused is a sign-in or payment wall.
    // Walking further would mean filling it, so the walk ends here.
    if (fields.length === 0 && refused.length > 0) {
      notes.push(
        `Stopped at "${intent}": it asks for ${refused.join(", ")}, which this will not read or fill. ` +
          `Sign in first, then learn the flow.`
      )
      break
    }

    progress(`reading step ${index + 1}: ${intent}`)
    steps.push({
      order: index + 1,
      intent,
      fields: fields.map((f) => ({ ...f })),
      submitLabel,
      // Where this step lived, and how much pressing its button commits.
      route: { path: location.pathname, hash: location.hash.split("?")[0] || undefined },
      sideEffect: classifySideEffect(submitLabel),
    })

    // Decide whether there is a next step, and whether it is safe to ask for
    // it. A counter is proof; otherwise only an explicit "next" will do.
    const counter = STEP_COUNTER.exec(heading)
    const atLastCountedStep = counter ? Number(counter[1]) >= Number(counter[2]) : false
    const looksLikeNext = NEXT_LABEL.test(submitLabel)

    if (atLastCountedStep) {
      notes.push(`Stopped at step ${counter![1]} of ${counter![2]} without submitting.`)
      break
    }
    if (!looksLikeNext) {
      notes.push(`Did not press "${submitLabel || "the last button"}": it does not read as a next-step button.`)
      break
    }

    fillProbes(form, fields, probes)
    await settle()
    progress(`advancing past ${intent}`)
    submit?.click()
    await settle()
  }

  if (!steps.length) return { ok: false, message: "Found a form but could not read any step from it." }

  return {
    ok: true,
    message: `Learned ${steps.length} step(s) and ${steps.reduce((n, s) => n + s.fields.length, 0)} field(s) by reading the page.`,
    flow: {
      // Built from the tool name and the site heading. The form's
      // tooldescription is deliberately NOT used: that attribute describes the
      // declarative single-step tool the browser registers for the form, not
      // the whole multi-step task, so borrowing it produces a description that
      // contradicts what the flow actually does.
      intent: `${toolName.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase())} at ${siteTitle}`,
      toolName,
      steps,
      siteTitle,
      probes,
      notes,
      refused,
    },
  }
}


// --- reading a form this app did not write ------------------------------
//
// The demo learns a clinic we authored, on a version-2 redesign we authored,
// which is a fair thing for a skeptic to point at: of course it works, we
// broke our own site. The field-reading in this file is the part actually
// under question, so it is exposed here against arbitrary markup.
//
// Nothing about it is special-cased to our own DOM: isVisible already tolerates
// a document with no layout, labelOf goes through element.labels, and purposes
// come from name and autocomplete attributes that any real form carries.
//
// No wizard walking, because that needs the site's own JavaScript and we only
// have its markup. One form, one step, read exactly as the live path reads it.

export interface StaticReadResult {
  ok: boolean
  message: string
  formCount: number
  intent: string
  toolName: string
  submitLabel: string
  fields: FieldSpec[]
  /** Credential and payment fields, refused rather than read. */
  refused: string[]
  /** Where each purpose came from, so the reading can be checked by eye. */
  provenance: { purpose: string; label: string; from: string; required: boolean; options?: string[] }[]
}

function provenanceOf(el: HTMLElement): string {
  if (el.getAttribute("name")) return `name="${el.getAttribute("name")}"`
  const ac = el.getAttribute("autocomplete")
  if (ac && ac !== "off" && ac !== "on") return `autocomplete="${ac}"`
  if ((el as HTMLInputElement).labels?.length) return "its <label>"
  if (el.getAttribute("aria-label")) return "aria-label"
  if (el.getAttribute("placeholder")) return "placeholder"
  if (el.getAttribute("id")) return `id="${el.getAttribute("id")}"`
  return "element order"
}

/** Read a form out of a string of HTML, using the live discovery path. */
export function readFormFromHTML(html: string): StaticReadResult {
  const empty: StaticReadResult = {
    ok: false,
    message: "",
    formCount: 0,
    intent: "",
    toolName: "",
    submitLabel: "",
    fields: [],
    refused: [],
    provenance: [],
  }

  const trimmed = html.trim()
  if (!trimmed) return { ...empty, message: "Paste some HTML first." }

  let doc: Document
  try {
    doc = new DOMParser().parseFromString(trimmed, "text/html")
  } catch {
    return { ...empty, message: "That did not parse as HTML." }
  }

  const forms = [...doc.querySelectorAll<HTMLFormElement>("form")]
  // A pasted fragment often omits the <form> wrapper, so fall back to the body
  // and treat it as one.
  let form = forms.find((f) => f.querySelector("input, select, textarea")) ?? forms[0] ?? null
  if (!form && doc.body.querySelector("input, select, textarea")) {
    form = doc.createElement("form")
    while (doc.body.firstChild) form.appendChild(doc.body.firstChild)
    doc.body.appendChild(form)
  }
  if (!form) {
    return {
      ...empty,
      message:
        "No form controls in there. Paste the markup around the fields: an <input>, <select> or <textarea> has to be present.",
    }
  }

  const refused: string[] = []
  const fields = readFields(form, refused)
  if (!fields.length) {
    return {
      ...empty,
      formCount: forms.length,
      refused,
      message: refused.length
        ? `Every field in that form was a credential or payment field, so all ${refused.length} were refused and nothing was read.`
        : "Found a form but no readable fields in it.",
    }
  }

  const submitLabel = labelOfButton(
    form.querySelector<HTMLButtonElement | HTMLInputElement>(
      "button[type=submit], input[type=submit], button:not([type]), button[type=button]"
    )
  )
  const intent = intentFrom(form, fields)

  const provenance = [...form.querySelectorAll<HTMLElement>("input, select, textarea")]
    .filter((el) => fields.some((f) => f.label === labelOf(el)))
    .map((el) => {
      const field = fields.find((f) => f.label === labelOf(el))!
      return {
        purpose: field.purpose,
        label: field.label,
        from: provenanceOf(el),
        required: !!field.required,
        options: field.options,
      }
    })

  return {
    ok: true,
    message:
      `Read ${fields.length} field(s) from markup this app has never seen` +
      (refused.length ? `, and refused ${refused.length} credential or payment field(s)` : "") +
      ".",
    formCount: forms.length,
    intent,
    toolName: slugify(intent) || "pasted_task",
    submitLabel: submitLabel || "(no submit button found)",
    fields,
    refused,
    provenance,
  }
}
