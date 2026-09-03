import { ReactNode, useEffect, useId, useRef } from "react"

const FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'

/**
 * Every decision in this app happens in a dialog, so the dialog has to be
 * usable without a mouse: focus moves in on open, Tab stays inside, Escape
 * takes the safe path, and focus returns where it came from on close.
 */
export function Modal({
  title,
  children,
  onEscape,
  escapeHint,
}: {
  title: string
  children: ReactNode
  /** Escape must resolve to the non-destructive choice (deny, cancel, later). */
  onEscape?: () => void
  escapeHint?: string
}) {
  const ref = useRef<HTMLDivElement>(null)
  const headingId = useId()

  useEffect(() => {
    const node = ref.current
    if (!node) return
    const previouslyFocused = document.activeElement as HTMLElement | null

    const focusables = () =>
      [...node.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
        (el) => !el.hasAttribute("disabled") && el.offsetParent !== null
      )

    const list = focusables()
    const preferred = list.find((el) => el.dataset.autofocus === "true")
    ;(preferred ?? list[0])?.focus()

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && onEscape) {
        e.preventDefault()
        onEscape()
        return
      }
      if (e.key !== "Tab") return
      const items = focusables()
      if (items.length === 0) return
      const index = items.indexOf(document.activeElement as HTMLElement)
      if (e.shiftKey && index <= 0) {
        e.preventDefault()
        items[items.length - 1].focus()
      } else if (!e.shiftKey && index === items.length - 1) {
        e.preventDefault()
        items[0].focus()
      }
    }

    node.addEventListener("keydown", onKeyDown)
    return () => {
      node.removeEventListener("keydown", onKeyDown)
      previouslyFocused?.focus?.()
    }
  }, [onEscape])

  return (
    <div className="modal-backdrop">
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby={headingId} ref={ref}>
        <h3 id={headingId}>{title}</h3>
        {children}
        {escapeHint && (
          <p className="key-hint">
            Press <kbd>Esc</kbd> to {escapeHint}.
          </p>
        )}
      </div>
    </div>
  )
}
