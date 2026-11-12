const DESK_CSP = "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'";
/** @type {Record<string, string>} */
const HTML_ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
/** @param {unknown} value */
const esc = (value) => String(value).replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]);

/** @param {string} title @param {string} body */
const SHELL = (title, body) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${esc(title)} | TinyStudio</title>
<style>
body{font:16px/1.5 Georgia,serif;max-width:52rem;margin:2rem auto;padding:0 1rem;color:#111;background:#fff}
table{width:100%;border-collapse:collapse}
th,td{border:1px solid #ddd;padding:.5rem;text-align:left;vertical-align:top}
.muted{color:#666;font-size:.85rem}
button{font:inherit;padding:.4rem .8rem}
textarea{width:100%;min-height:3rem}
</style>
</head>
<body>
<main>
${body}
</main>
</body>
</html>
`;

/** @param {CorrectionLineRow} line */
function lineCell(line) {
  return `<div class="line">
<p><strong>${esc(line.fault_title)}</strong></p>
<p>Before: ${esc(line.before_text)}</p>
<p>After: ${esc(line.after_text)}</p>
${Number(line.legal_copy) === 1 ? '<p class="muted">Legal copy: it publishes only with written consent on file.</p>' : ""}
<form method="post" action="/api/desk/correction-lines/${esc(line.id)}/review">
<input type="hidden" name="action" value="approve">
<input type="text" name="note" placeholder="Review note (optional)">
<button type="submit">Approve</button>
</form>
<form method="post" action="/api/desk/correction-lines/${esc(line.id)}/review">
<input type="hidden" name="action" value="reject">
<input type="text" name="note" placeholder="Why this line is rejected">
<button type="submit">Reject</button>
</form>
</div>`;
}

/** @param {DeskQueueRow} row @param {string | undefined} reportUrlTemplate */
function sourceCell(row, reportUrlTemplate) {
  if (row.source !== "seofixkit" || !row.report_id) return "";
  const template = String(reportUrlTemplate || "");
  const href = template.includes("{id}")
    ? template.replace("{id}", encodeURIComponent(row.report_id))
    : "";
  return `<span class="muted">via SEO Fix Kit report${
    href ? ` <a href="${esc(href)}" rel="noopener">${esc(row.report_id)}</a>` : ` ${esc(row.report_id)}`
  }</span><br>`;
}

/** @param {DeskQueueRow[]} rows @param {CorrectionLineRow[]} lines @param {string | undefined} [reportUrlTemplate] */
export function deskQueuePage(rows, lines, reportUrlTemplate = "https://app.seofixkit.com/reports/{id}") {
  /** @type {Map<string, CorrectionLineRow[]>} */
  const byEngagement = new Map();
  for (const line of lines) {
    byEngagement.set(line.engagement_id, [...(byEngagement.get(line.engagement_id) ?? []), line]);
  }
  const body = rows.length
    ? `<h1>Desk review</h1>
<table>
<thead><tr><th>Site</th><th>State</th><th>Opened</th><th>Correction lines to review</th><th>Payments</th><th>Checkout</th></tr></thead>
<tbody>
${rows
  .map(
    (row) => `<tr>
<td><strong>${esc(row.site_url)}</strong><br><span class="muted">${esc(row.email)}</span><br>${sourceCell(row, reportUrlTemplate)}</td>
<td>${esc(row.status)}</td>
<td>${esc(row.created_at)}</td>
<td>${byEngagement.get(row.id)?.map(lineCell).join("<hr>") || '<span class="muted">nothing awaiting review</span>'}</td>
<td>${row.payment_rows > 1
      ? `<strong>${esc(String(row.payment_rows))} payments received</strong><br><span class="muted">Refund the extra payment and tell the customer.</span>`
      : row.payment_rows === 1
        ? '<span class="muted">one payment</span>'
        : '<span class="muted">no payment yet</span>'}</td>
<td>${row.checkout_session_id ? `<span class="muted">${esc(row.checkout_session_id)}</span>` : '<span class="muted">no checkout session yet</span>'}</td>
</tr>`
  )
  .join("\n")}
</tbody>
</table>
<p class="muted">Every action here is written to the engagement journal with the reviewer name and the time.</p>`
    : "<h1>Desk review</h1>\n<p>No engagements yet.</p>";
  return new Response(SHELL("Desk review", body), {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "private, no-store",
      "X-Robots-Tag": "noindex, nofollow",
      "Content-Security-Policy": DESK_CSP
    }
  });
}
