import { SVGProps } from "react"

/**
 * Hand-written inline SVG. No icon dependency, no font, no sprite request.
 * Everything strokes in currentColor at 1.75, so icons inherit the theme and
 * work in both light and dark mode without a second asset.
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
      strokeWidth={1.75}
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

/** The product mark: a loop that closes itself, with the mend picked out. */
export function Logo({ size = 28, ...rest }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      <rect width="32" height="32" rx="8" fill="var(--logo-bg, #0B1220)" />
      <path
        d="M22.5 12.2A8 8 0 1 0 24 16.6"
        stroke="var(--logo-ring, #F4F6F9)"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
      <path
        d="M10.8 16.3l3.4 3.4 6.6-7"
        stroke="var(--logo-mark, #7BD40A)"
        strokeWidth="2.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="23.2" cy="9.4" r="2.2" fill="var(--logo-mark, #7BD40A)" />
    </svg>
  )
}

export function IconRecord(p: IconProps) {
  return (
    <Icon {...p}>
      <circle cx="12" cy="12" r="8.5" />
      <circle cx="12" cy="12" r="3.5" fill="currentColor" stroke="none" />
    </Icon>
  )
}

/** Autonomous learning: a wand with two sparks. */
export function IconAuto(p: IconProps) {
  return (
    <Icon {...p}>
      <path d="M4 20L14.5 9.5" />
      <path d="M13 5.5l1 2.5 2.5 1-2.5 1-1 2.5-1-2.5-2.5-1 2.5-1 1-2.5z" />
      <path d="M19 14.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7.7-1.8z" />
    </Icon>
  )
}

export function IconTool(p: IconProps) {
  return (
    <Icon {...p}>
      <path d="M14.5 5.5a3.8 3.8 0 0 0 5 5L15 15l-4.2 4.2a2.1 2.1 0 0 1-3-3L12 12l2.5-6.5z" />
    </Icon>
  )
}

/** Healing: a cross over a seam. */
export function IconHeal(p: IconProps) {
  return (
    <Icon {...p}>
      <path d="M4.5 12h15" strokeDasharray="3 2.5" />
      <path d="M12 6.5v11" />
      <circle cx="12" cy="12" r="8.5" />
    </Icon>
  )
}

export function IconPlay(p: IconProps) {
  return (
    <Icon {...p}>
      <path d="M9 6.8l8.5 5.2L9 17.2z" />
    </Icon>
  )
}

export function IconCheck(p: IconProps) {
  return (
    <Icon {...p}>
      <path d="M5 12.8l4.4 4.2L19 7.5" />
    </Icon>
  )
}

export function IconAlert(p: IconProps) {
  return (
    <Icon {...p}>
      <path d="M12 4.8l8 14.4H4l8-14.4z" />
      <path d="M12 10.5v3.6" />
      <path d="M12 16.8h.01" />
    </Icon>
  )
}

export function IconTrash(p: IconProps) {
  return (
    <Icon {...p}>
      <path d="M4.5 7.5h15" />
      <path d="M9.5 7.5V5.2h5v2.3" />
      <path d="M6.5 7.5l.9 11.3h9.2l.9-11.3" />
    </Icon>
  )
}

export function IconCopy(p: IconProps) {
  return (
    <Icon {...p}>
      <rect x="9" y="9" width="10.5" height="10.5" rx="2" />
      <path d="M15 6.5a2 2 0 0 0-2-2H6.5a2 2 0 0 0-2 2V13a2 2 0 0 0 2 2" />
    </Icon>
  )
}

export function IconUndo(p: IconProps) {
  return (
    <Icon {...p}>
      <path d="M4.5 9.5h9a5.5 5.5 0 1 1 0 11H8" />
      <path d="M8 5.5L4.5 9.5 8 13.5" />
    </Icon>
  )
}

export function IconSteps(p: IconProps) {
  return (
    <Icon {...p}>
      <path d="M4.5 19h4v-4.5h4V10h4V5.5h3" />
    </Icon>
  )
}

export function IconTerminal(p: IconProps) {
  return (
    <Icon {...p}>
      <rect x="3.5" y="5" width="17" height="14" rx="2.5" />
      <path d="M7.5 10l2.5 2-2.5 2" />
      <path d="M12.5 14h4" />
    </Icon>
  )
}

export function IconShield(p: IconProps) {
  return (
    <Icon {...p}>
      <path d="M12 4l7 2.6v5.1c0 4.2-2.8 7.3-7 8.3-4.2-1-7-4.1-7-8.3V6.6L12 4z" />
      <path d="M9 12.2l2.2 2.2L15.2 10" />
    </Icon>
  )
}

export function IconArrowRight(p: IconProps) {
  return (
    <Icon {...p}>
      <path d="M5 12h13" />
      <path d="M13 6.8l5.2 5.2-5.2 5.2" />
    </Icon>
  )
}

export function IconChevron({ open, ...p }: IconProps & { open?: boolean }) {
  return (
    <Icon {...p} style={{ transform: open ? "rotate(90deg)" : undefined, transition: "transform .15s ease", ...p.style }}>
      <path d="M9.5 6l6 6-6 6" />
    </Icon>
  )
}

export function IconSun(p: IconProps) {
  return (
    <Icon {...p}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 3.2v1.9M12 18.9v1.9M4.6 4.6l1.3 1.3M18.1 18.1l1.3 1.3M3.2 12h1.9M18.9 12h1.9M4.6 19.4l1.3-1.3M18.1 5.9l1.3-1.3" />
    </Icon>
  )
}

export function IconMoon(p: IconProps) {
  return (
    <Icon {...p}>
      <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z" />
    </Icon>
  )
}

export function IconSystem(p: IconProps) {
  return (
    <Icon {...p}>
      <rect x="3" y="4.5" width="18" height="12" rx="2" />
      <path d="M8.5 20h7" />
      <path d="M12 16.5V20" />
    </Icon>
  )
}
