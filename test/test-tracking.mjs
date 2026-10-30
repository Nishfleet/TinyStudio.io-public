import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { recordsMock } from "./records-mock.js";
import worker from "../src/worker.js";
import { publishRecord } from "../src/record.js";
import {
  addDeskCorrectionLine,
  addDeskKickoffNote,
  addDeskTrackingNote,
  closeOutEngagement,
  reviewDeskCorrectionLine,
  setDeskSpecimenConsent
} from "../src/desk.js";
import { handleDodoWebhook } from "../src/payments.js";
import { engagementAllows } from "../src/guardrails.js";
import { Webhook } from "standardwebhooks";
import offer from "../config/offer.json" with { type: "json" };

const WEBHOOK_SECRET = "whsec_" + Buffer.from("tinystudio-test-secret-key").toString("base64");
const SIGNER = new Webhook(Buffer.from("tinystudio-test-secret-key").toString("base64"));
const PRODUCT_ID = "prod_tinystudio_correction";

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

function fakeLimiter(limit) {
  const seen = new Map();
  return {
    async limit({ key }) {
      const n = (seen.get(key) || 0) + 1;
      seen.set(key, n);
      return { success: n <= limit };
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
    DODO_TINYSTUDIO_API_KEY: "test-api-key",
    DODO_TINYSTUDIO_PRODUCT_ID: PRODUCT_ID,
    DODO_TINYSTUDIO_WEBHOOK_SECRET: WEBHOOK_SECRET,
    DODO_TINYSTUDIO_MODE: "test",
    DB: d1(sqlite),
    APPRAISAL_LIMITER: fakeLimiter(50),
    EMAIL: { async send(message) { sent.push(message); } },
    RECORDS: recordsMock(objects)
  };
  return { sqlite, env, sent, objects };
}

const faults = [
  { id: "f1", type: "slow-load", title: "Home page loads in 6.1 seconds", url: "https://clinic.example/", evidence: "Largest Contentful Paint 6.1 s on mobile." },
  { id: "f2", type: "missing-title", title: "Missing page title", url: "https://clinic.example/about", evidence: "The <title> element is empty." }
];
const review = { keep: ["f1", "f2"], summary: "The home page is slow on phones and one page has no title." };
const rerunReview = { keep: ["f2"], summary: "The home page now loads in under two seconds. The about page still has no title." };

function proofRerun(env) {
  return publishRecord(
    env,
    "req-1",
    { faults: faults.filter((fault) => fault.id !== "f1"), review: rerunReview },
    "https://tinystudio.io",
    "2026-10-26T08:00:00.000Z",
    { kind: "rerun" }
  );
}

function payEngagement(env, sqlite, recordId) {
  const engagement = sqlite.prepare("SELECT id FROM engagements WHERE request_id = 'req-1'").get();
  const event = {
    type: "payment.succeeded",
    data: {
      payment_id: `pay_${engagement.id}`,
      session_id: `cs_${engagement.id}`,
      currency: offer.currency,
      total_amount: offer.priceCents,
      customer_email: "dana@clinic.example",
      product_cart: [{ product_id: PRODUCT_ID, quantity: 1 }],
      metadata: { engagement_id: engagement.id, record_id: recordId, request_id: "req-1" }
    }
  };
  const body = JSON.stringify(event);
  const webhookId = `wh_${engagement.id}`;
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = SIGNER.sign(webhookId, new Date(timestamp * 1000), body);
  return handleDodoWebhook(env, {
    rawBody: body,
    headers: {
      "webhook-id": webhookId,
      "webhook-timestamp": String(timestamp),
      "webhook-signature": signature
    }
  });
}

async function engagementInTracking(env, sqlite) {
  const recordId = (await publishRecord(env, "req-1", { faults, review }, "https://tinystudio.io", "2026-10-13T08:00:00.000Z")).id;
  await payEngagement(env, sqlite, recordId);
  const engagementId = sqlite.prepare("SELECT id FROM engagements WHERE request_id = 'req-1'").get().id;
  await addDeskCorrectionLine(
    env,
    { engagementId, faultId: "f1", faultTitle: "Home page loads in 6.1 seconds", beforeText: "6.1 s LCP", afterText: "1.9 s LCP" },
    "reviewer@tinystudio.io",
    "2026-10-20T08:00:00.000Z"
  );
  await reviewDeskCorrectionLine(env, { lineId: sqlite.prepare("SELECT id FROM correction_lines").get().id, action: "approve" }, "reviewer@tinystudio.io", "2026-10-24T08:00:00.000Z");
  await addDeskKickoffNote(env, { engagementId, note: "Brand words stay as written." }, "reviewer@tinystudio.io", "2026-10-25T08:00:00.000Z");
  return { engagementId, recordId };
}

test("a desk republish re-renders the stored record and writes no receipt and no email", async () => {
  const { env, sent, sqlite } = freshEnv();
  await engagementInTracking(env, sqlite);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM proof_receipts").get().n, 0, "the approval and the kickoff republishes write no receipt");
  assert.equal(sent.length, 1, "no email beyond the first record email");
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM appraisal_events WHERE type IN ('drift_email_sent', 'drift_below_threshold')").get().n, 0, "no drift check runs on a desk republish");
});

test("a republish after the proof rerun keeps the receipt link on the record", async () => {
  const { env, objects, sent, sqlite } = freshEnv();
  const recordId = (await publishRecord(env, "req-1", { faults, review }, "https://tinystudio.io", "2026-10-13T08:00:00.000Z")).id;
  await payEngagement(env, sqlite, recordId);
  const engagementId = sqlite.prepare("SELECT id FROM engagements WHERE request_id = 'req-1'").get().id;
  await addDeskCorrectionLine(
    env,
    { engagementId, faultId: "f1", faultTitle: "Home page loads in 6.1 seconds", beforeText: "6.1 s LCP", afterText: "1.9 s LCP" },
    "reviewer@tinystudio.io",
    "2026-10-20T08:00:00.000Z"
  );
  await reviewDeskCorrectionLine(env, { lineId: sqlite.prepare("SELECT id FROM correction_lines").get().id, action: "approve" }, "reviewer@tinystudio.io", "2026-10-24T08:00:00.000Z");
  await proofRerun(env);
  const receiptId = sqlite.prepare("SELECT id FROM proof_receipts").get().id;
  await addDeskKickoffNote(env, { engagementId, note: "Brand words stay as written." }, "reviewer@tinystudio.io", "2026-10-25T08:00:00.000Z");
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM proof_receipts").get().n, 1, "the republish after the rerun writes no second receipt");
  assert.ok(objects.get(`records/${recordId}.html`).includes(`href="/records/${receiptId}"`), "the record still links its latest receipt");
  assert.equal(sent.length, 1, "no email from the republish");
});

test("the nightly clock queues one tracking check per engagement day, once per day", async () => {
  const { env, sqlite } = freshEnv();
  const { engagementId } = await engagementInTracking(env, sqlite);
  const controller = { cron: "17 6 * * *", scheduledTime: Date.parse("2026-10-26T06:17:00.000Z") };

  env.APPRAISAL_NOW = "2026-10-27T06:17:00.000Z";
  await worker.scheduled(controller, env);
  const checks = () => sqlite.prepare("SELECT day, status FROM tracking_checks WHERE engagement_id = ? ORDER BY day").all(engagementId).map((row) => ({ ...row }));
  assert.deepEqual(checks(), [{ day: 1, status: "queued" }, { day: 2, status: "queued" }], "tracking opened 2026-10-25, so the night of 2026-10-27 is day 2");

  env.APPRAISAL_NOW = "2026-11-01T06:17:00.000Z";
  await worker.scheduled(controller, env);
  assert.equal(checks().length, 7, "the nights backfill every day up to day 7");

  env.APPRAISAL_NOW = "2026-12-01T06:17:00.000Z";
  await worker.scheduled(controller, env);
  assert.equal(checks().length, 14, "the checks stop at day 14");
  assert.equal(checks().filter((row) => row.day === 14).length, 1, "day 14 is queued once");
});

test("the day-7 and day-14 notes are the reviewer's, once each, only in tracking", async () => {
  const { env, sqlite } = freshEnv();
  const { engagementId } = await engagementInTracking(env, sqlite);

  await assert.rejects(
    addDeskTrackingNote(env, { engagementId, day: "6", note: "too early" }, "reviewer@tinystudio.io", "2026-11-01T08:00:00.000Z"),
    /day 7 or day 14/
  );
  await addDeskTrackingNote(env, { engagementId, day: "7", note: "Speed is holding; the site is indexed; rankings climbed two places." }, "reviewer@tinystudio.io", "2026-11-01T08:00:00.000Z");
  await assert.rejects(
    addDeskTrackingNote(env, { engagementId, day: "7", note: "again" }, "reviewer@tinystudio.io", "2026-11-01T09:00:00.000Z"),
    /already written/,
    "one day-7 note, not two"
  );
  await assert.rejects(
    addDeskTrackingNote(env, { engagementId, day: "14", note: "x" }, "", "2026-11-08T08:00:00.000Z"),
    /needs the reviewer/
  );
  await addDeskTrackingNote(env, { engagementId, day: "14", note: "Two weeks in: the form had four submissions from search." }, "reviewer@tinystudio.io", "2026-11-08T08:00:00.000Z");
  const notes = sqlite.prepare("SELECT day, reviewer FROM tracking_notes WHERE engagement_id = ? ORDER BY day").all(engagementId).map((row) => ({ ...row }));
  assert.deepEqual(notes, [{ day: 7, reviewer: "reviewer@tinystudio.io" }, { day: 14, reviewer: "reviewer@tinystudio.io" }]);
  const journal = sqlite.prepare("SELECT type FROM engagement_events WHERE engagement_id = ? AND type LIKE 'tracking_note%' ORDER BY id").all(engagementId);
  assert.deepEqual(journal.map((row) => row.type), ["tracking_note_day_7", "tracking_note_day_14"]);
});

test("a full engagement runs through to the Close-out, with the receipt and close-out links attached", async () => {
  const { env, objects, sent, sqlite } = freshEnv();
  const { engagementId, recordId } = await engagementInTracking(env, sqlite);
  await proofRerun(env);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM proof_receipts").get().n, 1, "only the engine rerun writes a receipt");
  assert.equal(sent.length, 1, "the proof rerun emails nothing while the engagement runs");
  await addDeskTrackingNote(env, { engagementId, day: "7", note: "Speed holds and the pages are indexed." }, "reviewer@tinystudio.io", "2026-11-01T08:00:00.000Z");
  await assert.rejects(
    closeOutEngagement(env, { engagementId: engagementId }, "reviewer@tinystudio.io", "2026-11-01T09:00:00.000Z").then(() => {}),
    /day-14/,
    "the close-out waits for the day-14 note"
  );
  await addDeskTrackingNote(env, { engagementId, day: "14", note: "Four form submissions from search in the second week." }, "reviewer@tinystudio.io", "2026-11-08T08:00:00.000Z");

  const result = await closeOutEngagement(env, { engagementId }, "reviewer@tinystudio.io", "2026-11-08T09:00:00.000Z");
  assert.equal(result.engagement.status, "closed");
  const closeOutRow = sqlite.prepare("SELECT * FROM close_outs").get();
  assert.equal(closeOutRow.id, result.closeOutId);
  assert.equal(closeOutRow.referral_code, result.referralCode);
  assert.equal(closeOutRow.receipt_id, result.receiptId, "the close-out names the proof receipt beside the record");
  assert.ok(result.receiptId, "the correction above produced a proof receipt to attach");

  const html = objects.get(`records/${result.closeOutId}.html`);
  assert.match(html, /<h1>Close-out: https:\/\/clinic\.example<\/h1>/);
  assert.ok(html.includes("Who else should see their record?"), "the close-out asks the one question");
  assert.ok(html.includes(`href="/records/${recordId}"`), "the close-out links the record");
  assert.ok(html.includes(`href="/records/${result.receiptId}"`), "the close-out links the proof receipt");
  assert.ok(html.includes("Day 7: Speed holds"), "the day-7 note is on the page");
  assert.ok(html.includes("Day 14: Four form submissions"), "the day-14 note is on the page");
  assert.ok(html.includes(result.referralCode));
  assert.ok(html.includes("for the month it was minted and the month after"));
  assert.doesNotMatch(html, /class="fig"/, "the close-out prices nothing");

  const res = await worker.fetch(new Request("https://tinystudio.io/records/" + result.closeOutId), env);
  assert.equal(res.status, 200);

  const events = sqlite.prepare("SELECT type FROM engagement_events WHERE engagement_id = ? ORDER BY id").all(engagementId).map((row) => row.type);
  assert.deepEqual(events, [
    "engagement_opened",
    "status_changed",
    "status_changed",
    "status_changed",
    "checkout_session_created",
    "correction_line_added",
    "status_changed",
    "correction_line_approve",
    "correction_line_recorded",
    "status_changed",
    "kickoff_note_added",
    "status_changed",
    "tracking_note_day_7",
    "tracking_note_day_14",
    "close_out_rendered",
    "status_changed"
  ]);
  const state = sqlite.prepare("SELECT status FROM engagements WHERE id = ?").get(engagementId);
  assert.equal(state.status, "closed", "the close-out ends the engagement");
});

test("the close-out's referral code skips the waitlist for the current month", async () => {
  const { env, sqlite } = freshEnv();
  const { engagementId } = await engagementInTracking(env, sqlite);
  await addDeskTrackingNote(env, { engagementId, day: "7", note: "Speed holds." }, "reviewer@tinystudio.io", "2026-11-01T08:00:00.000Z");
  await addDeskTrackingNote(env, { engagementId, day: "14", note: "Rankings hold." }, "reviewer@tinystudio.io", "2026-11-08T08:00:00.000Z");
  const { referralCode } = await closeOutEngagement(env, { engagementId }, "reviewer@tinystudio.io", "2026-11-08T09:00:00.000Z");

  env.APPRAISAL_NOW = "2026-11-09T08:00:00.000Z";
  sqlite.prepare(
    `INSERT INTO appraisal_requests (id, site_url, business_type, avg_deal_value, monthly_leads, name, email, month, created_at)
     VALUES ('filler-1','https://a.example','Dental clinic',8000,40,'A','a@a.example','2026-11','2026-11-01T08:00:00.000Z'),
            ('filler-2','https://b.example','Dental clinic',8000,40,'B','b@b.example','2026-11','2026-11-01T08:00:00.000Z'),
            ('filler-3','https://e.example','Dental clinic',8000,40,'E','e@e.example','2026-11','2026-11-01T08:00:00.000Z'),
            ('filler-4','https://f.example','Dental clinic',8000,40,'F','f@f.example','2026-11','2026-11-01T08:00:00.000Z'),
            ('filler-5','https://g.example','Dental clinic',8000,40,'G','g@g.example','2026-11','2026-11-01T08:00:00.000Z')`
  ).run();
  const submit = async (body, ip) =>
    worker.fetch(
      new Request("https://tinystudio.io/api/appraisal-requests", {
        method: "POST",
        headers: { "content-type": "application/json", "origin": "https://tinystudio.io", "CF-Connecting-IP": ip },
        body: JSON.stringify({ website: body.website, email: body.email, name: body.name, businessType: "Dental clinic", dealValue: 8000, monthlyLeads: 40, referral: body.referral })
      }),
      env
    );
  const sixth = await (await submit({ website: "https://c.example", email: "c@c.example", name: "C" }, "192.0.2.1")).json();
  assert.equal(sixth.status, "accepted", "the sixth slot of the month is open");
  const full = await (await submit({ website: "https://h.example", email: "h@h.example", name: "H" }, "192.0.2.2")).json();
  assert.equal(full.status, "waitlisted", "the month is full, as the close-out's question assumes");
  const referred = await (await submit({ website: "https://d.example", email: "d@d.example", name: "D", referral: referralCode }, "192.0.2.3")).json();
  assert.equal(referred.status, "accepted", "the close-out's code skips the waitlist for the current month");
  assert.equal(sqlite.prepare("SELECT referrer FROM appraisal_referrals WHERE code = ?").get(referralCode).referrer, "Dana Reyes");

  env.APPRAISAL_NOW = "2026-12-10T08:00:00.000Z";
  sqlite.prepare(
    `INSERT INTO appraisal_requests (id, site_url, business_type, avg_deal_value, monthly_leads, name, email, month, created_at)
     VALUES ('dec-1','https://1.example','Dental clinic',8000,40,'One','1@1.example','2026-12','2026-12-01T08:00:00.000Z'),
            ('dec-2','https://2.example','Dental clinic',8000,40,'Two','2@2.example','2026-12','2026-12-01T08:00:00.000Z'),
            ('dec-3','https://3.example','Dental clinic',8000,40,'Three','3@3.example','2026-12','2026-12-01T08:00:00.000Z'),
            ('dec-4','https://4.example','Dental clinic',8000,40,'Four','4@4.example','2026-12','2026-12-01T08:00:00.000Z'),
            ('dec-5','https://5.example','Dental clinic',8000,40,'Five','5@5.example','2026-12','2026-12-01T08:00:00.000Z'),
            ('dec-6','https://6.example','Dental clinic',8000,40,'Six','6@6.example','2026-12','2026-12-01T08:00:00.000Z')`
  ).run();
  const later = await (await submit({ website: "https://late.example", email: "l@l.example", name: "L", referral: referralCode }, "192.0.2.9")).json();
  assert.equal(later.status, "waitlisted", "the code skips nothing in a month after the one it was minted in");
});

test("specimen consent is the client's say-so, recorded on the engagement and shown on the wall", async () => {
  const { env, objects, sqlite } = freshEnv();
  const { engagementId } = await engagementInTracking(env, sqlite);

  assert.equal(engagementAllows({ status: "paid" }, "set_specimen_consent"), false, "no consent is asked before the proof exists");
  assert.equal(engagementAllows({ status: "tracking" }, "set_specimen_consent"), true);
  await assert.rejects(
    setDeskSpecimenConsent(env, { engagementId, consent: true }, "reviewer@tinystudio.io", "2026-11-01T08:00:00.000Z"),
    /own words/,
    "a yes carries the client's own words"
  );
  const consented = await setDeskSpecimenConsent(
    env,
    { engagementId, consent: true, sayso: "Yes — put our before and after on the wall. Dana" },
    "reviewer@tinystudio.io",
    "2026-11-01T08:00:00.000Z"
  );
  assert.equal(consented.specimen_consent, 1);
  const event = sqlite.prepare("SELECT detail FROM engagement_events WHERE type = 'specimen_consent_recorded'").get();
  assert.ok(event.detail.includes("put our before and after on the wall"), "the client's own words are on file with the consent");

  await addDeskTrackingNote(env, { engagementId, day: "7", note: "Holding." }, "reviewer@tinystudio.io", "2026-11-01T08:00:00.000Z");
  await addDeskTrackingNote(env, { engagementId, day: "14", note: "Holding." }, "reviewer@tinystudio.io", "2026-11-08T08:00:00.000Z");
  const { closeOutId } = await closeOutEngagement(env, { engagementId }, "reviewer@tinystudio.io", "2026-11-08T09:00:00.000Z");
  assert.ok(objects.get(`records/${closeOutId}.html`).includes("this proof pair now sits in our specimen gallery"), "a consented close-out says so");

  const assets = new Map([["/specimen", '<!doctype html><html><body><main><div class="band"><h2>Yours is read the same way.</h2></div></main></body></html>']]);
  const galleryEnv = {
    ...env,
    ASSETS: { async fetch(request) { return new Response(assets.get(new URL(request.url).pathname), { headers: { "content-type": "text/html; charset=utf-8" } }); } }
  };
  const page = await worker.fetch(new Request("https://tinystudio.io/specimen"), galleryEnv);
  const body = await page.text();
  assert.match(body, /id="client-proof-pairs"/);
  assert.ok(body.includes("https://clinic.example"), "the consented proof pair is on the wall");
  assert.ok(body.includes("/records/"), "the wall links the record");
});
