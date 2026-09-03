import { access } from "node:fs/promises"

/**
 * Run a public page's own JavaScript, then snapshot the DOM.
 *
 * Only used when a plain GET had no learnable fields. Still GET-only: we never
 * type, click a submit, or send cookies. Subresource requests that look private
 * are aborted so page JS cannot use us as an SSRF trampoline.
 */

const RENDER_MS = 20_000

function looksPrivateUrl(urlString) {
  try {
    const u = new URL(urlString)
    if (u.protocol !== "http:" && u.protocol !== "https:" && u.protocol !== "data:" && u.protocol !== "blob:") {
      return true
    }
    if (u.protocol === "data:" || u.protocol === "blob:") return false
    const h = u.hostname.toLowerCase()
    if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h === "0.0.0.0") return true
    if (h === "metadata.google.internal" || h.endsWith(".internal")) return true
    if (/^\d+\.\d+\.\d+\.\d+$/.test(h)) {
      const [a, b] = h.split(".").map(Number)
      if (a === 0 || a === 10 || a === 127) return true
      if (a === 169 && b === 254) return true
      if (a === 172 && b >= 16 && b <= 31) return true
      if (a === 192 && b === 168) return true
      if (a === 100 && b >= 64 && b <= 127) return true
      if (a >= 224) return true
    }
    if (h === "::1" || h.startsWith("fd") || h.startsWith("fe80")) return true
    return false
  } catch {
    return true
  }
}

async function chromePath() {
  const candidates = [
    process.env.PUPPETEER_EXECUTABLE_PATH,
    process.env.CHROME_PATH,
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium-browser",
    "/usr/bin/chromium",
  ].filter(Boolean)
  for (const p of candidates) {
    try {
      await access(p)
      return p
    } catch {
      /* next */
    }
  }
  return null
}

async function launchBrowser() {
  const puppeteer = (await import("puppeteer-core")).default
  const onLambda = !!(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME)

  if (onLambda) {
    const chromium = (await import("@sparticuz/chromium")).default
    return puppeteer.launch({
      args: [...chromium.args, "--disable-gpu"],
      defaultViewport: { width: 1280, height: 900 },
      executablePath: await chromium.executablePath(),
      headless: true,
    })
  }

  const executablePath = await chromePath()
  return puppeteer.launch({
    executablePath: executablePath ?? undefined,
    channel: executablePath ? undefined : "chrome",
    headless: true,
    defaultViewport: { width: 1280, height: 900 },
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  })
}

/**
 * @param {string} url
 * @returns {Promise<{ html?: string, error?: string }>}
 */
export async function renderPublicPage(url) {
  let browser
  try {
    browser = await launchBrowser()
    const page = await browser.newPage()
    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
    )
    await page.setRequestInterception(true)
    page.on("request", (req) => {
      const dest = req.url()
      if (looksPrivateUrl(dest)) {
        void req.abort()
        return
      }
      void req.continue()
    })

    await page.goto(url, { waitUntil: "networkidle2", timeout: RENDER_MS })
    await page.waitForSelector("input, select, textarea", { timeout: 4000 }).catch(() => {})
    const html = await page.content()
    if (!html) return { error: "Headless Chrome returned an empty document." }
    return { html }
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Headless Chrome could not open that page." }
  } finally {
    if (browser) await browser.close().catch(() => {})
  }
}
