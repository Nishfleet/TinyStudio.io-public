const DESK_CSP = "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'";
const esc = (value) =>
  String(value).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

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

export function deskQueuePage(rows, lines) {
  const byEngagement = new Map();
  for (const line of lines) {
    if (!byEngagement.has(line.engagement_id)) byEngagement.set(line.engagement_id, []);
    byEngagement.get(line.engagement_id).push(line);
  }
  const body = rows.length
    ? `<h1>Desk review</h1>
<table>
<thead><tr><th>Site</th><th>State</th><th>Opened</th><th>Correction lines to review</th><th>Checkout</th></tr></thead>
<tbody>
${rows
  .map(
    (row) => `<tr>
<td><strong>${esc(row.site_url)}</strong><br><span class="muted">${esc(row.email)}</span></td>
<td>${esc(row.status)}</td>
<td>${esc(row.created_at)}</td>
<td>${byEngagement.get(row.id)?.map(lineCell).join("<hr>") || '<span class="muted">nothing awaiting review</span>'}</td>
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
