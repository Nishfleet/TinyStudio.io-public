import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { Webhook } from "standardwebhooks";
import worker from "../src/worker.js";
import { publishRecord } from "../src/record.js";
import {
  createDodoCheckout,
  dodoConfigStatus,
  decodeWebhookSecret,
  extractDodoPayment,
  handleDodoWebhook,
  paymentMatchesOffer,
  parseWebhookHeaders,
  safeDodoCheckoutUrl,
  startCheckoutForRequest,
  verifyDodoWebhookSignature,
  webhookSecretUsable
} from "../src/payments.js";
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
      async get(key) { return objects.has(key) ? { body: objects.get(key) } : null; }
    }
  };
  return { sqlite, env, sent, objects };
}

const faults = [{ id: "f1", type: "slow-load", title: "Home page loads in 6.1 seconds", url: "https://clinic.example/", evidence: "Largest Contentful Paint 6.1 s on mobile." }];
const review = { keep: ["f1"], summary: "The home page is slow on phones." };

function signedEvent(overrides = {}) {
  const event = {
    type: "payment.succeeded",
    data: {
      payment_id: "pay_123",
      session_id: "cs_123",
      currency: offer.currency,
      total_amount: offer.priceCents,
      customer_email: "dana@clinic.example",
      product_cart: [{ product_id: PRODUCT_ID, quantity: 1 }],
      metadata: { engagement_id: "", record_id: "", request_id: "", product_key: offer.productKey },
      ...overrides.data
    },
    ...overrides.event
  };
  const body = JSON.stringify(event);
  const webhookId = overrides.webhookId || "wh_123";
  const timestamp = overrides.timestamp ?? Math.floor(Date.now() / 1000);
  const signature = SIGNER.sign(webhookId, new Date(timestamp * 1000), body);
  return { body, headers: { "webhook-id": webhookId, "webhook-timestamp": String(timestamp), "webhook-signature": signature } };
}

async function proposedEngagement(env) {
  const { id } = await publishRecord(env, "req-1", { faults, review }, "https://tinystudio.io", "2026-10-13T08:00:00.000Z");
  return id;
}

test("checkout: one product, one price, and a Dodo URL the worker may redirect to", async () => {
  const { env, sqlite } = freshEnv();
  const recordId = await proposedEngagement(env);
  const engagement = sqlite.prepare("SELECT id FROM engagements WHERE request_id = 'req-1'").get();
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return {
      ok: true,
      status: 200,
      json: async () => ({ checkout_url: "https://checkout.dodopayments.com/session/cs_1", session_id: "cs_1" })
    };
  };
  const checkout = await startCheckoutForRequest(env, { recordId }, "2026-10-13T09:00:00.000Z", fetchImpl);
  assert.deepEqual(checkout, { checkoutUrl: "https://checkout.dodopayments.com/session/cs_1", sessionId: "cs_1" });

  const body = JSON.parse(calls[0].init.body);
  assert.deepEqual(body.product_cart, [{ product_id: PRODUCT_ID, quantity: 1 }], "one product, quantity one");
  assert.equal(body.metadata.product_key, offer.productKey);
  assert.equal(body.metadata.source, "tinystudio.io");
  assert.equal(body.metadata.engagement_id, engagement.id);
  assert.equal(body.metadata.record_id, recordId);
  assert.equal(body.metadata.request_id, "req-1");
  assert.equal(body.return_url, `https://tinystudio.io/records/${recordId}?paid=1`);
  assert.equal(body.customer_email, "dana@clinic.example");
  assert.equal(calls[0].url, "https://test.dodopayments.com/checkouts", "the test mode base URL");
  assert.equal(calls[0].init.headers.authorization, "Bearer test-api-key");

  const stored = sqlite.prepare("SELECT checkout_session_id, status FROM engagements WHERE id = ?").get(engagement.id);
  assert.equal(stored.checkout_session_id, "cs_1");
  assert.equal(stored.status, "proposed");
  const journal = sqlite.prepare("SELECT type, detail FROM engagement_events WHERE engagement_id = ? AND type = 'checkout_session_created'").all(engagement.id);
  assert.equal(journal.length, 1, "the checkout session is written to the journal");
  assert.equal(journal[0].detail, "checkout session cs_1");

  assert.equal(safeDodoCheckoutUrl("https://checkout.dodopayments.com/session/cs_1"), "https://checkout.dodopayments.com/session/cs_1");
  assert.equal(safeDodoCheckoutUrl("https://evil.example/session/cs_1"), "");
  assert.equal(safeDodoCheckoutUrl("http://checkout.dodopayments.com/session/cs_1"), "");
  assert.equal(safeDodoCheckoutUrl(""), "");
});

