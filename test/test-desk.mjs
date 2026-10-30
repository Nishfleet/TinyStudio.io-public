import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import worker from "../src/worker.js";
import { publishRecord } from "../src/record.js";
import { addDeskCorrectionLine, addDeskKickoffNote, deskDraftLines, deskQueue, reviewDeskCorrectionLine } from "../src/desk.js";
import { deskQueuePage } from "../src/desk-page.js";
import { handleDodoWebhook } from "../src/payments.js";
import { Webhook } from "standardwebhooks";

const WEBHOOK_SECRET = "whsec_" + Buffer.from("tinystudio-test-secret-key").toString("base64");
const SIGNER = new Webhook(Buffer.from("tinystudio-test-secret-key").toString("base64"));
const PRODUCT_ID = "prod_tinystudio_correction";
import offer from "../config/offer.json" with { type: "json" };

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
    DODO_TINYSTUDIO_API_KEY: "test-api-key",
    DODO_TINYSTUDIO_PRODUCT_ID: PRODUCT_ID,
    DODO_TINYSTUDIO_WEBHOOK_SECRET: WEBHOOK_SECRET,
    DODO_TINYSTUDIO_MODE: "test",
    DB: d1(sqlite),
    EMAIL: { async send(message) { sent.push(message); } },
    RECORDS: {
      async put(key, body) { objects.set(key, body); },
      async get(key) {
        if (!objects.has(key)) return null;
        const body = objects.get(key);
        return { body, text: async () => body };
      }
    }
  };
  return { sqlite, env, sent, objects };
}

const faults = [
  { id: "f1", type: "slow-load", title: "Home page loads in 6.1 seconds", url: "https://clinic.example/", evidence: "Largest Contentful Paint 6.1 s on mobile." },
  { id: "f2", type: "missing-title", title: "Missing page title", url: "https://clinic.example/about", evidence: "The <title> element is empty." }
];
const review = { keep: ["f1", "f2"], summary: "The home page is slow on phones and one page has no title." };

async function paidEngagement(env, sqlite, at = "2026-10-13T10:00:00.000Z") {
  const recordId = (await publishRecord(env, "req-1", { faults, review }, "https://tinystudio.io", "2026-10-13T08:00:00.000Z")).id;
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
  await handleDodoWebhook(
    env,
    { rawBody: body, headers: new Headers({ "webhook-id": webhookId, "webhook-timestamp": String(timestamp), "webhook-signature": signature }) },
    at
  );
  return { recordId, engagementId: engagement.id };
}

test("desk: the queue lists the site, the state and the lines awaiting review", async () => {
  const { env, sqlite } = freshEnv();
  const { engagementId } = await paidEngagement(env, sqlite);

  const empty = await deskQueue(env);
  assert.equal(empty.length, 1);
  assert.equal(empty[0].site_url, "https://clinic.example");
  assert.equal(empty[0].status, "paid");
  assert.equal(empty[0].open_lines, 0);
  assert.equal((await deskDraftLines(env)).length, 0);

  await addDeskCorrectionLine(
    env,
    {
      engagementId,
      faultId: "f1",
      faultTitle: "Home page loads in 6.1 seconds",
      beforeText: "The hero image is 2.4 MB and loads last.",
      afterText: "The hero image is 190 KB and loads first.",
      legalCopy: 0
    },
    "Jev",
    "2026-10-13T11:00:00.000Z"
  );
  const queue = await deskQueue(env);
  assert.equal(queue[0].status, "in_correction", "a line moves the engagement into correction");
  assert.equal(queue[0].open_lines, 1);
  const lines = await deskDraftLines(env);
  assert.equal(lines.length, 1);
  assert.equal(lines[0].engagement_id, engagementId);
  assert.equal(lines[0].fault_id, "f1");
  assert.equal(lines[0].status, "draft");

  const page = await deskQueuePage(queue, lines);
  const html = await page.text();
  assert.equal(page.status, 200);
  assert.match(page.headers.get("x-robots-tag"), /noindex/);
  assert.match(page.headers.get("cache-control"), /no-store/);
  assert.match(page.headers.get("content-security-policy"), /form-action 'self'/);
  assert.ok(html.includes("https://clinic.example"), "the desk queue names the site");
  assert.ok(html.includes("The hero image is 2.4 MB and loads last."), "the desk queue shows the line before approval");
  assert.ok(html.includes(`action="/api/desk/correction-lines/${lines[0].id}/review"`), "each line has its own review action");
  assert.ok(html.includes('value="approve"'));
  assert.ok(html.includes('value="reject"'));
});

