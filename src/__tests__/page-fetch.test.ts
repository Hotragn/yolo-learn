import { describe, expect, it } from "vitest"
import { explainReadFailure } from "../page-fetch"

describe("judge-facing read errors", () => {
  it("never surfaces a JSON parse of index.html", () => {
    expect(explainReadFailure(`Unexpected token '<', "<!doctype "... is not valid JSON`)).toMatch(
      /page-read service did not answer/i
    )
  })

  it("tells a JS-only site to use an HTML form instead", () => {
    expect(explainReadFailure("No form controls in there. Paste the markup around the fields.")).toMatch(
      /no form fields in its HTML/i
    )
  })

  it("leaves an honest host error readable", () => {
    expect(explainReadFailure("example.com resolves to 127.0.0.1, which is a private or reserved address.")).toMatch(
      /127\.0\.0\.1/
    )
  })
})