test("checkout: a missing config or an unusable Dodo answer never opens an engagement", async () => {
  const { env } = freshEnv();
  const recordId = await proposedEngagement(env);
  delete env.DODO_TINYSTUDIO_API_KEY;
  await assert.rejects(startCheckoutForRequest(env, { recordId }), /not configured/);
  assert.deepEqual(dodoConfigStatus(env).apiKey, false);

  const withKey = freshEnv().env;
  const id = await proposedEngagement(withKey);
  const fetchImpl = async () => ({ ok: true, status: 200, json: async () => ({ checkout_url: "https://evil.example/x", session_id: "cs_1" }) });
  await assert.rejects(createDodoCheckout(withKey, { recordId: id }, fetchImpl), /no usable checkout/);
  const noSession = async () => ({ ok: true, status: 200, json: async () => ({ checkout_url: "https://checkout.dodopayments.com/s/cs_2" }) });
  await assert.rejects(createDodoCheckout(withKey, { recordId: id }, noSession), /no usable checkout/);
  const rejected = async () => ({ ok: false, status: 422, json: async () => ({ message: "product not found" }) });
  await assert.rejects(createDodoCheckout(withKey, { recordId: id }, rejected), /product not found/);
  const aborted = async (url, init) => {
    assert.ok(typeof init.signal?.addEventListener === "function", "the Dodo call carries an abort signal");
    throw Object.assign(new Error("The operation was aborted"), { name: "AbortError" });
  };
  await assert.rejects(createDodoCheckout(withKey, { recordId: id }, aborted), /aborted/);
});

test("webhook: a signed payment.succeeded opens the engagement and logs the webhook and the D1 rows", async () => {
  const { env, sqlite } = freshEnv();
  const recordId = await proposedEngagement(env);
  const engagement = sqlite.prepare("SELECT id FROM engagements WHERE request_id = 'req-1'").get();
  const { body, headers } = signedEvent({
    data: { metadata: { engagement_id: engagement.id, record_id: recordId, request_id: "req-1" } }
  });

  const result = await handleDodoWebhook(env, { rawBody: body, headers: new Headers(headers) }, "2026-10-13T10:00:00.000Z");
  assert.deepEqual(result.body, { received: true, engagementId: engagement.id, engagementStatus: "paid" });
  assert.equal(result.status, 200);

  const paid = sqlite.prepare("SELECT status, checkout_session_id FROM engagements WHERE id = ?").get(engagement.id);
  assert.equal(paid.status, "paid");
  assert.equal(paid.checkout_session_id, "cs_123");
  const payment = sqlite.prepare("SELECT * FROM engagement_payments WHERE payment_id = 'pay_123'").get();
  assert.equal(payment.engagement_id, engagement.id);
  assert.equal(payment.amount_cents, offer.priceCents);
  assert.equal(payment.currency, offer.currency);
  const logged = sqlite.prepare("SELECT * FROM dodo_webhook_events WHERE webhook_id = 'wh_123'").get();
  assert.equal(logged.status, "processed");
  assert.equal(logged.event_type, "payment.succeeded");
  const events = sqlite.prepare("SELECT from_status, to_status, type FROM engagement_events WHERE engagement_id = ? ORDER BY created_at").all(engagement.id);
  assert.deepEqual(events.map((row) => [row.type, row.from_status, row.to_status]), [
    ["engagement_opened", null, "requested"],
    ["status_changed", "requested", "appraised"],
    ["status_changed", "appraised", "proposed"],
    ["status_changed", "proposed", "paid"],
    ["checkout_session_created", "paid", "paid"]
  ]);
});

