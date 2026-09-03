import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react"
import { safeGetItem, safeSetItem } from "./types"
import { IconArrowRight, IconPointer } from "./icons"

/**
 * A first-visit walkthrough that points at the real interface.
 *
 * Deliberately not a modal carousel of screenshots: it spotlights the actual
 * element on the actual page, so what the reader is told and what they are
 * looking at cannot drift apart. Each stop names one thing and says why it is
 * there, because a reviewer landing cold has no idea what "Flows" or "Tools"
 * mean in a product they have never seen.
 *
 * It runs once. Anyone who wants it again can press "Take the tour".
 */

const SEEN_KEY = "tour.v1"

export interface TourStop {
  /** CSS selector for the element to spotlight. Skipped when it is not on screen. */
  target: string
  title: string
  body: string
  /** Route to switch to before this stop, so the target exists. */
  route?: string
}

const STOPS: TourStop[] = [
  {
    target: "[data-tour='brand']",
    title: "This page is two things at once",
    body:
      "Yolo Learn, and a fictional clinic for it to learn. They share one origin because a WebMCP tool belongs to the page that registers it.",
  },
  {
    target: "[data-tour='detect']",
    title: "Whether a real agent is connected",
    body:
      "Green means the browser accepted the tools. Amber means no WebMCP here, which changes nothing on the page: the simulated agent at the bottom calls exactly the same tools.",
  },
  {
    target: "[data-tour='nav-site']",
    title: "Demo site: the clinic",
    body:
      "A four-step booking form, and a v2 of it redesigned a year later. The version switch is what creates the drift the whole product exists to survive.",
  },
  {
    target: "[data-tour='nav-flows']",
    title: "Flows: what it has learned",
    body:
      "One card per learned task, each with its health against the site as it looks right now, its parameters, and its last three runs.",
  },
  {
    target: "[data-tour='nav-tools']",
    title: "Tools: the live registry",
    body:
      "Every tool an agent can see. Learning a flow adds one here mid-session, badged new, with no reload. That is the part that is genuinely hard.",
  },
  {
    target: "[data-tour='learn']",
    title: "Start here",
    body:
      "It reads the page and mints a tool for what it found. No demonstration, and nothing invented: it stores the shape of the task, never your values.",
  },
  {
    target: "[data-tour='guided']",
    title: "Or watch the whole thing",
    body:
      "Nine beats, about forty seconds, every one a real tool call. It stops twice for you, because nothing is submitted without a human pressing approve.",
  },
  {
    target: "[data-tour='console']",
    title: "Check any claim yourself",
    body:
      "The simulated agent calls the registered tool objects directly, with the same argument validation and the same cancellation a browser agent gets.",
  },
]

export function hasSeenTour(): boolean {
  return safeGetItem(SEEN_KEY) === "1"
}

export function markTourSeen() {
  safeSetItem(SEEN_KEY, "1")
}

interface Box {
  top: number
  left: number
  width: number
  height: number
}

export function Tour({ onClose }: { onClose: () => void }) {
  const [index, setIndex] = useState(0)
  const [box, setBox] = useState<Box | null>(null)
  const cardRef = useRef<HTMLDivElement>(null)

  // Stops whose target is not in the DOM are dropped rather than shown
  // pointing at nothing.
  const stops = STOPS.filter((s) => document.querySelector(s.target))
  const stop = stops[index]

  const finish = useCallback(() => {
    markTourSeen()
    onClose()
  }, [onClose])

  const measure = useCallback(() => {
    if (!stop) return
    const el = document.querySelector(stop.target)
    if (!el) return setBox(null)
    const r = el.getBoundingClientRect()
    setBox({ top: r.top + window.scrollY, left: r.left + window.scrollX, width: r.width, height: r.height })
    if (r.top < 80 || r.bottom > window.innerHeight - 80) {
      el.scrollIntoView({ block: "center", behavior: "smooth" })
      // Re-measure once the scroll settles, or the spotlight lands where the
      // element used to be.
      window.setTimeout(() => {
        const again = el.getBoundingClientRect()
        setBox({
          top: again.top + window.scrollY,
          left: again.left + window.scrollX,
          width: again.width,
          height: again.height,
        })
      }, 380)
    }
  }, [stop])

  useLayoutEffect(measure, [measure])

  useEffect(() => {
    window.addEventListener("resize", measure)
    return () => window.removeEventListener("resize", measure)
  }, [measure])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") finish()
      else if (e.key === "ArrowRight" || e.key === "Enter") {
        e.preventDefault()
        setIndex((i) => (i + 1 >= stops.length ? (finish(), i) : i + 1))
      } else if (e.key === "ArrowLeft") setIndex((i) => Math.max(0, i - 1))
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [finish, stops.length])

  useEffect(() => {
    cardRef.current?.focus()
  }, [index])

  if (!stop || !box) return null

  const PAD = 8
  const spot = {
    top: box.top - PAD,
    left: box.left - PAD,
    width: box.width + PAD * 2,
    height: box.height + PAD * 2,
  }

  // Place the card under the target, or above it when there is no room.
  const below = spot.top + spot.height - window.scrollY + 190 < window.innerHeight
  const cardTop = below ? spot.top + spot.height + 12 : spot.top - 12
  const cardLeft = Math.max(16, Math.min(spot.left, window.innerWidth - 380))

  return (
    <div className="tour" role="dialog" aria-modal="true" aria-label="Product tour">
      {/* Four panels around the target rather than one overlay with a hole,
          so the spotlit element stays fully interactive and un-dimmed. */}
      <div className="tour-veil" style={{ top: 0, left: 0, width: "100%", height: Math.max(0, spot.top) }} />
      <div
        className="tour-veil"
        style={{ top: spot.top + spot.height, left: 0, width: "100%", height: `calc(100% - ${spot.top + spot.height}px)` }}
      />
      <div className="tour-veil" style={{ top: spot.top, left: 0, width: Math.max(0, spot.left), height: spot.height }} />
      <div
        className="tour-veil"
        style={{ top: spot.top, left: spot.left + spot.width, width: `calc(100% - ${spot.left + spot.width}px)`, height: spot.height }}
      />

      <div className="tour-ring" style={{ top: spot.top, left: spot.left, width: spot.width, height: spot.height }} />

      <div
        className={"tour-card" + (below ? "" : " above")}
        style={{ top: cardTop, left: cardLeft }}
        ref={cardRef}
        tabIndex={-1}
      >
        <div className="tour-head">
          <IconPointer size={15} />
          <span>
            {index + 1} of {stops.length}
          </span>
          <button className="tour-skip" onClick={finish}>
            Skip
          </button>
        </div>
        <h3>{stop.title}</h3>
        <p>{stop.body}</p>
        <div className="tour-actions">
          <button onClick={() => setIndex((i) => Math.max(0, i - 1))} disabled={index === 0}>
            Back
          </button>
          {index + 1 < stops.length ? (
            <button className="primary" onClick={() => setIndex(index + 1)}>
              Next <IconArrowRight size={15} />
            </button>
          ) : (
            <button className="primary" onClick={finish}>
              Got it
            </button>
          )}
        </div>
        <p className="tour-keys">Arrow keys to move, Esc to close.</p>
      </div>
    </div>
  )
}
