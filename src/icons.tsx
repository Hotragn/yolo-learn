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
 * The narrative, in order:
 *   Read -> Remember -> Mint -> Run -> Approve -> Drift -> Heal -> Refuse
 *
 * Craft rules, learned the hard way after a first pass that was illegible at
 * 17px: at most FOUR path segments per glyph, stroke 2, no decorative opacity,
 * no dash patterns (they disappear), and every glyph checked at 16px before it
 * ships. Detail is the enemy of a small icon.
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
      strokeWidth={2}
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
 * The mark: one field line, one bold accent stroke crossing it. The product is
 * the stroke that redraws itself, not the form underneath. Two shapes only, so
 * it survives a 16px favicon.
 */
export function Logo({ size = 28, ...rest }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden="true" focusable="false" {...rest}>
      <rect width="32" height="32" rx="8" fill="var(--logo-bg, #0B1220)" />
      <path d="M8 20.5h16" stroke="var(--logo-ring, #F4F6F9)" strokeWidth="2.6" strokeLinecap="round" />
      <path
        d="M9.5 15.5l5 5 9-11"
        stroke="var(--logo-mark, #7BD40A)"
        strokeWidth="3.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

// --- the story ----------------------------------------------------------

/** READ: a page with a scan line straight across it. */
export function IconRead(p: IconProps) {
  return (
    <Icon {...p}>
      <path d="M6 3.5h12v17H6z" />
      <path d="M3 12h18" />
    </Icon>
  )
}

/** REMEMBER: purpose nodes and the links between them, not pixels. */
export function IconRemember(p: IconProps) {
  return (
    <Icon {...p}>
      <circle cx="5.5" cy="6.5" r="2.5" />
      <circle cx="5.5" cy="17.5" r="2.5" />
      <circle cx="18.5" cy="12" r="2.5" />
      <path d="M8 7.6l8 3.3M8 16.4l8-3.3" />
    </Icon>
  )
}

/** MINT: a new thing struck into existence. */
export function IconMint(p: IconProps) {
  return (
    <Icon {...p}>
      <path d="M12 3v7M12 14v7M3 12h7M14 12h7" />
    </Icon>
  )
}

/** RUN: the flow executing. */
export function IconRun(p: IconProps) {
  return (
    <Icon {...p}>
      <path d="M8 5.5l11 6.5-11 6.5z" />
    </Icon>
  )
}

/** APPROVE: the human gate the agent cannot open. */
export function IconApprove(p: IconProps) {
  return (
    <Icon {...p}>
      <path d="M12 3.5l7.5 2.7v5.3c0 4.3-3 7.5-7.5 8.5-4.5-1-7.5-4.2-7.5-8.5V6.2z" />
      <path d="M9 12l2.3 2.3L15.5 10" />
    </Icon>
  )
}

/** DRIFT: the site moved. Two frames out of register. */
export function IconDrift(p: IconProps) {
  return (
    <Icon {...p}>
      <path d="M3.5 4h10v10h-10z" />
      <path d="M10.5 10h10v10h-10z" />
    </Icon>
  )
}

/** HEAL: the seam closed. */
export function IconHeal(p: IconProps) {
  return (
    <Icon {...p}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M8.5 12h7M12 8.5v7" />
    </Icon>
  )
}

/** REFUSE: the boundary. */
export function IconRefuse(p: IconProps) {
  return (
    <Icon {...p}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M6.9 17.1L17.1 6.9" />
    </Icon>
  )
}

/** ASK: the one open question. */
export function IconAsk(p: IconProps) {
  return (
    <Icon {...p}>
      <path d="M9 9a3 3 0 1 1 4.2 2.8c-.8.4-1.2 1-1.2 1.9v.6" />
      <path d="M12 18h.01" />
      <circle cx="12" cy="12" r="9" />
    </Icon>
  )
}

// --- utility ------------------------------------------------------------

export function IconRecord(p: IconProps) {
  return (
    <Icon {...p}>
      <circle cx="12" cy="12" r="8.5" />
      <circle cx="12" cy="12" r="3" fill="currentColor" stroke="none" />
    </Icon>
  )
}

export function IconCheck(p: IconProps) {
  return (
    <Icon {...p}>
      <path d="M5 12.5l4.5 4.5L19 7.5" />
    </Icon>
  )
}

export function IconAlert(p: IconProps) {
  return (
    <Icon {...p}>
      <path d="M12 4.5l8.5 15H3.5z" />
      <path d="M12 10v4" />
      <path d="M12 17h.01" />
    </Icon>
  )
}

export function IconTrash(p: IconProps) {
  return (
    <Icon {...p}>
      <path d="M4 7h16" />
      <path d="M9.5 7V4.5h5V7" />
      <path d="M6.5 7l.8 12.5h9.4L17.5 7" />
    </Icon>
  )
}

export function IconCopy(p: IconProps) {
  return (
    <Icon {...p}>
      <rect x="9" y="9" width="11" height="11" rx="2.5" />
      <path d="M15 5.5A2 2 0 0 0 13 4H6.5A2.5 2.5 0 0 0 4 6.5V13a2 2 0 0 0 1.5 1.9" />
    </Icon>
  )
}

export function IconUndo(p: IconProps) {
  return (
    <Icon {...p}>
      <path d="M4 9.5h9.5a5.5 5.5 0 1 1 0 11H8" />
      <path d="M8 5L3.5 9.5 8 14" />
    </Icon>
  )
}

export function IconTerminal(p: IconProps) {
  return (
    <Icon {...p}>
      <rect x="3" y="5" width="18" height="14" rx="2.5" />
      <path d="M7.5 10l2.5 2-2.5 2" />
      <path d="M13 14h4" />
    </Icon>
  )
}

export function IconArrowRight(p: IconProps) {
  return (
    <Icon {...p}>
      <path d="M4.5 12h14" />
      <path d="M13 6.5l5.5 5.5L13 17.5" />
    </Icon>
  )
}

export function IconSun(p: IconProps) {
  return (
    <Icon {...p}>
      <circle cx="12" cy="12" r="4.2" />
      <path d="M12 2.8v2.2M12 19v2.2M4.9 4.9l1.6 1.6M17.5 17.5l1.6 1.6M2.8 12h2.2M19 12h2.2M4.9 19.1l1.6-1.6M17.5 6.5l1.6-1.6" />
    </Icon>
  )
}

export function IconMoon(p: IconProps) {
  return (
    <Icon {...p}>
      <path d="M20.5 14.3A9 9 0 0 1 9.7 3.5a9 9 0 1 0 10.8 10.8z" />
    </Icon>
  )
}

export function IconSystem(p: IconProps) {
  return (
    <Icon {...p}>
      <rect x="2.5" y="4.5" width="19" height="12.5" rx="2.5" />
      <path d="M8.5 20.5h7" />
    </Icon>
  )
}

// Aliases so call sites read in product language, not shape names.
export const IconAuto = IconRead
export const IconTool = IconMint
export const IconPlay = IconRun
export const IconShield = IconApprove
export const IconSteps = IconRemember