test("webhook: the signature is verified before the engagement opens", async () => {
  const { env, sqlite } = freshEnv();
  const recordId = await proposedEngagement(env);
  const engagement = sqlite.prepare("SELECT id FROM engagements WHERE request_id = 'req-1'").get();
  const { body, headers } = signedEvent({
    data: { metadata: { engagement_id: engagement.id, record_id: recordId, request_id: "req-1" } }
  });

  const tampered = JSON.parse(body);
  tampered.data.total_amount = 1;
  const bad = await handleDodoWebhook(
    env,
    { rawBody: JSON.stringify(tampered), headers: new Headers(headers) },
    "2026-10-13T10:00:00.000Z"
  );
  assert.equal(bad.status, 401);
  assert.deepEqual(bad.body, { error: "signature_invalid" });
  assert.equal(sqlite.prepare("SELECT status FROM engagements WHERE id = ?").get(engagement.id).status, "proposed", "no engagement opened");
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM engagement_payments").get().n, 0);
  assert.equal(
    sqlite.prepare("SELECT COUNT(*) AS n FROM dodo_webhook_events WHERE webhook_id = 'wh_123'").get().n,
    0,
    "a refused signature writes no row, so an unauthenticated POST cannot claim a real webhook id"
  );

  const replayOfPoisonedId = await handleDodoWebhook(env, { rawBody: body, headers: new Headers(headers) }, "2026-10-13T10:05:00.000Z");
  assert.equal(replayOfPoisonedId.status, 200, "the same webhook id still works once it arrives with a good signature");
  assert.equal(sqlite.prepare("SELECT status FROM engagements WHERE id = ?").get(engagement.id).status, "paid");

  const noHeaders = await handleDodoWebhook(env, { rawBody: body, headers: new Headers() }, "2026-10-13T10:00:00.000Z");
  assert.equal(noHeaders.status, 400);
  assert.deepEqual(noHeaders.body, { error: "webhook_headers_missing" });

  const badJson = await handleDodoWebhook(
    env,
    { rawBody: "not json", headers: new Headers({ "webhook-id": "wh_json", "webhook-timestamp": String(Math.floor(Date.now() / 1000)), "webhook-signature": "v1,xx" }) },
    "2026-10-13T10:00:00.000Z"
  );
  assert.equal(badJson.status, 401);

  delete env.DODO_TINYSTUDIO_WEBHOOK_SECRET;
  const unconfigured = await handleDodoWebhook(env, { rawBody: body, headers: new Headers(headers) }, "2026-10-13T10:00:00.000Z");
  assert.equal(unconfigured.status, 503);
  assert.deepEqual(unconfigured.body, { error: "webhook_secret_missing" });
});

