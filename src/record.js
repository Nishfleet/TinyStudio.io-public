import costing from "../config/costing.json" with { type: "json" };


const ROWS = new Map(costing.rows.map((row) => [row.faultType, row]));

export function costFault(fault, inputs) {
  if (!(inputs.dealValue > 0) || !(inputs.monthlyLeads > 0)) throw new Error("deal value and monthly leads must be above zero");
  const row = ROWS.get(fault.type);
  if (!row) return { fault, row: null, monthlyCost: null };
  const monthlyCost = Math.round(inputs.monthlyLeads * (row.deltaPct / 100) * inputs.dealValue);
  return { fault, row, monthlyCost };
}

export function reviewFaults(faults, review) {
  if (!review || typeof review.summary !== "string" || !review.summary.trim()) {
    throw new Error("reviewer summary missing");
  }
  if (!Array.isArray(review.keep)) throw new Error("reviewer keep list missing");
  const kept = new Set(review.keep);
  return { faults: faults.filter((fault) => kept.has(fault.id)), summary: review.summary.trim() };
}

function esc(value) {
  return String(value).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

const money = (n) => `$${n.toLocaleString("en-US")}`;

function cited(text, cite) {
  return `<span class="fig" data-cite="${esc(cite)}">${esc(text)}</span>`;
}

export function renderRecord({ request, faults, summary, version, renderedAt, receiptId }) {
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
${receiptId ? `<p><a href="/records/${esc(receiptId)}">Read the Proof Receipt: this rerun set beside the first run, fault by fault.</a></p>
` : ""}<h2>Where each number comes from</h2>
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

const runKey = (id, version) => `records/${id}.v${version}.json`;

async function storeRun(env, recordId, run) {
  await env.RECORDS.put(runKey(recordId, run.version), JSON.stringify(run), {
    httpMetadata: { contentType: "application/json" }
  });
}

async function loadRun(env, recordId, version) {
  const object = await env.RECORDS.get(runKey(recordId, version));
  if (!object) return null;
  const run = JSON.parse(await object.text());
  return Array.isArray(run.faults) && typeof run.renderedAt === "string" ? run : null;
}

function rowCite(faults) {
  const rows = new Set(faults.map((fault) => ROWS.get(fault.type)).filter((row) => row && row.deltaPct > 0).map((row) => row.id));
  return [...rows].map((id) => `row:${id}`).concat("input:dealValue", "input:monthlyLeads").join(" ");
}

function faultLine(costed, verdict) {
  const { fault, row, monthlyCost } = costed;
  return `<li class="fault">
<h3>${esc(fault.title)}</h3>
<p class="where">${esc(fault.url)}</p>
<p>${esc(fault.evidence)}</p>
<p>${row && row.deltaPct > 0
    ? `${verdict}: ${cited(money(monthlyCost), `row:${row.id} input:dealValue input:monthlyLeads`)}.`
    : "Not priced: the costing table claims no conversion delta for this fault."}</p>
</li>`;
}

export function renderProofReceipt({ request, before, after, renderedAt }) {
  const inputs = { dealValue: request.avg_deal_value, monthlyLeads: request.monthly_leads };
  const cost = (faults) => faults.map((fault) => costFault(fault, inputs));
  const afterIds = new Set(after.faults.map((fault) => fault.id));
  const beforeIds = new Set(before.faults.map((fault) => fault.id));
  const closed = cost(before.faults.filter((fault) => !afterIds.has(fault.id)));
  const kept = cost(after.faults.filter((fault) => beforeIds.has(fault.id)));
  const added = cost(after.faults.filter((fault) => !beforeIds.has(fault.id)));
  const total = (items) => items.reduce((sum, item) => sum + (item.monthlyCost || 0), 0);
  const sources = [...new Map(
    [...closed, ...kept, ...added].filter((item) => item.row && item.row.deltaPct > 0).map((item) => [item.row.id, item.row])
  ).values()];
  const sourceHtml = sources
    .map((row) => `<li id="row-${esc(row.id)}">${esc(row.label)}: <a href="${esc(row.source.url)}">${esc(row.source.title)}</a>. ${esc(row.basis)}</li>`)
    .join("\n");
  const section = (title, items, verdict, emptyLine) => `<h2>${title}</h2>
${items.length
    ? `<ol>\n${items.map((item) => faultLine(item, verdict)).join("\n")}\n</ol>`
    : `<p>${emptyLine}</p>`}`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Proof Receipt for ${esc(request.site_url)} | TinyStudio</title>
<style>
body{font:16px/1.6 Georgia,serif;max-width:42rem;margin:2rem auto;padding:0 1rem;color:#111;background:#fff}
h1{font-size:1.7rem}h3{margin-bottom:0}.where{color:#555;margin:0;font-size:.9rem}
.fault{margin-bottom:1.5rem}.total{font-size:1.2rem;border-top:2px solid #111;padding-top:1rem}
@media print{body{margin:0;max-width:none}a{color:inherit}}
</style>
</head>
<body>
<main data-receipt-rendered-at="${esc(renderedAt)}">
<h1>Proof Receipt: ${esc(request.site_url)}</h1>
<p>Prepared for ${esc(request.name)}. The record of <time datetime="${esc(before.renderedAt)}">${esc(before.renderedAt.slice(0, 10))}</time> is compared with the rerun of <time datetime="${esc(after.renderedAt)}">${esc(after.renderedAt.slice(0, 10))}</time>, page to page, fault by fault.</p>
<h2>Summary</h2>
<p>${esc(after.summary)}</p>
${section("Faults closed", closed, "Monthly cost removed", "No fault from the first run has disappeared.")}
${section("Faults still present", kept, "Monthly cost still carried", "Every fault from the first run is gone.")}
${section("New faults", added, "New monthly cost", "The rerun found no new fault.")}
<p class="total">Monthly cost before: ${cited(money(total(closed) + total(kept)), rowCite(before.faults))}. Monthly cost now: ${cited(money(total(added) + total(kept)), rowCite(after.faults))}.</p>
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

export function driftEmail({ env, request, recordId, receiptId, origin }) {
  const link = `${origin}/records/${recordId}`;
  const receipt = `${origin}/records/${receiptId}`;
  return {
    from: env.CONFIRMATION_FROM || "TinyStudio <appraisals@tinystudio.io>",
    to: request.email,
    subject: `The appraisal of ${request.site_url} was rerun`,
    text: [
      "Hello,",
      "",
      `We reran the appraisal of ${request.site_url}. New faults have appeared. The updated record is here: ${link}`,
      `The Proof Receipt sets the two runs side by side, fault by fault: ${receipt}`,
      "",
      "TinyStudio"
    ].join("\n")
  };
}

async function publishProofReceipt(env, request, recordId, receiptId, before, after, at) {
  const html = renderProofReceipt({ request, before, after, renderedAt: at });
  await env.RECORDS.put(recordKey(receiptId), html, { httpMetadata: { contentType: "text/html; charset=utf-8" } });
  await env.DB.prepare(
    "INSERT INTO proof_receipts (id, request_id, record_id, before_version, after_version, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)"
  ).bind(receiptId, request.id, recordId, before.version, after.version, at).run();
  await writeEvent(env, request.id, "proof_receipt_rendered", `${receiptId} v${before.version}->v${after.version}`, at);
}

async function writeEvent(env, requestId, type, detail, at) {
  await env.DB.prepare("INSERT INTO appraisal_events (request_id, type, detail, created_at) VALUES (?1, ?2, ?3, ?4)")
    .bind(requestId, type, detail, at).run();
}

export async function publishRecord(env, requestId, { faults, review }, origin, at) {
  const request = await env.DB.prepare("SELECT * FROM appraisal_requests WHERE id = ?1").bind(requestId).first();
  if (!request) throw new Error("appraisal request not found");
  const reviewed = reviewFaults(faults, review);
  const existing = await env.DB.prepare("SELECT id, version FROM appraisal_records WHERE request_id = ?1").bind(requestId).first();
  const id = existing ? existing.id : crypto.randomUUID();
  const version = existing ? existing.version + 1 : 1;
  const run = { version, renderedAt: at, summary: reviewed.summary, faults: reviewed.faults };
  const before = version === 1 ? null : await loadRun(env, id, version - 1);
  const receiptId = before ? crypto.randomUUID() : null;
  const html = renderRecord({ request, faults: reviewed.faults, summary: reviewed.summary, version, renderedAt: at, receiptId });
  await env.RECORDS.put(recordKey(id), html, { httpMetadata: { contentType: "text/html; charset=utf-8" } });
  await env.DB.prepare(
    "INSERT INTO appraisal_records (id, request_id, version, rendered_at) VALUES (?1, ?2, ?3, ?4) ON CONFLICT(id) DO UPDATE SET version = excluded.version, rendered_at = excluded.rendered_at"
  ).bind(id, requestId, version, at).run();
  await writeEvent(env, requestId, "record_rendered", `${id} v${version}`, at);
  await storeRun(env, id, run);
  if (version === 1) {
    await env.EMAIL.send(recordEmail({ env, request, recordId: id, origin }));
    return { id, version };
  }
  if (!before) {
    await writeEvent(env, requestId, "drift_baseline_missing", `${id} v${version}`, at);
    return { id, version };
  }
  await publishProofReceipt(env, request, id, receiptId, before, run, at);
  const beforeIds = new Set(before.faults.map((fault) => fault.id));
  const inputs = { dealValue: request.avg_deal_value, monthlyLeads: request.monthly_leads };
  const newCost = run.faults
    .filter((fault) => !beforeIds.has(fault.id))
    .reduce((sum, fault) => sum + (costFault(fault, inputs).monthlyCost || 0), 0);
  const floor = costing.drift?.minNewMonthlyCost;
  if (typeof floor === "number" && newCost >= floor) {
    await env.EMAIL.send(driftEmail({ env, request, recordId: id, receiptId, origin }));
    await writeEvent(env, requestId, "drift_email_sent", `${id} +${newCost}`, at);
  } else {
    await writeEvent(env, requestId, "drift_below_threshold", `${id} +${newCost}`, at);
  }
  return { id, version };
}
