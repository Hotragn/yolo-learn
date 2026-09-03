import { beforeEach, describe, expect, it } from "vitest"
import { discoverFlow } from "../discover"

/**
 * Discovery is DOM-only by design, so these tests build wizards it has never
 * seen — different markup, different labels, different button wording — rather
 * than reusing the demo site's model. That is the whole claim under test: it
 * learns a page nobody described to it.
 */

interface StepDef {
  heading: string
  controls: string
  submit: string
}

/** A plain-HTML wizard. Clicking the submit button swaps in the next step. */
function mountWizard(steps: StepDef[], opts: { toolname?: string; stall?: boolean } = {}) {
  document.body.innerHTML = `
    <main>
      <h2>Fixture Clinic</h2>
      <section id="wrap"></section>
    </main>`
  let index = 0

  const render = () => {
    const step = steps[index]
    const wrap = document.getElementById("wrap")!
    wrap.innerHTML = `
      <h3>${step.heading}</h3>
      <form ${opts.toolname ? `toolname="${opts.toolname}"` : ""}>
        ${step.controls}
        <button type="submit">${step.submit}</button>
      </form>`
    wrap.querySelector("button")!.addEventListener("click", (e) => {
      e.preventDefault()
      if (opts.stall) return render() // re-renders the same step forever
      if (index < steps.length - 1) {
        index++
        render()
      }
    })
  }
  render()
  return { current: () => index }
}

const FOUR_STEPS: StepDef[] = [
  {
    heading: "Step 1 of 4: choose service",
    controls: `<label><span>Service *</span>
      <select name="service_type" required>
        <option value=""></option>
        <option value="checkup">checkup</option>
        <option value="dental cleaning">dental cleaning</option>
      </select></label>`,
    submit: "Next",
  },
  {
    heading: "Step 2 of 4: pick date and time",
    controls: `<label><span>Preferred date *</span><input name="date" type="date" required /></label>`,
    submit: "Next",
  },
  {
    heading: "Step 3 of 4: enter patient details",
    controls: `<label><span>Your name *</span><input name="patient_name" required /></label>
      <label><span>Notes</span><input name="notes" /></label>`,
    submit: "Next",
  },
  { heading: "Step 4 of 4: confirm booking", controls: "", submit: "Confirm booking" },
]

beforeEach(() => {
  document.body.innerHTML = ""
})

describe("discoverFlow on a page it has never seen", () => {
  it("reads every step, in order, from the DOM alone", async () => {
    mountWizard(FOUR_STEPS, { toolname: "clinic_booking_form" })
    const { ok, flow } = await discoverFlow()

    expect(ok).toBe(true)
    expect(flow!.steps.map((s) => s.intent)).toEqual([
      "choose service",
      "pick date and time",
      "enter patient details",
      "confirm booking",
    ])
    expect(flow!.steps.map((s) => s.order)).toEqual([1, 2, 3, 4])
  })

  it("takes each field's purpose from its name attribute, which a redesign does not rewrite", async () => {
    mountWizard(FOUR_STEPS)
    const { flow } = await discoverFlow()
    expect(flow!.steps.flatMap((s) => s.fields.map((f) => f.purpose))).toEqual([
      "service type",
      "date",
      "patient name",
      "notes",
    ])
  })

  it("reads labels, required flags, option lists and input types", async () => {
    mountWizard(FOUR_STEPS)
    const { flow } = await discoverFlow()
    const fields = flow!.steps.flatMap((s) => s.fields)

    const service = fields.find((f) => f.purpose === "service type")!
    expect(service.label).toBe("Service")
    expect(service.type).toBe("select")
    expect(service.required).toBe(true)
    expect(service.options).toEqual(["checkup", "dental cleaning"])

    expect(fields.find((f) => f.purpose === "date")!.type).toBe("date")
    expect(fields.find((f) => f.purpose === "notes")!.required).toBe(false)
  })

  it("strips the step counter out of the intent", async () => {
    mountWizard(FOUR_STEPS)
    const { flow } = await discoverFlow()
    expect(flow!.steps[0].intent).not.toMatch(/step/i)
  })

  it("derives a tool name from the declarative toolname, minus the form suffix", async () => {
    mountWizard(FOUR_STEPS, { toolname: "clinic_booking_form" })
    const { flow } = await discoverFlow()
    expect(flow!.toolName).toBe("clinic_booking")
  })

  it("falls back to the page heading when the form declares no toolname", async () => {
    mountWizard(FOUR_STEPS)
    const { flow } = await discoverFlow()
    expect(flow!.toolName).toBe("fixture_clinic")
  })
})