test("webhook: a replay, another product and a failed payment open nothing new", async () => {
  const { env, sqlite } = freshEnv();
  const recordId = await proposedEngagement(env);
  const engagement = sqlite.prepare("SELECT id FROM engagements WHERE request_id = 'req-1'").get();
  const first = signedEvent({ data: { metadata: { engagement_id: engagement.id, record_id: recordId, request_id: "req-1" } } });
  const options = { rawBody: first.body, headers: new Headers(first.headers) };
  await handleDodoWebhook(env, options, "2026-10-13T10:00:00.000Z");
  const eventsBefore = sqlite.prepare("SELECT COUNT(*) AS n FROM engagement_events WHERE engagement_id = ?").get(engagement.id).n;

  const replay = await handleDodoWebhook(env, options, "2026-10-13T11:00:00.000Z");
  assert.deepEqual(replay.body, { received: true, duplicate: true, webhookStatus: "processed" });
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM engagement_events WHERE engagement_id = ?").get(engagement.id).n, eventsBefore, "a replay writes no event row");
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM engagement_payments").get().n, 1);

  const otherProduct = signedEvent({
    webhookId: "wh_other_product",
    data: { product_cart: [{ product_id: "prod_something_else", quantity: 1 }], metadata: { engagement_id: engagement.id, record_id: recordId, request_id: "req-1" } }
  });
  const wrongProduct = await handleDodoWebhook(env, { rawBody: otherProduct.body, headers: new Headers(otherProduct.headers) }, "2026-10-13T12:00:00.000Z");
  assert.equal(wrongProduct.status, 400);
  assert.deepEqual(wrongProduct.body, { error: "offer_mismatch" });
  assert.equal(sqlite.prepare("SELECT status FROM dodo_webhook_events WHERE webhook_id = 'wh_other_product'").get().status, "rejected");

  const tooCheap = signedEvent({
    webhookId: "wh_too_cheap",
    data: { total_amount: 500, metadata: { engagement_id: engagement.id, record_id: recordId, request_id: "req-1" } }
  });
  const cheap = await handleDodoWebhook(env, { rawBody: tooCheap.body, headers: new Headers(tooCheap.headers) }, "2026-10-13T12:30:00.000Z");
  assert.equal(cheap.status, 400);
  assert.deepEqual(cheap.body, { error: "offer_mismatch" });

  const failed = signedEvent({
    webhookId: "wh_failed",
    event: { type: "payment.failed" },
    data: { metadata: { engagement_id: engagement.id, record_id: recordId, request_id: "req-1" } }
  });
  const failure = await handleDodoWebhook(env, { rawBody: failed.body, headers: new Headers(failed.headers) }, "2026-10-13T13:00:00.000Z");
  assert.deepEqual(failure.body, { received: true, ignored: true });
  assert.equal(sqlite.prepare("SELECT status FROM engagements WHERE id = ?").get(engagement.id).status, "paid");
  assert.equal(sqlite.prepare("SELECT status FROM dodo_webhook_events WHERE webhook_id = 'wh_failed'").get().status, "failed");
});

test("webhook: a failed payment does not claim its webhook id, so Dodo's retry still opens the engagement", async () => {
  const { env, sqlite } = freshEnv();
  const recordId = await proposedEngagement(env);
  const engagement = sqlite.prepare("SELECT id FROM engagements WHERE request_id = 'req-1'").get();
  const metadata = { engagement_id: engagement.id, record_id: recordId, request_id: "req-1" };

  const failed = signedEvent({ webhookId: "wh_retry", event: { type: "payment.failed" }, data: { metadata } });
  const failure = await handleDodoWebhook(env, { rawBody: failed.body, headers: new Headers(failed.headers) }, "2026-10-13T13:00:00.000Z");
  assert.deepEqual(failure.body, { received: true, ignored: true });
  assert.equal(sqlite.prepare("SELECT status FROM engagements WHERE id = ?").get(engagement.id).status, "proposed");

  const retry = signedEvent({ webhookId: "wh_retry", data: { metadata } });
  const success = await handleDodoWebhook(env, { rawBody: retry.body, headers: new Headers(retry.headers) }, "2026-10-13T13:05:00.000Z");
  assert.equal(success.status, 200);
  assert.equal(sqlite.prepare("SELECT status FROM engagements WHERE id = ?").get(engagement.id).status, "paid", "the retry is processed, not answered as a duplicate");
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM engagement_payments").get().n, 1);
});

