import { describe, expect, it } from "vitest"
import { hasLearnableControls } from "../form-detect"

describe("when a GET is worth a JS render", () => {
  it("treats a hidden-only SPA shell as empty", () => {
    expect(
      hasLearnableControls(`<div id="root"></div><input type="hidden" name="csrf" value="x">`)
    ).toBe(false)
  })

  it("does not launch Chrome for a real HTML form", () => {
    expect(hasLearnableControls(`<form><label>Name <input name="n"></label></form>`)).toBe(true)
  })
})
