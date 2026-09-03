import { useState } from "react"
import { readFormFromHTML, StaticReadResult } from "./discover"
import { logEvent } from "./store"
import { IconAlert, IconCheck, IconNoKey, IconRead } from "./icons"

/**
 * Read a form this app did not write.
 *
 * The demo learns a clinic we authored and survives a redesign we authored,
 * which is a fair thing for a reviewer to be suspicious of. This page exists
 * so the suspicion can be settled instead of argued: paste the markup of any
 * real form and watch the same field-reading code work on it, including where
 * it got each purpose from and what it refused to touch.
 *
 * The samples below are written to be structurally unlike our clinic on
 * purpose: no labels wired with "for", purposes hiding in autocomplete tokens,
 * a select with real option values, a honeypot, a password. They are still
 * samples though, and the paste box is the part that actually proves anything.
 */

const SAMPLES: { name: string; note: string; html: string }[] = [
  {
    name: "Parking permit renewal",
    note: "Government style: no for/id wiring, purposes only in name attributes",
    html: `<section>
  <h2>Renew your residential parking permit</h2>
  <form action="/permits/renew" method="post">
    <div class="fld"><span>Permit number</span>
      <input name="permit_ref" required maxlength="12"></div>
    <div class="fld"><span>Vehicle registration</span>
      <input name="vehicle_reg" required></div>
    <div class="fld"><span>Zone</span>
      <select name="parking_zone" required>
        <option value="">Select a zone</option>
        <option value="A">Zone A - North</option>
        <option value="B">Zone B - Riverside</option>
        <option value="C">Zone C - Hillcrest</option>
      </select></div>
    <div class="fld"><span>Renew from</span>
      <input name="start_date" type="date" required></div>
    <input type="text" name="url" style="display:none">
    <button type="submit">Continue to payment</button>
  </form>
</section>`,
  },
  {
    name: "School lunch order",
    note: "Purposes only in autocomplete tokens, plus a password it must refuse",
    html: `<main>
  <h1>Order next week's lunches</h1>
  <form>
    <label>Parent email <input type="email" autocomplete="email" required></label>
    <label>Contact number <input type="tel" autocomplete="tel"></label>
    <label>Child's full name <input autocomplete="name" required></label>
    <label>Year group
      <select name="year_group" required>
        <option value="">Choose</option>
        <option>Year 3</option><option>Year 4</option><option>Year 5</option>
      </select></label>
    <label>Dietary notes <textarea name="dietary_notes"></textarea></label>
    <label>Account password <input type="password" autocomplete="current-password" required></label>
    <button>Place order</button>
  </form>
</main>`,
  },
  {
    name: "Supplier reorder",
    note: "aria-label only, a disabled field, and a card number it must refuse",
    html: `<div>
  <h3>Reorder consumables</h3>
  <form>
    <input aria-label="Purchase order reference" name="po_ref" required>
    <input aria-label="Item SKU" name="sku" required>
    <input aria-label="Quantity" name="quantity" type="text" required>
    <input aria-label="Account code" value="LEGACY" disabled>
    <input aria-label="Card number" autocomplete="cc-number">
    <select aria-label="Delivery speed" name="delivery_speed">
      <option>Standard</option><option>Next day</option>
    </select>
    <button type="submit">Submit order</button>
  </form>
</div>`,
  },
]