test("webhook: a second successful payment for a paid engagement is journaled, not reopened", async () => {
  const { env, sqlite } = freshEnv();
  const recordId = await proposedEngagement(env);
  const engagement = sqlite.prepare("SELECT id FROM engagements WHERE request_id = 'req-1'").get();
  const metadata = { engagement_id: engagement.id, record_id: recordId, request_id: "req-1" };
  const first = signedEvent({ data: { metadata } });
  await handleDodoWebhook(env, { rawBody: first.body, headers: new Headers(first.headers) }, "2026-10-13T10:00:00.000Z");

  const second = signedEvent({ webhookId: "wh_second", data: { payment_id: "pay_456", session_id: "cs_456", metadata } });
  const again = await handleDodoWebhook(env, { rawBody: second.body, headers: new Headers(second.headers) }, "2026-10-13T11:00:00.000Z");
  assert.equal(again.status, 200);
  assert.equal(again.body.duplicatePayment, true, "the duplicate charge is reported, not hidden");
  assert.equal(sqlite.prepare("SELECT status FROM engagements WHERE id = ?").get(engagement.id).status, "paid");
  const journaled = sqlite.prepare("SELECT type, detail FROM engagement_events WHERE engagement_id = ? AND type = 'payment_recorded_duplicate'").all(engagement.id);
  assert.equal(journaled.length, 1);
  assert.match(journaled[0].detail, /pay_456/);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM engagement_payments WHERE payment_id = 'pay_456'").get().n, 1);
});

test("webhook: a signed event with no payment id, no amount or no product is an offer mismatch", async () => {
  const { env, sqlite } = freshEnv();
  const recordId = await proposedEngagement(env);
  const engagement = sqlite.prepare("SELECT id FROM engagements WHERE request_id = 'req-1'").get();
  const metadata = { engagement_id: engagement.id, record_id: recordId, request_id: "req-1" };
  const broken = [
    { webhookId: "wh_no_id", data: { payment_id: "", metadata } },
    { webhookId: "wh_no_amount", data: { total_amount: 0, metadata } },
    { webhookId: "wh_no_cart", data: { product_cart: [], metadata } }
  ];
  for (const [index, override] of broken.entries()) {
    const event = signedEvent(override);
    const refused = await handleDodoWebhook(env, { rawBody: event.body, headers: new Headers(event.headers) }, `2026-10-13T1${index}:00:00.000Z`);
    assert.equal(refused.status, 400, `${override.webhookId} must be refused`);
    assert.deepEqual(refused.body, { error: "offer_mismatch" });
  }
  assert.equal(sqlite.prepare("SELECT status FROM engagements WHERE id = ?").get(engagement.id).status, "proposed");
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM engagement_payments").get().n, 0);
});

test("webhook: a payment for an engagement that is not proposed is refused, not opened twice", async () => {
  const { env, sqlite } = freshEnv();
  const recordId = await proposedEngagement(env);
  const engagement = sqlite.prepare("SELECT id FROM engagements WHERE request_id = 'req-1'").get();
  const metadata = { engagement_id: engagement.id, record_id: recordId, request_id: "req-1" };

  const requested = signedEvent({ webhookId: "wh_requested", data: { metadata } });
  sqlite.prepare("UPDATE engagements SET status = 'requested' WHERE id = ?").run(engagement.id);
  const early = await handleDodoWebhook(env, { rawBody: requested.body, headers: new Headers(requested.headers) }, "2026-10-13T10:00:00.000Z");
  assert.equal(early.status, 409);
  assert.deepEqual(early.body, { error: "engagement_state" });
  assert.equal(sqlite.prepare("SELECT status FROM engagements WHERE id = ?").get(engagement.id).status, "requested");

  const unknown = signedEvent({ webhookId: "wh_unknown", data: { metadata: { ...metadata, engagement_id: crypto.randomUUID() } } });
  const missing = await handleDodoWebhook(env, { rawBody: unknown.body, headers: new Headers(unknown.headers) }, "2026-10-13T10:30:00.000Z");
  assert.equal(missing.status, 409);
  assert.deepEqual(missing.body, { error: "engagement_unknown" });
});

