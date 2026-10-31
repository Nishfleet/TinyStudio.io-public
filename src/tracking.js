import { engagementAllows } from "./guardrails.js";
import { journalEngagementEvent } from "./engagement.js";

export const TRACKING_DAYS = 14;

export function trackingDay(nowIso, startedAtIso) {
  const days = Math.floor((Date.parse(nowIso) - Date.parse(startedAtIso)) / 86400000) + 1;
  return Math.min(TRACKING_DAYS, Math.max(1, days));
}

export async function trackingStartedAt(env, engagementId) {
  const row = await env.DB.prepare(
    `SELECT MIN(created_at) AS started_at
       FROM engagement_events
      WHERE engagement_id = ?1 AND type = 'status_changed' AND to_status = 'tracking'`
  )
    .bind(engagementId)
    .first();
  return row?.started_at ?? null;
}

export async function trackingNotes(env, engagementId) {
  const result = await env.DB.prepare("SELECT * FROM tracking_notes WHERE engagement_id = ?1 ORDER BY day ASC")
    .bind(engagementId)
    .all();
  return result.results ?? [];
}

export async function queueTrackingChecks(env, now) {
  const engagements = await env.DB.prepare(
    `SELECT e.id, e.request_id,
            (SELECT MIN(created_at) FROM engagement_events ev
              WHERE ev.engagement_id = e.id AND ev.type = 'status_changed' AND ev.to_status = 'tracking') AS started_at
       FROM engagements e
      WHERE e.status = 'tracking'
      LIMIT 200`
  ).all();
  const at = now.toISOString();
  const checks = [];
  for (const row of engagements.results ?? []) {
    if (!row.started_at) continue;
    const dueDay = trackingDay(at, row.started_at);
    for (let day = 1; day <= dueDay; day += 1) {
      checks.push(
        env.DB.prepare(
          "INSERT OR IGNORE INTO tracking_checks (id, engagement_id, request_id, day, status, created_at) VALUES (?1, ?2, ?3, ?4, 'queued', ?5)"
        ).bind(crypto.randomUUID(), row.id, row.request_id, day, at)
      );
    }
  }
  if (!checks.length) {
    console.log("tinystudio_tracking_checks_queued", 0);
    return 0;
  }
  const results = await env.DB.batch(checks);
  const queued = results.filter((result) => Number(result.meta?.changes) > 0).length;
  console.log("tinystudio_tracking_checks_queued", queued);
  return queued;
}

export async function addTrackingNote(env, engagement, input, reviewer, at) {
  if (!engagementAllows(engagement, "add_tracking_note")) {
    throw Object.assign(new Error("a tracking note is written while the engagement is in tracking"), { code: "NOT_TRACKING" });
  }
  const day = Number(input.day);
  if (![7, 14].includes(day)) {
    throw Object.assign(new Error("a tracking note is written at day 7 or day 14"), { code: "BAD_DAY" });
  }
  const startedAt = await trackingStartedAt(env, engagement.id);
  if (!startedAt || trackingDay(at, startedAt) < day) {
    throw Object.assign(new Error(`the day-${day} note waits for day ${day} of tracking`), { code: "DAY_TOO_EARLY" });
  }
  const text = String(input.note ?? "").trim();
  if (!text) throw Object.assign(new Error("tracking note missing"), { code: "NOTE_MISSING" });
  const reviewerName = String(reviewer ?? "").trim();
  if (!reviewerName) throw Object.assign(new Error("tracking note needs the reviewer"), { code: "REVIEWER_MISSING" });
  const written = await env.DB.prepare(
    `INSERT OR IGNORE INTO tracking_notes (id, engagement_id, request_id, day, note, reviewer, created_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`
  )
    .bind(crypto.randomUUID(), engagement.id, engagement.request_id, day, text, reviewerName, at)
    .run();
  if (Number(written.meta?.changes) === 0) {
    throw Object.assign(new Error(`the day-${day} note is already written`), { code: "NOTE_EXISTS" });
  }
  await journalEngagementEvent(env, engagement, { type: `tracking_note_day_${day}`, detail: text, at });
  return trackingNotes(env, engagement.id);
}
