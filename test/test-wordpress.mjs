import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { recordsMock } from "./records-mock.js";
import worker from "../src/worker.js";
import { addDeskCorrectionLine, addDeskKickoffNote, addDeskTrackingNote, closeOutEngagement, reviewDeskCorrectionLine } from "../src/desk.js";
import { reviewCorrectionLine } from "../src/engagement.js";
import { publishRecord } from "../src/record.js";
import { handleDodoWebhook } from "../src/payments.js";
import { Webhook } from "standardwebhooks";
import offer from "../config/offer.json" with { type: "json" };
import {
  CONNECTOR_NOTE,
  WORDPRESS_CONNECT_APP_ID,
  applyApprovedLines,
  connectionForEngagement,
  decryptSecret,
  encryptSecret,
  normalizeSiteUrl,
  purgeEngagementKey,
  startConnect,
  storeCredentials,
  undoLineWrites
} from "../src/wordpress.js";

const WEBHOOK_SECRET = "whsec_" + Buffer.from("tinystudio-test-secret-key").toString("base64");
const SIGNER = new Webhook(Buffer.from("tinystudio-test-secret-key").toString("base64"));
const PRODUCT_ID = "prod_tinystudio_correction";
const ENC_KEY = "nKGWU0YTMUuot7uZWU5jX0OgNSH9pBG+/N5ZDhINOWo=";
const APP_PASSWORD = "abcd efgh ijkl mnop";
const STRIPPED_PASSWORD = "abcdefghijklmnop";
const MINTED_PASSWORD = "fedcba9876543210";
const ARRIVING_UUID = "aaaaaaaa-1111-4bbb-8ccc-000000000001";
const MINTED_UUID = "aaaaaaaa-2222-4bbb-8ccc-000000000002";
const AT = "2026-10-13T12:10:00.000Z";

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
    WORDPRESS_KEY_ENC_KEY: ENC_KEY,
    DB: d1(sqlite),
    EMAIL: { async send() {} },
    RECORDS: recordsMock(objects)
  };
  return { sqlite, env };
}

/** @param {{ connector?: boolean, failRead?: boolean, failWrite?: boolean, roles?: string[], failStep?: string }} [options] */
function wpServer({ connector = false, failRead = false, failWrite = false, roles = ["editor"], failStep = "" } = {}) {
  const page = {
    id: 7,
    type: "page",
    title: { raw: "Old Title" },
    content: { raw: "<p>Old copy</p>" },
    excerpt: { raw: "" },
    meta: {}
  };
  const state = {
    page,
    requests: [],
    passwords: [{ uuid: ARRIVING_UUID, password: STRIPPED_PASSWORD, deleted: false }]
  };
  const impl = async (input, init = {}) => {
    const url = String(input);
    const method = (init.method || "GET").toUpperCase();
    const auth = new Headers(init.headers || {}).get("Authorization") || "";
    state.requests.push({ url, method, auth, body: init.body || "" });
    const path = new URL(url).pathname;
    if (path === "/wp-json/tinystudio-connector/v1") {
      return new Response(connector ? '{"ok":true}' : "not found", { status: connector ? 200 : 404 });
    }
    if (path === "/wp-json/wp/v2/users/me") {
      if (failStep === "users_me") return new Response("refused", { status: 500 });
      return Response.json({ id: 2, name: "ts-editor", roles });
    }
    if (path === "/wp-json/wp/v2/users/me/application-passwords" && method === "POST") {
      if (failStep === "mint") return new Response("refused", { status: 500 });
      const body = JSON.parse(init.body || "{}");
      if (body.app_id !== WORDPRESS_CONNECT_APP_ID) return new Response("bad app_id", { status: 400 });
      if (!body.name) return new Response("no name", { status: 400 });
      state.passwords.push({ uuid: MINTED_UUID, password: MINTED_PASSWORD, deleted: false });
      return Response.json({ name: body.name, app_id: body.app_id, uuid: MINTED_UUID, password: MINTED_PASSWORD });
    }
    if (path === "/wp-json/wp/v2/users/me/application-passwords/introspect" && method === "GET") {
      if (failStep === "introspect") return new Response("refused", { status: 500 });
      const arriving = state.passwords.find((entry) => entry.password === STRIPPED_PASSWORD && !entry.deleted);
      return Response.json({ uuid: arriving ? arriving.uuid : MINTED_UUID });
    }
    const revokeMatch = path.match(/^\/wp-json\/wp\/v2\/users\/me\/application-passwords\/([^/]+)$/);
    if (revokeMatch && method === "DELETE") {
      if (failStep === "revoke") return new Response("refused", { status: 500 });
      const entry = state.passwords.find((candidate) => candidate.uuid === revokeMatch[1]);
      if (!entry) return new Response("not found", { status: 404 });
      entry.deleted = true;
      return Response.json({ deleted: true, uuid: entry.uuid });
    }
    if (!url.startsWith("https://client.example/wp-json/wp/v2/pages/7")) {
      return new Response("not found", { status: 404 });
    }
    if (method === "GET") {
      if (failRead) return new Response("read failed", { status: 500 });
      return Response.json(state.page);
    }
    if (failWrite) return new Response("write failed", { status: 500 });
    const payload = JSON.parse(init.body || "{}");
    if (payload.title !== undefined) state.page.title.raw = payload.title;
    if (payload.content !== undefined) state.page.content.raw = payload.content;
    if (payload.meta) state.page.meta = { ...state.page.meta, ...payload.meta };
    return Response.json(state.page);
  };
  return { impl, state };
}