test("checkout route: a browser form post hands off to the Dodo page, and a JSON caller gets the URL", async () => {
  const { env } = freshEnv();
  const recordId = await proposedEngagement(env);
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({ checkout_url: "https://checkout.dodopayments.com/session/cs_form", session_id: "cs_form" })
  });
  try {
    const browser = await worker.fetch(
      new Request("https://tinystudio.io/api/engagements/checkout", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "text/html,application/xhtml+xml",
          Origin: "https://tinystudio.io",
          "Sec-Fetch-Mode": "navigate"
        },
        body: new URLSearchParams({ recordId }).toString()
      }),
      env
    );
    assert.equal(browser.status, 303);
    assert.equal(browser.headers.get("location"), "https://checkout.dodopayments.com/session/cs_form");
    assert.equal(await browser.text(), "", "the redirect carries no body");

    const api = await worker.fetch(
      new Request("https://tinystudio.io/api/engagements/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json", Origin: "https://tinystudio.io" },
        body: new URLSearchParams({ recordId }).toString()
      }),
      env
    );
    assert.equal(api.status, 200);
    assert.equal((await api.json()).checkoutUrl, "https://checkout.dodopayments.com/session/cs_form");
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("checkout route: a paid engagement redirects the customer to the record instead of charging twice", async () => {
  const { env, sqlite } = freshEnv();
  const recordId = await proposedEngagement(env);
  const engagement = sqlite.prepare("SELECT id FROM engagements WHERE request_id = 'req-1'").get();
  const paid = signedEvent({ data: { metadata: { engagement_id: engagement.id, record_id: recordId, request_id: "req-1" } } });
  await handleDodoWebhook(env, { rawBody: paid.body, headers: new Headers(paid.headers) }, "2026-10-13T10:00:00.000Z");

  const res = await worker.fetch(
    new Request("https://tinystudio.io/api/engagements/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "text/html", Origin: "https://tinystudio.io" },
      body: new URLSearchParams({ recordId }).toString()
    }),
    env
  );
  assert.equal(res.status, 303);
  assert.equal(res.headers.get("location"), `/records/${recordId}?checkout=failed`);
  const sessions = sqlite.prepare("SELECT COUNT(*) AS n FROM engagement_events WHERE engagement_id = ? AND type = 'checkout_session_created'").get(engagement.id).n;
  assert.equal(sessions, 1, "no second checkout session is attached");
});

