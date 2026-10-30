import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import worker from "../src/worker.js";
import { publishRecord, renderProofReceipt, renderRecord } from "../src/record.js";
import costing from "../config/costing.json" with { type: "json" };
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
  { id: "f2", type: "missing-title", title: "Missing page title", url: "https://clinic.example/about", evidence: "The <title> element is empty." },
  { id: "f3", type: "slow-load", title: "Not worth the customer's attention", url: "https://clinic.example/old", evidence: "Archived page." }
];
const review = { keep: ["f1", "f2"], summary: "The home page is slow on phones and one page has no title." };

test("costing: every row cites a source, and a figure is leads x delta x deal value", async () => {
  for (const row of costing.rows) {
    assert.match(row.source.url, /^https:\/\//, `${row.id} needs a cited source`);
    assert.ok(row.source.title && row.basis, `${row.id} needs a title and a basis`);
  }
  const { env, objects } = freshEnv();
  const { id } = await publishRecord(env, "req-1", { faults, review }, "https://tinystudio.io", "2026-10-13T08:00:00.000Z");
  const html = objects.get(`records/${id}.html`);

  assert.match(html, /data-cite="row:slow-load input:dealValue input:monthlyLeads">\$14,144</);
  assert.match(html, /data-cite="row:slow-load">4\.42%</);
  assert.match(html, /data-cite="input:dealValue">\$8,000</);
  assert.match(html, /data-cite="input:monthlyLeads">40</);
});

test("quality gate: no uncited number in a rendered record", async () => {
  const { env, objects } = freshEnv();
  const { id } = await publishRecord(env, "req-1", { faults, review }, "https://tinystudio.io", "2026-10-13T08:00:00.000Z");
  const html = objects.get(`records/${id}.html`);
  const ids = new Set(costing.rows.map((r) => r.id));
  const offerRefs = new Set(["priceCents", "workingDays", "slotsPerMonth", "startDate"]);
  const figs = [...html.matchAll(/<span class="fig" data-cite="([^"]+)">/g)];
  assert.ok(figs.length > 0);
  for (const [, cite] of figs) {
    for (const ref of cite.split(" ")) {
      const [kind, name] = ref.split(":");
      assert.ok(
        (kind === "row" && ids.has(name)) ||
          (kind === "input" && ["dealValue", "monthlyLeads"].includes(name)) ||
          (kind === "offer" && offerRefs.has(name)),
        `bad citation ${ref}`
      );
    }
  }

  const price = `$${(offer.priceCents / 100).toLocaleString("en-US")}`;
  assert.ok(html.includes(`data-cite="offer:priceCents">${price}<`), "the proposal price is cited from the offer");
  assert.ok(html.includes(`data-cite="offer:workingDays">${offer.workingDays}<`));
  assert.ok(html.includes(`data-cite="offer:slotsPerMonth">${offer.slotsPerMonth}<`));
  assert.ok(html.includes('data-cite="offer:startDate">1 November 2026<'));
  const body = html
    .replace(/<span class="fig"[^>]*>[^<]*<\/span>/g, "")
    .replace(/<style>[\s\S]*?<\/style>/, "")
    .replace(/<head>[\s\S]*?<\/head>/, "")
    .replace(/<main[^>]*>/, "<main>")
    .replace(/<p class="where">[^<]*<\/p>/g, "")
    .replace(/<h3>[^<]*<\/h3>/g, "")
    .replace(/<li class="fault">[\s\S]*?<\/li>/g, (li) => li.replace(/<p>(?!Estimated|Not priced)[^<]*<\/p>/g, ""))
    .replace(/<a [^>]*>[^<]*<\/a>/g, "")
    .replace(/<li id="row-[^"]*">[^<]*(?:<a[^>]*>.*?<\/a>)?[^<]*<\/li>/g, "");
  assert.doesNotMatch(body.replace(/<[^>]+>/g, " "), /\d/, "a digit outside a cited figure");
});

test("reviewer step: removed faults do not appear and a summary is required", async () => {
  const { env, objects } = freshEnv();
  const { id } = await publishRecord(env, "req-1", { faults, review }, "https://tinystudio.io", "2026-10-13T08:00:00.000Z");
  const html = objects.get(`records/${id}.html`);
  assert.ok(html.includes(review.summary));
  assert.ok(!html.includes("Not worth the customer"));
  assert.ok(html.includes("The &lt;title&gt; element is empty."), "fault text is HTML-escaped");
  await assert.rejects(publishRecord(env, "req-1", { faults, review: { keep: ["f1"], summary: " " } }, "https://tinystudio.io", "x"), /summary/);
});

test("no email without a record link, and the record opens at /records/{id}", async () => {
  const { env, sent, sqlite } = freshEnv();
  const { id, version } = await publishRecord(env, "req-1", { faults, review }, "https://tinystudio.io", "2026-10-13T08:00:00.000Z");
  assert.equal(version, 1);
  assert.equal(sent.length, 1);
  assert.ok(sent[0].text.includes(`https://tinystudio.io/records/${id}`), "email carries the record link");
  assert.match(id, /^[0-9a-f-]{36}$/);

  const res = await worker.fetch(new Request(`https://tinystudio.io/records/${id}`), env);
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type"), /text\/html/);
  assert.match(res.headers.get("x-robots-tag"), /noindex/);
  assert.match(await res.text(), /Appraisal Record/);

  const guess = await worker.fetch(new Request("https://tinystudio.io/records/req-1"), env);
  assert.equal(guess.status, 404);
  const missing = await worker.fetch(new Request(`https://tinystudio.io/records/${crypto.randomUUID()}`), env);
  assert.equal(missing.status, 404);

  const again = await publishRecord(env, "req-1", { faults, review }, "https://tinystudio.io", "2026-10-14T08:00:00.000Z");
  assert.deepEqual({ id: again.id, version: again.version }, { id, version: 2 });
  assert.equal(sent.length, 1, "a re-render sends no second email");
  const events = sqlite.prepare("SELECT type FROM appraisal_events WHERE request_id = 'req-1' AND type = 'record_rendered'").all();
  assert.equal(events.length, 2, "every state change writes an event row");
});

test("bad inputs fail the publish instead of printing $NaN", async () => {
  const { env, sqlite } = freshEnv();
  sqlite.prepare("UPDATE appraisal_requests SET avg_deal_value = 0").run();
  await assert.rejects(publishRecord(env, "req-1", { faults, review }, "https://tinystudio.io", "x"), /above zero/);
  await assert.rejects(publishRecord(env, "req-1", { faults, review: { keep: null, summary: "S" } }, "https://tinystudio.io", "x"), /keep list/);
});

test("renderRecord is pure: same inputs, same bytes", () => {
  const request = { site_url: "https://a.example", name: "A", avg_deal_value: 1000, monthly_leads: 10 };
  const args = { request, faults: faults.slice(0, 1), summary: "S", version: 1, renderedAt: "t" };
  assert.equal(renderRecord(args), renderRecord(args));
});

const driftedFault = { id: "f4", type: "no-mobile-viewport", title: "Layout breaks on phones", url: "https://clinic.example/", evidence: "The page has no viewport meta tag." };
const receiptRow = (sqlite, requestId) =>
  sqlite.prepare("SELECT * FROM proof_receipts WHERE request_id = ?").all(requestId)[0];
const runRow = (objects, recordId, version) =>
  JSON.parse(objects.get(`records/${recordId}.v${version}.json`));

test("proof receipt: a rerun renders before and after side by side with the delta per fault", async () => {
  const { env, objects, sqlite } = freshEnv();
  const first = await publishRecord(env, "req-1", { faults, review }, "https://tinystudio.io", "2026-10-13T08:00:00.000Z");
  const corrected = { keep: ["f2"], summary: "The home page now loads in under two seconds. The about page still has no title." };
  await publishRecord(env, "req-1", { faults, review: corrected }, "https://tinystudio.io", "2026-10-14T08:00:00.000Z", { kind: "rerun" });

  const receipt = receiptRow(sqlite, "req-1");
  assert.ok(receipt, "the rerun writes a receipt row");
  assert.deepEqual({ record: receipt.record_id, before: receipt.before_version, after: receipt.after_version }, { record: first.id, before: 1, after: 2 });
  const html = objects.get(`records/${receipt.id}.html`);
  assert.match(html, /<h1>Proof Receipt: https:\/\/clinic\.example<\/h1>/);
  assert.ok(html.includes("Home page loads in 6.1 seconds"), "the closed fault is listed");
  assert.ok(html.includes("The &lt;title&gt; element is empty."), "the fault that persists is listed");
  assert.match(html, /Monthly cost removed: <span class="fig" data-cite="row:slow-load input:dealValue input:monthlyLeads">\$14,144<\/span>\./, "the closed fault carries its removed cost");
  assert.ok(html.includes("Not priced: the costing table claims no conversion delta for this fault."), "an unpriced fault says so");
  assert.ok(html.includes("The rerun found no new fault."), "a rerun that found nothing new says so");
  assert.match(html, /Monthly cost before: <span class="fig" data-cite="row:slow-load input:dealValue input:monthlyLeads">\$14,144<\/span>\. Monthly cost now: <span class="fig" data-cite="input:dealValue input:monthlyLeads">\$0<\/span>\./, "both totals are cited figures");
  assert.match(html, /<time datetime="2026-10-13T08:00:00\.000Z">2026-10-13<\/time>/, "the comparison dates are marked");

  const res = await worker.fetch(new Request("https://tinystudio.io/records/" + receipt.id), env);
  assert.equal(res.status, 200);
  assert.match(res.headers.get("x-robots-tag"), /noindex/);
  const record = objects.get(`records/${first.id}.html`);
  assert.ok(record.includes(`/records/${receipt.id}`), "the record links its proof receipt");
  const rows = JSON.parse(JSON.stringify(sqlite.prepare("SELECT id, request_id, before_version, after_version FROM proof_receipts").all()));
  assert.deepEqual(rows, [{ id: receipt.id, request_id: "req-1", before_version: 1, after_version: 2 }], "the receipt row reads back");

  const again = renderProofReceipt({ request: { avg_deal_value: 8000, monthly_leads: 40, site_url: "https://clinic.example", name: "Dana Reyes" }, before: runRow(objects, first.id, 1), after: runRow(objects, first.id, 2), renderedAt: "2026-10-14T08:00:00.000Z" });
  assert.equal(again, html, "the receipt renderer is pure");
});

test("quality gate: no uncited number in a proof receipt", async () => {
  const { env, objects, sqlite } = freshEnv();
  await publishRecord(env, "req-1", { faults, review }, "https://tinystudio.io", "2026-10-13T08:00:00.000Z");
  await publishRecord(env, "req-1", { faults: [...faults, driftedFault], review: { keep: ["f1", "f2", "f4"], summary: "The rerun found a new mobile layout fault." } }, "https://tinystudio.io", "2026-10-14T08:00:00.000Z", { kind: "rerun" });
  const html = objects.get(`records/${receiptRow(sqlite, "req-1").id}.html`);

  const ids = new Set(costing.rows.map((r) => r.id));
  const figs = [...html.matchAll(/<span class="fig" data-cite="([^"]+)">/g)];
  assert.ok(figs.length >= 3, `expected cited figures, got ${figs.length}`);
  for (const [, cite] of figs) {
    for (const token of cite.split(" ")) {
      if (token.startsWith("row:")) assert.ok(ids.has(token.slice(4)), `${cite} cites unknown row ${token}`);
      else assert.ok(["input:dealValue", "input:monthlyLeads"].includes(token), `${cite} cites unknown input`);
    }
  }
  const stripped = html
    .replace(/<span class="fig"[^>]*>[^<]*<\/span>/g, "")
    .replace(/<time[^>]*>[^<]*<\/time>/g, " ")
    .replace(/<style>[\s\S]*?<\/style>/, "")
    .replace(/<head>[\s\S]*?<\/head>/, "")
    .replace(/<main[^>]*>/, "<main>")
    .replace(/<h2>Summary<\/h2>\s*<p>[^<]*<\/p>/, " ")
    .replace(/<h3>[^<]*<\/h3>/g, "")
    .replace(/<p class="where">[^<]*<\/p>/g, "")
    .replace(/<li class="fault">[\s\S]*?<\/li>/g, (li) => li.replace(/<p>(?!<span class="fig")[^<]*<\/p>/g, ""))
    .replace(/<li id="row-[^"]*">[^<]*(?:<a[^>]*>[\s\S]*?<\/a>)?[^<]*<\/li>/g, "");
  assert.doesNotMatch(stripped.replace(/<[^>]+>/g, " "), /\d/, "every digit outside a figure or a marked date");
});

test("drift email: one email above the cost floor with the record link, and silence below it", async () => {
  const { env, sent, sqlite } = freshEnv();
  const first = await publishRecord(env, "req-1", { faults, review }, "https://tinystudio.io", "2026-10-13T08:00:00.000Z");
  assert.equal(sent.length, 1);
  const drifted = [...faults, driftedFault];
  await publishRecord(env, "req-1", { faults, review }, "https://tinystudio.io", "2026-10-14T08:00:00.000Z", { kind: "drift" });
  assert.equal(sent.length, 1, "a drift rerun during an active engagement sends nothing");
  assert.equal(sqlite.prepare("SELECT type FROM appraisal_events WHERE type = 'drift_engagement_active'").all().length, 1, "the active-engagement gate, not the cost floor, kept it quiet");
  assert.equal(sqlite.prepare("SELECT type FROM appraisal_events WHERE type = 'drift_below_threshold'").all().length, 0);
  sqlite.prepare("UPDATE engagements SET status = 'closed'").run();
  await publishRecord(env, "req-1", { faults: drifted, review: { keep: ["f1", "f2", "f4"], summary: "The rerun found a new mobile layout fault." } }, "https://tinystudio.io", "2026-10-15T08:00:00.000Z", { kind: "drift" });
  assert.equal(sent.length, 2, "a closed engagement's rerun with a new fault above the floor sends exactly one email");
  const emailedReceipt = sqlite.prepare("SELECT id FROM proof_receipts ORDER BY created_at DESC LIMIT 1").get().id;
  assert.equal(sent[1].to, "dana@clinic.example");
  assert.ok(sent[1].text.includes(`https://tinystudio.io/records/${first.id}`), "the drift email carries the record link");
  assert.ok(sent[1].text.includes(`https://tinystudio.io/records/${emailedReceipt}`), "the drift email carries the receipt link");
  assert.doesNotMatch(sent[1].text, /\$/i, "the drift email prices nothing");
  assert.doesNotMatch(sent[1].text, /correction|book|call|offer|price|upgrade/i, "the drift email carries no sales copy");
  assert.deepEqual(JSON.parse(JSON.stringify(sqlite.prepare("SELECT detail FROM appraisal_events WHERE type = 'drift_email_sent'").all())), [{ detail: `${first.id} +26880` }]);

  await publishRecord(env, "req-1", { faults: drifted, review: { keep: ["f1", "f2", "f4"], summary: "The rerun confirmed the same faults." } }, "https://tinystudio.io", "2026-10-16T08:00:00.000Z", { kind: "drift" });
  assert.equal(sent.length, 2, "a rerun with no new fault sends nothing");
  assert.deepEqual(JSON.parse(JSON.stringify(sqlite.prepare("SELECT detail FROM appraisal_events WHERE type = 'drift_below_threshold' ORDER BY id").all())), [{ detail: `${first.id} +0` }]);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM proof_receipts").all()[0].n, 3, "every drift rerun, even one that emails nothing, writes its receipt");
});

test("a rerun without a stored baseline writes no receipt and sends nothing", async () => {
  const { env, objects, sent, sqlite } = freshEnv();
  const first = await publishRecord(env, "req-1", { faults, review }, "https://tinystudio.io", "2026-10-13T08:00:00.000Z");
  objects.delete(`records/${first.id}.v1.json`);
  await publishRecord(env, "req-1", { faults, review }, "https://tinystudio.io", "2026-10-14T08:00:00.000Z", { kind: "rerun" });
  assert.equal(sent.length, 1, "no drift email without the run to compare against");
  assert.equal(receiptRow(sqlite, "req-1"), undefined);
  assert.equal(sqlite.prepare("SELECT type FROM appraisal_events WHERE type = 'drift_baseline_missing'").all().length, 1);
});

test("scheduled drift rerun: a record untouched for 90 days is requeued once per window", async () => {
  const { env, sqlite } = freshEnv();
  await publishRecord(env, "req-1", { faults, review }, "https://tinystudio.io", "2026-10-13T08:00:00.000Z");
  const jobs = () => JSON.parse(JSON.stringify(sqlite.prepare("SELECT status FROM appraisal_rerun_jobs").all()));
  const controller = { cron: "17 6 * * *", scheduledTime: Date.parse("2026-10-13T08:00:00.000Z") };

  env.APPRAISAL_NOW = "2026-11-06T00:00:00.000Z";
  await worker.scheduled(controller, env);
  assert.deepEqual(jobs(), [], "a record rendered 24 days ago is not due");

  env.APPRAISAL_NOW = "2027-01-09T08:00:00.000Z";
  await worker.scheduled(controller, env);
  assert.deepEqual(jobs(), [], "a record rendered 88 days ago is not due");

  env.APPRAISAL_NOW = "2027-01-11T08:00:00.000Z";
  await worker.scheduled(controller, env);
  assert.deepEqual(jobs(), [], "the record of an engagement that never paid is not queued");

  sqlite.prepare("INSERT INTO engagement_payments (payment_id, engagement_id, status, role, created_at) SELECT 'pay-drift-1', id, 'paid', 'engagement', '2026-10-13T08:00:00.000Z' FROM engagements").run();
  await worker.scheduled(controller, env);
  assert.deepEqual(jobs(), [{ status: "queued" }], "a record untouched for 90 days is requeued");

  await worker.scheduled(controller, env);
  assert.deepEqual(jobs(), [{ status: "queued" }], "the same window does not requeue it");

  env.APPRAISAL_NOW = "2027-04-15T00:00:00.000Z";
  await worker.scheduled(controller, env);
  assert.equal(jobs().length, 2, "a new window requeues it");
});

test("record: the checkout button is offered only while the engagement awaits payment", async () => {
  const { sqlite } = freshEnv();
  const request = sqlite.prepare("SELECT * FROM appraisal_requests WHERE id = 'req-1'").get();
  const args = { request, faults, summary: "S", version: 1, renderedAt: "2026-10-13T08:00:00.000Z", recordId: "r1", engagementId: "e1" };

  const awaiting = renderRecord({ ...args, engagementStatus: "proposed" });
  assert.ok(awaiting.includes('action="/api/engagements/checkout"'), "the proposal asks for the payment while the engagement is proposed");
  assert.ok(awaiting.includes("Start the correction"));

  const settled = renderRecord({ ...args, engagementStatus: "paid" });
  assert.ok(!settled.includes('action="/api/engagements/checkout"'), "a paid record offers no second checkout");
  assert.ok(!settled.includes("Start the correction"));
  assert.ok(settled.includes("We received your payment."), "the record says the payment arrived");

  const unsettled = renderRecord({ ...args, engagementStatus: "appraised" });
  assert.ok(!unsettled.includes('action="/api/engagements/checkout"'), "a record whose engagement has no proposal yet offers no checkout");
  assert.ok(unsettled.includes("This record is being prepared."));

  const undated = renderRecord({ ...args });
  assert.ok(!undated.includes('action="/api/engagements/checkout"'), "a record with no engagement status offers no checkout");
  assert.ok(undated.includes("This record is being prepared."));
});

test("record: only a settled engagement says the payment arrived", async () => {
  const { sqlite } = freshEnv();
  const request = sqlite.prepare("SELECT * FROM appraisal_requests WHERE id = 'req-1'").get();
  const args = { request, faults, summary: "S", version: 1, renderedAt: "2026-10-13T08:00:00.000Z", recordId: "r1", engagementId: "e1" };

  for (const status of ["requested", "appraised"]) {
    const html = renderRecord({ ...args, engagementStatus: status });
    assert.ok(!html.includes("We received your payment."), `an engagement in ${status} has paid nothing`);
    assert.ok(!html.includes('action="/api/engagements/checkout"'), `an engagement in ${status} cannot pay yet`);
  }

  for (const status of ["paid", "in_correction", "proved", "tracking", "closed"]) {
    const html = renderRecord({ ...args, engagementStatus: status });
    assert.ok(html.includes("We received your payment."), `an engagement in ${status} has paid`);
    assert.ok(!html.includes('action="/api/engagements/checkout"'), `an engagement in ${status} offers no second checkout`);
  }
});

test("engagement walk: a pre-existing engagement is advanced by its state, not by the record version", async () => {
  const { env, sqlite } = freshEnv();
  sqlite.prepare(
    "INSERT INTO engagements (id, request_id, status, created_at, changed_at) VALUES ('e-pre', 'req-1', 'requested', '2026-10-12T09:00:00.000Z', '2026-10-12T09:00:00.000Z')"
  ).run();
  sqlite.prepare(
    "INSERT INTO appraisal_records (id, request_id, version, rendered_at, faults_json, review_json) VALUES ('rec-pre', 'req-1', 3, '2026-10-12T09:30:00.000Z', ?1, ?2)"
  ).run(JSON.stringify(faults), JSON.stringify(review));

  const { version } = await publishRecord(env, "req-1", { faults, review }, "https://tinystudio.io", "2026-10-13T08:00:00.000Z");
  assert.equal(version, 4, "the pre-existing record is republished as the next version");

  const engagement = sqlite.prepare("SELECT status FROM engagements WHERE id = 'e-pre'").get();
  assert.equal(engagement.status, "proposed", "the engagement walks from its own state, so a record past version one still reaches the proposal");

  const journal = sqlite.prepare("SELECT type, from_status, to_status FROM engagement_events WHERE engagement_id = 'e-pre' ORDER BY created_at, id").all();
  assert.deepEqual(journal.map(({ type, from_status, to_status }) => ({ type, from_status, to_status })), [
    { type: "status_changed", from_status: "requested", to_status: "appraised" },
    { type: "status_changed", from_status: "appraised", to_status: "proposed" }
  ]);
});

test("engagement walk: a paid engagement is never walked back to a proposal", async () => {
  const { env, sqlite } = freshEnv();
  sqlite.prepare(
    "INSERT INTO engagements (id, request_id, status, created_at, changed_at) VALUES ('e-paid', 'req-1', 'paid', '2026-10-12T09:00:00.000Z', '2026-10-12T09:00:00.000Z')"
  ).run();

  const { version } = await publishRecord(env, "req-1", { faults, review }, "https://tinystudio.io", "2026-10-13T08:00:00.000Z");
  assert.equal(version, 1);
  const engagement = sqlite.prepare("SELECT status FROM engagements WHERE id = 'e-paid'").get();
  assert.equal(engagement.status, "paid", "a paid engagement stays paid when the record is published");
});
