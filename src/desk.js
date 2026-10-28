import {
  addCorrectionLine,
  advanceEngagement,
  correctionLineById,
  engagementById,
  reviewCorrectionLine,
  setKickoffNote
} from "./engagement.js";
import { republishRecord } from "./record.js";

const DESK_LINE_STATES = ["paid", "in_correction"];

export async function deskQueue(env) {
  const result = await env.DB.prepare(
    `SELECT e.*, r.site_url, r.email,
            (SELECT COUNT(*) FROM correction_lines cl WHERE cl.engagement_id = e.id AND cl.status = 'draft') AS open_lines
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

async function deskLines(env, engagementId) {
  const result = await env.DB.prepare(
    "SELECT * FROM correction_lines WHERE engagement_id = ?1 ORDER BY created_at ASC"
  )
    .bind(engagementId)
    .all();
  return result.results ?? [];
}

export async function addDeskCorrectionLine(env, input, reviewer, at) {
  const engagement = await engagementById(env, input.engagementId);
  if (!engagement) throw Object.assign(new Error("engagement not found"), { code: "NOT_FOUND" });
  if (!DESK_LINE_STATES.includes(engagement.status)) {
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
  const reviewed = await reviewCorrectionLine(env, line, input.action, { reviewer, note: input.note, at });
  let current = engagement;
  if (engagement.status === "in_correction") {
    const lines = await deskLines(env, engagement.id);
    if (lines.every((row) => row.status !== "draft")) {
      current = await advanceEngagement(env, engagement, "proved", {
        type: "status_changed",
        detail: `review complete by ${reviewer}`,
        at
      });
      await republishRecord(env, engagement.request_id, at);
    }
  }
  return { engagement: current, line: reviewed };
}

export async function addDeskKickoffNote(env, input, reviewer, at) {
  const engagement = await engagementById(env, input.engagementId);
  if (!engagement) throw Object.assign(new Error("engagement not found"), { code: "NOT_FOUND" });
  const noted = await setKickoffNote(env, engagement, input.note, at);
  const advanced = noted.status === "proved"
    ? await advanceEngagement(env, noted, "tracking", {
        type: "status_changed",
        detail: `tracking opened by ${reviewer}`,
        at
      })
    : noted;
  await republishRecord(env, engagement.request_id, at);
  return advanced;
}