async function paidEngagement(env, sqlite) {
  const { id: recordId } = await publishRecord(
    env,
    "req-1",
    { faults: [{ id: "f1", type: "slow-load", title: "Home page loads in 6.1 seconds" }], review: { summary: "The home page is slow on phones.", keep: ["f1"] } },
    "https://tinystudio.io",
    "2026-10-13T08:00:00.000Z"
  );
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
    "2026-10-13T09:30:00.000Z"
  );
  return engagement.id;
}

async function approvedLine(env, sqlite, afterText = "The hero image is 190 KB and loads first.") {
  const engagementId = await paidEngagement(env, sqlite);
  const { line } = await addDeskCorrectionLine(
    env,
    {
      engagementId,
      faultId: "f1",
      faultTitle: "Home page loads in 6.1 seconds",
      beforeText: "The hero image is 2.4 MB and loads last.",
      afterText
    },
    "Jev",
    "2026-10-13T11:00:00.000Z"
  );
  const approved = await reviewCorrectionLine(env, line, "approve", { reviewer: "Jev", at: "2026-10-13T11:30:00.000Z" });
  return { engagementId, line: approved };
}

async function connectedSite(env, sqlite, { connector = false, roles = ["editor"], failStep = "" } = {}) {
  const { engagementId, line } = await approvedLine(env, sqlite);
  const connect = await startConnect(env, engagementId, "https://client.example", "https://tinystudio.io", AT);
  const server = wpServer({ connector, roles, failStep });
  await storeCredentials(
    env,
    { engagementId, token: connect.token, siteUrl: connect.siteUrl, userLogin: "ts-editor", appPassword: APP_PASSWORD },
    AT,
    server.impl
  );
  return { engagementId, line, connect, server };
}

test("connect builds WordPress's own application-password approve screen", async () => {
  const { env, sqlite } = freshEnv();
  const engagementId = await paidEngagement(env, sqlite);
  const connect = await startConnect(env, engagementId, "https://client.example/", "https://tinystudio.io", AT);
  assert.ok(connect.authorizeUrl.startsWith("https://client.example/wp-admin/authorize-application.php"), "the approve screen is on the customer's WordPress");
  assert.ok(connect.authorizeUrl.includes("app_name=TinyStudio"), "WordPress names the app TinyStudio");
  assert.ok(connect.authorizeUrl.includes(`app_id=${encodeURIComponent(WORDPRESS_CONNECT_APP_ID)}`), "the authorize link carries the fixed app id");
  const success = new URL(decodeURIComponent(connect.authorizeUrl.split("success_url=")[1]));
  assert.equal(success.origin, "https://tinystudio.io");
  assert.equal(success.pathname, "/api/wordpress/callback");
  assert.equal(success.searchParams.get("engagementId"), engagementId);
  assert.ok(success.searchParams.get("token"), "the callback carries a one-time connect token");
  const reject = new URL(decodeURIComponent(connect.authorizeUrl.split("reject_url=")[1]));
  assert.equal(reject.pathname, "/api/wordpress/callback", "the authorize link carries a reject address");
  assert.equal(connect.manualFallback, true, "manual entry of an application password is the fallback");
  const row = await connectionForEngagement(env, engagementId);
  assert.equal(row.status, "connecting");
  assert.equal(row.site_url, "https://client.example");
});

