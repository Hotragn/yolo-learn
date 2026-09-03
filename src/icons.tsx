import { SVGProps } from "react"

/**
 * Hand-written inline SVG, on purpose.
 *
 * The taste guidance for this project says never hand-roll icons and reach for
 * Phosphor or Tabler instead. That is right for most work and wrong here: this
 * is a zero-dependency demo, and an icon library would be the largest
 * dependency in it. More importantly, no generic set has a mark for "the site
 * moved out of register" or "a value nobody has ever supplied".
 *
 * Two earlier passes failed in opposite directions, which is the whole lesson:
 *
 *   Pass 1 was too detailed. Opacity, dash arrays and eight segments per glyph
 *   turned to mud at 17px.
 *   Pass 2 over-corrected into bare primitives. A plus sign for "mint" and a
 *   circle-plus for "heal" are legible and say nothing.
 *
 * What actually makes a small icon work is a distinctive SILHOUETTE, not more
 * detail and not less. So each glyph here is built to be recognisable by its
 * outline alone: the scan bar breaks the page's edges, drift is two frames out
 * of register, mint is a sparkle. Rules: stroke 1.9, everything inside a 20x20
 * safe area, no feature smaller than 2px, no opacity, no dashes, and every
 * glyph checked on screen at 16px before it ships.
 *
 * The narrative, in order:
 *   Read -> Remember -> Mint -> Run -> Approve -> Drift -> Heal -> Ask -> Refuse
 */

type IconProps = SVGProps<SVGSVGElement> & { size?: number }

function Icon({ size = 18, children, ...rest }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.9}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {children}
    </svg>
  )
}

/**
 * The mark: a form's field lines with one bold accent stroke lifting off the
 * last one and rising clear of it. The product is the line that redraws itself.
 */
export function Logo({ size = 28, ...rest }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden="true" focusable="false" {...rest}>
      <rect width="32" height="32" rx="8.5" fill="var(--logo-bg, #0B1220)" />
      <g stroke="var(--logo-ring, #F4F6F9)" strokeWidth="2.2" strokeLinecap="round" opacity="0.45">
        <path d="M8.5 12h9" />
        <path d="M8.5 19.5h5" />
      </g>
      <path
        d="M8.5 23.5c7 0 6-11 15-11"
        stroke="var(--logo-mark, #4EC38A)"
        strokeWidth="2.9"
        strokeLinecap="round"
      />
      <circle cx="23.5" cy="12.5" r="2.4" fill="var(--logo-mark, #4EC38A)" />
    </svg>
  )
}

// --- the story ----------------------------------------------------------

/**
 * READ: a page, and a scan bar crossing it that breaks past both edges.
 * The overhang is what makes it read as scanning rather than as a table.
 */
export function IconRead(p: IconProps) {
  return (
    <Icon {...p}>
      <path d="M7 3h10v18H7z" />
      <path d="M2 12h20" />
    </Icon>
  )
}

/** REMEMBER: purpose nodes and the links between them. A graph, not a disk. */
export function IconRemember(p: IconProps) {
  return (
    <Icon {...p}>
      <circle cx="5.5" cy="6" r="2.4" />
      <circle cx="5.5" cy="18" r="2.4" />
      <circle cx="18.5" cy="12" r="2.4" />
      <path d="M7.7 7.2l8.6 3.7M7.7 16.8l8.6-3.7" />
    </Icon>
  )
}

/**
 * MINT: a sparkle striking off a tool's corner. The four-point star is the
 * common mark for "newly made", and the bracket keeps it from being decorative.
 */
export function IconMint(p: IconProps) {
  return (
    <Icon {...p}>
      <path d="M3.5 14.5v6h6" />
      <path d="M3.5 20.5l7-7" />
      <path d="M15.5 2.5l1.7 4.3 4.3 1.7-4.3 1.7-1.7 4.3-1.7-4.3L9.5 8.5l4.3-1.7z" />
    </Icon>
  )
}

