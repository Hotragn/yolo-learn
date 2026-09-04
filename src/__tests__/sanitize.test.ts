import { describe, expect, it } from "vitest"
import { attrsAreSensitive, stripSensitiveMarkup } from "../sanitize"
import { readFormFromHTML } from "../discover"

/**
 * The security boundary for the most sensitive input this app accepts: HTML
 * captured from a tab the user is signed in to.
 *
 * The design is subtractive. Rather than hunting for the fields that look
 * dangerous and hoping the list is complete, it removes every category of
 * content that could carry a person's data and keeps only structure. So the
 * tests come in two halves: nothing personal may survive, and the shape must.
 */

const strip = stripSensitiveMarkup

/** Everything a signed-in page might hand over, in one document. */
const SIGNED_IN = `
<!doctype html><html><body>
  <script>window.__USER = {"email":"real@person.com","token":"sk-live-abc123"}</script>
  <h1>Your account</h1>
  <form method="post" action="/save">
    <label for="n">Full name</label>
    <input id="n" name="full_name" value="Real Person" required>

    <label for="e">Email</label>
    <input id="e" name="email" type="email" value="real@person.com" autocomplete="email">

    <label for="pw">Password</label>
    <input id="pw" name="password" type="password" value="hunter2">

    <label for="card">Card number</label>
    <input id="card" name="cardnumber" autocomplete="cc-number" value="4111111111111111">

    <input type="hidden" name="csrf_token" value="deadbeef-session">

    <label for="notes">Notes</label>
    <textarea id="notes" name="notes">I am going through a divorce.</textarea>

    <label for="svc">Service</label>
    <select id="svc" name="service">
      <option value="checkup">Checkup</option>
      <option value="dental" selected>Dental cleaning</option>
    </select>

    <label><input type="checkbox" name="marketing" checked> Email me offers</label>
    <button type="submit">Save</button>
  </form>
</body></html>`

const SECRETS = [
  "Real Person",
  "real@person.com",
  "hunter2",
  "4111111111111111",
  "deadbeef-session",
  "I am going through a divorce",
  "sk-live-abc123",
]

describe("nothing personal survives", () => {
  const out = strip(SIGNED_IN)

  it.each(SECRETS)("removes %s", (secret) => {
    expect(out).not.toContain(secret)
  })

  it("removes the credential and payment controls entirely, not just their values", () => {
    expect(out).not.toMatch(/type\s*=\s*["']?password/i)
    expect(out).not.toMatch(/cc-number/i)
    expect(out).not.toMatch(/name\s*=\s*["']?cardnumber/i)
  })

  it("removes hidden inputs, where session and CSRF tokens live", () => {
    expect(out).not.toMatch(/csrf/i)
    expect(out).not.toMatch(/type\s*=\s*["']?hidden/i)
  })

  it("empties a textarea rather than keeping what somebody typed", () => {
    expect(out).toMatch(/<textarea/i)
    expect(out).not.toContain("divorce")
  })

  it("drops the user's selection but keeps the site's vocabulary", () => {
    expect(out).not.toMatch(/\bselected\b/i)
    expect(out).not.toMatch(/\bchecked\b/i)
    expect(out).toContain('value="checkup"')
    expect(out).toContain("Dental cleaning")
  })

  it("removes scripts, which carry bootstrapped user state as JSON", () => {
    expect(out).not.toContain("<script")
    expect(out).not.toContain("__USER")
  })
})

describe("the shape survives", () => {
  const out = strip(SIGNED_IN)

  it("keeps the form, its controls and their names", () => {
    expect(out).toMatch(/<form/i)
    expect(out).toContain('name="full_name"')
    expect(out).toContain('name="email"')
    expect(out).toContain('name="service"')
  })

  it("keeps required flags and labels, which is what a purpose is read from", () => {
    expect(out).toContain("required")
    expect(out).toContain("Full name")
    expect(out).toContain("Email")
  })

  it("still reads as the same task afterwards", () => {
    const read = readFormFromHTML(out)
    expect(read.ok).toBe(true)
    const purposes = read.provenance.map((f) => f.purpose)
    expect(purposes).toContain("full name")
    expect(purposes).toContain("email")
    // Credential and payment fields are gone before the reader ever sees them.
    expect(purposes.join(" ")).not.toMatch(/password|card/i)
  })
})

describe("markup written the awkward ways", () => {
  it("catches an unquoted type attribute", () => {
    expect(strip("<input type=password name=p>")).not.toMatch(/password/i)
  })

  it("catches spaces around the equals sign", () => {
    expect(strip('<input type = "password" name="p">')).not.toMatch(/password/i)
  })

  it("catches uppercase tags and attributes", () => {
    expect(strip('<INPUT TYPE="PASSWORD" NAME="P">')).not.toMatch(/password/i)
  })

  it("catches single quotes", () => {
    expect(strip("<input type='password' name='p'>")).not.toMatch(/password/i)
  })

  it("does not care what order the attributes come in", () => {
    expect(strip('<input value="hunter2" name="x" type="password">')).not.toContain("hunter2")
    expect(strip('<input value="hunter2" type="password" name="x">')).not.toContain("hunter2")
  })

  it("catches a sensitive name even when the type is ordinary", () => {
    for (const attrs of [
      'name="user_password"',
      'name="passwd"',
      'name="cvv"',
      'name="ssn"',
      'name="iban"',
      'name="api_token"',
      'id="one_time_pin"',
    ]) {
      expect(attrsAreSensitive(attrs)).toBe(true)
    }
  })

  it("does not over-reach and delete ordinary fields", () => {
    for (const attrs of ['name="email"', 'name="postcode"', 'name="full_name"', 'name="pineapple"']) {
      expect(attrsAreSensitive(attrs)).toBe(false)
    }
  })

  it("strips a value that itself contains markup", () => {
    const out = strip(`<input name="bio" value="<b>Real Person</b>">`)
    expect(out).not.toContain("Real Person")
  })

  it("handles a self-closing input", () => {
    expect(strip('<input type="password" name="p" />')).not.toMatch(/password/i)
  })
})

describe("it is safe to call on anything", () => {
  it("returns empty for empty input", () => {
    expect(strip("")).toBe("")
  })

  it("leaves markup with no form alone", () => {
    const article = "<h1>An article</h1><p>Some words.</p>"
    expect(strip(article)).toContain("An article")
  })

  it("is idempotent, so a double pass changes nothing further", () => {
    const once = strip(SIGNED_IN)
    expect(strip(once)).toBe(once)
  })

  it("does not throw on malformed markup", () => {
    for (const junk of ["<input", "<<>>", "<form><input name=", "</textarea>", "<textarea>"]) {
      expect(() => strip(junk)).not.toThrow()
    }
  })
})
