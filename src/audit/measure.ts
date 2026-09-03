/**
 * The measurable half of the audit.
 *
 * Everything here computes a number that a published rule defines, so a finding
 * can cite the rule and show its working instead of asserting a judgement. Two
 * things are implemented to spec rather than approximated:
 *
 *   1. WCAG relative luminance and contrast ratio, including the alpha
 *      compositing that most naive implementations skip.
 *   2. The accessible name computation order from ARIA, which is what decides
 *      whether a control actually has a name at all.
 *
 * Where a value genuinely cannot be computed - a background image, a gradient,
 * a colour in a space we cannot resolve - it is reported as UNKNOWN. It is
 * never quietly treated as a pass. That distinction is the difference between
 * an audit and a reassurance.
 */

export type Certainty = "exact" | "unknown"

// --- colour --------------------------------------------------------------

export interface Rgba {
  r: number
  g: number
  b: number
  a: number
}

/**
 * Parse the colour forms getComputedStyle actually returns: rgb(), rgba(),
 * colour keywords resolved by the engine, and hex when it comes from markup.
 * Anything else (color(), lab(), oklch(), gradients) returns null and becomes
 * an UNKNOWN finding rather than a guess.
 */
export function parseColor(input: string | null | undefined): Rgba | null {
  if (!input) return null
  const value = input.trim().toLowerCase()
  if (value === "transparent") return { r: 0, g: 0, b: 0, a: 0 }

  const rgb = value.match(
    /^rgba?\(\s*([\d.]+)\s*[, ]\s*([\d.]+)\s*[, ]\s*([\d.]+)\s*(?:[,/]\s*([\d.%]+)\s*)?\)$/
  )
  if (rgb) {
    const alphaRaw = rgb[4]
    const a =
      alphaRaw == null
        ? 1
        : alphaRaw.endsWith("%")
          ? parseFloat(alphaRaw) / 100
          : parseFloat(alphaRaw)
    return { r: +rgb[1], g: +rgb[2], b: +rgb[3], a: Number.isFinite(a) ? a : 1 }
  }

  const hex = value.match(/^#([0-9a-f]{3,8})$/)
  if (hex) {
    const h = hex[1]
    const expand = (c: string) => parseInt(c.length === 1 ? c + c : c, 16)
    if (h.length === 3 || h.length === 4) {
      return {
        r: expand(h[0]),
        g: expand(h[1]),
        b: expand(h[2]),
        a: h.length === 4 ? expand(h[3]) / 255 : 1,
      }
    }
    if (h.length === 6 || h.length === 8) {
      return {
        r: expand(h.slice(0, 2)),
        g: expand(h.slice(2, 4)),
        b: expand(h.slice(4, 6)),
        a: h.length === 8 ? expand(h.slice(6, 8)) / 255 : 1,
      }
    }
  }
  return null
}

/** Composite a translucent colour over an opaque one. Source-over, per CSS. */
export function composite(fg: Rgba, bg: Rgba): Rgba {
  if (fg.a >= 1) return { ...fg, a: 1 }
  const a = fg.a
  return {
    r: fg.r * a + bg.r * (1 - a),
    g: fg.g * a + bg.g * (1 - a),
    b: fg.b * a + bg.b * (1 - a),
    a: 1,
  }
}

/**
 * WCAG relative luminance.
 *
 * The threshold is 0.03928, which is what the WCAG definition normatively
 * states. The sRGB specification itself says 0.04045; the discrepancy is a
 * known erratum, and conformance is measured against WCAG's number, so that is
 * the one used here.
 *
 * https://www.w3.org/TR/WCAG22/#dfn-relative-luminance
 */
export function relativeLuminance({ r, g, b }: Rgba): number {
  const channel = (v: number) => {
    const s = v / 255
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
  }
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
}

/**
 * WCAG contrast ratio. Ranges 1:1 to 21:1 and is symmetric.
 * https://www.w3.org/TR/WCAG22/#dfn-contrast-ratio
 */
export function contrastRatio(a: Rgba, b: Rgba): number {
  const la = relativeLuminance(a)
  const lb = relativeLuminance(b)
  const lighter = Math.max(la, lb)
  const darker = Math.min(la, lb)
  return (lighter + 0.05) / (darker + 0.05)
}

/**
 * The threshold a given piece of text has to clear.
 *
 * WCAG 2.2 SC 1.4.3 sets 4.5:1, relaxed to 3:1 for "large text", which the
 * spec defines as 18pt, or 14pt when bold. In CSS pixels at the usual 96dpi
 * that is 24px, or 18.66px bold.
 * https://www.w3.org/TR/WCAG22/#contrast-minimum
 */
export function requiredContrast(fontSizePx: number, fontWeight: number): { threshold: number; large: boolean } {
  const bold = fontWeight >= 700
  const large = fontSizePx >= 24 || (bold && fontSizePx >= 18.66)
  return { threshold: large ? 3 : 4.5, large }
}

export interface ResolvedBackground {
  color: Rgba | null
  certainty: Certainty
  /** Why it could not be resolved, when it could not. */
  reason?: string
}

/**
 * Walk up the ancestor chain compositing backgrounds until an opaque one is
 * reached. Returns UNKNOWN rather than a number when something in the stack is
 * a background image or a gradient, because the effective colour behind the
 * text genuinely is not knowable from the cascade alone.
 */
export function resolveBackground(el: Element, win: Window): ResolvedBackground {
  let node: Element | null = el
  const layers: Rgba[] = []

  while (node) {
    const style = win.getComputedStyle(node)
    const image = style.backgroundImage
    if (image && image !== "none") {
      return {
        color: null,
        certainty: "unknown",
        reason: `an ancestor paints ${image.startsWith("linear-gradient") || image.startsWith("radial-gradient") ? "a gradient" : "a background image"}, so the colour behind the text is not computable from styles alone`,
      }
    }
    const parsed = parseColor(style.backgroundColor)
    if (!parsed) {
      return { color: null, certainty: "unknown", reason: `background-color "${style.backgroundColor}" is in a colour space this cannot resolve` }
    }
    if (parsed.a > 0) layers.push(parsed)
    if (parsed.a >= 1) {
      // Composite from the opaque layer forwards.
      let acc = layers.pop()!
      while (layers.length) acc = composite(layers.pop()!, acc)
      return { color: acc, certainty: "exact" }
    }
    node = node.parentElement
  }

  // Nothing opaque found: the canvas shows through. Per CSS the canvas is
  // white unless the author set it, and we already walked every author layer.
  let acc: Rgba = { r: 255, g: 255, b: 255, a: 1 }
  while (layers.length) acc = composite(layers.pop()!, acc)
  return { color: acc, certainty: "exact" }
}

// --- accessible name -----------------------------------------------------

export interface AccessibleName {
  name: string
  /** Which step of the algorithm produced it, so a finding can show its source. */
  from: "aria-labelledby" | "aria-label" | "label" | "title" | "placeholder" | "value" | "content" | "none"
}

const NAME_FROM_CONTENT = new Set([
  "BUTTON",
  "A",
  "SUMMARY",
  "TH",
  "LEGEND",
  "OPTION",
  "H1",
  "H2",
  "H3",
  "H4",
  "H5",
  "H6",
])

/**
 * Accessible name computation, in the order the ARIA specification defines.
 *
 * Not "does it have a label" - the order matters, because aria-labelledby
 * overrides a perfectly good <label>, and a placeholder is a last resort that
 * disappears the moment the user types. Implemented far enough to decide the
 * question that matters: does this control have a name at all.
 *
 * https://www.w3.org/TR/accname-1.2/#computation-steps
 */
export function accessibleName(el: Element): AccessibleName {
  const attr = (n: string) => el.getAttribute(n)?.trim() ?? ""

  const labelledby = attr("aria-labelledby")
  if (labelledby) {
    const text = labelledby
      .split(/\s+/)
      .map((id) => el.ownerDocument.getElementById(id)?.textContent?.trim() ?? "")
      .filter(Boolean)
      .join(" ")
    if (text) return { name: text, from: "aria-labelledby" }
  }

  const ariaLabel = attr("aria-label")
  if (ariaLabel) return { name: ariaLabel, from: "aria-label" }

  const labels = (el as HTMLInputElement).labels
  if (labels?.length) {
    const clone = labels[0].cloneNode(true) as Element
    for (const c of clone.querySelectorAll("input, select, textarea, option, optgroup, button")) c.remove()
    const text = clone.textContent?.trim().replace(/\s+/g, " ") ?? ""
    if (text) return { name: text, from: "label" }
  }

  if (NAME_FROM_CONTENT.has(el.tagName)) {
    const text = el.textContent?.trim().replace(/\s+/g, " ") ?? ""
    // An icon-only button often has an <img alt> or an aria-hidden <svg>.
    const imgAlt = [...el.querySelectorAll("img[alt]")]
      .map((i) => i.getAttribute("alt")?.trim())
      .filter(Boolean)
      .join(" ")
    if (text) return { name: text, from: "content" }
    if (imgAlt) return { name: imgAlt, from: "content" }
  }

  if (el.tagName === "IMG") {
    const alt = el.getAttribute("alt")
    // alt="" is a valid, deliberate claim that the image is decorative, which
    // is different from the attribute being absent.
    if (alt !== null) return { name: alt.trim(), from: alt.trim() ? "content" : "none" }
  }

  if (el.tagName === "INPUT") {
    const type = (el as HTMLInputElement).type
    if (type === "submit" || type === "button" || type === "reset") {
      const value = attr("value")
      if (value) return { name: value, from: "value" }
      // The browser supplies a default label for these when value is absent.
      if (type !== "button") return { name: type === "submit" ? "Submit" : "Reset", from: "value" }
    }
    if (type === "image") {
      const alt = attr("alt")
      if (alt) return { name: alt, from: "content" }
    }
  }

  const title = attr("title")
  if (title) return { name: title, from: "title" }

  const placeholder = attr("placeholder")
  if (placeholder) return { name: placeholder, from: "placeholder" }

  return { name: "", from: "none" }
}

/** A short, stable selector for pointing a human at the element. */
export function describeElement(el: Element): string {
  const tag = el.tagName.toLowerCase()
  const id = el.getAttribute("id")
  if (id) return `${tag}#${id}`
  const name = el.getAttribute("name")
  if (name) return `${tag}[name="${name}"]`
  const cls = (el.getAttribute("class") ?? "").trim().split(/\s+/).filter(Boolean)[0]
  if (cls) return `${tag}.${cls}`
  const parent = el.parentElement
  if (parent) {
    const sameTag = [...parent.children].filter((c) => c.tagName === el.tagName)
    if (sameTag.length > 1) return `${tag}:nth-of-type(${sameTag.indexOf(el) + 1})`
  }
  return tag
}
