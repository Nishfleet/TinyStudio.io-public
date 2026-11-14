import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import worker from "../src/worker.js";

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

function freshEnv() {
  const sqlite = new DatabaseSync(":memory:");
  for (const file of readdirSync(new URL("../migrations/", import.meta.url)).sort()) {
    sqlite.exec(readFileSync(new URL(`../migrations/${file}`, import.meta.url), "utf8"));
  }
  const sent = [];
  const env = {
    DB: d1(sqlite),
    EMAIL: { async send(message) { sent.push(message); } },
    APPRAISAL_LIMITER: fakeLimiter(5)
  };
  return { sqlite, env, sent };
}

let nextIp = 0;
function request(env, body, headers = {}) {
  nextIp += 1;
  return worker.fetch(
    new Request("https://tinystudio.io/api/deletion-request", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "https://tinystudio.io",
        "CF-Connecting-IP": `192.0.2.${nextIp % 250}`,
        ...headers
      },
      body: JSON.stringify(body)
    }),
    env
  );
}

test("a valid request stores the row and sends one email to the team inbox", async () => {
  const { sqlite, env, sent } = freshEnv();
  const res = await request(env, { email: "Dana@Clinic.Example" });
  assert.equal(res.status, 202);
  assert.deepEqual(await res.json(), { ok: true, email: "sent" });

  const rows = sqlite.prepare("SELECT email, created_at, handled_at FROM deletion_requests").all();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].email, "dana@clinic.example");
  assert.match(rows[0].created_at, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(rows[0].handled_at, null);

  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, "hello@tinystudio.io");
  assert.match(sent[0].text, /dana@clinic\.example/);
});

test("an invalid email answers 400 and stores and sends nothing", async () => {
  const { sqlite, env, sent } = freshEnv();
  const res = await request(env, { email: "not-an-email" });
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error, "invalid_email");
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM deletion_requests").get().n, 0);
  assert.equal(sent.length, 0);
});

test("the existing rate limit cuts off a burst from one address", async () => {
  const { sqlite, env, sent } = freshEnv();
  const statuses = [];
  for (let n = 1; n <= 7; n += 1) {
    const res = await request(env, { email: `v${n}@clinic.example` }, { "CF-Connecting-IP": "203.0.113.9" });
    statuses.push(res.status);
  }
  assert.deepEqual(statuses, [202, 202, 202, 202, 202, 429, 429]);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM deletion_requests").get().n, 5);
  assert.equal(sent.length, 5);
});

test("a cross-site post is refused and stores nothing", async () => {
  const { sqlite, env, sent } = freshEnv();
  const res = await request(env, { email: "dana@clinic.example" }, { Origin: "https://evil.example" });
  assert.equal(res.status, 403);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM deletion_requests").get().n, 0);
  assert.equal(sent.length, 0);
});

test("a no-JS form post lands on the confirmation page", async () => {
  const { sqlite, env, sent } = freshEnv();
  const res = await worker.fetch(
    new Request("https://tinystudio.io/api/deletion-request", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "text/html", Referer: "https://tinystudio.io/contact" },
      body: new URLSearchParams({ email: "dana@clinic.example" }).toString()
    }),
    env
  );
  assert.equal(res.status, 200);
  const text = await res.text();
  assert.match(text, /deletion request is recorded/);
  assert.match(text, /the desk has it by email/);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM deletion_requests").get().n, 1);
  assert.equal(sent.length, 1);
});

test("a no-JS form post with a failed send says only that the request is recorded", async () => {
  const { sqlite, env } = freshEnv();
  env.EMAIL = { async send() { throw new Error("mail down"); } };
  const res = await worker.fetch(
    new Request("https://tinystudio.io/api/deletion-request", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "text/html", Referer: "https://tinystudio.io/contact" },
      body: new URLSearchParams({ email: "dana@clinic.example" }).toString()
    }),
    env
  );
  assert.equal(res.status, 200);
  const text = await res.text();
  assert.match(text, /deletion request is recorded/);
  assert.match(text, /your request is recorded/);
  assert.doesNotMatch(text, /the desk has it by email/);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM deletion_requests").get().n, 1);
});

test("a failed send still keeps the request and never claims the email went out", async () => {
  const { sqlite, env } = freshEnv();
  env.EMAIL = { async send() { throw new Error("mail down"); } };
  const res = await request(env, { email: "dana@clinic.example" });
  assert.equal(res.status, 202);
  assert.deepEqual(await res.json(), { ok: true, email: "failed" });
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM deletion_requests").get().n, 1);
});
