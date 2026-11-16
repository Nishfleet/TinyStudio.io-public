import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { recordsMock } from "./records-mock.js";
import worker from "../src/worker.js";
import { publishRecord } from "../src/record.js";
import { addDeskCorrectionLine, reviewDeskCorrectionLine } from "../src/desk.js";
import { handleDodoWebhook } from "../src/payments.js";
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

function freshEnv() {
  const sqlite = new DatabaseSync(":memory:");
  for (const file of readdirSync(new URL("../migrations/", import.meta.url)).sort()) {
    sqlite.exec(readFileSync(new URL(`../migrations/${file}`, import.meta.url), "utf8"));
  }
  sqlite.prepare(
    "INSERT INTO appraisal_requests (id, site_url, business_type, avg_deal_value, monthly_leads, name, email, month, created_at) VALUES ('req-1','https://clinic.example','Dental clinic',8000,40,'Dana Reyes','dana@clinic.example','2026-10','2026-10-12T09:00:00.000Z')"
  ).run();
  const objects = new Map();
  const env = {
    DODO_TINYSTUDIO_API_KEY: "test-api-key",
    DODO_TINYSTUDIO_PRODUCT_ID: PRODUCT_ID,
    DODO_TINYSTUDIO_WEBHOOK_SECRET: WEBHOOK_SECRET,
    DODO_TINYSTUDIO_MODE: "test",
    DB: d1(sqlite),
    EMAIL: { async send() {} },
    RECORDS: recordsMock(objects)
  };
  return { sqlite, env, objects };
}

const faults = [
  { id: "f1", type: "slow-load", title: "Home page loads in 6.1 seconds", url: "https://clinic.example/", evidence: "Largest Contentful Paint 6.1 s on mobile." }
];
const review = { keep: ["f1"], summary: "The home page is slow on phones." };

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

async function addDeskLines(env, engagementId, titles, at) {
  const lines = [];
  for (const [index, title] of titles.entries()) {
    const added = await addDeskCorrectionLine(
      env,
      { engagementId, faultId: `f${index}`, faultTitle: title, beforeText: `${title}: before`, afterText: `${title}: after` },
      "Jev",
      at
    );
    lines.push(added.line);
  }
  return lines;
}

/** @param {Env} env @param {string} path @param {Record<string, string>} [form] @param {Record<string, string>} [headers] */
const postLines = (env, path, form = {}, headers = {}) =>
  worker.fetch(
    new Request(`https://tinystudio.io${path}`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", origin: "https://tinystudio.io", ...headers },
      body: new URLSearchParams(form).toString()
    }),
    env
  );

