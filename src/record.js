import costing from "../config/costing.json" with { type: "json" };
import offer from "../config/offer.json" with { type: "json" };
import { advanceEngagement, correctionLines, markLinesRecorded, openEngagement } from "./engagement.js";
import { assertPublishableLines } from "./guardrails.js";

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

const offerPrice = () => cited(money(offer.priceCents / 100), "offer:priceCents");
const offerWorkingDays = () => cited(String(offer.workingDays), "offer:workingDays");
const offerSlots = () => cited(String(offer.slotsPerMonth), "offer:slotsPerMonth");

function proposalStartDate(renderedAt) {
  const parsed = new Date(renderedAt);
  if (Number.isNaN(parsed.getTime())) return "";
  return new Date(Date.UTC(parsed.getUTCFullYear(), parsed.getUTCMonth() + 1, 1)).toISOString().slice(0, 10);
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const APPLIED_LINE_STATES = ["approved", "recorded"];
const REVIEWED_LINE_STATES = [...APPLIED_LINE_STATES, "rejected"];

function longDate(iso) {
  const parsed = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return "";
  return `${parsed.getUTCDate()} ${MONTHS[parsed.getUTCMonth()]} ${parsed.getUTCFullYear()}`;
}

function proposalBlock({ recordId, engagementStatus, renderedAt }) {
  const startDate = proposalStartDate(renderedAt);
  const startHtml = startDate ? cited(longDate(startDate), "offer:startDate") : "the next open slot";
  const awaitingPayment = !engagementStatus || engagementStatus === "proposed";
  return `<section class="proposal">
<h2>The proposal</h2>
<p>We will fix the faults listed above for ${offerPrice()}. Work starts on ${startHtml}. From the day you pay and give us access, the correction takes ${offerWorkingDays()} working days.</p>
<p class="terms">TinyStudio opens ${offerSlots()} appraisals a month. The proposal needs two things from you: ${esc(offer.requires[0])}, and ${esc(offer.requires[1])}.</p>
<p class="terms">${esc(offer.noGuarantee)}</p>
${awaitingPayment
    ? `<form method="post" action="/api/engagements/checkout">
<input type="hidden" name="recordId" value="${esc(recordId || "")}">
<button type="submit">Start the correction</button>
</form>`
    : `<p class="terms">We received your payment. The Correction Record below lists every change we made and every change we left alone.</p>`}
</section>`;
}

function correctionBlock({ engagementId, kickoffNote, lines }) {
  if (!lines.length) return "";
  const applied = lines.filter((line) => APPLIED_LINE_STATES.includes(line.status));
  const refused = lines.filter((line) => line.status === "rejected");
  assertPublishableLines(applied);
  const items = applied
    .map((line) => `<li class="correction-line" data-line-id="${esc(line.id)}">
<h3>${esc(line.fault_title)}</h3>
<p>Fault closed: ${esc(line.fault_title)}.</p>
<p>Before: ${esc(line.before_text)}</p>
<p>After: ${esc(line.after_text)}</p>
<p>Reviewed and approved by ${esc(line.reviewer || "the reviewer")}.</p>
</li>`)
    .join("\n");
  const refusedItems = refused
    .map((line) => `<li class="correction-refused" data-line-id="${esc(line.id)}">
<h3>${esc(line.fault_title)}</h3>
<p>Not applied: ${esc(line.review_note || "the reviewer did not approve this change")}</p>
</li>`)
    .join("\n");
  return `<section class="correction" data-cite="engagement:${esc(engagementId || "")}">
<h2>Correction Record</h2>
${kickoffNote ? `<p class="kickoff">Kickoff note: ${esc(kickoffNote)}</p>` : ""}
${applied.length ? `<ol>
${items}
</ol>` : ""}
${refused.length ? `<h3>Reviewed and not applied</h3>
<ul>
${refusedItems}
</ul>` : ""}
</section>`;
}

export function renderRecord({ request, faults, summary, version, renderedAt, recordId, engagementId, engagementStatus, kickoffNote, correctionLines: lines = [] }) {
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
.proposal{border-top:2px solid #111;margin-top:1.5rem;padding-top:1rem}
.terms{color:#444}.correction{border-top:2px solid #111;margin-top:1.5rem;padding-top:1rem}
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
${proposalBlock({ recordId, engagementStatus, renderedAt })}
${correctionBlock({ engagementId, kickoffNote, lines })}
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

async function storeRecord(env, { id, requestId, version, html, at, faults, review }) {
  await env.RECORDS.put(recordKey(id), html, { httpMetadata: { contentType: "text/html; charset=utf-8" } });
  await env.DB.prepare(
    `INSERT INTO appraisal_records (id, request_id, version, rendered_at, faults_json, review_json)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6)
     ON CONFLICT(id) DO UPDATE SET version = excluded.version, rendered_at = excluded.rendered_at,
       faults_json = excluded.faults_json, review_json = excluded.review_json`
  )
    .bind(id, requestId, version, at, JSON.stringify(faults), JSON.stringify(review))
    .run();
  await env.DB.prepare("INSERT INTO appraisal_events (request_id, type, detail, created_at) VALUES (?1, 'record_rendered', ?2, ?3)")
    .bind(requestId, `${id} v${version}`, at)
    .run();
}

export async function publishRecord(env, requestId, { faults, review }, origin, at) {
  const request = await env.DB.prepare("SELECT * FROM appraisal_requests WHERE id = ?1").bind(requestId).first();
  if (!request) throw new Error("appraisal request not found");
  const reviewed = reviewFaults(faults, review);
  const existing = await env.DB.prepare("SELECT id, version FROM appraisal_records WHERE request_id = ?1").bind(requestId).first();
  const id = existing ? existing.id : crypto.randomUUID();
  const version = existing ? existing.version + 1 : 1;

  let engagement = await openEngagement(env, requestId, at);
  if (version === 1 && engagement.status === "requested") {
    engagement = await advanceEngagement(env, engagement, "appraised", { type: "status_changed", detail: `${id} v1`, at });
  }
  if (engagement.status === "appraised") {
    engagement = await advanceEngagement(env, engagement, "proposed", { type: "status_changed", detail: `proposal v${version}`, at });
  }

  const html = renderRecord({
    request,
    faults: reviewed.faults,
    summary: reviewed.summary,
    version,
    renderedAt: at,
    recordId: id,
    engagementId: engagement.id,
    engagementStatus: engagement.status,
    kickoffNote: engagement.kickoff_note,
    correctionLines: (await correctionLines(env, engagement.id)).filter((line) => REVIEWED_LINE_STATES.includes(line.status))
  });
  await storeRecord(env, { id, requestId, version, html, at, faults, review });
  await env.DB.prepare("UPDATE engagements SET record_id = ?1 WHERE id = ?2").bind(id, engagement.id).run();
  await markLinesRecorded(env, engagement, version, at);
  if (version === 1) await env.EMAIL.send(recordEmail({ env, request, recordId: id, origin }));
  return { id, version };
}

export async function republishRecord(env, requestId, at, origin) {
  const row = await env.DB.prepare(
    "SELECT faults_json, review_json FROM appraisal_records WHERE request_id = ?1"
  )
    .bind(requestId)
    .first();
  if (!row?.faults_json || !row?.review_json) {
    throw new Error("stored appraisal record cannot be re-rendered");
  }
  const faults = JSON.parse(row.faults_json);
  const review = JSON.parse(row.review_json);
  if (!Array.isArray(faults) || !review) throw new Error("stored appraisal record cannot be re-rendered");
  return publishRecord(env, requestId, { faults, review }, origin, at);
}
