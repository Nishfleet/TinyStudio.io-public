import costing from "../config/costing.json" with { type: "json" };
import offer from "../config/offer.json" with { type: "json" };
import { advanceEngagement, correctionLines, markLinesRecorded, openEngagement } from "./engagement.js";
import { APPLIED_LINE_STATES, assertPublishableLines, ENGAGEMENT_SETTLED_STATUSES, REVIEWED_LINE_STATES } from "./guardrails.js";

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

export function faultKey(fault) {
  return `${fault.type ?? ""}\u0000${fault.url ?? ""}`;
}

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

function longDate(iso) {
  const parsed = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return "";
  return `${parsed.getUTCDate()} ${MONTHS[parsed.getUTCMonth()]} ${parsed.getUTCFullYear()}`;
}

function proposalBlock({ recordId, engagementStatus, renderedAt }) {
  const startDate = proposalStartDate(renderedAt);
  const startHtml = startDate ? cited(longDate(startDate), "offer:startDate") : "the next open slot";
  const awaitingPayment = engagementStatus === "proposed";
  const settled = ENGAGEMENT_SETTLED_STATUSES.includes(engagementStatus);
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
    : settled
      ? `<p class="terms">We received your payment. The Correction Record below lists every change we made and every change we left alone.</p>`
      : `<p class="terms">This record is being prepared. We will send you the proposal when it is ready.</p>`}
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