test("record page: five lines — approve two, edit one, skip two; only the approved two are marked ready to apply", async () => {
  const { env, sqlite, objects } = freshEnv();
  const { recordId, engagementId } = await paidEngagement(env, sqlite);
  const titles = ["Hero image weighs 2.4 MB", "Missing page title", "No alt text on photos", "Form hides its submit label", "Footer cites an old price"];
  const lines = await addDeskLines(env, engagementId, titles, "2026-10-13T11:00:00.000Z");
  for (const line of lines) {
    const passed = await reviewDeskCorrectionLine(env, { lineId: line.id, action: "approve", note: "" }, "Jev", "2026-10-13T12:00:00.000Z");
    assert.equal(passed.line.status, "proposed");
  }
  assert.equal(sqlite.prepare("SELECT status FROM engagements WHERE id = ?").get(engagementId).status, "in_correction");

  const firstApprove = await postLines(env, `/api/records/${recordId}/lines/${lines[0].id}`, { decision: "approve" });
  const firstBody = await firstApprove.json();
  assert.equal(firstBody.ok, true);
  assert.equal(firstBody.lineStatus, "recorded");
  const secondApprove = await postLines(env, `/api/records/${recordId}/lines/${lines[1].id}`, { decision: "approve" });
  assert.equal((await secondApprove.json()).lineStatus, "recorded");
  const edit = await postLines(env, `/api/records/${recordId}/lines/${lines[2].id}`, { decision: "edit", text: "Write alt text that names the treatment." });
  assert.equal((await edit.json()).lineStatus, "draft");
  const firstSkip = await postLines(env, `/api/records/${recordId}/lines/${lines[3].id}`, { decision: "skip" });
  assert.equal((await firstSkip.json()).lineStatus, "skipped");
  const secondSkip = await postLines(env, `/api/records/${recordId}/lines/${lines[4].id}`, { decision: "skip" });
  assert.equal((await secondSkip.json()).lineStatus, "skipped");

  const statuses = sqlite.prepare("SELECT id, status, after_text FROM correction_lines ORDER BY rowid").all().map((row) => ({ ...row }));
  assert.deepEqual(statuses.map((row) => [row.status, row.after_text]), [
    ["recorded", "Hero image weighs 2.4 MB: after"],
    ["recorded", "Missing page title: after"],
    ["draft", "Write alt text that names the treatment."],
    ["skipped", "Form hides its submit label: after"],
    ["skipped", "Footer cites an old price: after"]
  ]);
  assert.equal(sqlite.prepare("SELECT status FROM engagements WHERE id = ?").get(engagementId).status, "in_correction", "the edited line still waits for the reviewer");

  const reviews = sqlite.prepare("SELECT action, created_at FROM correction_reviews WHERE reviewer = 'customer' ORDER BY rowid").all().map((row) => ({ ...row }));
  assert.deepEqual(
    reviews.map((row) => row.action),
    ["customer_approve", "customer_approve", "customer_edit", "customer_skip", "customer_skip"]
  );
  for (const row of reviews) {
    assert.match(row.created_at, /^2026-/, "every customer decision is recorded with its time");
  }

  const html = objects.get(`records/${recordId}.html`);
  assert.ok(html.includes("Fault closed: Hero image weighs 2.4 MB"), "the first approved line is ready to apply");
  assert.ok(html.includes("Fault closed: Missing page title"), "the second approved line is ready to apply");
  assert.ok(!html.includes("No alt text on photos"), "the edited line is neither applied nor shown");
  assert.ok(html.includes("Skipped: you left this change alone."), "the skipped lines say so");
  assert.ok(html.includes("Form hides its submit label"), "the skipped line is named");
  assert.ok(!html.includes("Your decision"), "no line waits for the customer on this page");
  assert.ok(!html.includes("Approve all"), "no approve-all without a line to approve");

  const passed = await reviewDeskCorrectionLine(env, { lineId: lines[2].id, action: "approve", note: "" }, "Jev", "2026-10-13T13:00:00.000Z");
  assert.equal(passed.line.status, "proposed");
  const approved = await postLines(env, `/api/records/${recordId}/lines/${lines[2].id}`, { decision: "approve" });
  assert.equal((await approved.json()).engagementStatus, "proved");
  const finalHtml = objects.get(`records/${recordId}.html`);
  assert.ok(finalHtml.includes("Fault closed: No alt text on photos"), "the edited line applies only after the reviewer and the customer both pass it");
  assert.equal(sqlite.prepare("SELECT status FROM engagements WHERE id = ?").get(engagementId).status, "proved");
});

test("record page: approve all passes every line the reviewer approved, and nothing else", async () => {
  const { env, sqlite } = freshEnv();
  const { recordId, engagementId } = await paidEngagement(env, sqlite);
  const lines = await addDeskLines(env, engagementId, ["Slow hero", "Missing title", "Thin about page"], "2026-10-13T11:00:00.000Z");
  await reviewDeskCorrectionLine(env, { lineId: lines[0].id, action: "approve", note: "" }, "Jev", "2026-10-13T12:00:00.000Z");
  await reviewDeskCorrectionLine(env, { lineId: lines[1].id, action: "approve", note: "" }, "Jev", "2026-10-13T12:05:00.000Z");

  const approveAll = await postLines(env, `/api/records/${recordId}/lines`, { decision: "approve-all" });
  const body = await approveAll.json();
  assert.equal(body.ok, true);
  assert.equal(body.count, 2);
  assert.equal(body.engagementStatus, "in_correction", "the desk's draft keeps the correction open");
  assert.equal(sqlite.prepare("SELECT status FROM correction_lines WHERE id = ?").get(lines[0].id).status, "recorded");
  assert.equal(sqlite.prepare("SELECT status FROM correction_lines WHERE id = ?").get(lines[1].id).status, "recorded");
  assert.equal(sqlite.prepare("SELECT status FROM correction_lines WHERE id = ?").get(lines[2].id).status, "draft", "the desk's draft is never approved by approve all");
});

