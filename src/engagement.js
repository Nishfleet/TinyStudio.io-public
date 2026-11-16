import { assertCorrectionLineStatus, assertEngagementStatus, assertLegalCopyConsent } from "./guardrails.js";

export const ENGAGEMENT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** @param {Env} env @param {string} requestId @returns {Promise<EngagementRow | null>} */
export async function engagementForRequest(env, requestId) {
  /** @type {EngagementRow | null} */
  const row = await env.DB.prepare("SELECT * FROM engagements WHERE request_id = ?1").bind(requestId).first();
  return row ?? null;
}

/** @param {Env} env @param {string} engagementId @returns {Promise<EngagementRow | null>} */
export async function engagementById(env, engagementId) {
  /** @type {EngagementRow | null} */
  const row = await env.DB.prepare("SELECT * FROM engagements WHERE id = ?1").bind(engagementId).first();
  return row ?? null;
}

/** @param {Env} env @param {string} recordId @returns {Promise<EngagementRow | null>} */
export async function engagementByRecordId(env, recordId) {
  /** @type {EngagementRow | null} */
  const row = await env.DB.prepare("SELECT * FROM engagements WHERE record_id = ?1").bind(recordId).first();
  return row ?? null;
}

/** @param {Env} env @param {EngagementRef} engagement @param {{ type: string, detail?: string | null, at: string, from?: string | null, to?: string }} event */
export async function journalEngagementEvent(env, engagement, { type, detail, at, from = engagement.status, to = engagement.status }) {
  await env.DB.prepare(
    "INSERT INTO engagement_events (engagement_id, request_id, type, from_status, to_status, detail, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)"
  )
    .bind(engagement.id, engagement.request_id, type, from, to, detail ?? null, at)
    .run();
}

/** @param {CorrectionLineRow} line @returns {EngagementRef} */
function lineJournalRow(line) {
  return { id: line.engagement_id, request_id: line.request_id, status: line.status };
}

/** @param {Env} env @param {string} requestId @param {string} at */
export async function openEngagement(env, requestId, at) {
  const existing = await engagementForRequest(env, requestId);
  if (existing) return existing;
  const id = crypto.randomUUID();
  await env.DB.prepare(
    "INSERT INTO engagements (id, request_id, status, created_at, changed_at) VALUES (?1, ?2, 'requested', ?3, ?3)"
  )
    .bind(id, requestId, at)
    .run();
  await journalEngagementEvent(env, { id, request_id: requestId, status: "requested" }, { type: "engagement_opened", detail: "intake", at, from: null, to: "requested" });
  const opened = await engagementForRequest(env, requestId);
  if (!opened) throw new Error(`engagement for request ${requestId} was not saved`);
  return opened;
}

/** @template {EngagementRef} T @param {Env} env @param {T} engagement @param {string} to @param {{ type: string, detail?: string, at: string }} event @returns {Promise<T>} */
export async function advanceEngagement(env, engagement, to, { type, detail, at }) {
  assertEngagementStatus(engagement.status, to);
  const claim = await env.DB.prepare("UPDATE engagements SET status = ?1, changed_at = ?2 WHERE id = ?3 AND status = ?4").bind(to, at, engagement.id, engagement.status).run();
  if (Number(claim.meta?.changes) === 0) return engagement;
  await journalEngagementEvent(env, engagement, { type, detail, at, from: engagement.status, to });
  return { ...engagement, status: to };
}

/** @param {Env} env @param {EngagementRow} engagement @param {string} checkoutSessionId @param {string} at */
export async function attachCheckoutSession(env, engagement, checkoutSessionId, at) {
  if (!checkoutSessionId) throw new Error("checkout session id missing");
  await env.DB.prepare("UPDATE engagements SET checkout_session_id = ?1, changed_at = ?2 WHERE id = ?3")
    .bind(checkoutSessionId, at, engagement.id)
    .run();
  await journalEngagementEvent(env, engagement, { type: "checkout_session_created", detail: `checkout session ${checkoutSessionId}`, at });
  return { ...engagement, checkout_session_id: checkoutSessionId };
}

/** @param {Env} env @param {EngagementRow} engagement @param {unknown} note @param {string} at */
export async function setKickoffNote(env, engagement, note, at) {
  const text = String(note ?? "").trim();
  if (!text) throw new Error("kickoff note missing");
  await env.DB.prepare("UPDATE engagements SET kickoff_note = ?1, changed_at = ?2 WHERE id = ?3")
    .bind(text, at, engagement.id)
    .run();
  await journalEngagementEvent(env, engagement, { type: "kickoff_note_added", detail: text, at });
  return { ...engagement, kickoff_note: text };
}

/** @param {Env} env @param {EngagementRef} engagement @param {{ faultId?: unknown, faultTitle?: unknown, beforeText?: unknown, afterText?: unknown, legalCopy?: unknown, consentReceived?: unknown }} line @param {string} at */
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
  await journalEngagementEvent(env, engagement, { type: "correction_line_added", detail: `${id} ${faultTitle}`, at });
  const added = await correctionLineById(env, id);
  if (!added) throw new Error(`correction line ${id} could not be read back`);
  return added;
}