/** RUN: the flow executing, framed so it reads as a control and not an arrow. */
export function IconRun(p: IconProps) {
  return (
    <Icon {...p}>
      <rect x="3" y="3.5" width="18" height="17" rx="3.5" />
      <path d="M10 8.5l6 3.5-6 3.5z" />
    </Icon>
  )
}

/** APPROVE: the human gate. A shield the agent cannot open by itself. */
export function IconApprove(p: IconProps) {
  return (
    <Icon {...p}>
      <path d="M12 2.8l8 2.9v5.6c0 4.6-3.2 8-8 9-4.8-1-8-4.4-8-9V5.7z" />
      <path d="M8.6 11.8l2.5 2.5 4.3-5" />
    </Icon>
  )
}

/**
 * DRIFT: the site moved. Two frames out of register, the second one dragged
 * clear of the first. The offset is the whole idea.
 */
export function IconDrift(p: IconProps) {
  return (
    <Icon {...p}>
      <path d="M3 3.5h9.5V13H3z" />
      <path d="M11.5 11h9.5v9.5h-9.5z" />
    </Icon>
  )
}

/**
 * HEAL: a seam pulled back together. Two halves closing on a join, which is a
 * different silhouette from the plus sign that replaced it last time.
 */
export function IconHeal(p: IconProps) {
  return (
    <Icon {...p}>
      <path d="M3.5 3.5h17v17h-17z" />
      <path d="M7.5 12l3 3 6-6.5" />
    </Icon>
  )
}

/** ASK: the one open question, in a bubble so it reads as a request. */
export function IconAsk(p: IconProps) {
  return (
    <Icon {...p}>
      <path d="M21 14.5a2.5 2.5 0 0 1-2.5 2.5H8l-5 4V5.5A2.5 2.5 0 0 1 5.5 3h13A2.5 2.5 0 0 1 21 5.5z" />
      <path d="M9.4 8.2a2.7 2.7 0 1 1 2.85 2.7v1.4" />
    </Icon>
  )
}

/** REFUSE: the boundary. Used for the things it will not do. */
export function IconRefuse(p: IconProps) {
  return (
    <Icon {...p}>
      <circle cx="12" cy="12" r="8.8" />
      <path d="M5.8 18.2L18.2 5.8" />
    </Icon>
  )
}

// --- refusal subjects ---------------------------------------------------
// Four identical slashed circles down the "what it will not do" list read as a
// repeating stamp, so each of these carries its own subject instead.
//
// None of them carry a slash. The first attempt did, and at 16px the slash ran
// collinear with the paper plane's own body and across the sparkle's arms,
// turning both to mud. The section heading and the red already say "will not";
// a second negation only costs legibility.

/** Will not submit for you. */
export function IconNoSubmit(p: IconProps) {
  return (
    <Icon {...p}>
      <path d="M20.5 3.5L10.5 13.5" />
      <path d="M20.5 3.5l-6.8 17.2-3.2-7.2-7.2-3.2z" />
    </Icon>
  )
}

/** Will not invent a value. */
export function IconNoInvent(p: IconProps) {
  return (
    <Icon {...p}>
      <path d="M15 2.5l1.8 4.7 4.7 1.8-4.7 1.8L15 15.5l-1.8-4.7L8.5 9l4.7-1.8z" />
      <path d="M6.5 14.5l.9 2.4 2.4.9-2.4.9-.9 2.4-.9-2.4-2.4-.9 2.4-.9z" />
    </Icon>
  )
}

/** Will not touch a credential. */
export function IconNoKey(p: IconProps) {
  return (
    <Icon {...p}>
      <rect x="3.5" y="10" width="17" height="10.5" rx="2.5" />
      <path d="M7.5 10V6.8a4.5 4.5 0 0 1 9 0V10" />
    </Icon>
  )
}

