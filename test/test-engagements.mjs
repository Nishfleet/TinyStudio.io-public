import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { recordsMock } from "./records-mock.js";
import {
  ENGAGEMENT_ID,
  addCorrectionLine,
  advanceEngagement,
  attachCheckoutSession,
  correctionLines,
  engagementById,
  engagementForRequest,
  openEngagement,
  reviewCorrectionLine,
  setKickoffNote
} from "../src/engagement.js";
import { publishRecord } from "../src/record.js";

function d1(sqlite) {
  return {
    prepare(sql) {
      let values = [];
      const statement = {
        bind(...bound) { values = bound; return statement; },
        async first() { return sqlite.prepare(sql).get(...values) ?? null; },
        async run() { return { success: true, meta: { changes: Number(sqlite.prepare(sql).run(...values).changes) } }; },
        async all() { return { results: sqlite.prepare(sql).all(...values) }; }
      };
      return statement;
    }
  };
}

function freshEnv() {
  const sqlite = new DatabaseSync(":memory:");
  for (const file of readdirSync(new URL("../migrations/", import.meta.url)).sort()) {
    sqlite.exec(readFileSync(new URL(`../migrations/${file}`, import.meta.url), "utf8"));
  }
  sqlite.prepare(
    "INSERT INTO appraisal_requests (id, site_url, business_type, avg_deal_value, monthly_leads, name, email, month, created_at) VALUES ('req-1','https://clinic.example','Dental clinic',8000,40,'Dana Reyes','dana@clinic.example','2026-10','2026-10-12T09:00:00.000Z')"
  ).run();
  const objects = new Map();
  const sent = [];
  const env = {
    DB: d1(sqlite),
    EMAIL: { async send(message) { sent.push(message); } },
    RECORDS: recordsMock(objects)
  };
  return { sqlite, env, sent, objects };
}

const faults = [
  { id: "f1", type: "slow-load", title: "Home page loads in 6.1 seconds", url: "https://clinic.example/", evidence: "Largest Contentful Paint 6.1 s on mobile." }
];
const review = { keep: ["f1"], summary: "The home page is slow on phones." };

test("engagement: one request has one engagement, opened once", async () => {
  const { env, sqlite } = freshEnv();
  const first = await openEngagement(env, "req-1", "2026-10-12T09:00:00.000Z");
  assert.match(first.id, ENGAGEMENT_ID);
  assert.equal(first.status, "requested");
  const second = await openEngagement(env, "req-1", "2026-10-12T09:05:00.000Z");
  assert.equal(second.id, first.id, "a second open returns the same engagement");
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM engagements").get().n, 1);
  const events = sqlite.prepare("SELECT type, from_status, to_status FROM engagement_events ORDER BY created_at, id").all();
  assert.deepEqual(events.map(({ type, from_status, to_status }) => ({ type, from_status, to_status })), [
    { type: "engagement_opened", from_status: null, to_status: "requested" }
  ]);
  assert.equal((await engagementForRequest(env, "req-1")).id, first.id);
  assert.equal((await engagementById(env, first.id)).id, first.id);
  assert.equal(await engagementForRequest(env, "req-missing"), null);
});

test("engagement: publishing the record walks requested to proposed, and the payment moves it to paid", async () => {
  const { env, sqlite } = freshEnv();
  const engagement = await openEngagement(env, "req-1", "2026-10-12T09:00:00.000Z");
  const record = await publishRecord(env, "req-1", { faults, review }, "https://tinystudio.io", "2026-10-12T10:00:00.000Z");
  const proposed = await engagementById(env, engagement.id);
  assert.equal(proposed.status, "proposed");
  assert.equal(proposed.record_id, record.id);
  const withCheckout = await attachCheckoutSession(env, proposed, "cs_42", "2026-10-12T11:00:00.000Z");
  assert.equal(withCheckout.checkout_session_id, "cs_42");
  const paid = await advanceEngagement(env, withCheckout, "paid", { type: "payment_recorded", detail: "pay_42", at: "2026-10-12T12:00:00.000Z" });
  assert.equal(paid.status, "paid");
  const journal = sqlite.prepare("SELECT type, from_status, to_status FROM engagement_events WHERE engagement_id = ? ORDER BY created_at, id").all(engagement.id);
  assert.deepEqual(journal.map(({ type, from_status, to_status }) => ({ type, from_status, to_status })), [
    { type: "engagement_opened", from_status: null, to_status: "requested" },
    { type: "status_changed", from_status: "requested", to_status: "appraised" },
    { type: "status_changed", from_status: "appraised", to_status: "proposed" },
    { type: "checkout_session_created", from_status: "proposed", to_status: "proposed" },
    { type: "payment_recorded", from_status: "proposed", to_status: "paid" }
  ]);
  assert.equal(sqlite.prepare("SELECT version FROM appraisal_records WHERE id = ?").get(record.id).version, 1);
});