test("normalizeSiteUrl refuses addresses that are not an https site", () => {
  assert.throws(() => normalizeSiteUrl("not a url"), /not a URL/);
  assert.throws(() => normalizeSiteUrl("http://client.example"), /must be https/, "plain http is refused");
  assert.throws(() => normalizeSiteUrl("ftp://client.example"), /must be https/);
  assert.throws(() => normalizeSiteUrl("https://user:pass@client.example"), /must not carry a login/);
  assert.equal(normalizeSiteUrl("https://Client.example/wp-admin/"), "https://client.example");
});

test("the arriving key is deleted on the site and only the fresh key is stored", async () => {
  const { env, sqlite } = freshEnv();
  const { engagementId, server } = await connectedSite(env, sqlite);
  const row = await connectionForEngagement(env, engagementId);
  assert.equal(row.status, "connected");
  assert.equal(row.wp_user_login, "ts-editor");
  assert.equal(row.password_uuid, MINTED_UUID, "the fresh key's uuid is stored");
  assert.equal(await decryptSecret(env, row.password_ciphertext, engagementId), MINTED_PASSWORD, "only the fresh key is stored");
  const urls = server.state.requests.map((request) => `${request.method} ${request.url}`);
  assert.ok(urls.includes(`GET https://client.example/wp-json/wp/v2/users/me?context=edit`), "the arriving key is proved against users/me");
  const mint = server.state.requests.find((request) => request.method === "POST" && request.url.endsWith("/users/me/application-passwords"));
  assert.equal(JSON.parse(mint.body).app_id, WORDPRESS_CONNECT_APP_ID, "the fresh key is minted with the app id");
  assert.equal(JSON.parse(mint.body).name, "TinyStudio");
  const revoke = server.state.requests.find((request) => request.method === "DELETE");
  assert.ok(revoke.url.endsWith(`/users/me/application-passwords/${ARRIVING_UUID}`), "the key that arrived in the address is deleted");
  assert.equal(server.state.passwords.find((entry) => entry.uuid === ARRIVING_UUID).deleted, true, "the arriving key is gone from the site");
  assert.equal(server.state.passwords.find((entry) => entry.uuid === MINTED_UUID).deleted, false, "the fresh key stays on the site");
  assert.ok(!server.state.requests.some((request) => request.method === "DELETE" && request.url.includes(MINTED_UUID)));
  assert.match(row.password_ciphertext, /^v1:/, "the stored key is a versioned ciphertext");
  assert.ok(!row.password_ciphertext.includes(STRIPPED_PASSWORD), "the ciphertext does not carry the arriving key");
  assert.ok(!row.password_ciphertext.includes(MINTED_PASSWORD), "the ciphertext does not carry the fresh key in the clear");
  const events = sqlite.prepare("SELECT type, detail FROM engagement_events WHERE engagement_id = ?").all(engagementId);
  for (const event of events) {
    assert.ok(!JSON.stringify(event).includes(STRIPPED_PASSWORD), "no journal event carries the arriving key");
    assert.ok(!JSON.stringify(event).includes(MINTED_PASSWORD), "no journal event carries the fresh key");
  }
});

test("a fresh key's ciphertext only opens with its own engagement id", async () => {
  const { env } = freshEnv();
  const stored = await encryptSecret(env, "secret", "engagement-a");
  assert.equal(await decryptSecret(env, stored, "engagement-a"), "secret");
  await assert.rejects(() => decryptSecret(env, stored, "engagement-b"), /does not belong/);
});