export function AnyForm() {
  const [html, setHtml] = useState("")
  const [result, setResult] = useState<StaticReadResult | null>(null)

  const read = (source: string) => {
    const out = readFormFromHTML(source)
    setResult(out)
    logEvent(
      "learn",
      out.ok
        ? `Read a pasted form: ${out.fields.length} field(s), ${out.refused.length} refused`
        : `Could not read pasted markup: ${out.message}`
    )
  }

  return (
    <main>
      <h1>Read a form this app did not write</h1>
      <p className="sub">
        The demo learns a clinic we built, and survives a redesign we wrote. That is worth being suspicious of. So
        paste the markup of any real form here and watch the same code read it.
      </p>

      <div className="any-samples">
        <span className="explain-tag">Or start from a sample</span>
        <div className="row">
          {SAMPLES.map((s) => (
            <button
              key={s.name}
              onClick={() => {
                setHtml(s.html)
                read(s.html)
              }}
              title={s.note}
            >
              {s.name}
            </button>
          ))}
        </div>
        <p className="explain-note">
          Each sample is deliberately unlike our clinic: no <code>for</code>/<code>id</code> wiring, purposes hidden in{" "}
          <code>autocomplete</code> tokens, a hidden honeypot, a password. They are still samples we wrote. The paste
          box is the part that proves something.
        </p>
      </div>

      <label className="field">
        <span>
          HTML <small>right-click a real form, Inspect, then Copy outer HTML</small>
        </span>
        <textarea
          rows={9}
          className="any-input"
          spellCheck={false}
          placeholder={'<form>\n  <label>Your name <input name="full_name" required></label>\n  <button>Continue</button>\n</form>'}
          value={html}
          onChange={(e) => setHtml(e.target.value)}
        />
      </label>
      <div className="row">
        <button className="primary" onClick={() => read(html)}>
          <IconRead size={17} /> Read this form
        </button>
        {(html || result) && (
          <button
            onClick={() => {
              setHtml("")
              setResult(null)
            }}
          >
            Clear
          </button>
        )}
      </div>

      {result && (
        <section className={"any-result " + (result.ok ? "ok" : "bad")}>
          <p className="any-msg">
            {result.ok ? <IconCheck size={17} /> : <IconAlert size={17} />}
            <span>{result.message}</span>
          </p>

          {result.ok && (
            <>
              <dl className="any-meta">
                <div>
                  <dt>It called the task</dt>
                  <dd>
                    <code>{result.toolName}</code>
                  </dd>
                </div>
                <div>
                  <dt>Submit button</dt>
                  <dd>{result.submitLabel}</dd>
                </div>
                <div>
                  <dt>Forms on the page</dt>
                  <dd>{result.formCount}</dd>
                </div>
              </dl>

              <h2>What it read, and where from</h2>
              <p className="sub">
                The purpose is what survives a redesign. It comes from the attributes the server reads, never from the
                label text or a CSS selector, which is exactly what a visual refresh rewrites.
              </p>
              <table className="any-table">
                <thead>
                  <tr>
                    <th>Purpose</th>
                    <th>Label it showed</th>
                    <th>Read from</th>
                    <th>Required</th>
                  </tr>
                </thead>
                <tbody>
                  {result.provenance.map((p, i) => (
                    <tr key={i}>
                      <td>
                        <code>{p.purpose}</code>
                      </td>
                      <td>{p.label}</td>
                      <td>
                        <code>{p.from}</code>
                      </td>
                      <td>{p.required ? "yes" : "no"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {result.provenance.some((p) => p.options?.length) && (
                <p className="explain-note">
                  Option lists it picked up:{" "}
                  {result.provenance
                    .filter((p) => p.options?.length)
                    .map((p) => `${p.purpose} (${p.options!.length})`)
                    .join(", ")}
                  .
                </p>
              )}
            </>
          )}

          {result.refused.length > 0 && (
            <div className="any-refused">
              <p>
                <IconNoKey size={17} />
                <span>
                  <b>Refused {result.refused.length} field(s):</b> {result.refused.join(", ")}. Credential and payment
                  fields are never read, never stored and never filled.
                </span>
              </p>
            </div>
          )}
        </section>
      )}

      <h2>What this does and does not prove</h2>
      <div className="explainer">
        <div className="explain-card is-product">
          <span className="explain-tag">It does prove</span>
          <p>
            The field reading is not special-cased to our own markup. Purposes, labels, required flags and option lists
            come out of ordinary HTML, and credential fields are refused on sight.
          </p>
        </div>
        <div className="explain-card">
          <span className="explain-tag">It does not prove</span>
          <p>
            It cannot walk a wizard here, because that needs the site's own JavaScript and this only has its markup. Nor
            can it register a tool on somebody else's page: a WebMCP tool belongs to the document that registers it, so
            reaching real sites needs a browser extension.
          </p>
        </div>
      </div>
    </main>
  )
}
