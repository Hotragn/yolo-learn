import { describe, expect, it } from "vitest"
import { readFormFromHTML } from "../discover"

describe("reading a form this app did not write", () => {
  it("takes purposes from name attributes, not from label text", () => {
    const r = readFormFromHTML(`<form>
      <div><span>Permit number</span><input name="permit_ref" required></div>
      <div><span>Vehicle registration</span><input name="vehicle_reg" required></div>
      <button type="submit">Continue to payment</button>
    </form>`)
    expect(r.ok).toBe(true)
    expect(r.provenance.map((p) => p.purpose)).toEqual(["permit ref", "vehicle reg"])
    expect(r.provenance.every((p) => p.from.startsWith("name="))).toBe(true)
    expect(r.submitLabel).toBe("Continue to payment")
  })

  it("falls back to autocomplete tokens when there is no name", () => {
    const r = readFormFromHTML(`<form>
      <label>Parent email <input type="email" autocomplete="email" required></label>
      <label>Child's full name <input autocomplete="name" required></label>
      <button>Place order</button>
    </form>`)
    expect(r.ok).toBe(true)
    expect(r.provenance.map((p) => p.from)).toEqual(['autocomplete="email"', 'autocomplete="name"'])
  })

  it("refuses passwords and card numbers without reading them", () => {
    const r = readFormFromHTML(`<form>
      <label>Child's name <input name="child_name" required></label>
      <label>Password <input type="password" autocomplete="current-password"></label>
      <label>Card <input autocomplete="cc-number"></label>
      <button>Go</button>
    </form>`)
    expect(r.ok).toBe(true)
    expect(r.refused).toHaveLength(2)
    expect(r.fields.map((f) => f.purpose)).toEqual(["child name"])
    // Nothing about the refused fields leaks into what was read.
    expect(JSON.stringify(r.provenance)).not.toMatch(/password|cc-number/i)
  })

  it("reads real option values off a select", () => {
    const r = readFormFromHTML(`<form>
      <select name="parking_zone" required>
        <option value="">Select a zone</option>
        <option value="A">Zone A - North</option>
        <option value="B">Zone B - Riverside</option>
      </select>
      <button>Next</button>
    </form>`)
    const zone = r.provenance.find((p) => p.purpose === "parking zone")
    expect(zone?.required).toBe(true)
    expect(zone?.options?.length).toBe(2)
  })

  it("skips a hidden honeypot and a disabled field", () => {
    const r = readFormFromHTML(`<form>
      <input name="sku" required>
      <input type="text" name="url" style="display:none">
      <input name="legacy" value="X" disabled>
      <button>Submit order</button>
    </form>`)
    expect(r.fields.map((f) => f.purpose)).toEqual(["sku"])
  })

  it("accepts a fragment with no form wrapper", () => {
    const r = readFormFromHTML(`<label>Your name <input name="full_name" required></label>`)
    expect(r.ok).toBe(true)
    expect(r.fields[0].purpose).toBe("full name")
  })

  it("explains itself instead of throwing on junk", () => {
    expect(readFormFromHTML("").message).toMatch(/paste some html/i)
    expect(readFormFromHTML("<p>hello</p>").ok).toBe(false)
    expect(readFormFromHTML("<p>hello</p>").message).toMatch(/no form controls/i)
    expect(readFormFromHTML("<<<>>").ok).toBe(false)
  })

  it("reports when a form was nothing but credentials", () => {
    const r = readFormFromHTML(`<form>
      <input type="password" name="pw">
      <button>Sign in</button>
    </form>`)
    expect(r.ok).toBe(false)
    expect(r.message).toMatch(/credential or payment/i)
  })
})

describe("label reading", () => {
  it("does not swallow option text into a wrapping label", () => {
    const r = readFormFromHTML(`<form>
      <label>Year group
        <select name="year_group" required>
          <option value="">Choose</option>
          <option>Year 3</option><option>Year 4</option>
        </select>
      </label>
      <button>Go</button>
    </form>`)
    expect(r.provenance[0].label).toBe("Year group")
  })

  it("still prefers a span when the markup provides one", () => {
    const r = readFormFromHTML(`<form>
      <label><span>Preferred date</span><input name="date" type="date" required></label>
      <button>Go</button>
    </form>`)
    expect(r.provenance[0].label).toBe("Preferred date")
  })

  it("strips a required asterisk", () => {
    const r = readFormFromHTML(`<form>
      <label>Phone number * <input name="phone" required></label>
      <button>Go</button>
    </form>`)
    expect(r.provenance[0].label).toBe("Phone number")
  })
})