test("an administrator is refused and nothing is stored", async () => {
  const { env, sqlite } = freshEnv();
  const engagementId = await paidEngagement(env, sqlite);
  const connect = await startConnect(env, engagementId, "https://client.example", "https://tinystudio.io", AT);
  const server = wpServer({ roles: ["administrator"] });
  await assert.rejects(
    () =>
      storeCredentials(
        env,
        { engagementId, token: connect.token, siteUrl: connect.siteUrl, userLogin: "ts-editor", appPassword: APP_PASSWORD },
        AT,
        server.impl
      ),
    /Editor role/,
    "the refusal repeats the separate-Editor-user instruction"
  );
  const row = await connectionForEngagement(env, engagementId);
  assert.equal(row.status, "connecting");
  assert.equal(row.password_ciphertext, null);
  assert.equal(row.password_uuid, null);
  assert.ok(!server.state.requests.some((request) => request.method === "POST"), "no fresh key was minted");
});

test("a failed swap step names the step and stores nothing", async () => {
  for (const failStep of ["users_me", "mint", "introspect", "revoke"]) {
    const { env, sqlite } = freshEnv();
    const engagementId = await paidEngagement(env, sqlite);
    const connect = await startConnect(env, engagementId, "https://client.example", "https://tinystudio.io", AT);
    const server = wpServer({ failStep });
    await assert.rejects(
      () =>
        storeCredentials(
          env,
          { engagementId, token: connect.token, siteUrl: connect.siteUrl, userLogin: "ts-editor", appPassword: APP_PASSWORD },
          AT,
          server.impl
        ),
      new RegExp(failStep),
      `the failure at ${failStep} names the step`
    );
    const row = await connectionForEngagement(env, engagementId);
    assert.equal(row.status, "connecting", `nothing is stored after ${failStep} fails`);
    assert.equal(row.password_ciphertext, null);
    assert.equal(row.password_uuid, null);
  }
});

test("the callback route swaps the approve-screen key and answers with a one-time redirect", async () => {
  const { env, sqlite } = freshEnv();
  const engagementId = await paidEngagement(env, sqlite);
  const connect = await startConnect(env, engagementId, "https://client.example", "https://tinystudio.io", AT);
  const server = wpServer();
  const globalFetch = globalThis.fetch;
  globalThis.fetch = server.impl;
  try {
    const callback = new URL("https://tinystudio.io/api/wordpress/callback");
    callback.searchParams.set("engagementId", engagementId);
    callback.searchParams.set("token", connect.token);
    callback.searchParams.set("site_url", "https://client.example");
    callback.searchParams.set("user_login", "ts-editor");
    callback.searchParams.set("password", APP_PASSWORD);
    const response = await worker.fetch(new Request(callback), env);
    assert.equal(response.status, 303, "the callback answers with a redirect");
    const location = new URL(response.headers.get("Location"));
    assert.equal(location.origin, "https://tinystudio.io");
    assert.equal(location.search, "", "the redirect address carries no query");
    assert.equal(response.headers.get("Referrer-Policy"), "no-referrer");
    const row = await connectionForEngagement(env, engagementId);
    assert.equal(row.status, "connected");
    assert.equal(row.connect_token, "", "the connect token is cleared once used");
    assert.equal(await decryptSecret(env, row.password_ciphertext, engagementId), MINTED_PASSWORD);
    const replay = await worker.fetch(new Request(callback), env);
    assert.equal(replay.status, 400, "the callback works once");
    const rotated = await startConnect(env, engagementId, "https://client.example", "https://tinystudio.io", AT);
    assert.notEqual(rotated.token, connect.token, "a new connect rotates the token");
    const replayOld = await worker.fetch(new Request(callback), env);
    assert.equal(replayOld.status, 400, "the old callback cannot be replayed once the token rotated");
  } finally {
    globalThis.fetch = globalFetch;
  }
});

test("the declined callback stores nothing and keeps the token for another try", async () => {
  const { env, sqlite } = freshEnv();
  const engagementId = await paidEngagement(env, sqlite);
  const connect = await startConnect(env, engagementId, "https://client.example", "https://tinystudio.io", AT);
  const response = await worker.fetch(
    new Request(`https://tinystudio.io/api/wordpress/callback?engagementId=${engagementId}&token=${connect.token}&error=declined`),
    env
  );
  assert.equal(response.status, 200);
  assert.ok((await response.text()).includes("Not connected"));
  const row = await connectionForEngagement(env, engagementId);
  assert.equal(row.status, "connecting");
  assert.equal(row.password_ciphertext, null);
});

