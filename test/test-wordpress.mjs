import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { recordsMock } from "./records-mock.js";
import worker from "../src/worker.js";
import { addDeskCorrectionLine } from "../src/desk.js";
import { reviewCorrectionLine } from "../src/engagement.js";
import { publishRecord } from "../src/record.js";
import { handleDodoWebhook } from "../src/payments.js";
import { Webhook } from "standardwebhooks";
import offer from "../config/offer.json" with { type: "json" };
import {
  CONNECTOR_NOTE,
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
const APP_PASSWORD = "abcd efgh ijkl mnop";
const STRIPPED_PASSWORD = "abcdefghijklmnop";
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
    WORDPRESS_KEY_ENC_KEY: "test-key-material-for-aes-gcm",
    DB: d1(sqlite),
    EMAIL: { async send() {} },
    RECORDS: recordsMock(objects)
  };
  return { sqlite, env };
}

function wpServer({ connector = false, failRead = false, failWrite = false } = {}) {
  const page = {
    id: 7,
    type: "page",
    title: { rendered: "Old Title" },
    content: { rendered: "<p>Old copy</p>" },
    excerpt: { rendered: "" },
    meta: {}
  };
  const state = { page, requests: [] };
  const impl = async (input, init = {}) => {
    const url = String(input);
    const auth = new Headers(init.headers || {}).get("Authorization") || "";
    state.requests.push({ url, method: init.method || "GET", auth, body: init.body || "" });
    if (url.endsWith("/wp-json/tinystudio-connector/v1")) {
      return new Response(connector ? '{"ok":true}' : "not found", { status: connector ? 200 : 404 });
    }
    if (!url.startsWith("https://client.example/wp-json/wp/v2/pages/7")) {
      return new Response("not found", { status: 404 });
    }
    if ((init.method || "GET") === "GET") {
      if (failRead) return new Response("read failed", { status: 500 });
      return Response.json(state.page);
    }
    if (failWrite) return new Response("write failed", { status: 500 });
    const payload = JSON.parse(init.body || "{}");
    if (payload.title !== undefined) state.page.title.rendered = payload.title;
    if (payload.content !== undefined) state.page.content.rendered = payload.content;
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

async function connectedSite(env, sqlite, { connector = false } = {}) {
  const { engagementId, line } = await approvedLine(env, sqlite);
  const connect = await startConnect(env, engagementId, "https://client.example", "https://tinystudio.io", AT);
  await storeCredentials(
    env,
    { engagementId, token: connect.token, siteUrl: connect.siteUrl, userLogin: "ts-editor", appPassword: APP_PASSWORD },
    AT
  );
  const server = wpServer({ connector });
  return { engagementId, line, connect, server };
}

test("connect builds WordPress's own application-password approve screen", async () => {
  const { env, sqlite } = freshEnv();
  const engagementId = await paidEngagement(env, sqlite);
  const connect = await startConnect(env, engagementId, "https://client.example/", "https://tinystudio.io", AT);
  assert.ok(connect.authorizeUrl.startsWith("https://client.example/wp-admin/authorize-application.php"), "the approve screen is on the customer's WordPress");
  assert.ok(connect.authorizeUrl.includes("app_name=TinyStudio"), "WordPress names the app TinyStudio");
  const success = new URL(decodeURIComponent(connect.authorizeUrl.split("success_url=")[1]));
  assert.equal(success.origin, "https://tinystudio.io");
  assert.equal(success.pathname, "/api/wordpress/callback");
  assert.equal(success.searchParams.get("engagementId"), engagementId);
  assert.ok(success.searchParams.get("token"), "the callback carries a one-time connect token");
  assert.equal(connect.manualFallback, true, "manual entry of an application password is the fallback");
  const row = await connectionForEngagement(env, engagementId);
  assert.equal(row.status, "connecting");
  assert.equal(row.site_url, "https://client.example");
});

test("normalizeSiteUrl rejects addresses that are not a plain site", () => {
  assert.throws(() => normalizeSiteUrl("not a url"), /not a URL/);
  assert.throws(() => normalizeSiteUrl("ftp://client.example"), /http or https/);
  assert.throws(() => normalizeSiteUrl("https://user:pass@client.example"), /must not carry a login/);
  assert.equal(normalizeSiteUrl("https://Client.example/wp-admin/"), "https://client.example");
});

test("the key is stored encrypted and never appears in the clear", async () => {
  const { env, sqlite } = freshEnv();
  const { engagementId } = await connectedSite(env, sqlite);
  const row = await connectionForEngagement(env, engagementId);
  assert.equal(row.status, "connected");
  assert.equal(row.wp_user_login, "ts-editor");
  assert.match(row.password_ciphertext, /^v1:/, "the stored key is a versioned ciphertext");
  assert.ok(!row.password_ciphertext.includes(STRIPPED_PASSWORD), "the ciphertext does not carry the key");
  assert.equal(await decryptSecret(env, row.password_ciphertext), STRIPPED_PASSWORD, "the applier can read the key back");
  const events = sqlite.prepare("SELECT type, detail FROM engagement_events WHERE engagement_id = ?").all(engagementId);
  for (const event of events) {
    assert.ok(!JSON.stringify(event).includes(STRIPPED_PASSWORD), "no journal event carries the key");
  }
});

test("the callback route stores the key the WordPress approve screen sends back", async () => {
  const { env, sqlite } = freshEnv();
  const engagementId = await paidEngagement(env, sqlite);
  const connect = await startConnect(env, engagementId, "https://client.example", "https://tinystudio.io", AT);
  const callback = new URL("https://tinystudio.io/api/wordpress/callback");
  callback.searchParams.set("engagementId", engagementId);
  callback.searchParams.set("token", connect.token);
  callback.searchParams.set("site_url", "https://client.example");
  callback.searchParams.set("user_login", "ts-editor");
  callback.searchParams.set("password", APP_PASSWORD);
  const response = await worker.fetch(new Request(callback), env);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.equal(body.status, "connected");
  const row = await connectionForEngagement(env, engagementId);
  assert.equal(row.status, "connected");
  assert.equal(await decryptSecret(env, row.password_ciphertext), STRIPPED_PASSWORD);
  const rotated = await startConnect(env, engagementId, "https://client.example", "https://tinystudio.io", AT);
  assert.notEqual(rotated.token, connect.token, "a new connect rotates the token");
  const replay = await worker.fetch(new Request(callback), env);
  assert.equal(replay.status, 400, "the old callback cannot be replayed once the token rotated");
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
  assert.equal(server.state.page.content.rendered, "The hero image is 190 KB and loads first.", "the approved after text is live on the site");
  const expectedAuth = `Basic ${Buffer.from(`ts-editor:${STRIPPED_PASSWORD}`).toString("base64")}`;
  assert.equal(server.state.requests[0].auth, expectedAuth, "the key travels as Basic application-password auth");
  const writeIndex = server.state.requests.findIndex((r) => r.method === "POST");
  const readIndex = server.state.requests.findIndex((r) => r.method === "GET" && r.url.endsWith("/wp-json/wp/v2/pages/7"));
  assert.ok(readIndex > -1 && readIndex < writeIndex, "the old value is read before the write");
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
  await storeCredentials(env, { engagementId, token: connect.token, siteUrl: connect.siteUrl, userLogin: "ts-editor", appPassword: APP_PASSWORD }, AT);
  const server = wpServer({ connector: true });
  const result = await applyApprovedLines(
    env,
    engagementId,
    [{ lineId: draft.id, postType: "page", postId: 7, field: "content" }],
    { fetchImpl: server.impl },
    AT
  );
  assert.equal(result.results[0].status, "skipped");
  assert.equal(result.applied, 0);
  assert.ok(!server.state.requests.some((r) => r.body.includes("DRAFT-ONLY-TEXT")), "no unapproved text reaches the site");
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
  const { env, sqlite } = freshEnv();
  const without = await connectedSite(env, sqlite);
  const result = await applyApprovedLines(
    env,
    without.engagementId,
    [{ lineId: without.line.id, postType: "page", postId: 7, field: "meta:_yoast_wpseo_title" }],
    { fetchImpl: without.server.impl },
    AT
  );
  assert.equal(result.results[0].status, "owner_step");
  assert.equal(result.results[0].pluginNeeded, "TinyStudio Connector");
  /** @type {{ status: string, charged: number, detail: string } | undefined} */
  const write = sqlite.prepare("SELECT status, charged, detail FROM wordpress_line_writes WHERE engagement_id = ?").get(without.engagementId);
  assert.equal(write.status, "owner_step");
  assert.equal(write.charged, 0, "an unwritable field is not charged");
  assert.ok(write.detail.includes("TinyStudio Connector"));

  const { env: env2, sqlite: sqlite2 } = freshEnv();
  const withConnector = await connectedSite(env2, sqlite2, { connector: true });
  const applied = await applyApprovedLines(
    env2,
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
  assert.equal(server.state.requests.length, 0, "the healthy site was not touched by the failing run");
});

test("undo restores the saved old value for the line", async () => {
  const { env, sqlite } = freshEnv();
  const { engagementId, line, server } = await connectedSite(env, sqlite);
  await applyApprovedLines(env, engagementId, [{ lineId: line.id, postType: "page", postId: 7, field: "content" }], { fetchImpl: server.impl }, AT);
  assert.equal(server.state.page.content.rendered, "The hero image is 190 KB and loads first.");
  const undone = await undoLineWrites(env, engagementId, line.id, { fetchImpl: server.impl, connector: false }, AT);
  assert.deepEqual(undone.undone, [{ field: "content", status: "undone" }]);
  assert.equal(server.state.page.content.rendered, "<p>Old copy</p>", "the old value is back on the site");
  /** @type {{ status: string } | undefined} */
  const write = sqlite.prepare("SELECT status FROM wordpress_line_writes WHERE engagement_id = ?").get(engagementId);
  assert.equal(write.status, "undone");
  const again = await undoLineWrites(env, engagementId, line.id, { fetchImpl: server.impl }, AT);
  assert.equal(again.undone.length, 0, "a second undo has nothing left to restore");
});

test("unknown fields are refused before any write", async () => {
  const { env, sqlite } = freshEnv();
  const { engagementId, line, server } = await connectedSite(env, sqlite);
  const result = await applyApprovedLines(
    env,
    engagementId,
    [{ lineId: line.id, postType: "page", postId: 7, field: "meta:not_a_known_field" }],
    { fetchImpl: server.impl, connector: false },
    AT
  );
  assert.equal(result.results[0].status, "invalid");
  assert.equal(server.state.requests.length, 0);
});

test("apply and undo refuse an engagement with no connected site", async () => {
  const { env, sqlite } = freshEnv();
  const { engagementId, line } = await approvedLine(env, sqlite);
  await assert.rejects(() => applyApprovedLines(env, engagementId, [{ lineId: line.id, postType: "page", postId: 7, field: "content" }]), /no connected WordPress site/);
  await assert.rejects(() => undoLineWrites(env, engagementId, line.id), /no connected WordPress site/);
});

test("closing the engagement deletes the key", async () => {
  const { env, sqlite } = freshEnv();
  const { engagementId } = await connectedSite(env, sqlite);
  const purged = await purgeEngagementKey(env, engagementId, AT);
  assert.equal(purged, true);
  const row = await connectionForEngagement(env, engagementId);
  assert.equal(row.status, "removed");
  assert.equal(row.password_ciphertext, null, "the ciphertext is gone");
  assert.equal(row.wp_user_login, null);
  assert.equal(row.connect_token, "");
  assert.equal(await purgeEngagementKey(env, engagementId, AT), false);
  const desk = readFileSync(new URL("../src/desk.js", import.meta.url), "utf8");
  assert.ok(desk.includes("purgeEngagementKey"), "the close-out purges the key");
  assert.ok(desk.includes("tinystudio_wordpress_key_purge_failed"), "a failed purge is logged, not swallowed");
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

test("the key secret is required before anything is encrypted", async () => {
  const { env } = freshEnv();
  const noSecret = { ...env, WORDPRESS_KEY_ENC_KEY: "" };
  await assert.rejects(() => encryptSecret(noSecret, "x"), /key-encryption Worker secret/);
});