test("desk: a line is added only after the payment cleared", async () => {
  const { env, sqlite } = freshEnv();
  await publishRecord(env, "req-1", { faults, review }, "https://tinystudio.io", "2026-10-13T08:00:00.000Z");
  const engagement = sqlite.prepare("SELECT id FROM engagements WHERE request_id = 'req-1'").get();
  await assert.rejects(
    addDeskCorrectionLine(env, { engagementId: engagement.id, faultTitle: "T", beforeText: "a", afterText: "b", legalCopy: 0 }, "Jev", "2026-10-13T09:00:00.000Z"),
    /only after payment/
  );
  assert.equal(sqlite.prepare("SELECT status FROM engagements WHERE id = ?").get(engagement.id).status, "proposed");
});

test("desk: legal copy needs the customer's written consent on file", async () => {
  const { env, sqlite } = freshEnv();
  const { engagementId } = await paidEngagement(env, sqlite);
  await assert.rejects(
    addDeskCorrectionLine(env, { engagementId, faultId: "f2", faultTitle: "Missing page title", beforeText: "a", afterText: "b", legalCopy: 1 }, "Jev", "2026-10-13T11:00:00.000Z"),
    /written consent/
  );
  const consent = await addDeskCorrectionLine(
    env,
    { engagementId, faultId: "f2", faultTitle: "Missing page title", beforeText: "a", afterText: "b", legalCopy: 1, consentReceived: true },
    "Jev",
    "2026-10-13T11:00:00.000Z"
  );
  assert.equal(consent.line.status, "draft");
  assert.equal(consent.line.legal_copy, 1);
});

test("desk: an engagement whose every line is rejected stays in correction", async () => {
  const { env, sqlite, objects } = freshEnv();
  const { recordId, engagementId } = await paidEngagement(env, sqlite);
  const line = await addDeskCorrectionLine(
    env,
    {
      engagementId,
      faultId: "f1",
      faultTitle: "Home page loads in 6.1 seconds",
      beforeText: "The hero image is 2.4 MB and loads last.",
      afterText: "The hero image is 190 KB and loads first.",
      legalCopy: 0
    },
    "Jev",
    "2026-10-13T11:00:00.000Z"
  );
  const reviewed = await reviewDeskCorrectionLine(
    env,
    { lineId: line.line.id, action: "reject", note: "the after text names a tool we do not use" },
    "Jev",
    "2026-10-13T12:00:00.000Z"
  );
  assert.equal(reviewed.line.status, "rejected");
  assert.equal(reviewed.engagement.status, "in_correction", "nothing was proved, so the correction stays open");
  assert.equal(sqlite.prepare("SELECT status FROM engagements WHERE id = ?").get(engagementId).status, "in_correction");
  assert.equal(sqlite.prepare("SELECT version FROM appraisal_records WHERE id = ?").get(recordId).version, 1, "a rejected line republishes nothing");
  assert.equal(objects.has(`records/${recordId}.html`), true);

  const again = await addDeskCorrectionLine(
    env,
    {
      engagementId,
      faultId: "f2",
      faultTitle: "Missing page title",
      beforeText: "The <title> element is empty.",
      afterText: "The <title> element names the clinic and the service.",
      legalCopy: 0
    },
    "Jev",
    "2026-10-13T12:30:00.000Z"
  );
  const proved = await reviewDeskCorrectionLine(env, { lineId: again.line.id, action: "approve", note: "" }, "Jev", "2026-10-13T13:00:00.000Z");
  assert.equal(proved.engagement.status, "proved", "an approved line proves the correction");
});