test("the connect token works once", async () => {
  const { env, sqlite } = freshEnv();
  const engagementId = await paidEngagement(env, sqlite);
  const connect = await startConnect(env, engagementId, "https://client.example", "https://tinystudio.io", AT);
  const server = wpServer();
  const input = { engagementId, token: connect.token, siteUrl: connect.siteUrl, userLogin: "ts-editor", appPassword: APP_PASSWORD };
  await storeCredentials(env, input, AT, server.impl);
  await assert.rejects(
    () => storeCredentials(env, input, AT, server.impl),
    /token does not match|not waiting for a key/,
    "the cleared token and the connected status both fail the replay"
  );
  const again = await startConnect(env, engagementId, "https://client.example", "https://tinystudio.io", AT);
  await storeCredentials(
    env,
    { engagementId, token: again.token, siteUrl: again.siteUrl, userLogin: "ts-editor", appPassword: APP_PASSWORD },
    AT,
    server.impl
  );
  const row = await connectionForEngagement(env, engagementId);
  assert.equal(row.status, "connected", "a fresh connect arms a fresh token");
});

test("storeCredentials refuses token and site mismatches", async () => {
  const { env, sqlite } = freshEnv();
  const engagementId = await paidEngagement(env, sqlite);
  const connect = await startConnect(env, engagementId, "https://client.example", "https://tinystudio.io", AT);
  await assert.rejects(
    () => storeCredentials(env, { engagementId, token: "wrong", siteUrl: connect.siteUrl, userLogin: "ts-editor", appPassword: APP_PASSWORD }, AT),
    /token does not match/
  );
  await assert.rejects(
    () => storeCredentials(env, { engagementId, token: connect.token, siteUrl: "https://other.example", userLogin: "ts-editor", appPassword: APP_PASSWORD }, AT),
    /does not match the connect request/
  );
});

test("apply writes the approved line through the core REST API and saves the old value first", async () => {
  const { env, sqlite } = freshEnv();
  const { engagementId, line, server } = await connectedSite(env, sqlite);
  const result = await applyApprovedLines(
    env,
    engagementId,
    [{ lineId: line.id, postType: "page", postId: 7, field: "content" }],
    { fetchImpl: server.impl, connector: false },
    AT
  );
  assert.equal(result.applied, 1);
  assert.equal(result.ownerSteps, 0);
  assert.equal(server.state.page.content.raw, "The hero image is 190 KB and loads first.", "the approved after text is live on the site");
  const expectedAuth = `Basic ${Buffer.from(`ts-editor:${MINTED_PASSWORD}`).toString("base64")}`;
  const pageRead = server.state.requests.find((request) => request.url.includes("/wp-json/wp/v2/pages/7?context=edit"));
  assert.equal(pageRead.auth, expectedAuth, "the stored fresh key travels as Basic application-password auth");
  const writeIndex = server.state.requests.findIndex((request) => request.method === "POST" && request.url.includes("/wp-json/wp/v2/pages/7"));
  const readIndex = server.state.requests.findIndex((request) => request.method === "GET" && request.url.endsWith("/wp-json/wp/v2/pages/7?context=edit"));
  assert.ok(readIndex > -1 && readIndex < writeIndex, "the old value is read with context=edit before the write");
  /** @type {{ old_value: string, had_old: number, status: string, charged: number } | undefined} */
  const write = sqlite.prepare("SELECT old_value, had_old, status, charged FROM wordpress_line_writes WHERE engagement_id = ?").get(engagementId);
  assert.equal(write.old_value, "<p>Old copy</p>");
  assert.equal(write.had_old, 1);
  assert.equal(write.status, "applied");
  assert.equal(write.charged, 1);
  const stored = sqlite.prepare("SELECT status FROM correction_lines WHERE id = ?").get(line.id);
  assert.equal(stored.status, "recorded", "the applied line is recorded");
});

