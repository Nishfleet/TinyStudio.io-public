import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import worker from "../src/worker.js";
import { deskQueue } from "../src/desk.js";
import { deskQueuePage as renderDeskQueuePage } from "../src/desk-page.js";

const SECRET = "seofixkit-test-shared-secret";

function d1(sqlite) {
  return {
    prepare(sql) {
      let values = [];
      const statement = {
        bind(...bound) {
          values = bound;
          return statement;
        },
        async first() {
          return sqlite.prepare(sql).get(...values) ?? null;
        },
        async run() {
          const result = sqlite.prepare(sql).run(...values);
          return { success: true, meta: { changes: Number(result.changes) } };
        },
        async all() {
          return { results: sqlite.prepare(sql).all(...values) };
        }
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

function freshEnv(overrides = {}) {
  const sqlite = new DatabaseSync(":memory:");
  for (const file of readdirSync(new URL("../migrations/", import.meta.url)).sort()) {
    sqlite.exec(readFileSync(new URL(`../migrations/${file}`, import.meta.url), "utf8"));
  }
  const env = {
    DB: d1(sqlite),
    APPRAISAL_LIMITER: fakeLimiter(5),
    SEOFIXKIT_REQUEST_SECRET: SECRET,
    ...overrides
  };
  return { sqlite, env };
}

async function sign(timestamp, body, secret = SECRET) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${timestamp}.${body}`));
  return [...new Uint8Array(signature)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

const BODY = {
  site: "clinic.example",
  email: "dana@clinic.example",
  reportId: "sfk-report-123",
  consentText: "Yes, send my report to TinyStudio and have them fix it."
};

async function post(env, body = BODY, { timestamp, signature, headers = {} } = {}) {
  const raw = typeof body === "string" ? body : JSON.stringify(body);
  const at = timestamp === undefined ? Math.floor(Date.now() / 1000) : timestamp;
  const requestHeaders = {
    "Content-Type": "application/json",
    "CF-Connecting-IP": "198.51.100.9",
    ...headers
  };
  requestHeaders["X-TinyStudio-Timestamp"] = String(at);
  requestHeaders["X-TinyStudio-Signature"] =
    signature === undefined ? `sha256=${await sign(at, raw)}` : signature;
  return worker.fetch(
    new Request("https://tinystudio.io/api/requests/from-seofixkit", {
      method: "POST",
      headers: requestHeaders,
      body: raw
    }),
    env
  );
}

test("seofixkit: an unsigned request is rejected with 401", async () => {
  const { env, sqlite } = freshEnv();
  const response = await post(env, BODY, { signature: "" });
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { ok: false, error: "unauthorized" });
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM appraisal_requests").get().n, 0);
});

test("seofixkit: a wrong signature is rejected with 401", async () => {
  const { env, sqlite } = freshEnv();
  const response = await post(env, BODY, { signature: "sha256=" + "0".repeat(64) });
  assert.equal(response.status, 401);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM appraisal_requests").get().n, 0);
});

test("seofixkit: a signature made with another secret is rejected with 401", async () => {
  const { env } = freshEnv();
  const response = await post(env, BODY, { signature: `sha256=${await sign(Math.floor(Date.now() / 1000), JSON.stringify(BODY), "other-secret")}` });
  assert.equal(response.status, 401);
});

test("seofixkit: a timestamp older than five minutes is rejected with 401", async () => {
  const { env, sqlite } = freshEnv();
  const stale = Math.floor(Date.now() / 1000) - 601;
  const response = await post(env, BODY, { timestamp: stale });
  assert.equal(response.status, 401);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM appraisal_requests").get().n, 0);
});

test("seofixkit: a signed request returns 202 with an id and lands in the desk queue", async () => {
  const { env, sqlite } = freshEnv();
  const response = await post(env);
  assert.equal(response.status, 202);
  const { id } = await response.json();
  assert.match(id, /^[0-9a-f-]{36}$/);
  const row = sqlite.prepare("SELECT * FROM appraisal_requests WHERE id = ?").get(id);
  assert.equal(row.source, "seofixkit");
  assert.equal(row.report_id, BODY.reportId);
  assert.equal(row.consent_text, BODY.consentText);
  assert.equal(row.site_url, "https://clinic.example");
  assert.equal(row.email, BODY.email);
  assert.equal(row.month, "seofixkit");
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM appraisal_events WHERE request_id = ? AND type = 'request_accepted'").get(id).n, 1);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM appraisal_audit_jobs WHERE request_id = ? AND status = 'queued'").get(id).n, 1);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM engagements WHERE request_id = ? AND status = 'requested'").get(id).n, 1);

  const queue = await deskQueue(env);
  assert.equal(queue.length, 1);
  const page = await renderDeskQueuePage(queue, [], "https://reports.example/{id}");
  const html = await page.text();
  assert.match(html, /via SEO Fix Kit report/);
  assert.match(html, new RegExp(`href="https://reports.example/${BODY.reportId}"`));
});

test("seofixkit: the same reportId and email returns the first id and creates nothing new", async () => {
  const { env, sqlite } = freshEnv();
  const first = await post(env);
  const second = await post(env);
  assert.equal(first.status, 202);
  assert.equal(second.status, 202);
  assert.equal((await first.json()).id, (await second.json()).id);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM appraisal_requests").get().n, 1);
});

test("seofixkit: invalid input is rejected with 400 and nothing is stored", async () => {
  const { env, sqlite } = freshEnv();
  const response = await post(env, { site: "not a url", email: "nope", reportId: "", consentText: "" });
  assert.equal(response.status, 400);
  const body = await response.json();
  assert.equal(body.error, "invalid_request");
  assert.deepEqual(body.fields.sort(), ["consentText", "email", "reportId", "site"]);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM appraisal_requests").get().n, 0);
});

test("seofixkit: a request over the size limit is rejected with 413", async () => {
  const { env } = freshEnv();
  const response = await post(env, { ...BODY, consentText: "x".repeat(25000) });
  assert.equal(response.status, 413);
});

test("seofixkit: a rate-limited caller is rejected with 429", async () => {
  const { env } = freshEnv({ APPRAISAL_LIMITER: fakeLimiter(0) });
  const response = await post(env);
  assert.equal(response.status, 429);
});

test("seofixkit: without the shared secret the endpoint answers 503 and stores nothing", async () => {
  const { env, sqlite } = freshEnv({ SEOFIXKIT_REQUEST_SECRET: undefined });
  const response = await post(env);
  assert.equal(response.status, 503);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM appraisal_requests").get().n, 0);
});

test("seofixkit: a non-POST call is rejected with 405", async () => {
  const { env } = freshEnv();
  const response = worker.fetch(
    new Request("https://tinystudio.io/api/requests/from-seofixkit", { method: "GET" }),
    env
  );
  assert.equal((await response).status, 405);
});

test("seofixkit: the desk page renders without a report template", async () => {
  const { env } = freshEnv();
  await post(env);
  const queue = await deskQueue(env);
  const page = renderDeskQueuePage(queue, []);
  const html = await page.text();
  assert.match(html, /via SEO Fix Kit report/);
  assert.match(html, /href="https:\/\/app\.seofixkit\.com\/reports\/sfk-report-123"/);
});

test("seofixkit: the desk page shows a web request without a source badge", async () => {
  const { env, sqlite } = freshEnv();
  sqlite
    .prepare(
      "INSERT INTO appraisal_requests (id, site_url, business_type, avg_deal_value, monthly_leads, name, email, month, created_at) VALUES ('req-1','https://clinic.example','Dental clinic',8000,40,'Dana Reyes','dana@clinic.example','2026-11','2026-11-12T09:00:00.000Z')"
    )
    .run();
  sqlite
    .prepare(
      "INSERT INTO engagements (id, request_id, status, created_at, changed_at) VALUES ('eng-1','req-1','requested','2026-11-12T09:00:00.000Z','2026-11-12T09:00:00.000Z')"
    )
    .run();
  const queue = await deskQueue(env);
  assert.equal(queue[0].source, "web");
  const html = await (renderDeskQueuePage(queue, [])).text();
  assert.doesNotMatch(html, /via SEO Fix Kit/);
});
