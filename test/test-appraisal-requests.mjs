import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import worker from "../src/worker.js";

// A D1-shaped wrapper over node:sqlite, so the worker's exact SQL runs on the
// real migrations (every file in migrations/, in order).
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

function freshEnv(now = "2026-10-12T09:00:00.000Z") {
  const sqlite = new DatabaseSync(":memory:");
  for (const file of readdirSync(new URL("../migrations/", import.meta.url)).sort()) {
    sqlite.exec(readFileSync(new URL(`../migrations/${file}`, import.meta.url), "utf8"));
  }
  const sent = [];
  const env = {
    DB: d1(sqlite),
    APPRAISAL_NOW: now,
    EMAIL: { async send(message) { sent.push(message); } }
  };
  return { sqlite, env, sent };
}

function submit(env, overrides = {}, headers = {}) {
  const body = {
    website: "clinic.example",
    businessType: "Private dental clinic",
    dealValue: "8000",
    monthlyLeads: "40",
    name: "Dana Reyes",
    email: "dana@clinic.example",
    ...overrides
  };
  return worker.fetch(
    new Request("https://tinystudio.io/api/appraisal-requests", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "https://tinystudio.io", ...headers },
      body: JSON.stringify(body)
    }),
    env
  );
}

async function slots(env) {
  const res = await worker.fetch(new Request("https://tinystudio.io/api/appraisal-slots"), env);
  return res.json();
}

test("requests 1 to 6 are accepted and request 7 goes to the waitlist with the next slot date", async () => {
  const { sqlite, env } = freshEnv();
  assert.deepEqual(
    { taken: (await slots(env)).taken, full: (await slots(env)).full },
    { taken: 0, full: false }
  );

  for (let n = 1; n <= 6; n += 1) {
    const res = await submit(env, { website: `site${n}.example`, email: `owner${n}@site${n}.example` });
    const json = await res.json();
    assert.equal(res.status, 201);
    assert.equal(json.status, "accepted", `request ${n} must be accepted`);
    assert.equal((await slots(env)).taken, n, "the counter is computed from D1 rows");
  }

  const seventh = await submit(env, { website: "site7.example", email: "owner7@site7.example" });
  const json = await seventh.json();
  assert.equal(json.status, "waitlisted");
  assert.equal(json.nextSlotDate, "2026-11-01");

  const counter = await slots(env);
  assert.deepEqual(
    { taken: counter.taken, remaining: counter.remaining, full: counter.full, nextSlotDate: counter.nextSlotDate },
    { taken: 6, remaining: 0, full: true, nextSlotDate: "2026-11-01" }
  );
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM appraisal_requests").get().n, 6);
  const waitlist = sqlite.prepare("SELECT email, month, slot_date FROM appraisal_waitlist").all();
  assert.deepEqual(waitlist.map((row) => ({ ...row })), [
    { email: "owner7@site7.example", month: "2026-10", slot_date: "2026-11-01" }
  ]);
  console.log("D1 requests:", sqlite.prepare("SELECT id, site_url, email, month FROM appraisal_requests ORDER BY created_at, email").all().map((r) => ({ ...r })));
  console.log("D1 waitlist:", waitlist.map((row) => ({ ...row })));
});

test("a new month starts the counter again", async () => {
  const { sqlite, env } = freshEnv();
  for (let n = 1; n <= 6; n += 1) {
    await submit(env, { website: `site${n}.example`, email: `owner${n}@site${n}.example` });
  }
  env.APPRAISAL_NOW = "2026-11-01T00:00:00.000Z";
  assert.equal((await slots(env)).taken, 0);
  const res = await submit(env, { website: "site7.example", email: "owner7@site7.example" });
  assert.equal((await res.json()).status, "accepted");
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM appraisal_requests WHERE month = '2026-11'").get().n, 1);
});

test("exactly one confirmation email per request, none on a retry of the same submission", async () => {
  const { sqlite, env, sent } = freshEnv();
  const first = await submit(env);
  assert.equal((await first.json()).confirmation, "sent");
  const retry = await submit(env);
  const retryJson = await retry.json();
  assert.equal(retry.status, 200);
  assert.equal(retryJson.duplicate, true);
  assert.equal(retryJson.confirmation, "already_sent");
  assert.equal(sent.length, 1, "a retry must not send a second email");
  assert.equal(sent[0].to, "dana@clinic.example");
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM appraisal_requests").get().n, 1);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM appraisal_audit_jobs").get().n, 1, "one audit job, not two");
});