test("apply never writes a line the desk has not approved", async () => {
  const { env, sqlite } = freshEnv();
  const engagementId = await paidEngagement(env, sqlite);
  const { line: draft } = await addDeskCorrectionLine(
    env,
    { engagementId, faultId: "f2", faultTitle: "Draft fix", beforeText: "b", afterText: "DRAFT-ONLY-TEXT" },
    "Jev",
    AT
  );
  const connect = await startConnect(env, engagementId, "https://client.example", "https://tinystudio.io", AT);
  const server = wpServer({ connector: true });
  await storeCredentials(env, { engagementId, token: connect.token, siteUrl: connect.siteUrl, userLogin: "ts-editor", appPassword: APP_PASSWORD }, AT, server.impl);
  const result = await applyApprovedLines(
    env,
    engagementId,
    [{ lineId: draft.id, postType: "page", postId: 7, field: "content" }],
    { fetchImpl: server.impl },
    AT
  );
  assert.equal(result.results[0].status, "skipped");
  assert.equal(result.applied, 0);
  assert.ok(!server.state.requests.some((request) => request.body.includes("DRAFT-ONLY-TEXT")), "no unapproved text reaches the site");
});

test("Rank Math and All in One SEO meta write through the core REST API", async () => {
  const { env, sqlite } = freshEnv();
  const { engagementId, line, server } = await connectedSite(env, sqlite);
  const result = await applyApprovedLines(
    env,
    engagementId,
    [
      { lineId: line.id, postType: "page", postId: 7, field: "meta:rank_math_title" },
      { lineId: line.id, postType: "page", postId: 7, field: "meta:aioseo_title" }
    ],
    { fetchImpl: server.impl },
    AT
  );
  assert.equal(result.applied, 2);
  assert.equal(server.state.page.meta.rank_math_title, "The hero image is 190 KB and loads first.");
  assert.equal(server.state.page.meta.aioseo_title, "The hero image is 190 KB and loads first.");
});

test("Yoast fields become owner steps without the connector and write with it", async () => {
  const first = freshEnv();
  const without = await connectedSite(first.env, first.sqlite);
  const result = await applyApprovedLines(
    first.env,
    without.engagementId,
    [{ lineId: without.line.id, postType: "page", postId: 7, field: "meta:_yoast_wpseo_title" }],
    { fetchImpl: without.server.impl },
    AT
  );
  assert.equal(result.results[0].status, "owner_step");
  assert.equal(result.results[0].pluginNeeded, "TinyStudio Connector");
  /** @type {{ status: string, charged: number, detail: string } | undefined} */
  const write = first.sqlite.prepare("SELECT status, charged, detail FROM wordpress_line_writes WHERE engagement_id = ?").get(without.engagementId);
  assert.equal(write.status, "owner_step");
  assert.equal(write.charged, 0, "an unwritable field is not charged");
  assert.ok(write.detail.includes("TinyStudio Connector"));

  const second = freshEnv();
  const withConnector = await connectedSite(second.env, second.sqlite, { connector: true });
  const applied = await applyApprovedLines(
    second.env,
    withConnector.engagementId,
    [{ lineId: withConnector.line.id, postType: "page", postId: 7, field: "meta:_yoast_wpseo_title" }],
    { fetchImpl: withConnector.server.impl },
    AT
  );
  assert.equal(applied.applied, 1);
  assert.equal(withConnector.server.state.page.meta._yoast_wpseo_title, "The hero image is 190 KB and loads first.");
});

test("a failed write is an owner step, not a charge, and the line stays approved", async () => {
  const { env, sqlite } = freshEnv();
  const { engagementId, line, server } = await connectedSite(env, sqlite);
  const failing = wpServer({ failWrite: true });
  const healthyRequestsBefore = server.state.requests.length;
  const result = await applyApprovedLines(
    env,
    engagementId,
    [{ lineId: line.id, postType: "page", postId: 7, field: "title" }],
    { fetchImpl: failing.impl },
    AT
  );
  assert.equal(result.ownerSteps, 1);
  /** @type {{ status: string, charged: number, detail: string, old_value: string } | undefined} */
  const write = sqlite.prepare("SELECT status, charged, detail, old_value FROM wordpress_line_writes WHERE engagement_id = ?").get(engagementId);
  assert.equal(write.status, "owner_step");
  assert.equal(write.charged, 0);
  assert.equal(write.detail, "wordpress_write_failed_500");
  assert.equal(write.old_value, "Old Title", "the old value is saved even when the write fails");
  const stored = sqlite.prepare("SELECT status FROM correction_lines WHERE id = ?").get(line.id);
  assert.equal(stored.status, "approved", "the line waits, it is not recorded");
  assert.equal(server.state.requests.length, healthyRequestsBefore, "the healthy site was not touched by the failing run");
});

