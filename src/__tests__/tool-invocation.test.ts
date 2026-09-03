import { beforeEach, describe, expect, it } from "vitest"
import { executeToolByName, getToolEntries, initTools } from "../webmcp"
import { clearAll } from "../store"

/**
 * Reproduces the way ChatGPT's in-app browser actually calls these tools.
 *
 * The spec says execute(inputObject, {signal}) with signal required. That
 * implementation passes an options object with NO signal, and one that passes
 * no options object at all is equally permitted by a Promise<any> callback.
 * Every tool read `.aborted` off it, so every native invocation threw
 * "Cannot read properties of undefined (reading 'aborted')" before the body
 * ran, while the tool LIST looked perfect. Discovery worked, invocation did
 * not, which is the worst shape a bug can take.
 */
describe("tools survive how implementations really call them", () => {
  beforeEach(async () => {
    localStorage.clear()
    sessionStorage.clear()
    clearAll()
    await initTools()
  })

  const readOnly = ["list_flows", "get_site_info", "recall_page", "get_run_status", "check_flow_health"]

  it("registers the built-in tools", () => {
    const names = getToolEntries().map((e) => e.tool.name)
    for (const n of readOnly) expect(names).toContain(n)
  })

  it("does not throw when options has no signal, which is the reported bug", async () => {
    for (const name of readOnly) {
      const tool = getToolEntries().find((e) => e.tool.name === name)!.tool
      // Exactly what the transcript showed: an options object, no signal.
      const result = await tool.execute({}, {} as { signal: AbortSignal })
      expect(result).toBeDefined()
      expect(JSON.stringify(result)).not.toContain("aborted")
    }
  })

  it("does not throw when the options argument is missing entirely", async () => {
    for (const name of readOnly) {
      const tool = getToolEntries().find((e) => e.tool.name === name)!.tool
      const call = tool.execute as (a: Record<string, unknown>) => Promise<unknown>
      const result = await call({})
      expect(result).toBeDefined()
    }
  })

  it("does not throw when args are missing too", async () => {
    const tool = getToolEntries().find((e) => e.tool.name === "list_flows")!.tool
    const call = tool.execute as () => Promise<unknown>
    await expect(call()).resolves.toBeDefined()
  })

  it("still honours a real signal when one is given", async () => {
    const controller = new AbortController()
    controller.abort()
    const tool = getToolEntries().find((e) => e.tool.name === "list_flows")!.tool
    const result = await tool.execute({}, { signal: controller.signal })
    expect(JSON.stringify(result)).toContain("Cancelled")
  })

  it("routes the same way through executeToolByName", async () => {
    const result = await executeToolByName("get_site_info", {})
    expect(JSON.stringify(result)).toContain("version")
  })
})
