import { engagementAllows, APPLIED_LINE_STATES } from "./guardrails.js";
import {
  addCorrectionLine,
  advanceEngagement,
  correctionLineById,
  correctionLines,
  engagementById,
  journalEngagementEvent,
  reviewCorrectionLine,
  revertCorrectionLine,
  setKickoffNote
} from "./engagement.js";
import { addTrackingNote, TRACKING_DAYS, trackingDay, trackingNotes, trackingStartedAt } from "./tracking.js";
import { renderCloseOut, republishRecord } from "./record.js";

export async function deskQueue(env) {
  const result = await env.DB.prepare(
    `SELECT e.*, r.site_url, r.email,
            (SELECT COUNT(*) FROM correction_lines cl WHERE cl.engagement_id = e.id AND cl.status = 'draft') AS open_lines,
            (SELECT COUNT(*) FROM engagement_payments p WHERE p.engagement_id = e.id) AS payment_rows
       FROM engagements e
       JOIN appraisal_requests r ON r.id = e.request_id
      ORDER BY e.changed_at DESC
      LIMIT 200`
  ).all();
  return result.results ?? [];
}

export async function deskDraftLines(env) {
  const result = await env.DB.prepare(
    `SELECT cl.*, e.status AS engagement_status
       FROM correction_lines cl
       JOIN engagements e ON e.id = cl.engagement_id
      WHERE cl.status = 'draft'
      ORDER BY cl.created_at ASC
      LIMIT 500`
  ).all();
  return result.results ?? [];
}

export async function addDeskCorrectionLine(env, input, reviewer, at) {
  const engagement = await engagementById(env, input.engagementId);
  if (!engagement) throw Object.assign(new Error("engagement not found"), { code: "NOT_FOUND" });
  if (!engagementAllows(engagement, "add_correction_line")) {
    throw Object.assign(new Error("an engagement accepts correction lines only after payment"), { code: "NOT_PAID" });
  }
  const line = await addCorrectionLine(env, engagement, input, at);
  const advanced =
    engagement.status === "in_correction"
      ? engagement
      : await advanceEngagement(env, engagement, "in_correction", {
          type: "status_changed",
          detail: `correction started by ${reviewer}`,
          at
        });
  return { engagement: advanced, line };
}

export async function reviewDeskCorrectionLine(env, input, reviewer, at) {
  const line = await correctionLineById(env, input.lineId);
  if (!line) throw Object.assign(new Error("correction line not found"), { code: "NOT_FOUND" });
  const engagement = await engagementById(env, line.engagement_id);
  if (!engagement) throw Object.assign(new Error("engagement not found"), { code: "NOT_FOUND" });
  if (!engagementAllows(engagement, "review_correction_line")) {
    throw Object.assign(new Error("a correction line is reviewed only while the correction is in progress"), { code: "NOT_PAID" });
  }
  const alreadyRecorded = line.status === "recorded";
  const reviewed = alreadyRecorded
    ? line
    : await reviewCorrectionLine(env, line, input.action, { reviewer, note: input.note, at });
  let current = engagement;
  if (engagement.status === "in_correction") {
    const lines = await correctionLines(env, engagement.id);
    const closed = lines.every((row) => row.status !== "draft");
    const applied = lines.some((row) => APPLIED_LINE_STATES.includes(row.status));
    if (closed && applied) {
      try {
        await republishRecord(env, engagement.request_id, at);
      } catch (error) {
        await revertCorrectionLine(env, reviewed, at);
        throw error;
      }
      current = await advanceEngagement(env, engagement, "proved", {
        type: "status_changed",
        detail: `review complete by ${reviewer}`,
        at
      });
    }
  }
  return { engagement: current, line: reviewed };
}

export async function addDeskKickoffNote(env, input, reviewer, at) {
  const engagement = await engagementById(env, input.engagementId);
  if (!engagement) throw Object.assign(new Error("engagement not found"), { code: "NOT_FOUND" });
  if (!engagementAllows(engagement, "add_kickoff_note")) {
    throw Object.assign(new Error("a kickoff note opens tracking once the correction is proved"), { code: "NOT_PAID" });
  }
  const noted = await setKickoffNote(env, engagement, input.note, at);
  await republishRecord(env, engagement.request_id, at);
  return advanceEngagement(env, noted, "tracking", {
    type: "status_changed",
    detail: `tracking opened by ${reviewer}`,
    at
  });
}

export async function addDeskTrackingNote(env, input, reviewer, at) {
  const engagement = await engagementById(env, input.engagementId);
  if (!engagement) throw Object.assign(new Error("engagement not found"), { code: "NOT_FOUND" });
  return addTrackingNote(env, engagement, { day: input.day, note: input.note }, reviewer, at);
}