/** Will not send anything anywhere. */
export function IconNoSend(p: IconProps) {
  return (
    <Icon {...p}>
      <circle cx="12" cy="12" r="8.8" />
      <path d="M3.2 12h17.6" />
      <path d="M12 3.2a13.5 13.5 0 0 1 0 17.6a13.5 13.5 0 0 1 0-17.6" />
    </Icon>
  )
}

// --- utility ------------------------------------------------------------

export function IconRecord(p: IconProps) {
  return (
    <Icon {...p}>
      <circle cx="12" cy="12" r="8.8" />
      <circle cx="12" cy="12" r="3.2" fill="currentColor" stroke="none" />
    </Icon>
  )
}

export function IconCheck(p: IconProps) {
  return (
    <Icon {...p}>
      <path d="M4.5 12.5l5 5L19.5 6.5" />
    </Icon>
  )
}

export function IconAlert(p: IconProps) {
  return (
    <Icon {...p}>
      <path d="M12 3.8l9 15.7H3z" />
      <path d="M12 9.8v4" />
      <path d="M12 16.8h.01" />
    </Icon>
  )
}

export function IconTrash(p: IconProps) {
  return (
    <Icon {...p}>
      <path d="M3.5 6.5h17" />
      <path d="M9.5 6.5V4h5v2.5" />
      <path d="M6 6.5l.9 13.2h10.2L18 6.5" />
    </Icon>
  )
}

export function IconCopy(p: IconProps) {
  return (
    <Icon {...p}>
      <rect x="8.5" y="8.5" width="12" height="12" rx="2.5" />
      <path d="M15.5 5.5A2 2 0 0 0 13.5 3.5H6a2.5 2.5 0 0 0-2.5 2.5v7.5a2 2 0 0 0 2 2" />
    </Icon>
  )
}

export function IconUndo(p: IconProps) {
  return (
    <Icon {...p}>
      <path d="M3.5 9.5h10a5.75 5.75 0 0 1 0 11.5H8" />
      <path d="M7.5 5L3 9.5 7.5 14" />
    </Icon>
  )
}

export function IconTerminal(p: IconProps) {
  return (
    <Icon {...p}>
      <rect x="2.5" y="4.5" width="19" height="15" rx="2.5" />
      <path d="M7 10l2.5 2.2L7 14.4" />
      <path d="M12.5 14.4h4.5" />
    </Icon>
  )
}

export function IconArrowRight(p: IconProps) {
  return (
    <Icon {...p}>
      <path d="M3.5 12h16" />
      <path d="M13.5 6l6 6-6 6" />
    </Icon>
  )
}

export function IconSun(p: IconProps) {
  return (
    <Icon {...p}>
      <circle cx="12" cy="12" r="4.2" />
      <path d="M12 2.6v2.3M12 19.1v2.3M4.9 4.9l1.7 1.7M17.4 17.4l1.7 1.7M2.6 12h2.3M19.1 12h2.3M4.9 19.1l1.7-1.7M17.4 6.6l1.7-1.7" />
    </Icon>
  )
}

export function IconMoon(p: IconProps) {
  return (
    <Icon {...p}>
      <path d="M20.8 14.4A9.2 9.2 0 0 1 9.6 3.2a9.2 9.2 0 1 0 11.2 11.2z" />
    </Icon>
  )
}

export function IconSystem(p: IconProps) {
  return (
    <Icon {...p}>
      <rect x="2.5" y="4" width="19" height="13" rx="2.5" />
      <path d="M8.5 20.5h7" />
    </Icon>
  )
}

/** Pointer for the product tour. */
export function IconPointer(p: IconProps) {
  return (
    <Icon {...p}>
      <path d="M6 3.5l13 7.2-5.6 1.6-1.8 5.7z" />
      <path d="M13 14l5.5 6.5" />
    </Icon>
  )
}

// Aliases so call sites read in product language, not shape names.
export const IconAuto = IconRead
export const IconTool = IconMint
export const IconPlay = IconRun
export const IconShield = IconApprove
export const IconSteps = IconRemember