test("checkout route: the sixth checkout from one address in a day is refused", async () => {
  const { env } = freshEnv();
  const recordId = await proposedEngagement(env);
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({ checkout_url: "https://checkout.dodopayments.com/session/cs_limit", session_id: "cs_limit" })
  });
  try {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const res = await worker.fetch(
        new Request("https://tinystudio.io/api/engagements/checkout", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json", Origin: "https://tinystudio.io", "CF-Connecting-IP": "203.0.113.7" },
          body: new URLSearchParams({ recordId }).toString()
        }),
        env
      );
      assert.equal(res.status, 200, `checkout ${attempt + 1} is allowed`);
    }
    const blocked = await worker.fetch(
      new Request("https://tinystudio.io/api/engagements/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json", Origin: "https://tinystudio.io", "CF-Connecting-IP": "203.0.113.7" },
        body: new URLSearchParams({ recordId }).toString()
      }),
      env
    );
    assert.equal(blocked.status, 429);
    assert.equal((await blocked.json()).error, "checkout_daily_limit");
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("checkout route: a checkout Dodo refuses does not spend the daily allowance", async () => {
  const { env } = freshEnv();
  const recordId = await proposedEngagement(env);
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: false,
    status: 422,
    json: async () => ({ message: "the product is not published in this mode" })
  });
  try {
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const res = await worker.fetch(
        new Request("https://tinystudio.io/api/engagements/checkout", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json", Origin: "https://tinystudio.io", "CF-Connecting-IP": "203.0.113.9" },
          body: new URLSearchParams({ recordId }).toString()
        }),
        env
      );
      assert.equal(res.status, 400, `a refused checkout ${attempt + 1} is answered, not capped`);
    }
    globalThis.fetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({ checkout_url: "https://checkout.dodopayments.com/session/cs_after", session_id: "cs_after" })
    });
    const allowed = await worker.fetch(
      new Request("https://tinystudio.io/api/engagements/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json", Origin: "https://tinystudio.io", "CF-Connecting-IP": "203.0.113.9" },
        body: new URLSearchParams({ recordId }).toString()
      }),
      env
    );
    assert.equal(allowed.status, 200, "a customer whose checkout failed six times can still pay");
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("checkout route: parallel checkouts from one address still stop at the daily cap", async () => {
  const { env } = freshEnv();
  const recordId = await proposedEngagement(env);
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({ checkout_url: "https://checkout.dodopayments.com/session/cs_race", session_id: `cs_race_${crypto.randomUUID()}` })
  });
  try {
    const attempts = Array.from({ length: 12 }, () =>
      worker.fetch(
        new Request("https://tinystudio.io/api/engagements/checkout", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json", Origin: "https://tinystudio.io", "CF-Connecting-IP": "203.0.113.11" },
          body: new URLSearchParams({ recordId }).toString()
        }),
        env
      )
    );
    const results = await Promise.all(attempts);
    const allowed = results.filter((res) => res.status === 200).length;
    const refused = results.filter((res) => res.status === 429).length;
    assert.equal(allowed, 5, "the claim is atomic, so five sessions open and no more");
    assert.equal(refused, 7, "every other post from that address is refused");
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("webhook: the route refuses an unsigned POST and never opens an engagement", async () => {
  const { env, sqlite } = freshEnv();
  const recordId = await proposedEngagement(env);
  const engagement = sqlite.prepare("SELECT id FROM engagements WHERE request_id = 'req-1'").get();
  const { body } = signedEvent({ data: { metadata: { engagement_id: engagement.id, record_id: recordId, request_id: "req-1" } } });

  const unsigned = await worker.fetch(
    new Request("https://tinystudio.io/api/webhooks/dodo", { method: "POST", body, headers: { "content-type": "application/json" } }),
    env
  );
  assert.equal(unsigned.status, 400);
  assert.equal(sqlite.prepare("SELECT status FROM engagements WHERE id = ?").get(engagement.id).status, "proposed");

  const good = await worker.fetch(
    new Request("https://tinystudio.io/api/webhooks/dodo", {
      method: "POST",
      body,
      headers: { "content-type": "application/json", ...signedHeaders(body, "wh_route") }
    }),
    env
  );
  assert.equal(good.status, 200);
  assert.equal(sqlite.prepare("SELECT status FROM engagements WHERE id = ?").get(engagement.id).status, "paid");
});

test("webhook secret: a malformed or empty secret fails closed with a clear error", () => {
  assert.throws(() => decodeWebhookSecret(""), /webhook secret is empty/);
  assert.throws(() => decodeWebhookSecret("   "), /webhook secret is empty/);
  assert.throws(() => decodeWebhookSecret("whsec_"), /webhook secret is empty/);
  assert.throws(() => decodeWebhookSecret("not-base64!!"), /not valid base64/);
  assert.throws(() => decodeWebhookSecret("whsec_not-base64!!"), /not valid base64/);
  assert.equal(webhookSecretUsable(""), false);
  assert.equal(webhookSecretUsable("whsec_"), false);
  assert.equal(webhookSecretUsable("not-base64!!"), false);
  assert.equal(webhookSecretUsable(WEBHOOK_SECRET), true);

  const decoded = decodeWebhookSecret(WEBHOOK_SECRET);
  assert.equal(Buffer.from(decoded).toString("utf8"), "tinystudio-test-secret-key", "the secret decodes to the key Dodo signed with");
  assert.equal(Buffer.from(decodeWebhookSecret(Buffer.from("tinystudio-test-secret-key").toString("base64"))).toString("utf8"), "tinystudio-test-secret-key");
});