test("record page: a draft line never reaches the customer, so the customer cannot decide it", async () => {
  const { env, sqlite, objects } = freshEnv();
  const { recordId, engagementId } = await paidEngagement(env, sqlite);
  const [passed, draft] = await addDeskLines(env, engagementId, ["Slow hero", "Missing title"], "2026-10-13T11:00:00.000Z");
  await reviewDeskCorrectionLine(env, { lineId: passed.id, action: "approve", note: "" }, "Jev", "2026-10-13T12:00:00.000Z");
  const html = objects.get(`records/${recordId}.html`);
  assert.ok(html.includes("Slow hero"), "the passed line waits on the record page");
  assert.ok(!html.includes("Missing title"), "the draft line is not on the record page");

  const refused = await postLines(env, `/api/records/${recordId}/lines/${draft.id}`, { decision: "approve" });
  assert.equal(refused.status, 400);
  assert.equal((await refused.json()).error, "customer_decision_failed");
  assert.equal(sqlite.prepare("SELECT status FROM correction_lines WHERE id = ?").get(draft.id).status, "draft");
});
test("record page: the decision endpoints answer only a same-origin POST that names a real record and line", async () => {
  const { env, sqlite } = freshEnv();
  const { recordId, engagementId } = await paidEngagement(env, sqlite);
  const [line] = await addDeskLines(env, engagementId, ["Slow hero"], "2026-10-13T11:00:00.000Z");

  const gets = await worker.fetch(new Request(`https://tinystudio.io/api/records/${recordId}/lines/${line.id}`), env);
  assert.equal(gets.status, 405);
  const crossSite = await postLines(env, `/api/records/${recordId}/lines/${line.id}`, { decision: "approve" }, { "sec-fetch-site": "cross-site" });
  assert.equal(crossSite.status, 403);
  const noOrigin = await worker.fetch(
    new Request(`https://tinystudio.io/api/records/${recordId}/lines/${line.id}`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "decision=approve"
    }),
    env
  );
  assert.equal(noOrigin.status, 403);
  const badRecord = await postLines(env, "/api/records/not-a-record/lines", { decision: "approve-all" });
  assert.equal(badRecord.status, 404);
  const personal = await postLines(env, "/api/records/dana@clinic.example/lines", { decision: "approve-all" });
  assert.equal(personal.status, 404, "the record's address carries no personal data");
  const unknownLine = await postLines(env, `/api/records/${recordId}/lines/00000000-0000-4000-8000-000000000000`, { decision: "approve" });
  assert.equal(unknownLine.status, 404);
  const unknownDecision = await postLines(env, `/api/records/${recordId}/lines/${line.id}`, { decision: "hold" });
  assert.equal(unknownDecision.status, 400);
  const emptyEdit = await postLines(env, `/api/records/${recordId}/lines/${line.id}`, { decision: "edit" });
  assert.equal(emptyEdit.status, 400);
  const nothingPending = await postLines(env, `/api/records/${recordId}/lines`, { decision: "approve-all" });
  assert.equal(nothingPending.status, 400);

  await reviewDeskCorrectionLine(env, { lineId: line.id, action: "approve", note: "" }, "Jev", "2026-10-13T12:00:00.000Z");
  const browser = await postLines(
    env,
    `/api/records/${recordId}/lines/${line.id}`,
    { decision: "approve" },
    { accept: "text/html", "sec-fetch-mode": "navigate" }
  );
  assert.equal(browser.status, 200);
  const page = await browser.text();
  assert.match(page, /Approved\. The line is ready to apply\./);
  assert.match(page, new RegExp(`url=/records/${recordId}`));
});

test("record page: a line of another record belongs to no decision here", async () => {
  const { env, sqlite } = freshEnv();
  const { engagementId } = await paidEngagement(env, sqlite);
  const [line] = await addDeskLines(env, engagementId, ["Slow hero"], "2026-10-13T11:00:00.000Z");
  await reviewDeskCorrectionLine(env, { lineId: line.id, action: "approve", note: "" }, "Jev", "2026-10-13T12:00:00.000Z");
  sqlite.prepare(
    "INSERT INTO appraisal_requests (id, site_url, business_type, avg_deal_value, monthly_leads, name, email, month, created_at) VALUES ('req-2','https://other.example','Dental clinic',8000,40,'Ann Lee','ann@other.example','2026-10','2026-10-12T10:00:00.000Z')"
  ).run();
  const other = await publishRecord(env, "req-2", { faults, review }, "https://tinystudio.io", "2026-10-13T09:00:00.000Z");
  const stranger = await postLines(env, `/api/records/${other.id}/lines/${line.id}`, { decision: "approve" });
  assert.equal(stranger.status, 400, "the engagement gate answers before any line is touched");
  assert.equal(sqlite.prepare("SELECT status FROM correction_lines WHERE id = ?").get(line.id).status, "proposed", "the stranger's record decides nothing");
});

test("record page: an edited line keeps the legal-copy consent gate from the desk", async () => {
  const { env, sqlite } = freshEnv();
  const { recordId, engagementId } = await paidEngagement(env, sqlite);
  const added = await addDeskCorrectionLine(
    env,
    { engagementId, faultId: "f1", faultTitle: "Terms paragraph", beforeText: "a", afterText: "b", legalCopy: 1, consentReceived: true },
    "Jev",
    "2026-10-13T11:00:00.000Z"
  );
  await reviewDeskCorrectionLine(env, { lineId: added.line.id, action: "approve", note: "" }, "Jev", "2026-10-13T12:00:00.000Z");
  const edit = await postLines(env, `/api/records/${recordId}/lines/${added.line.id}`, { decision: "edit", text: "The customer's own wording." });
  assert.equal((await edit.json()).lineStatus, "draft");
  assert.equal(sqlite.prepare("SELECT legal_copy, after_text FROM correction_lines WHERE id = ?").get(added.line.id).after_text, "The customer's own wording.");
});