/** @param {Env} env @param {string} lineId @returns {Promise<CorrectionLineRow | null>} */
export async function correctionLineById(env, lineId) {
  /** @type {CorrectionLineRow | null} */
  const row = await env.DB.prepare("SELECT * FROM correction_lines WHERE id = ?1").bind(lineId).first();
  return row ?? null;
}

/** @param {Env} env @param {string} engagementId @returns {Promise<CorrectionLineRow[]>} */
export async function correctionLines(env, engagementId) {
  /** @type {D1Result<CorrectionLineRow>} */
  const result = await env.DB.prepare("SELECT * FROM correction_lines WHERE engagement_id = ?1 ORDER BY created_at ASC")
    .bind(engagementId)
    .all();
  return result.results ?? [];
}

/** @param {Env} env @param {CorrectionLineRow} line @param {unknown} action @param {{ reviewer: unknown, note?: unknown, at: string }} review */
export async function reviewCorrectionLine(env, line, action, { reviewer, note, at }) {
  const decision = action === "approve" ? "proposed" : action === "reject" ? "rejected" : "";
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
  await journalEngagementEvent(env, lineJournalRow(line), { type: `correction_line_${action}`, detail: `${line.id} by ${reviewerName}`, at, from: line.status, to: decision });
  const reviewed = await correctionLineById(env, line.id);
  if (!reviewed) throw new Error(`correction line ${line.id} could not be read back`);
  return reviewed;
}

/** @type {Record<string, string>} */
const CUSTOMER_DECISION_TARGETS = { approve: "approved", edit: "draft", skip: "skipped" };
/** @type {Record<string, string>} */
const CUSTOMER_DECISION_DETAILS = {
  approve: "the customer approved this line",
  edit: "the customer sent their own wording",
  skip: "the customer left this line alone"
};

/** @param {Env} env @param {CorrectionLineRow} line @param {string} decision @param {{ text?: unknown } | undefined} input @param {string} at */
export async function decideCorrectionLine(env, line, decision, input, at) {
  const to = CUSTOMER_DECISION_TARGETS[decision];
  if (!to) throw new Error("unknown customer decision");
  assertCorrectionLineStatus(line.status, to);
  const text = String(input?.text ?? "").trim();
  if (decision === "edit" && !text) throw new Error("an edit needs the customer's own wording");
  if (decision === "edit") {
    await env.DB.prepare("UPDATE correction_lines SET status = 'draft', after_text = ?1, changed_at = ?2 WHERE id = ?3 AND status = 'proposed'")
      .bind(text, at, line.id)
      .run();
  } else {
    await env.DB.prepare("UPDATE correction_lines SET status = ?1, changed_at = ?2 WHERE id = ?3 AND status = 'proposed'")
      .bind(to, at, line.id)
      .run();
  }
  await env.DB.prepare(
    "INSERT INTO correction_reviews (line_id, engagement_id, reviewer, action, note, created_at) VALUES (?1, ?2, 'customer', ?3, ?4, ?5)"
  )
    .bind(line.id, line.engagement_id, `customer_${decision}`, decision === "edit" ? text : null, at)
    .run();
  await journalEngagementEvent(env, lineJournalRow(line), {
    type: `correction_line_customer_${decision}`,
    detail: `${line.id} ${CUSTOMER_DECISION_DETAILS[decision]}`,
    at,
    from: line.status,
    to
  });
  const decided = await correctionLineById(env, line.id);
  if (!decided) throw new Error(`correction line ${line.id} could not be read back`);
  return decided;
}

/** @param {Env} env @param {CorrectionLineRow} line @param {string} at */
export async function revertCorrectionLine(env, line, at) {
  const current = await correctionLineById(env, line.id);
  if (!current || (current.status !== "approved" && current.status !== "proposed")) return current ?? line;
  await env.DB.prepare(
    "UPDATE correction_lines SET status = 'draft', reviewer = NULL, review_note = NULL, reviewed_at = NULL, changed_at = ?1 WHERE id = ?2 AND status IN ('approved', 'proposed')"
  )
    .bind(at, line.id)
    .run();
  await journalEngagementEvent(env, lineJournalRow(line), { type: "correction_line_reverted", detail: `${line.id} after a failed republish`, at, from: current.status, to: "draft" });
  return correctionLineById(env, line.id);
}

/** @param {Env} env @param {EngagementRef} engagement @param {number} version @param {string} at */
export async function markLinesRecorded(env, engagement, version, at) {
  const recorded = await correctionLines(env, engagement.id);
  for (const line of recorded) {
    if (line.status !== "approved") continue;
    assertCorrectionLineStatus(line.status, "recorded");
    await env.DB.prepare("UPDATE correction_lines SET status = 'recorded', recorded_version = ?1, changed_at = ?2 WHERE id = ?3")
      .bind(version, at, line.id)
      .run();
    await journalEngagementEvent(env, engagement, { type: "correction_line_recorded", detail: `${line.id} v${version}`, at, from: "approved", to: "recorded" });
  }
}
