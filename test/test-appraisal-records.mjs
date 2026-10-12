import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import worker from "../src/worker.js";
import { publishRecord, renderRecord } from "../src/record.js";
import costing from "../config/costing.json" with { type: "json" };

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
      async get(key) { return objects.has(key) ? { body: objects.get(key) } : null; }
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
  // 40 leads x 4.42% x $8,000 = $14,144, traced to row slow-load and both inputs.
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
  const figs = [...html.matchAll(/<span class="fig" data-cite="([^"]+)">/g)];
  assert.ok(figs.length > 0);
  for (const [, cite] of figs) {
    for (const ref of cite.split(" ")) {
      const [kind, name] = ref.split(":");
      assert.ok((kind === "row" && ids.has(name)) || (kind === "input" && ["dealValue", "monthlyLeads"].includes(name)), `bad citation ${ref}`);
    }
  }
  // Any digit run in the body text outside a cited figure, the title, the
  // record's own metadata and the fault/summary text the reviewer supplied is a defect.
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

  // A second state change re-renders the same record id at a higher version.
  const again = await publishRecord(env, "req-1", { faults, review }, "https://tinystudio.io", "2026-10-14T08:00:00.000Z");
  assert.deepEqual({ id: again.id, version: again.version }, { id, version: 2 });
  const events = sqlite.prepare("SELECT type FROM appraisal_events WHERE request_id = 'req-1' AND type = 'record_rendered'").all();
  assert.equal(events.length, 2, "every state change writes an event row");
});

test("renderRecord is pure: same inputs, same bytes", () => {
  const request = { site_url: "https://a.example", name: "A", avg_deal_value: 1000, monthly_leads: 10 };
  const args = { request, faults: faults.slice(0, 1), summary: "S", version: 1, renderedAt: "t" };
  assert.equal(renderRecord(args), renderRecord(args));
});