test("desk: a rejected line is not published, and the last approval republishes the record", async () => {
  const { env, sqlite, objects } = freshEnv();
  const { recordId, engagementId } = await paidEngagement(env, sqlite);
  const first = await addDeskCorrectionLine(
    env,
    {
      engagementId,
      faultId: "f1",
      faultTitle: "Home page loads in 6.1 seconds",
      beforeText: "The hero image is 2.4 MB and loads last.",
      afterText: "The hero image is 190 KB and loads first.",
      legalCopy: 0
    },
    "Jev",
    "2026-10-13T11:00:00.000Z"
  );
  const second = await addDeskCorrectionLine(
    env,
    {
      engagementId,
      faultId: "f2",
      faultTitle: "Missing page title",
      beforeText: "The <title> element is empty.",
      afterText: "The <title> element names the clinic and the service.",
      legalCopy: 0
    },
    "Jev",
    "2026-10-13T11:30:00.000Z"
  );

  await reviewDeskCorrectionLine(env, { lineId: first.line.id, action: "reject", note: "the after text names a tool we do not use" }, "Jev", "2026-10-13T12:00:00.000Z");
  const rejected = sqlite.prepare("SELECT status, reviewer, review_note FROM correction_lines WHERE id = ?").get(first.line.id);
  assert.equal(rejected.status, "rejected");
  assert.equal(rejected.reviewer, "Jev");
  assert.match(rejected.review_note, /a tool we do not use/);
  const stillCorrecting = sqlite.prepare("SELECT status FROM engagements WHERE id = ?").get(engagementId);
  assert.equal(stillCorrecting.status, "in_correction", "one open line keeps the engagement in correction");
  assert.equal(sqlite.prepare("SELECT version FROM appraisal_records WHERE id = ?").get(recordId).version, 1, "a rejection republishes nothing");

  const approved = await reviewDeskCorrectionLine(env, { lineId: second.line.id, action: "approve", note: "" }, "Jev", "2026-10-13T12:30:00.000Z");
  assert.equal(approved.line.status, "approved");
  assert.equal(sqlite.prepare("SELECT status FROM engagements WHERE id = ?").get(engagementId).status, "proved", "the last approval proves the correction");

  const record = sqlite.prepare("SELECT version FROM appraisal_records WHERE id = ?").get(recordId);
  assert.equal(record.version, 2, "the record is republished once the correction is proved");
  const storedLine = sqlite.prepare("SELECT status, recorded_version FROM correction_lines WHERE id = ?").get(second.line.id);
  assert.equal(storedLine.status, "recorded");
  assert.equal(storedLine.recorded_version, 2);

  const html = objects.get(`records/${recordId}.html`);
  assert.ok(html.includes("Correction Record"), "the record carries the correction section");
  assert.ok(html.includes("Reviewed and not applied"), "the rejected line is listed as not applied");
  assert.ok(!html.includes("The hero image is 2.4 MB and loads last."), "the rejected line is not published as a correction");
  assert.ok(html.includes("The &lt;title&gt; element names the clinic and the service."), "the approved line is published");
  assert.ok(html.includes("Fault closed"), "the fault the correction fixes is closed on the record");
  assert.ok(html.includes("Missing page title"), "the fault the correction fixes is named");
  assert.ok(html.includes(`data-cite="engagement:${engagementId}"`), "the correction state cites the engagement");

  const kickoff = await addDeskKickoffNote(env, { engagementId, note: "Tracking starts 1 November 2026. We report every Friday." }, "Jev", "2026-10-13T13:00:00.000Z");
  assert.equal(kickoff.status, "tracking");
  const afterKickoff = objects.get(`records/${recordId}.html`);
  assert.ok(afterKickoff.includes("Tracking starts 1 November 2026."), "the kickoff note is published on the record");
  const journal = sqlite.prepare("SELECT type FROM engagement_events WHERE engagement_id = ? ORDER BY created_at, id").all(engagementId).map((row) => row.type);
  assert.deepEqual(journal, [
    "engagement_opened",
    "status_changed",
    "status_changed",
    "status_changed",
    "checkout_session_created",
    "correction_line_added",
    "status_changed",
    "correction_line_added",
    "correction_line_reject",
    "correction_line_approve",
    "correction_line_recorded",
    "status_changed",
    "kickoff_note_added",
    "status_changed"
  ]);
});