export async function setDeskSpecimenConsent(env, input, reviewer, at) {
  const engagement = await engagementById(env, input.engagementId);
  if (!engagement) throw Object.assign(new Error("engagement not found"), { code: "NOT_FOUND" });
  if (!engagementAllows(engagement, "set_specimen_consent")) {
    throw Object.assign(new Error("specimen consent is recorded once the correction is proved"), { code: "NOT_PROVED" });
  }
  const consent = input.consent ? 1 : 0;
  const sayso = String(input.sayso ?? "").trim();
  if (consent && !sayso) {
    throw Object.assign(new Error("a yes to the specimen gallery carries the client's own words"), { code: "SAYSO_MISSING" });
  }
  await env.DB.prepare("UPDATE engagements SET specimen_consent = ?1, changed_at = ?2 WHERE id = ?3")
    .bind(consent, at, engagement.id)
    .run();
  await journalEngagementEvent(env, engagement, {
    type: "specimen_consent_recorded",
    detail: consent ? `the client said yes to the specimen gallery: ${sayso}` : "the client said no to the specimen gallery",
    at
  });
  return { ...engagement, specimen_consent: consent };
}

async function mintReferralCode(env, referrer, at) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const code = `TS-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
    const minted = await env.DB.prepare(
      "INSERT OR IGNORE INTO appraisal_referrals (code, referrer, created_at) VALUES (?1, ?2, ?3)"
    )
      .bind(code, referrer, at)
      .run();
    if (Number(minted.meta?.changes) > 0) return code;
  }
  throw Object.assign(new Error("no referral code could be minted"), { code: "REFERRAL_MINT_FAILED" });
}

export async function closeOutEngagement(env, input, reviewer, at) {
  const engagement = await engagementById(env, input.engagementId);
  if (!engagement) throw Object.assign(new Error("engagement not found"), { code: "NOT_FOUND" });
  if (!engagementAllows(engagement, "close_out")) {
    throw Object.assign(new Error("the close-out ends an engagement that is in tracking"), { code: "NOT_TRACKING" });
  }
  const notes = await trackingNotes(env, engagement.id);
  const notedDays = new Set(notes.map((note) => Number(note.day)));
  for (const day of [7, TRACKING_DAYS]) {
    if (!notedDays.has(day)) {
      throw Object.assign(new Error(`the close-out waits for the day-${day} tracking note`), { code: `NOTE_${day}_MISSING` });
    }
  }
  const startedAt = await trackingStartedAt(env, engagement.id);
  if (!startedAt || trackingDay(at, startedAt) < TRACKING_DAYS) {
    throw Object.assign(new Error("the close-out waits for the fourteen days of tracking"), { code: "TRACKING_TOO_SHORT" });
  }
  const request = await env.DB.prepare("SELECT * FROM appraisal_requests WHERE id = ?1").bind(engagement.request_id).first();
  if (!request) throw Object.assign(new Error("appraisal request not found"), { code: "NOT_FOUND" });
  const receipt = await env.DB.prepare(
    "SELECT id FROM proof_receipts WHERE request_id = ?1 ORDER BY created_at DESC, id DESC LIMIT 1"
  )
    .bind(engagement.request_id)
    .first();
  let closeOutId;
  let referralCode;
  const existing = await env.DB.prepare("SELECT id, referral_code FROM close_outs WHERE engagement_id = ?1")
    .bind(engagement.id)
    .first();
  if (existing) {
    closeOutId = existing.id;
    referralCode = existing.referral_code;
  } else {
    referralCode = await mintReferralCode(env, request.name, at);
    closeOutId = crypto.randomUUID();
    const inserted = await env.DB.prepare(
      `INSERT OR IGNORE INTO close_outs (id, engagement_id, request_id, record_id, receipt_id, referral_code, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`
    )
      .bind(closeOutId, engagement.id, engagement.request_id, engagement.record_id, receipt?.id ?? null, referralCode, at)
      .run();
    if (Number(inserted.meta?.changes) === 0) {
      await env.DB.prepare("DELETE FROM appraisal_referrals WHERE code = ?1 AND used_request_id IS NULL")
        .bind(referralCode)
        .run();
      const raced = await env.DB.prepare("SELECT id, referral_code FROM close_outs WHERE engagement_id = ?1")
        .bind(engagement.id)
        .first();
      closeOutId = raced.id;
      referralCode = raced.referral_code;
    } else {
      await journalEngagementEvent(env, engagement, { type: "close_out_rendered", detail: `${closeOutId} ${referralCode}`, at });
    }
  }
  const html = renderCloseOut({
    request,
    notes,
    recordId: engagement.record_id,
    receiptId: receipt?.id ?? null,
    referralCode,
    specimenConsent: Number(engagement.specimen_consent) === 1,
    renderedAt: at
  });
  await env.RECORDS.put(`records/${closeOutId}.html`, html, { httpMetadata: { contentType: "text/html; charset=utf-8" } });
  const closed = await advanceEngagement(env, engagement, "closed", {
    type: "status_changed",
    detail: `close-out by ${reviewer}`,
    at
  });
  return { engagement: closed, closeOutId, referralCode, receiptId: receipt?.id ?? null };
}
