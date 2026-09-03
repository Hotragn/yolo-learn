import { beforeEach, describe, expect, it, vi } from "vitest"
import { forgetRemote, learnUrl } from "../remote"
import { toolNameForOrigin } from "../remembered"
import { clearAll } from "../store"
import { executeToolByName, getToolEntries, initTools } from "../webmcp"

describe("remembered origin tools", () => {
  beforeEach(async () => {
    localStorage.clear()
    sessionStorage.clear()
    clearAll()
    forgetRemote()
    vi.stubGlobal("fetch", async (input: string) => {
      const target = decodeURIComponent(String(input).split("url=")[1] ?? "")
      const html = `<h1>City permit</h1>
        <form>
          <label>Name <input name="n" required></label>
          <label>Email <input name="em" type="email"></label>
          <button>Submit</button>
        </form>`
      return {
        ok: true,
        json: async () => ({ html, finalUrl: target }),
      } as unknown as Response
    })
    await initTools()
  })

  it("names the tool from the host, not the path", () => {
    expect(toolNameForOrigin("https://www.w3.org/WAI/demos/bad/before/survey.html")).toBe(
      "remembered_www_w3_org"
    )
    expect(toolNameForOrigin("https://httpbin.org/forms/post")).toBe("remembered_httpbin_org")
  })

  it("mints a callable WebMCP tool after the first read, and a later call fetches nothing", async () => {
    const first = await learnUrl("https://permits.example.gov/apply")
    expect(first.ok).toBe(true)
    expect(first.cached).toBe(false)
    expect(first.toolName).toBe("remembered_permits_example_gov")
    expect(getToolEntries().map((e) => e.tool.name)).toContain("remembered_permits_example_gov")

    const calls: string[] = []
    vi.stubGlobal("fetch", async (input: string) => {
      calls.push(String(input))
      return { ok: true, json: async () => ({ html: "", finalUrl: "" }) } as unknown as Response
    })

    const result = (await executeToolByName("remembered_permits_example_gov", {})) as {
      servedFromMemory: boolean
      bytesRead: number
      origin: string
    }
    expect(result.servedFromMemory).toBe(true)
    expect(result.bytesRead).toBe(0)
    expect(result.origin).toBe("https://permits.example.gov")
    expect(calls).toHaveLength(0)
  })

  it("list_flows includes the remembered site", async () => {
    await learnUrl("https://permits.example.gov/apply")
    const listed = (await executeToolByName("list_flows", {})) as {
      rememberedSites: { tool: string; origin: string }[]
    }
    expect(listed.rememberedSites.some((s) => s.tool === "remembered_permits_example_gov")).toBe(true)
  })
})
