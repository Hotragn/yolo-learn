import handler from "./api/fetch-page.js"

function mock(url) {
  const res = {
    code: 0,
    body: null,
    headers: {},
    setHeader(k, v) {
      this.headers[k] = v
    },
    status(c) {
      this.code = c
      return this
    },
    json(b) {
      this.body = b
      return this
    },
  }
  return [{ query: { url } }, res]
}

const cases = [
  ["http://localhost:3000/", "hostname resolving to loopback"],
  ["http://127.0.0.1/", "literal loopback"],
  ["http://169.254.169.254/latest/meta-data/", "cloud metadata endpoint"],
  ["http://10.0.0.5/admin", "private 10/8"],
  ["http://192.168.1.1/", "private 192.168/16"],
  ["http://172.16.5.5/", "private 172.16/12"],
  ["http://100.64.1.1/", "CGNAT 100.64/10"],
  ["http://0.0.0.0/", "unspecified 0/8"],
  ["http://[::1]/", "IPv6 loopback"],
  ["http://[fd00::1]/", "IPv6 unique local"],
  ["file:///etc/passwd", "file scheme"],
  ["gopher://example.com/", "unsupported scheme"],
  ["not a url", "malformed"],
  ["", "empty"],
]

let pass = 0
let fail = 0
for (const [url, label] of cases) {
  const [req, res] = mock(url)
  await handler(req, res)
  const blocked = !!res.body?.error && !res.body?.html
  if (blocked) {
    pass++
    console.log(`  BLOCKED   ${label.padEnd(32)} ${String(res.body.error).slice(0, 70)}`)
  } else {
    fail++
    console.log(`  ALLOWED   ${label}   <-- SSRF HOLE`)
  }
}
console.log(`\n${pass} blocked, ${fail} allowed`)
process.exit(fail ? 1 : 0)