test("undo restores the saved old value for the line", async () => {
  const { env, sqlite } = freshEnv();
  const { engagementId, line, server } = await connectedSite(env, sqlite);
  await applyApprovedLines(env, engagementId, [{ lineId: line.id, postType: "page", postId: 7, field: "content" }], { fetchImpl: server.impl }, AT);
  assert.equal(server.state.page.content.raw, "The hero image is 190 KB and loads first.");
  const undone = await undoLineWrites(env, engagementId, line.id, { fetchImpl: server.impl, connector: false }, AT);
  assert.deepEqual(undone.undone, [{ field: "content", status: "undone" }]);
  assert.equal(server.state.page.content.raw, "<p>Old copy</p>", "the old value is back on the site");
  /** @type {{ status: string } | undefined} */
  const write = sqlite.prepare("SELECT status FROM wordpress_line_writes WHERE engagement_id = ?").get(engagementId);
  assert.equal(write.status, "undone");
  const again = await undoLineWrites(env, engagementId, line.id, { fetchImpl: server.impl }, AT);
  assert.equal(again.undone.length, 0, "a second undo has nothing left to restore");
});

test("unknown fields are refused before any write", async () => {
  const { env, sqlite } = freshEnv();
  const { engagementId, line, server } = await connectedSite(env, sqlite);
  const requestsBefore = server.state.requests.length;
  const result = await applyApprovedLines(
    env,
    engagementId,
    [{ lineId: line.id, postType: "page", postId: 7, field: "meta:not_a_known_field" }],
    { fetchImpl: server.impl, connector: false },
    AT
  );
  assert.equal(result.results[0].status, "invalid");
  assert.equal(server.state.requests.length, requestsBefore, "the site is not touched for an unknown field");
});

test("apply and undo refuse an engagement with no connected site", async () => {
  const { env, sqlite } = freshEnv();
  const { engagementId, line } = await approvedLine(env, sqlite);
  await assert.rejects(() => applyApprovedLines(env, engagementId, [{ lineId: line.id, postType: "page", postId: 7, field: "content" }]), /no connected WordPress site/);
  await assert.rejects(() => undoLineWrites(env, engagementId, line.id), /no connected WordPress site/);
});

test("closing the engagement revokes the stored key at the site and wipes our copy", async () => {
  const { env, sqlite } = freshEnv();
  const { engagementId, line, server } = await connectedSite(env, sqlite);
  await applyApprovedLines(env, engagementId, [{ lineId: line.id, postType: "page", postId: 7, field: "content" }], { fetchImpl: server.impl, connector: false }, AT);
  await reviewDeskCorrectionLine(env, { lineId: line.id, action: "approve" }, "reviewer@tinystudio.io", "2026-10-14T08:00:00.000Z");
  await addDeskKickoffNote(env, { engagementId, note: "Brand words stay as written." }, "reviewer@tinystudio.io", "2026-11-01T08:00:00.000Z");
  await addDeskTrackingNote(env, { engagementId, day: "7", note: "Speed holds and the pages are indexed." }, "reviewer@tinystudio.io", "2026-11-08T08:00:00.000Z");
  await addDeskTrackingNote(env, { engagementId, day: "14", note: "Four form submissions from search in the second week." }, "reviewer@tinystudio.io", "2026-11-15T08:00:00.000Z");
  const globalFetch = globalThis.fetch;
  globalThis.fetch = server.impl;
  try {
    await closeOutEngagement(env, { engagementId }, "reviewer@tinystudio.io", "2026-11-15T09:00:00.000Z");
  } finally {
    globalThis.fetch = globalFetch;
  }
  const row = await connectionForEngagement(env, engagementId);
  assert.equal(row.status, "removed");
  assert.equal(row.password_ciphertext, null, "the ciphertext is gone");
  assert.equal(row.password_uuid, null);
  assert.equal(row.wp_user_login, null);
  assert.equal(row.connect_token, "");
  const revoke = server.state.requests.find(
    (request) => request.method === "DELETE" && request.url.endsWith(`/users/me/application-passwords/${MINTED_UUID}`)
  );
  assert.ok(revoke, "the stored key is revoked on the site before the wipe");
  assert.equal(server.state.passwords.find((entry) => entry.uuid === MINTED_UUID).deleted, true);
  /** @type {{ detail: string } | undefined} */
  const event = sqlite.prepare("SELECT detail FROM engagement_events WHERE type = 'wordpress_key_deleted'").get();
  assert.ok(event, "the purge is journalled");
  assert.ok(event.detail.includes("revoked on https://client.example"), "the journal says the key was revoked at the site");
});