test("a failed send is recorded and the retry sends the one email", async () => {
  const { sqlite, env, sent } = freshEnv();
  env.EMAIL = { async send() { throw new Error("mail down"); } };
  const first = await (await submit(env)).json();
  assert.equal(first.confirmation, "failed");
  env.EMAIL = { async send(message) { sent.push(message); } };
  const retry = await (await submit(env)).json();
  assert.equal(retry.confirmation, "sent");
  assert.equal(sent.length, 1);
  const types = sqlite.prepare("SELECT type FROM appraisal_events ORDER BY id").all().map((row) => row.type);
  assert.deepEqual(types, ["request_accepted", "audit_queued", "confirmation_failed", "confirmation_sent"]);
});

test("a waitlisted request gets one waitlist confirmation that names the slot date", async () => {
  const { env, sent } = freshEnv();
  for (let n = 1; n <= 6; n += 1) {
    await submit(env, { website: `site${n}.example`, email: `owner${n}@site${n}.example` });
  }
  await submit(env, { website: "late.example", email: "late@late.example" });
  await submit(env, { website: "late.example", email: "late@late.example" });
  const toLate = sent.filter((message) => message.to === "late@late.example");
  assert.equal(toLate.length, 1);
  assert.match(toLate[0].text, /next open slot is 2026-11-01/);
});

test("a referred business skips the waitlist for the current month, once per code", async () => {
  const { sqlite, env } = freshEnv();
  sqlite.prepare("INSERT INTO appraisal_referrals (code, referrer, created_at) VALUES (?, ?, ?)")
    .run("REF-ONE", "closed-out client", "2026-09-30T00:00:00.000Z");
  for (let n = 1; n <= 6; n += 1) {
    await submit(env, { website: `site${n}.example`, email: `owner${n}@site${n}.example` });
  }
  const unreferred = await (await submit(env, { website: "a.example", email: "a@a.example" })).json();
  assert.equal(unreferred.status, "waitlisted");
  const wrongCode = await (await submit(env, { website: "b.example", email: "b@b.example", referral: "NOPE" })).json();
  assert.equal(wrongCode.status, "waitlisted");
  const referred = await (await submit(env, { website: "c.example", email: "c@c.example", referral: "REF-ONE" })).json();
  assert.equal(referred.status, "accepted");
  const reused = await (await submit(env, { website: "d.example", email: "d@d.example", referral: "REF-ONE" })).json();
  assert.equal(reused.status, "waitlisted", "a code works once");
  const events = sqlite.prepare("SELECT type, detail FROM appraisal_events WHERE type = 'referral_used'").all();
  assert.deepEqual(events.map((row) => ({ ...row })), [{ type: "referral_used", detail: "REF-ONE" }]);
});

test("every state change writes an event row", async () => {
  const { sqlite, env } = freshEnv();
  const { requestId } = await (await submit(env)).json();
  const events = sqlite.prepare("SELECT type FROM appraisal_events WHERE request_id = ? ORDER BY id").all(requestId);
  assert.deepEqual(events.map((row) => row.type), ["request_accepted", "audit_queued", "confirmation_sent"]);
  const job = sqlite.prepare("SELECT status FROM appraisal_audit_jobs WHERE request_id = ?").get(requestId);
  assert.equal(job.status, "queued");
});

test("invalid input is rejected before anything is stored or sent", async () => {
  const { sqlite, env, sent } = freshEnv();
  const res = await submit(env, { dealValue: "lots", email: "not-an-email", name: "" });
  const json = await res.json();
  assert.equal(res.status, 400);
  assert.deepEqual(json.fields, ["dealValue", "name", "email"]);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM appraisal_requests").get().n, 0);
  assert.equal(sent.length, 0);
});

test("a storage failure answers 503 and never claims success", async () => {
  const { env, sent } = freshEnv();
  env.DB = { prepare() { throw new Error("D1 unavailable"); } };
  const res = await submit(env);
  assert.equal(res.status, 503);
  assert.equal((await res.json()).error, "storage_unavailable");
  assert.equal(sent.length, 0);
});

test("a no-JS form post lands on the thank-you page, or the waitlist page when the month is full", async () => {
  const { env } = freshEnv();
  const form = (n) =>
    worker.fetch(
      new Request("https://tinystudio.io/api/appraisal-requests", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "text/html" },
        body: new URLSearchParams({
          website: `site${n}.example`, businessType: "Clinic", dealValue: "5000", monthlyLeads: "10",
          name: "Dana", email: `owner${n}@site${n}.example`
        }).toString()
      }),
      env
    );
  const ok = await form(1);
  assert.equal(ok.status, 303);
  assert.equal(new URL(ok.headers.get("Location")).pathname, "/brief-requested");
  for (let n = 2; n <= 6; n += 1) await form(n);
  const waitlisted = await form(7);
  assert.equal(waitlisted.status, 200);
  assert.match(await waitlisted.text(), /next open slot is 2026-11-01/);
});