export function renderRecord({ request, faults, summary, version, renderedAt, recordId, receiptId, engagementId, engagementStatus, kickoffNote, correctionLines: lines = [] }) {
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
${receiptId ? `<p><a href="/records/${esc(receiptId)}">Read the Proof Receipt: this rerun set beside the first run, fault by fault.</a></p>
` : ""}<h2>Where each number comes from</h2>
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
  const afterKeys = new Set(after.faults.map(faultKey));
  const beforeKeys = new Set(before.faults.map(faultKey));
  const closed = cost(before.faults.filter((fault) => !afterKeys.has(faultKey(fault))));
  const kept = cost(after.faults.filter((fault) => beforeKeys.has(faultKey(fault))));
  const added = cost(after.faults.filter((fault) => !beforeKeys.has(faultKey(fault))));
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

export async function publishRecord(env, requestId, { faults, review }, origin, at, { kind = "publish" } = {}) {
  const request = await env.DB.prepare("SELECT * FROM appraisal_requests WHERE id = ?1").bind(requestId).first();
  if (!request) throw new Error("appraisal request not found");
  const reviewed = reviewFaults(faults, review);
  const existing = await env.DB.prepare("SELECT id, version FROM appraisal_records WHERE request_id = ?1").bind(requestId).first();
  const id = existing ? existing.id : crypto.randomUUID();
  const version = existing ? existing.version + 1 : 1;

  let engagement = await openEngagement(env, requestId, at);
  if (engagement.status === "requested") {
    engagement = await advanceEngagement(env, engagement, "appraised", { type: "status_changed", detail: `${id} v${version}`, at });
  }
  if (engagement.status === "appraised") {
    engagement = await advanceEngagement(env, engagement, "proposed", { type: "status_changed", detail: `proposal v${version}`, at });
  }

  const run = { version, renderedAt: at, summary: reviewed.summary, faults: reviewed.faults };
  const before = version === 1 ? null : await loadRun(env, id, version - 1);
  const rerun = kind === "rerun" || kind === "drift";
  const receiptId = before && rerun ? crypto.randomUUID() : null;
  let linkedReceiptId = receiptId;
  if (!linkedReceiptId && version > 1) {
    const last = await env.DB.prepare(
      "SELECT id FROM proof_receipts WHERE record_id = ?1 ORDER BY created_at DESC, id DESC LIMIT 1"
    )
      .bind(id)
      .first();
    linkedReceiptId = last?.id ?? null;
  }
  const html = renderRecord({
    request,
    faults: reviewed.faults,
    summary: reviewed.summary,
    version,
    renderedAt: at,
    recordId: id,
    receiptId: linkedReceiptId,
    engagementId: engagement.id,
    engagementStatus: engagement.status,
    kickoffNote: engagement.kickoff_note,
    correctionLines: (await correctionLines(env, engagement.id)).filter((line) => REVIEWED_LINE_STATES.includes(line.status))
  });
  if (receiptId) {
    await publishProofReceipt(env, request, id, receiptId, before, run, at);
  }
  try {
    await storeRecord(env, { id, requestId, version, html, at, faults, review });
    await env.DB.prepare("UPDATE engagements SET record_id = ?1 WHERE id = ?2").bind(id, engagement.id).run();
    await markLinesRecorded(env, engagement, version, at);
    await storeRun(env, id, run);
  } catch (error) {
    if (receiptId) {
      await env.DB.prepare("DELETE FROM proof_receipts WHERE id = ?1").bind(receiptId).run().catch(() => {});
      await env.RECORDS.delete(recordKey(receiptId)).catch(() => {});
    }
    throw error;
  }
  if (version === 1) {
    await env.EMAIL.send(recordEmail({ env, request, recordId: id, origin }));
    return { id, version };
  }
  if (!rerun) {
    return { id, version };
  }
  if (!before) {
    await writeEvent(env, requestId, "drift_baseline_missing", `${id} v${version}`, at);
    return { id, version };
  }
  if (kind !== "drift") {
    return { id, version };
  }
  if (engagement.status !== "closed") {
    await writeEvent(env, requestId, "drift_engagement_active", `${id} ${engagement.status}`, at);
    return { id, version };
  }
  if (!origin) {
    await writeEvent(env, requestId, "drift_email_skipped", `${id} no origin`, at);
    return { id, version };
  }
  const beforeKeys = new Set(before.faults.map(faultKey));
  const inputs = { dealValue: request.avg_deal_value, monthlyLeads: request.monthly_leads };
  const newCost = run.faults
    .filter((fault) => !beforeKeys.has(faultKey(fault)))
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

export function renderCloseOut({ request, notes, recordId, receiptId, referralCode, specimenConsent, renderedAt }) {
  const noteHtml = notes
    .map((note) => `<li class="tracking-note" data-note-day="${Number(note.day)}"><p>Day ${Number(note.day)}: ${esc(note.note)}</p></li>`)
    .join("\n");
  const specimenLine = specimenConsent
    ? `<p>With your say-so on file, this proof pair now sits in our specimen gallery.</p>`
    : `<p>If you agree, this proof pair joins our specimen gallery. Say the word and it goes up.</p>`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Close-out for ${esc(request.site_url)} | TinyStudio</title>
<style>
body{font:16px/1.6 Georgia,serif;max-width:42rem;margin:2rem auto;padding:0 1rem;color:#111;background:#fff}
h1{font-size:1.7rem}h2{margin-top:1.5rem}.note{margin-bottom:1rem}
.referral{font-size:1.2rem;border:2px solid #111;padding:1rem}
@media print{body{margin:0;max-width:none}a{color:inherit}}
</style>
</head>
<body>
<main data-close-out-rendered-at="${esc(renderedAt)}">
<h1>Close-out: ${esc(request.site_url)}</h1>
<p>Prepared for ${esc(request.name)}. The engagement ends here. The correction is delivered, proved and tracked for fourteen days.</p>
<h2>The fourteen days</h2>
<ul>
${noteHtml}
</ul>
<p>Your record stays where it was: <a href="/records/${esc(recordId)}">the Appraisal Record</a>${receiptId ? `, and the Proof Receipt that sets the two runs side by side: <a href="/records/${esc(receiptId)}">the Proof Receipt</a>` : ""}.</p>
${specimenLine}
<h2>Who else should see their record?</h2>
<p>That is the only question this page asks. You have seen what the correction did to your own numbers. If one other business comes to mind, send them here and give them this code:</p>
<p class="referral">${esc(referralCode)}</p>
<p>A business that names this code when it requests its appraisal skips the waitlist for the month it was minted and the month after.</p>
</main>
</body>
</html>
`;
}