import { beforeEach, describe, expect, it } from "vitest"
import { stripSensitiveMarkup } from "../sanitize"
import { forgetRemote, learnFromHtml } from "../remote"
import { clearAll } from "../store"
import { getToolEntries, initTools } from "../webmcp"

describe("snapshots from a logged-in tab", () => {
  beforeEach(async () => {
    localStorage.clear()
    sessionStorage.clear()
    clearAll()
    forgetRemote()
    await initTools()
  })

  it("strips password fields before learning", () => {
    const html = stripSensitiveMarkup(
      `<form><label>User <input name="login"></label><input type="password" name="password"><button>Go</button></form>`
    )
    expect(html).not.toMatch(/password/i)
    expect(html).toMatch(/login/)
  })

  it("learns the painted form and mints a remembered tool without fetching", async () => {
    const out = await learnFromHtml(
      "https://portal.example.com/app",
      `<form><label>Order id <input name="order_id" required></label><button>Next</button></form>`
    )
    expect(out.ok).toBe(true)
    expect(out.toolName).toMatch(/^remembered_portal_example_com_[a-z0-9]{4}$/)
    expect(out.steps[0].fields.map((f) => f.purpose)).toContain("order id")
    expect(getToolEntries().map((e) => e.tool.name)).toEqual(
      expect.arrayContaining([expect.stringMatching(/^remembered_portal_example_com_[a-z0-9]{4}$/)])
    )
  })
})
