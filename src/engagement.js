import { assertCorrectionLineStatus, assertEngagementStatus, assertLegalCopyConsent } from "./guardrails.js";

export const ENGAGEMENT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export async function engagementForRequest(env, requestId) {
  const row = await env.DB.prepare("SELECT * FROM engagements WHERE request_id = ?1").bind(requestId).first();
  return row ?? null;
}

export async function engagementById(env, engagementId) {
  const row = await env.DB.prepare("SELECT * FROM engagements WHERE id = ?1").bind(engagementId).first();
  return row ?? null;
}

async function recordEvent(env, engagement, { type, detail, at, from = engagement.status, to = engagement.status }) {
  await env.DB.prepare(
    "INSERT INTO engagement_events (engagement_id, request_id, type, from_status, to_status, detail, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)"
  )
    .bind(engagement.id, engagement.request_id, type, from, to, detail ?? null, at)
    .run();
}

export async function openEngagement(env, requestId, at) {
  const existing = await engagementForRequest(env, requestId);
  if (existing) return existing;
  const id = crypto.randomUUID();
  await env.DB.prepare(
    "INSERT INTO engagements (id, request_id, status, created_at, changed_at) VALUES (?1, ?2, 'requested', ?3, ?3)"
  )
    .bind(id, requestId, at)
    .run();
  await recordEvent(env, { id, request_id: requestId, status: "requested" }, { type: "engagement_opened", detail: "intake", at, from: null, to: "requested" });
  return engagementForRequest(env, requestId);
}

export async function advanceEngagement(env, engagement, to, { type, detail, at }) {
  assertEngagementStatus(engagement.status, to);
  await env.DB.prepare("UPDATE engagements SET status = ?1, changed_at = ?2 WHERE id = ?3").bind(to, at, engagement.id).run();
  await env.DB.prepare(
    "INSERT INTO engagement_events (engagement_id, request_id, type, from_status, to_status, detail, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)"
  )
    .bind(engagement.id, engagement.request_id, type, engagement.status, to, detail ?? null, at)
    .run();
  return { ...engagement, status: to };
}

export async function attachCheckoutSession(env, engagement, checkoutSessionId, at) {
  if (!checkoutSessionId) throw new Error("checkout session id missing");
  await env.DB.prepare("UPDATE engagements SET checkout_session_id = ?1, changed_at = ?2 WHERE id = ?3")
    .bind(checkoutSessionId, at, engagement.id)
    .run();
  await recordEvent(env, engagement, { type: "checkout_session_created", detail: checkoutSessionId, at });
  return { ...engagement, checkout_session_id: checkoutSessionId };
}

export async function setKickoffNote(env, engagement, note, at) {
  const text = String(note ?? "").trim();
  if (!text) throw new Error("kickoff note missing");
  await env.DB.prepare("UPDATE engagements SET kickoff_note = ?1, changed_at = ?2 WHERE id = ?3")
    .bind(text, at, engagement.id)
    .run();
  await recordEvent(env, engagement, { type: "kickoff_note_added", detail: text, at });
  return { ...engagement, kickoff_note: text };
}

export async function addCorrectionLine(env, engagement, line, at) {
  assertLegalCopyConsent(line);
  const faultId = String(line?.faultId ?? "").trim();
  const faultTitle = String(line?.faultTitle ?? "").trim();
  const beforeText = String(line?.beforeText ?? "").trim();
  const afterText = String(line?.afterText ?? "").trim();
  if (!faultTitle) throw new Error("correction line needs the fault it closes");
  if (!beforeText) throw new Error("correction line needs the before state");
  if (!afterText) throw new Error("correction line needs the after state");
  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO correction_lines
       (id, engagement_id, request_id, fault_id, fault_title, before_text, after_text, legal_copy, status, created_at, changed_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 'draft', ?9, ?9)`
  )
    .bind(id, engagement.id, engagement.request_id, faultId || null, faultTitle, beforeText, afterText, line.legalCopy ? 1 : 0, at)
    .run();
  await recordEvent(env, engagement, { type: "correction_line_added", detail: `${id} ${faultTitle}`, at });
  return correctionLineById(env, id);
}

export async function correctionLineById(env, lineId) {
  const row = await env.DB.prepare("SELECT * FROM correction_lines WHERE id = ?1").bind(lineId).first();
  return row ?? null;
}

export async function correctionLines(env, engagementId) {
  const result = await env.DB.prepare("SELECT * FROM correction_lines WHERE engagement_id = ?1 ORDER BY created_at ASC")
    .bind(engagementId)
    .all();
  return result.results ?? [];
}

export async function reviewCorrectionLine(env, line, action, { reviewer, note, at }) {
  const decision = action === "approve" ? "approved" : action === "reject" ? "rejected" : "";
  if (!decision) throw new Error("unknown correction review action");
  assertCorrectionLineStatus(line.status, decision);
  const reviewerName = String(reviewer ?? "").trim();
  if (!reviewerName) throw new Error("correction review needs the reviewer");
  await env.DB.prepare(
    "UPDATE correction_lines SET status = ?1, reviewer = ?2, review_note = ?3, reviewed_at = ?4, changed_at = ?4 WHERE id = ?5"
  )
    .bind(decision, reviewerName, String(note ?? "").trim() || null, at, line.id)
    .run();
  await env.DB.prepare(
    "INSERT INTO correction_reviews (line_id, engagement_id, reviewer, action, note, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)"
  )
    .bind(line.id, line.engagement_id, reviewerName, action, String(note ?? "").trim() || null, at)
    .run();
  await env.DB.prepare(
    "INSERT INTO engagement_events (engagement_id, request_id, type, from_status, to_status, detail, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)"
  )
    .bind(line.engagement_id, line.request_id, `correction_line_${action}`, line.status, decision, `${line.id} by ${reviewerName}`, at)
    .run();
  return correctionLineById(env, line.id);
}

export async function markLinesRecorded(env, engagement, version, at) {
  const recorded = await correctionLines(env, engagement.id);
  for (const line of recorded) {
    if (line.status !== "approved") continue;
    assertCorrectionLineStatus(line.status, "recorded");
    await env.DB.prepare("UPDATE correction_lines SET status = 'recorded', recorded_version = ?1, changed_at = ?2 WHERE id = ?3")
      .bind(version, at, line.id)
      .run();
    await env.DB.prepare(
      "INSERT INTO engagement_events (engagement_id, request_id, type, from_status, to_status, detail, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)"
    )
      .bind(engagement.id, engagement.request_id, "correction_line_recorded", "approved", "recorded", `${line.id} v${version}`, at)
      .run();
  }
}

export async function linesAwaitingReview(env, engagementId) {
  const result = await env.DB.prepare(
    "SELECT * FROM correction_lines WHERE engagement_id = ?1 AND status IN ('draft', 'approved') ORDER BY created_at ASC"
  )
    .bind(engagementId)
    .all();
  return result.results ?? [];
}
