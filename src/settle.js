import { advanceEngagement, correctionLines } from "./engagement.js";
import { republishRecord } from "./record.js";
import { APPLIED_LINE_STATES, CUSTOMER_PENDING_STATES } from "./guardrails.js";

/** @param {Env} env @param {EngagementRow} engagement @param {string} at @param {{ republish?: boolean }} [options] republish the record even while lines still wait (a customer decision always shows on the record) @returns {Promise<EngagementRow>} */
export async function settleCorrectionLines(env, engagement, at, { republish = false } = {}) {
  const lines = await correctionLines(env, engagement.id);
  const waiting = lines.some((row) => CUSTOMER_PENDING_STATES.includes(row.status) || row.status === "draft");
  const applied = lines.some((row) => APPLIED_LINE_STATES.includes(row.status));
  if (waiting || !applied) {
    if (republish) await republishRecord(env, engagement.request_id, at);
    return engagement;
  }
  await republishRecord(env, engagement.request_id, at);
  return advanceEngagement(env, engagement, "proved", {
    type: "status_changed",
    detail: "the customer decided every line",
    at
  });
}