test("desk: a failed republish returns the line to the desk, so the approval can be sent again", async () => {
  const { env, sqlite } = freshEnv();
  const { recordId, engagementId } = await paidEngagement(env, sqlite);
  const line = await addDeskCorrectionLine(
    env,
    { engagementId, faultId: "f1", faultTitle: "Home page loads in 6.1 seconds", beforeText: "a", afterText: "b", legalCopy: 0 },
    "Jev",
    "2026-10-13T11:00:00.000Z"
  );
  sqlite.prepare("UPDATE appraisal_records SET faults_json = NULL WHERE id = ?").run(recordId);
  await assert.rejects(
    reviewDeskCorrectionLine(env, { lineId: line.line.id, action: "approve", note: "" }, "Jev", "2026-10-13T12:00:00.000Z"),
    /cannot be re-rendered/
  );
  assert.equal(sqlite.prepare("SELECT status FROM engagements WHERE id = ?").get(engagementId).status, "in_correction", "a failed republish never proves the correction");
  const reverted = sqlite.prepare("SELECT status, reviewer, review_note FROM correction_lines WHERE id = ?").get(line.line.id);
  assert.equal(reverted.status, "draft", "the approval is taken back so the desk can send it again");
  assert.equal(reverted.reviewer, null);
  assert.equal(reverted.review_note, null);
  assert.equal(sqlite.prepare("SELECT version FROM appraisal_records WHERE id = ?").get(recordId).version, 1, "nothing was published");

  sqlite.prepare("UPDATE appraisal_records SET faults_json = ? WHERE id = ?").run(JSON.stringify(faults), recordId);
  const retried = await reviewDeskCorrectionLine(env, { lineId: line.line.id, action: "approve", note: "" }, "Jev", "2026-10-13T12:30:00.000Z");
  assert.equal(retried.line.status, "approved");
  assert.equal(sqlite.prepare("SELECT status FROM engagements WHERE id = ?").get(engagementId).status, "proved", "the second approval proves the correction");
  assert.equal(sqlite.prepare("SELECT version FROM appraisal_records WHERE id = ?").get(recordId).version, 2);
});

test("desk: no line is added or reviewed once the correction is proved", async () => {
  const { env, sqlite } = freshEnv();
  const { engagementId } = await paidEngagement(env, sqlite);
  const line = await addDeskCorrectionLine(
    env,
    { engagementId, faultId: "f1", faultTitle: "Home page loads in 6.1 seconds", beforeText: "a", afterText: "b", legalCopy: 0 },
    "Jev",
    "2026-10-13T11:00:00.000Z"
  );
  await reviewDeskCorrectionLine(env, { lineId: line.line.id, action: "approve", note: "" }, "Jev", "2026-10-13T12:00:00.000Z");
  await assert.rejects(
    addDeskCorrectionLine(env, { engagementId, faultId: "f2", faultTitle: "Missing page title", beforeText: "a", afterText: "b", legalCopy: 0 }, "Jev", "2026-10-13T12:30:00.000Z"),
    /accepts correction lines only after payment/
  );
  await assert.rejects(
    reviewDeskCorrectionLine(env, { lineId: line.line.id, action: "approve", note: "" }, "Jev", "2026-10-13T13:00:00.000Z"),
    /a correction line is reviewed only while the correction is in progress/
  );
});