test("engagement: an illegal step changes nothing and writes no event row", async () => {
  const { env, sqlite } = freshEnv();
  const engagement = await openEngagement(env, "req-1", "2026-10-12T09:00:00.000Z");
  for (const target of ["paid", "proved", "closed", "tracking"]) {
    await assert.rejects(
      advanceEngagement(env, engagement, target, { type: "status_changed", detail: "skip ahead", at: "2026-10-12T09:30:00.000Z" }),
      new RegExp(`illegal engagement transition: requested -> ${target}`)
    );
  }
  const after = await engagementById(env, engagement.id);
  assert.equal(after.status, "requested");
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM engagement_events").get().n, 1);
  assert.equal(sqlite.prepare("SELECT changed_at FROM engagements WHERE id = ?").get(engagement.id).changed_at, "2026-10-12T09:00:00.000Z");
});

test("engagement: a stale state object cannot move the engagement or write an event", async () => {
  const { env, sqlite } = freshEnv();
  const engagement = await openEngagement(env, "req-1", "2026-10-12T09:00:00.000Z");
  await publishRecord(env, "req-1", { faults, review }, "https://tinystudio.io", "2026-10-12T10:00:00.000Z");
  const proposed = await engagementById(env, engagement.id);
  assert.equal(proposed.status, "proposed");
  await advanceEngagement(env, proposed, "paid", { type: "payment_recorded", detail: "pay_1", at: "2026-10-12T11:00:00.000Z" });
  const events = sqlite.prepare("SELECT COUNT(*) AS n FROM engagement_events").get().n;

  const stale = await advanceEngagement(env, proposed, "paid", { type: "payment_recorded", detail: "pay_2", at: "2026-10-12T12:00:00.000Z" });
  assert.equal(stale.status, "proposed", "a stale object is not moved");
  assert.equal((await engagementById(env, engagement.id)).status, "paid", "the stored state does not move back");
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM engagement_events").get().n, events, "the lost update writes no event row");
});

test("engagement: the correction line is the unit the desk reviews, and the record cites what closed it", async () => {
  const { env, sqlite, objects } = freshEnv();
  const engagement = await openEngagement(env, "req-1", "2026-10-12T09:00:00.000Z");
  const record = await publishRecord(env, "req-1", { faults, review }, "https://tinystudio.io", "2026-10-12T10:00:00.000Z");
  let current = await engagementById(env, engagement.id);
  assert.equal(current.status, "proposed", "publishing the record walks the engagement to proposed");
  current = await advanceEngagement(env, current, "paid", { type: "payment_recorded", detail: "pay_1", at: "2026-10-12T11:00:00.000Z" });
  current = await advanceEngagement(env, current, "in_correction", { type: "status_changed", detail: "start", at: "2026-10-12T12:00:00.000Z" });

  const line = await addCorrectionLine(
    env,
    current,
    { faultId: "f1", faultTitle: "Home page loads in 6.1 seconds", beforeText: "The hero image is 2.4 MB.", afterText: "The hero image is 190 KB.", legalCopy: 0 },
    "2026-10-12T12:30:00.000Z"
  );
  assert.equal(line.status, "draft");
  assert.equal(line.fault_id, "f1");
  assert.equal((await correctionLines(env, current.id)).length, 1);
  await assert.rejects(reviewCorrectionLine(env, line, "hold", { reviewer: "Jev", note: "", at: "2026-10-12T13:00:00.000Z" }), /unknown correction review action/);
  const approved = await reviewCorrectionLine(env, line, "approve", { reviewer: "Jev", note: "", at: "2026-10-12T13:00:00.000Z" });
  assert.equal(approved.status, "approved");

  const proved = await advanceEngagement(env, current, "proved", { type: "status_changed", detail: "review complete", at: "2026-10-12T14:00:00.000Z" });
  const withNote = await setKickoffNote(env, proved, "Tracking starts 1 November 2026.", "2026-10-12T15:00:00.000Z");
  assert.equal(withNote.kickoff_note, "Tracking starts 1 November 2026.");
  const tracking = await advanceEngagement(env, withNote, "tracking", { type: "status_changed", detail: "tracking opened", at: "2026-10-12T16:00:00.000Z" });
  assert.equal(tracking.status, "tracking");

  const closed = await advanceEngagement(env, tracking, "closed", { type: "status_changed", detail: "month closed", at: "2026-11-30T09:00:00.000Z" });
  assert.equal(closed.status, "closed");
  await assert.rejects(advanceEngagement(env, closed, "paid", { type: "status_changed", detail: "reopen", at: "2026-11-30T10:00:00.000Z" }), /illegal engagement transition: closed -> paid/);

  const lines = await correctionLines(env, engagement.id);
  assert.equal(lines.length, 1);
  assert.equal(lines[0].recorded_version, null, "the record is not republished by this suite");
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM correction_reviews").get().n, 1);
  assert.equal(objects.has(`records/${record.id}.html`), true, "the record is stored");
  const html = objects.get(`records/${record.id}.html`);
  assert.ok(html.includes("Correction Record") === false, "no correction is recorded until the desk approves it");
});