describe("what discovery refuses to press", () => {
  it("stops at the last counted step without clicking its button", async () => {
    const wizard = mountWizard(FOUR_STEPS)
    const { flow } = await discoverFlow()
    // It read step 4 but never advanced past it.
    expect(flow!.steps).toHaveLength(4)
    expect(wizard.current()).toBe(3)
    expect(flow!.notes.join(" ")).toMatch(/without submitting/i)
  })

  it("refuses a button that does not read as a next-step button, even with no counter", async () => {
    mountWizard([
      { heading: "Your details", controls: `<label><span>Name</span><input name="full_name" /></label>`, submit: "Place order" },
      { heading: "Never reached", controls: "", submit: "Done" },
    ])
    const { flow } = await discoverFlow()
    expect(flow!.steps).toHaveLength(1)
    expect(flow!.notes.join(" ")).toContain("Place order")
  })

  it("accepts Continue and Proceed as next-step wording", async () => {
    mountWizard([
      { heading: "One", controls: `<label><span>A</span><input name="a" /></label>`, submit: "Continue" },
      { heading: "Two", controls: `<label><span>B</span><input name="b" /></label>`, submit: "Proceed to review" },
      { heading: "Three", controls: "", submit: "Pay now" },
    ])
    const { flow } = await discoverFlow()
    expect(flow!.steps.map((s) => s.intent)).toEqual(["one", "two", "three"])
    expect(flow!.notes.join(" ")).toContain("Pay now")
  })

  it("gives up instead of looping when the page stops advancing", async () => {
    mountWizard(
      [{ heading: "Stuck", controls: `<label><span>A</span><input name="a" required /></label>`, submit: "Next" }],
      { stall: true }
    )
    const { flow } = await discoverFlow({ maxSteps: 30 })
    expect(flow!.steps).toHaveLength(1)
    expect(flow!.notes.join(" ")).toMatch(/stopped advancing/i)
  })
})

describe("probe values", () => {
  it("fills required fields only, and reports them separately from the learned shape", async () => {
    mountWizard(FOUR_STEPS)
    const { flow } = await discoverFlow()
    // Probes exist for the required fields it had to satisfy to move on...
    expect(Object.keys(flow!.probes)).toContain("service type")
    expect(Object.keys(flow!.probes)).toContain("date")
    // ...and never for an optional one.
    expect(Object.keys(flow!.probes)).not.toContain("notes")
    // The learned shape carries no values at all.
    for (const step of flow!.steps) {
      for (const field of step.fields) {
        expect(field).not.toHaveProperty("value")
      }
    }
  })

  it("probes a select with a real option and a date with a real date", async () => {
    mountWizard(FOUR_STEPS)
    const { flow } = await discoverFlow()
    expect(flow!.probes["service type"]).toBe("checkup")
    expect(flow!.probes["date"]).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})

describe("markup discovery has not been told about", () => {
  it("uses the autocomplete token when there is no name attribute", async () => {
    mountWizard([
      {
        heading: "Contact",
        controls: `<label><span>Telephone</span><input autocomplete="tel" /></label>`,
        submit: "Finish",
      },
    ])
    const { flow } = await discoverFlow()
    expect(flow!.steps[0].fields[0].purpose).toBe("tel")
  })

  it("falls back to the label when there is neither name nor autocomplete", async () => {
    mountWizard([
      { heading: "Contact", controls: `<label><span>Postal code</span><input /></label>`, submit: "Finish" },
    ])
    const { flow } = await discoverFlow()
    expect(flow!.steps[0].fields[0].purpose).toBe("postal code")
  })

  it("reads a label associated by for/id rather than by wrapping", async () => {
    mountWizard([
      {
        heading: "Contact",
        controls: `<label for="em">Email address</label><input id="em" name="email" />`,
        submit: "Finish",
      },
    ])
    const { flow } = await discoverFlow()
    expect(flow!.steps[0].fields[0].label).toBe("Email address")
  })

  it("skips hidden, disabled and button inputs", async () => {
    mountWizard([
      {
        heading: "Contact",
        controls: `
          <input type="hidden" name="csrf" value="x" />
          <input name="disabled_one" disabled />
          <input name="styled_out" style="display:none" />
          <input type="button" name="a_button" value="Click" />
          <label><span>Real field</span><input name="real" /></label>`,
        submit: "Finish",
      },
    ])
    const { flow } = await discoverFlow()
    expect(flow!.steps[0].fields.map((f) => f.purpose)).toEqual(["real"])
  })

  it("describes a step by its fields when nothing labels it", async () => {
    document.body.innerHTML = `<form><input name="voucher_code" /><button type="submit">Redeem</button></form>`
    const { flow } = await discoverFlow()
    expect(flow!.steps[0].intent).toContain("voucher code")
  })

  it("reports a page with no form instead of throwing", async () => {
    document.body.innerHTML = `<p>Nothing to learn here.</p>`
    const result = await discoverFlow()
    expect(result.ok).toBe(false)
    expect(result.message).toMatch(/no form/i)
  })
})