test("desk: a failed republish leaves the kickoff open, so the note can be sent again", async () => {
  const { env, sqlite } = freshEnv();
  const { recordId, engagementId } = await paidEngagement(env, sqlite);
  const line = await addDeskCorrectionLine(
    env,
    { engagementId, faultId: "f1", faultTitle: "Home page loads in 6.1 seconds", beforeText: "a", afterText: "b", legalCopy: 0 },
    "Jev",
    "2026-10-13T11:00:00.000Z"
  );
  await reviewDeskCorrectionLine(env, { lineId: line.line.id, action: "approve", note: "" }, "Jev", "2026-10-13T12:00:00.000Z");
  assert.equal(sqlite.prepare("SELECT status FROM engagements WHERE id = ?").get(engagementId).status, "proved");
  sqlite.prepare("UPDATE appraisal_records SET review_json = NULL WHERE id = ?").run(recordId);
  await assert.rejects(
    addDeskKickoffNote(env, { engagementId, note: "Tracking starts 1 November 2026." }, "Jev", "2026-10-13T13:00:00.000Z"),
    /cannot be re-rendered/
  );
  assert.equal(sqlite.prepare("SELECT status FROM engagements WHERE id = ?").get(engagementId).status, "proved", "a failed republish never opens tracking");
  sqlite.prepare("UPDATE appraisal_records SET review_json = ? WHERE id = ?").run(JSON.stringify(review), recordId);
  const retried = await addDeskKickoffNote(env, { engagementId, note: "Tracking starts 1 November 2026." }, "Jev", "2026-10-13T13:30:00.000Z");
  assert.equal(retried.status, "tracking");
});

test("desk: a failed advance leaves the record published and the correction completable", async () => {
  const { env, sqlite } = freshEnv();
  const { recordId, engagementId } = await paidEngagement(env, sqlite);
  const line = await addDeskCorrectionLine(
    env,
    { engagementId, faultId: "f1", faultTitle: "Home page loads in 6.1 seconds", beforeText: "a", afterText: "b", legalCopy: 0 },
    "Jev",
    "2026-10-13T11:00:00.000Z"
  );
  const original = env.DB.prepare.bind(env.DB);
  let armed = true;
  env.DB.prepare = (sql) => {
    if (armed && sql.startsWith("UPDATE engagements SET status")) {
      armed = false;
      throw new Error("d1 write refused");
    }
    return original(sql);
  };
  await assert.rejects(
    reviewDeskCorrectionLine(env, { lineId: line.line.id, action: "approve", note: "" }, "Jev", "2026-10-13T12:00:00.000Z"),
    /d1 write refused/
  );
  env.DB.prepare = original;
  assert.equal(sqlite.prepare("SELECT status FROM engagements WHERE id = ?").get(engagementId).status, "in_correction");
  assert.equal(sqlite.prepare("SELECT status FROM correction_lines WHERE id = ?").get(line.line.id).status, "recorded", "the publish reached the line");
  assert.equal(sqlite.prepare("SELECT version FROM appraisal_records WHERE id = ?").get(recordId).version, 2);

  const completed = await reviewDeskCorrectionLine(env, { lineId: line.line.id, action: "approve", note: "" }, "Jev", "2026-10-13T12:30:00.000Z");
  assert.equal(completed.engagement.status, "proved", "the desk finishes the correction without a second review");
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM correction_reviews WHERE line_id = ?").get(line.line.id).n, 1, "the line is not reviewed twice");
});

test("desk route: it answers only when Cloudflare Access is configured", async () => {
  const { env } = freshEnv();
  const closed = await worker.fetch(new Request("https://tinystudio.io/desk"), env);
  assert.equal(closed.status, 503);
  assert.match(await closed.text(), /not configured/);
  const closedAction = await worker.fetch(
    new Request("https://tinystudio.io/api/desk/correction-lines", { method: "POST", headers: { Origin: "https://tinystudio.io" } }),
    env
  );
  assert.equal(closedAction.status, 503);
});

test("desk: a line carries a reviewable id, and nothing is reviewed before approval", async () => {
  const { env, sqlite } = freshEnv();
  const { engagementId } = await paidEngagement(env, sqlite);
  const line = await addDeskCorrectionLine(
    env,
    { engagementId, faultId: "f1", faultTitle: "Home page loads in 6.1 seconds", beforeText: "a", afterText: "b", legalCopy: 0 },
    "Jev",
    "2026-10-13T11:00:00.000Z"
  );
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM correction_reviews").get().n, 0);
  assert.match(line.line.id, /^[0-9a-f-]{36}$/);
});