test("when the revoke at the site fails our copy is still wiped and an owner step is recorded", async () => {
  const { env, sqlite } = freshEnv();
  const { engagementId } = await connectedSite(env, sqlite);
  const failing = wpServer({ failStep: "revoke" });
  await purgeEngagementKey(env, engagementId, AT, failing.impl);
  const row = await connectionForEngagement(env, engagementId);
  assert.equal(row.status, "removed", "the wipe happens even when the revoke fails");
  assert.equal(row.password_ciphertext, null);
  assert.equal(row.password_uuid, null);
  const events = sqlite.prepare("SELECT type, detail FROM engagement_events WHERE engagement_id = ?").all(engagementId);
  const step = events.find((event) => event.type === "wordpress_owner_step");
  assert.ok(step, "the owner step is journalled");
  assert.ok(step.detail.includes("Users, Profile, Application Passwords"), "the owner step tells the customer where to revoke");
  const deleted = events.find((event) => event.type === "wordpress_key_deleted");
  assert.ok(deleted, "the wipe is still journalled");
  assert.ok(deleted.detail.includes("could not be confirmed"));
});

test("the connector note tells the customer when the plugin is needed", () => {
  assert.ok(CONNECTOR_NOTE.includes("Rank Math"));
  assert.ok(CONNECTOR_NOTE.includes("All in One SEO"));
  assert.ok(CONNECTOR_NOTE.includes("Yoast"));
  assert.ok(CONNECTOR_NOTE.includes("TinyStudio Connector"));
  assert.ok(CONNECTOR_NOTE.includes("not charged"));
});

test("the WordPress routes gate on the desk and answer unknown paths", async () => {
  const { env } = freshEnv();
  const gated = await worker.fetch(new Request("https://tinystudio.io/api/wordpress/connect?engagementId=x&siteUrl=https://client.example"), env);
  assert.equal(gated.status, 503, "connect waits for desk configuration");
  const apply = await worker.fetch(
    new Request("https://tinystudio.io/api/wordpress/apply", { method: "POST", headers: { Origin: "https://tinystudio.io" }, body: "{}" }),
    env
  );
  assert.equal(apply.status, 503);
  const configured = { ...env, CF_ACCESS_TEAM_DOMAIN: "team.example", CF_ACCESS_AUD: "aud-123" };
  const unauthorized = await worker.fetch(new Request("https://tinystudio.io/api/wordpress/connect?engagementId=x"), configured);
  assert.equal(unauthorized.status, 401, "connect needs Cloudflare Access");
  const unknown = await worker.fetch(new Request("https://tinystudio.io/api/wordpress/nope"), env);
  assert.equal(unknown.status, 404);
  const crossSite = await worker.fetch(
    new Request("https://tinystudio.io/api/wordpress/callback", {
      method: "POST",
      headers: { Origin: "https://evil.example" },
      body: "engagementId=x"
    }),
    env
  );
  assert.equal(crossSite.status, 403, "the manual fallback refuses cross-site posts");
});

test("the key secret must be base64 of 32 random bytes and is required before anything is encrypted", async () => {
  const { env } = freshEnv();
  const noSecret = { ...env, WORDPRESS_KEY_ENC_KEY: "" };
  await assert.rejects(() => encryptSecret(noSecret, "x", "engagement-a"), /key-encryption Worker secret/);
  await assert.rejects(() => encryptSecret({ ...env, WORDPRESS_KEY_ENC_KEY: "short" }, "x", "engagement-a"), /32 random bytes/);
  await assert.rejects(() => encryptSecret({ ...env, WORDPRESS_KEY_ENC_KEY: Buffer.alloc(31).toString("base64") }, "x", "engagement-a"), /32 random bytes/);
  await assert.rejects(() => encryptSecret({ ...env, WORDPRESS_KEY_ENC_KEY: Buffer.alloc(64).toString("base64") }, "x", "engagement-a"), /32 random bytes/);
});
