import { engagementAllows } from "./guardrails.js";
import {
  addCorrectionLine,
  advanceEngagement,
  correctionLineById,
  correctionLines,
  engagementById,
  reviewCorrectionLine,
  revertCorrectionLine,
  setKickoffNote
} from "./engagement.js";
import { republishRecord } from "./record.js";

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

const APPLIED_LINE_STATES = ["approved", "recorded"];

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
    const proved = lines.some((row) => APPLIED_LINE_STATES.includes(row.status));
    if (closed && proved) {
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
