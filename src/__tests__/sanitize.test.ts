import { describe, expect, it } from "vitest"
import { attrsAreSensitive, SENSITIVE_NAME, stripSensitiveMarkup } from "../sanitize"
import { isSensitive, readFormFromHTML } from "../discover"

/**
 * This is the most sensitive input the app accepts: markup captured from a tab
 * the user is signed in to. The tests are written adversarially, because the
 * previous version matched only `type="password"` with quotes and would have
 * carried every other piece of the person's data straight through.
 */

const strip = stripSensitiveMarkup

describe("credentials are removed however they are written", () => {
  it("removes a quoted password input", () => {
    expect(strip('<input type="password" name="pw">')).not.toContain("input")
  })

  it("removes an UNQUOTED password input, which the first version missed", () => {
    expect(strip("<input type=password name=pw>")).not.toContain("input")
  })

  it("removes one with spaces around the equals sign", () => {
    expect(strip('<input type = "password">')).not.toContain("input")
  })

  it("ignores attribute order", () => {
    expect(strip('<input name="pw" id="x" type="password" class="y">')).not.toContain("input")
  })

  it("removes credential and card autocomplete tokens", () => {
    for (const token of ["current-password", "new-password", "cc-number", "cc-csc", "one-time-code"]) {
      expect(strip(`<input autocomplete="${token}" name="f">`)).not.toContain("input")
    }
  })

  it("removes a field named like a secret even with no telling type", () => {
    for (const name of ["cvv", "card_number", "ssn", "session_token", "otp", "pin", "security_answer"]) {
      expect(strip(`<input type="text" name="${name}">`)).toBe("")
    }
  })

  it("removes hidden inputs, where CSRF and session tokens live", () => {
    expect(strip('<input type="hidden" name="csrf" value="abc123">')).toBe("")
  })
})

describe("the user's own data is removed even from harmless fields", () => {
  it("drops a prefilled value on a signed-in page", () => {
    const out = strip('<input type="text" name="email" value="real.person@example.com">')
    expect(out).toContain("email")
    expect(out).not.toContain("real.person@example.com")
  })

  it("empties a textarea the person typed into", () => {
    const out = strip("<textarea name=notes>my private medical history</textarea>")
    expect(out).not.toContain("private medical history")
    expect(out).toContain("textarea")
  })

  it("drops checked and selected state", () => {
    expect(strip('<input type="checkbox" name="optin" checked>')).not.toContain("checked")
    expect(strip('<option value="x" selected>X</option>')).not.toContain("selected")
  })

  it("keeps an option's value, which is the site's vocabulary not the user's data", () => {
    const out = strip('<select name="service"><option value="checkup">Checkup</option></select>')
    expect(out).toContain('value="checkup"')
    expect(out).toContain("Checkup")
  })

  it("removes scripts, which carry bootstrapped user state as JSON", () => {
    const out = strip('<script>window.__USER={"email":"a@b.c"}</script><input name="q">')
    expect(out).not.toContain("a@b.c")
    expect(out).toContain('name="q"')
  })
})

describe("the shape survives, because the shape is the whole point", () => {
  const signedIn = `
    <h2>Your details</h2>
    <form action="/save" method="post">
      <label for="fn">Full name</label>
      <input id="fn" name="full_name" value="Real Person" required>
      <label for="pc">Postcode</label>
      <input id="pc" name="postcode" autocomplete="postal-code" value="SW1A 1AA" required>
      <label for="pw">Password</label>
      <input id="pw" name="password" type="password" value="hunter2">
      <input type="hidden" name="csrf_token" value="deadbeef">
      <textarea name="notes">something personal</textarea>
      <button type="submit">Save details</button>
    </form>`

  const read = readFormFromHTML(strip(signedIn))

  it("still reads the task", () => {
    expect(read.ok).toBe(true)
    expect(read.submitLabel).toBe("Save details")
  })

  it("keeps the non-sensitive purposes", () => {
    expect(read.fields.map((f) => f.purpose)).toContain("full name")
    expect(read.fields.map((f) => f.purpose)).toContain("postcode")
  })

  it("keeps required flags, which are structure not data", () => {
    expect(read.fields.find((f) => f.purpose === "full name")?.required).toBe(true)
  })

  it("carries no personal value anywhere in the result", () => {
    const json = JSON.stringify(read)
    for (const secret of ["Real Person", "SW1A 1AA", "hunter2", "deadbeef", "something personal"]) {
      expect(json).not.toContain(secret)
    }
  })

  it("does not surface the password or the token as fields", () => {
    const purposes = read.fields.map((f) => f.purpose).join(" ")
    expect(purposes).not.toMatch(/password|csrf/i)
  })
})

describe("edges", () => {
  it("handles empty and junk input without throwing", () => {
    expect(strip("")).toBe("")
    expect(strip("<<<not html")).toBeTypeOf("string")
    expect(() => strip("<input")).not.toThrow()
  })

  it("exposes the sensitivity test for reuse, so two modules cannot drift", () => {
    expect(attrsAreSensitive('type="password"')).toBe(true)
    expect(attrsAreSensitive('name="cvv"')).toBe(true)
    expect(attrsAreSensitive('name="full_name"')).toBe(false)
    expect(SENSITIVE_NAME.test("card_number")).toBe(true)
  })
})

describe("one source of truth for the sensitivity decision", () => {
  // discover.ts used to keep its own weaker copy of these patterns, missing
  // token, iban, auth and passcode. Two hand-maintained copies of a security
  // decision drift, and the weaker one silently wins wherever it is used.
  it("the element-level check agrees with the markup-level one", () => {
    const doc = new DOMParser().parseFromString(
      `<form>
         <input name="full_name">
         <input name="session_token">
         <input name="iban">
         <input name="passcode">
         <input type="password" name="pw">
       </form>`,
      "text/html"
    )
    for (const el of [...doc.querySelectorAll("input")]) {
      const attrs = [...el.attributes].map((a) => `${a.name}="${a.value}"`).join(" ")
      expect(attrsAreSensitive(attrs)).toBe(isSensitive(el as HTMLElement))
    }
  })

  it("catches the names the old duplicate missed", () => {
    for (const name of ["session_token", "iban", "passcode", "auth_key", "sort_code"]) {
      expect(attrsAreSensitive(`name="${name}"`)).toBe(true)
    }
  })
})