test("webhook secret: a malformed secret is refused before the signature is read", async () => {
  const { env, sqlite } = freshEnv();
  const recordId = await proposedEngagement(env);
  const engagement = sqlite.prepare("SELECT id FROM engagements WHERE request_id = 'req-1'").get();
  const { body, headers } = signedEvent({
    data: { metadata: { engagement_id: engagement.id, record_id: recordId, request_id: "req-1" } }
  });

  env.DODO_TINYSTUDIO_WEBHOOK_SECRET = "not-base64!!";
  assert.equal(dodoConfigStatus(env).webhookSecret, true, "the secret is set");
  assert.equal(dodoConfigStatus(env).webhookSecretValid, false, "but it is not usable");

  const refused = await handleDodoWebhook(env, { rawBody: body, headers: new Headers(headers) }, "2026-10-13T10:00:00.000Z");
  assert.equal(refused.status, 503);
  assert.deepEqual(refused.body, { error: "webhook_secret_invalid" });
  assert.equal(sqlite.prepare("SELECT status FROM engagements WHERE id = ?").get(engagement.id).status, "proposed", "no engagement opened");
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM engagement_payments").get().n, 0);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM dodo_webhook_events").get().n, 0, "a refused secret writes no webhook row");
});

test("payments helpers: the parsed payment, the offer check and the headers", () => {
  const event = {
    type: "payment.succeeded",
    data: {
      payment_id: "pay_9",
      session_id: "cs_9",
      currency: "USD",
      total_amount: 1000000,
      customer: { email: "Dana@Clinic.example" },
      product_cart: [{ product_id: PRODUCT_ID }],
      metadata: { engagement_id: "e1", record_id: "r1" }
    }
  };
  const payment = extractDodoPayment(event);
  assert.equal(payment.paymentId, "pay_9");
  assert.equal(payment.engagementId, "e1");
  assert.equal(payment.customerEmail, "dana@clinic.example");
  assert.deepEqual(payment.productIds, [PRODUCT_ID]);
  assert.equal(payment.amountCents, 1000000);
  assert.equal(paymentMatchesOffer(payment, { DODO_TINYSTUDIO_PRODUCT_ID: PRODUCT_ID }), true);
  assert.equal(paymentMatchesOffer({ ...payment, amountCents: 1 }, { DODO_TINYSTUDIO_PRODUCT_ID: PRODUCT_ID }), false);
  assert.equal(paymentMatchesOffer({ ...payment, productIds: ["prod_other"] }, { DODO_TINYSTUDIO_PRODUCT_ID: PRODUCT_ID }), false);
  assert.equal(paymentMatchesOffer({ ...payment, currency: "EUR" }, { DODO_TINYSTUDIO_PRODUCT_ID: PRODUCT_ID }), false);

  const headers = new Headers({ "Webhook-Id": "wh_x", "Webhook-Timestamp": "1", "Webhook-Signature": "v1,y" });
  assert.deepEqual(parseWebhookHeaders(headers), { webhookId: "wh_x", webhookTimestamp: "1", webhookSignature: "v1,y" });
  assert.deepEqual(parseWebhookHeaders({ "webhook-id": "wh_y" }), { webhookId: "wh_y", webhookTimestamp: "", webhookSignature: "" });

  const body = JSON.stringify(event);
  const now = Math.floor(Date.now() / 1000);
  const signature = SIGNER.sign("wh_z", new Date(now * 1000), body);
  assert.equal(verifyDodoWebhookSignature({ payload: body, webhookId: "wh_z", webhookTimestamp: String(now), webhookSignature: signature, secret: WEBHOOK_SECRET }), true);
  assert.equal(verifyDodoWebhookSignature({ payload: body, webhookId: "wh_z", webhookTimestamp: String(now), webhookSignature: "v1,wrong", secret: WEBHOOK_SECRET }), false);
  assert.equal(verifyDodoWebhookSignature({ payload: body, webhookId: "wh_z", webhookTimestamp: String(now), webhookSignature: signature, secret: "" }), false);
  assert.equal(verifyDodoWebhookSignature({ payload: "", webhookId: "", webhookTimestamp: "", webhookSignature: "", secret: WEBHOOK_SECRET }), false);
});

function signedHeaders(body, webhookId) {
  const now = Math.floor(Date.now() / 1000);
  const signature = SIGNER.sign(webhookId, new Date(now * 1000), body);
  return { "webhook-id": webhookId, "webhook-timestamp": String(now), "webhook-signature": signature };
}
