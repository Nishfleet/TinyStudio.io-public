import costing from "../config/costing.json" with { type: "json" };

// M1c costing layer and Appraisal Record render (docs/PLAN.md 6.3 and 7).
// Every number in a record is built here from a costing row and the customer's
// two inputs, and is printed with the ids it traces to.

const ROWS = new Map(costing.rows.map((row) => [row.faultType, row]));

export function costFault(fault, inputs) {
  const row = ROWS.get(fault.type);
  if (!row) return { fault, row: null, monthlyCost: null };
  const monthlyCost = Math.round(inputs.monthlyLeads * (row.deltaPct / 100) * inputs.dealValue);
  return { fault, row, monthlyCost };
}

// The reviewer step: every fault is read, anything not kept is removed, and one
// paragraph summarises the rest. A record cannot render without both.
export function reviewFaults(faults, review) {
  if (!review || typeof review.summary !== "string" || !review.summary.trim()) {
    throw new Error("reviewer summary missing");
  }
  const kept = new Set(review.keep);
  return { faults: faults.filter((fault) => kept.has(fault.id)), summary: review.summary.trim() };
}

function esc(value) {
  return String(value).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

const money = (n) => `$${n.toLocaleString("en-US")}`;

// A figure is a <span data-cite="..."> naming the costing row and the inputs it
// came from, so CI can fail any number that has no citation.
function cited(text, cite) {
  return `<span class="fig" data-cite="${esc(cite)}">${esc(text)}</span>`;
}

export function renderRecord({ request, faults, summary, version, renderedAt }) {
  const inputs = { dealValue: request.avg_deal_value, monthlyLeads: request.monthly_leads };
  const costed = faults.map((fault) => costFault(fault, inputs));
  const total = costed.reduce((sum, item) => sum + (item.monthlyCost || 0), 0);
  const totalCite = costed.filter((i) => i.row).map((i) => `row:${i.row.id}`).concat("input:dealValue", "input:monthlyLeads").join(" ");
  const sources = [...new Map(costed.filter((i) => i.row).map((i) => [i.row.id, i.row])).values()];

  const faultHtml = costed
    .map(({ fault, row, monthlyCost }) => `<li class="fault">
<h3>${esc(fault.title)}</h3>
<p class="where">${esc(fault.url)}</p>
<p>${esc(fault.evidence)}</p>
<p>${row && row.deltaPct > 0
        ? `Estimated cost per month: ${cited(money(monthlyCost), `row:${row.id} input:dealValue input:monthlyLeads`)} (${cited(`${row.deltaPct}%`, `row:${row.id}`)} of ${cited(String(inputs.monthlyLeads), "input:monthlyLeads")} leads at ${cited(money(inputs.dealValue), "input:dealValue")} each).`
        : "Not priced: the costing table claims no conversion delta for this fault."}</p>
</li>`)
    .join("\n");

  const sourceHtml = sources
    .map((row) => `<li id="row-${esc(row.id)}">${esc(row.label)}: <a href="${esc(row.source.url)}">${esc(row.source.title)}</a>. ${esc(row.basis)}</li>`)
    .join("\n");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Appraisal Record for ${esc(request.site_url)} | TinyStudio</title>
<style>
body{font:16px/1.6 Georgia,serif;max-width:42rem;margin:2rem auto;padding:0 1rem;color:#111;background:#fff}
h1{font-size:1.7rem}h3{margin-bottom:0}.where{color:#555;margin:0;font-size:.9rem}
.fault{margin-bottom:1.5rem}.total{font-size:1.2rem;border-top:2px solid #111;padding-top:1rem}
@media print{body{margin:0;max-width:none}a{color:inherit}}
</style>
</head>
<body>
<main data-record-version="${Number(version)}" data-rendered-at="${esc(renderedAt)}">
<h1>Appraisal Record: ${esc(request.site_url)}</h1>
<p>Prepared for ${esc(request.name)}.</p>
<h2>Summary</h2>
<p>${esc(summary)}</p>
<h2>Faults found</h2>
<ol>
${faultHtml}
</ol>
<p class="total">Estimated monthly cost of these faults: ${cited(money(total), totalCite)}</p>
<h2>Where each number comes from</h2>
<p>Each figure above is the share of your monthly leads a fault is estimated to lose, taken from the table below, multiplied by your lead volume and your average deal value. It values the affected leads at deal value; it is an estimate, not a promise of revenue.</p>
<ul>
${sourceHtml}
</ul>
</main>
</body>
</html>
`;
}

export function recordEmail({ env, request, recordId, origin }) {
  const link = `${origin}/records/${recordId}`;
  return {
    from: env.CONFIRMATION_FROM || "TinyStudio <appraisals@tinystudio.io>",
    to: request.email,
    subject: `Your Appraisal Record for ${request.site_url}`,
    text: ["Hello,", "", `Your Appraisal Record is ready: ${link}`, "", "TinyStudio"].join("\n")
  };
}

export const RECORD_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export const recordKey = (id) => `records/${id}.html`;

// Render once per state change: reuse the request's record id, bump the version,
// overwrite the R2 object, write the event row. The email goes only after the
// object is stored, and always carries the record link.
export async function publishRecord(env, requestId, { faults, review }, origin, at) {
  const request = await env.DB.prepare("SELECT * FROM appraisal_requests WHERE id = ?1").bind(requestId).first();
  if (!request) throw new Error("appraisal request not found");
  const reviewed = reviewFaults(faults, review);
  const existing = await env.DB.prepare("SELECT id, version FROM appraisal_records WHERE request_id = ?1").bind(requestId).first();
  const id = existing ? existing.id : crypto.randomUUID();
  const version = existing ? existing.version + 1 : 1;
  const html = renderRecord({ request, faults: reviewed.faults, summary: reviewed.summary, version, renderedAt: at });
  await env.RECORDS.put(recordKey(id), html, { httpMetadata: { contentType: "text/html; charset=utf-8" } });
  await env.DB.prepare(
    "INSERT INTO appraisal_records (id, request_id, version, rendered_at) VALUES (?1, ?2, ?3, ?4) ON CONFLICT(id) DO UPDATE SET version = excluded.version, rendered_at = excluded.rendered_at"
  ).bind(id, requestId, version, at).run();
  await env.DB.prepare("INSERT INTO appraisal_events (request_id, type, detail, created_at) VALUES (?1, 'record_rendered', ?2, ?3)")
    .bind(requestId, `${id} v${version}`, at).run();
  await env.EMAIL.send(recordEmail({ env, request, recordId: id, origin }));
  return { id, version };
}
