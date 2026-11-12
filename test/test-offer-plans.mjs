import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { Webhook } from "standardwebhooks";
import worker from "../src/worker.js";
import { handleDodoWebhook, paymentMatchesOffer } from "../src/payments.js";
import { closeDuePlans, extractDodoSubscription, paidProduct } from "../src/plans.js";
import offer from "../config/offer.json" with { type: "json" };

const WEBHOOK_SECRET = "whsec_" + Buffer.from("tinystudio-test-secret-key").toString("base64");
const SIGNER = new Webhook(Buffer.from("tinystudio-test-secret-key").toString("base64"));

const PRODUCT_IDS = {
  "repair-small": "prod_repair_small",
  "repair-medium": "prod_repair_medium",
  "repair-large": "prod_repair_large",
  care: "prod_care",
  growth: "prod_growth",
  "website-correction": "prod_website_correction"
};

const PLAN_ENV = {
  DODO_TINYSTUDIO_REPAIR_SMALL_PRODUCT_ID: PRODUCT_IDS["repair-small"],
  DODO_TINYSTUDIO_REPAIR_MEDIUM_PRODUCT_ID: PRODUCT_IDS["repair-medium"],
  DODO_TINYSTUDIO_REPAIR_LARGE_PRODUCT_ID: PRODUCT_IDS["repair-large"],
  DODO_TINYSTUDIO_CARE_PRODUCT_ID: PRODUCT_IDS.care,
  DODO_TINYSTUDIO_GROWTH_PRODUCT_ID: PRODUCT_IDS.growth,
  DODO_TINYSTUDIO_PRODUCT_ID: PRODUCT_IDS["website-correction"]
};

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
  const env = {
    DODO_TINYSTUDIO_API_KEY: "test-api-key",
    DODO_TINYSTUDIO_WEBHOOK_SECRET: WEBHOOK_SECRET,
    DODO_TINYSTUDIO_MODE: "test",
    DODO_TINYSTUDIO_REPAIR_SMALL_PRODUCT_ID: PRODUCT_IDS["repair-small"],
    DODO_TINYSTUDIO_REPAIR_MEDIUM_PRODUCT_ID: PRODUCT_IDS["repair-medium"],
    DODO_TINYSTUDIO_REPAIR_LARGE_PRODUCT_ID: PRODUCT_IDS["repair-large"],
    DODO_TINYSTUDIO_CARE_PRODUCT_ID: PRODUCT_IDS.care,
    DODO_TINYSTUDIO_GROWTH_PRODUCT_ID: PRODUCT_IDS.growth,
    DODO_TINYSTUDIO_PRODUCT_ID: PRODUCT_IDS["website-correction"],
    DB: d1(sqlite)
  };
  return { sqlite, env };
}

function proposedEngagement(sqlite, productKey, requestId = `req-${crypto.randomUUID().slice(0, 8)}`) {
  const id = crypto.randomUUID();
  sqlite.prepare(
    "INSERT INTO engagements (id, request_id, status, product_key, created_at, changed_at) VALUES (?1, ?2, 'proposed', ?3, ?4, ?4)"
  ).run(id, requestId, productKey || null, "2026-10-13T08:00:00.000Z");
  return id;
}

function paidEngagement(sqlite, productKey) {
  const id = proposedEngagement(sqlite, productKey);
  sqlite.prepare("UPDATE engagements SET status = 'paid', plan_status = 'active', subscription_id = 'sub_started' WHERE id = ?").run(id);
  return id;
}

/** @param {{ type?: string, productId?: string, amount?: number, currency?: string, subscriptionId?: string | null, engagementId?: string, webhookId?: string, paymentId?: string, timestamp?: number, extra?: Record<string, unknown> }} input */
function signedEvent({ type = "payment.succeeded", productId = PRODUCT_IDS.care, amount = 29900, currency = "USD", subscriptionId = null, engagementId = "", webhookId = "wh_plan", paymentId = "pay_plan", timestamp, extra = {} } = {}) {
  const data = {
    payment_id: paymentId,
    subscription_id: subscriptionId ?? undefined,
    session_id: "cs_plan",
    currency,
    total_amount: amount,
    customer_email: "dana@clinic.example",
    product_cart: [{ product_id: productId, quantity: 1 }],
    metadata: { engagement_id: engagementId, record_id: "", request_id: "req-1" },
    ...extra
  };
  if (type.startsWith("subscription.")) {
    delete data.payment_id;
    delete data.session_id;
    delete data.customer_email;
    delete data.total_amount;
  }
  const event = { type, data };
  const body = JSON.stringify(event);
  const id = webhookId;
  const ts = timestamp ?? Math.floor(Date.now() / 1000);
  const signature = SIGNER.sign(id, new Date(ts * 1000), body);
  return { body, headers: { "webhook-id": id, "webhook-timestamp": String(ts), "webhook-signature": signature } };
}

const send = (env, event, at = "2026-11-13T10:00:00.000Z") =>
  handleDodoWebhook(env, { rawBody: event.body, headers: new Headers(event.headers) }, at);

test("the catalog prices the offer's six products", () => {
  assert.deepEqual(
    offer.products.map((product) => [product.productKey, product.priceCents, product.billing]),
    [
      ["repair-small", 14900, "one-time"],
      ["repair-medium", 34900, "one-time"],
      ["repair-large", 69900, "one-time"],
      ["care", 29900, "monthly"],
      ["growth", 59900, "monthly"],
      ["website-correction", 1000000, "one-time"]
    ]
  );
  assert.equal(offer.currency, "USD");
});

test("each product id opens the engagement for that product", async () => {
  const { env, sqlite } = freshEnv();
  const at = "2026-11-13T10:00:00.000Z";
  for (const product of offer.products) {
    const engagementId = proposedEngagement(sqlite, product.productKey);
    const event = signedEvent({
      webhookId: `wh_open_${product.productKey}`,
      productId: PRODUCT_IDS[product.productKey],
      amount: product.priceCents,
      subscriptionId: product.billing === "monthly" ? `sub_${product.productKey}` : null,
      engagementId,
      paymentId: `pay_open_${product.productKey}`
    });
    const result = await send(env, event, at);
    assert.equal(result.status, 200, `${product.productKey} must open its engagement`);
    const row = sqlite.prepare("SELECT * FROM engagements WHERE id = ?").get(engagementId);
    assert.equal(row.status, "paid");
    assert.equal(row.product_key, product.productKey);
    if (product.billing === "monthly") {
      assert.equal(row.plan_status, "active", `${product.productKey} starts its plan`);
      assert.equal(row.subscription_id, `sub_${product.productKey}`);
    } else {
      assert.equal(row.plan_status, null, `${product.productKey} is one-time, no plan`);
    }
    const payment = sqlite.prepare("SELECT * FROM engagement_payments WHERE payment_id = ?").get(`pay_open_${product.productKey}`);
    assert.equal(payment.role, product.productKey);
    assert.equal(payment.amount_cents, product.priceCents);
    const logged = sqlite.prepare("SELECT status FROM dodo_webhook_events WHERE webhook_id = ?").get(`wh_open_${product.productKey}`);
    assert.equal(logged.status, "processed");
    const journaled = sqlite.prepare("SELECT type FROM engagement_events WHERE engagement_id = ? AND type = 'plan_started'").all(engagementId);
    assert.equal(journaled.length, product.billing === "monthly" ? 1 : 0);
  }
});

test("a payment for a cheaper product never opens a dearer engagement", async () => {
  const { env, sqlite } = freshEnv();
  const named = proposedEngagement(sqlite, "growth");
  const care = signedEvent({ webhookId: "wh_care_for_growth", productId: PRODUCT_IDS.care, engagementId: named });
  const result = await send(env, care);
  assert.equal(result.status, 400);
  assert.deepEqual(result.body, { error: "offer_mismatch" });
  assert.equal(sqlite.prepare("SELECT status, product_key, plan_status FROM engagements WHERE id = ?").get(named).status, "proposed");
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM engagement_payments").get().n, 0);
  assert.equal(sqlite.prepare("SELECT status FROM dodo_webhook_events WHERE webhook_id = 'wh_care_for_growth'").get().status, "rejected");

  const unnamed = proposedEngagement(sqlite, null);
  const repair = signedEvent({ webhookId: "wh_repair_for_unnamed", productId: PRODUCT_IDS["repair-large"], amount: 69900, engagementId: unnamed });
  const repairResult = await send(env, repair);
  assert.equal(repairResult.status, 400, "an unnamed engagement defaults to the Website Correction, so 699 dollars may not open it");
  assert.equal(sqlite.prepare("SELECT status FROM engagements WHERE id = ?").get(unnamed).status, "proposed");

  const correction = proposedEngagement(sqlite, "website-correction");
  const small = signedEvent({ webhookId: "wh_small_for_correction", productId: PRODUCT_IDS["repair-small"], amount: 14900, engagementId: correction });
  assert.equal((await send(env, small)).status, 400);
  assert.equal(sqlite.prepare("SELECT status FROM engagements WHERE id = ?").get(correction).status, "proposed");
});

test("a short amount is refused even for the named product", async () => {
  const { env, sqlite } = freshEnv();
  const care = proposedEngagement(sqlite, "care");
  const short = signedEvent({ webhookId: "wh_short_care", productId: PRODUCT_IDS.care, amount: 14900, engagementId: care });
  const result = await send(env, short);
  assert.equal(result.status, 400);
  assert.deepEqual(result.body, { error: "offer_mismatch" });
  assert.equal(sqlite.prepare("SELECT status, plan_status FROM engagements WHERE id = ?").get(care).status, "proposed");
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM engagement_payments").get().n, 0);

  const growth = proposedEngagement(sqlite, "growth");
  const shortGrowth = signedEvent({ webhookId: "wh_short_growth", productId: PRODUCT_IDS.growth, amount: 29900, engagementId: growth });
  assert.equal((await send(env, shortGrowth)).status, 400, "the care price does not buy growth");
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM engagement_payments").get().n, 0);
});

test("a replayed webhook changes nothing", async () => {
  const { env, sqlite } = freshEnv();
  const engagementId = proposedEngagement(sqlite, "care");
  const event = signedEvent({ subscriptionId: "sub_care", engagementId });
  const first = await send(env, event);
  assert.equal(first.status, 200);
  const eventsBefore = sqlite.prepare("SELECT COUNT(*) AS n FROM engagement_events").get().n;
  const paymentsBefore = sqlite.prepare("SELECT COUNT(*) AS n FROM engagement_payments").get().n;

  const replay = await send(env, event, "2026-11-13T11:00:00.000Z");
  assert.deepEqual(replay.body, { received: true, duplicate: true, webhookStatus: "processed" });
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM engagement_events").get().n, eventsBefore, "a replay writes no event row");
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM engagement_payments").get().n, paymentsBefore);
  const row = sqlite.prepare("SELECT * FROM engagements WHERE id = ?").get(engagementId);
  assert.equal(row.status, "paid");
  assert.equal(row.plan_status, "active");

  const replayedSubscription = signedEvent({
    type: "subscription.renewed",
    webhookId: "wh_renew_care",
    subscriptionId: "sub_care",
    engagementId
  });
  const firstRenewal = await send(env, replayedSubscription, "2026-11-13T11:10:00.000Z");
  assert.equal(firstRenewal.status, 200);
  const renewalEvents = sqlite.prepare("SELECT COUNT(*) AS n FROM engagement_events").get().n;
  const replayRenewal = await send(env, replayedSubscription, "2026-11-13T11:20:00.000Z");
  assert.equal(replayRenewal.status, 200);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM engagement_events").get().n, renewalEvents, "a replayed renewal writes no event row");
});

test("a cancelled plan closes the engagement at period end", async () => {
  const { env, sqlite } = freshEnv();
  const engagementId = paidEngagement(sqlite, "care");
  const cancelled = signedEvent({
    type: "subscription.cancelled",
    webhookId: "wh_cancel_care",
    subscriptionId: "sub_started",
    engagementId,
    extra: { next_billing_date: "2026-12-01T00:00:00.000Z" }
  });
  const result = await send(env, cancelled, "2026-11-13T10:00:00.000Z");
  assert.equal(result.status, 200);
  assert.deepEqual(result.body, { received: true, engagementId, planStatus: "cancelling", periodEndsAt: "2026-12-01T00:00:00.000Z" });
  const row = sqlite.prepare("SELECT * FROM engagements WHERE id = ?").get(engagementId);
  assert.equal(row.status, "paid", "the customer keeps access until the period they paid for ends");
  assert.equal(row.plan_status, "cancelling");
  assert.equal(row.period_ends_at, "2026-12-01T00:00:00.000Z");
  assert.equal(sqlite.prepare("SELECT status FROM dodo_webhook_events WHERE webhook_id = 'wh_cancel_care'").get().status, "processed");

  await closeDuePlans(env, new Date("2026-11-20T00:00:00.000Z"));
  assert.equal(sqlite.prepare("SELECT plan_status FROM engagements WHERE id = ?").get(engagementId).plan_status, "cancelling", "the period has not ended yet");

  const closed = await closeDuePlans(env, new Date("2026-12-02T00:00:00.000Z"));
  assert.equal(closed, 1);
  const after = sqlite.prepare("SELECT * FROM engagements WHERE id = ?").get(engagementId);
  assert.equal(after.plan_status, "closed");
  const journaled = sqlite.prepare("SELECT type FROM engagement_events WHERE engagement_id = ? AND type = 'plan_closed'").all(engagementId);
  assert.equal(journaled.length, 1);
});

test("an expired plan closes now, and a failed renewal waits out the grace period the provider runs", async () => {
  const { env, sqlite } = freshEnv();
  const expiredId = paidEngagement(sqlite, "growth");
  const expired = signedEvent({
    type: "subscription.expired",
    webhookId: "wh_expired",
    productId: PRODUCT_IDS.growth,
    subscriptionId: "sub_started",
    engagementId: expiredId,
    extra: { cancelled_at: "2026-11-10T00:00:00.000Z" }
  });
  const result = await send(env, expired);
  assert.equal(result.status, 200);
  assert.equal(sqlite.prepare("SELECT plan_status FROM engagements WHERE id = ?").get(expiredId).plan_status, "closed");

  const failedId = paidEngagement(sqlite, "care");
  const failed = signedEvent({
    type: "subscription.past_due",
    webhookId: "wh_past_due",
    subscriptionId: "sub_started",
    engagementId: failedId,
    extra: { past_due_ends_at: "2026-11-20T00:00:00.000Z" }
  });
  const failedResult = await send(env, failed);
  assert.equal(failedResult.status, 200);
  assert.equal(sqlite.prepare("SELECT plan_status, period_ends_at, status FROM engagements WHERE id = ?").get(failedId).plan_status, "past_due");
  assert.equal(sqlite.prepare("SELECT period_ends_at FROM engagements WHERE id = ?").get(failedId).period_ends_at, "2026-11-20T00:00:00.000Z", "the customer keeps access until the grace period ends");
  assert.equal(sqlite.prepare("SELECT status FROM engagements WHERE id = ?").get(failedId).status, "paid");
});

test("a renewal extends the period and is journaled as a renewal, not a duplicate", async () => {
  const { env, sqlite } = freshEnv();
  const engagementId = paidEngagement(sqlite, "care");
  const renewal = signedEvent({
    type: "subscription.renewed",
    webhookId: "wh_renew",
    subscriptionId: "sub_started",
    engagementId,
    extra: { next_billing_date: "2026-12-13T00:00:00.000Z" }
  });
  const result = await send(env, renewal, "2026-11-13T10:00:00.000Z");
  assert.equal(result.status, 200);
  assert.deepEqual(result.body, { received: true, engagementId, planStatus: "active" });
  const row = sqlite.prepare("SELECT * FROM engagements WHERE id = ?").get(engagementId);
  assert.equal(row.plan_status, "active");
  assert.equal(row.period_ends_at, "2026-12-13T00:00:00.000Z");
  const renewed = sqlite.prepare("SELECT type FROM engagement_events WHERE engagement_id = ? AND type = 'plan_renewed'").all(engagementId);
  assert.equal(renewed.length, 1);

  const renewalPayment = signedEvent({
    webhookId: "wh_renew_payment",
    subscriptionId: "sub_started",
    engagementId: "",
    extra: { payment_id: "pay_renewal" }
  });
  const paymentResult = await send(env, renewalPayment, "2026-11-13T10:05:00.000Z");
  assert.equal(paymentResult.status, 200);
  assert.equal(paymentResult.body.duplicatePayment, undefined, "a renewal payment is not a duplicate charge");
  const journaled = sqlite.prepare("SELECT type FROM engagement_events WHERE engagement_id = ? AND type = 'payment_recorded_renewal'").all(engagementId);
  assert.equal(journaled.length, 1);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM engagement_payments WHERE payment_id = 'pay_renewal'").get().n, 1);
});

test("subscription events go through the same signature and engagement guards", async () => {
  const { env, sqlite } = freshEnv();
  const engagementId = paidEngagement(sqlite, "care");
  const event = signedEvent({ type: "subscription.cancelled", subscriptionId: "sub_started", engagementId, extra: { next_billing_date: "2026-12-01T00:00:00.000Z" } });

  const unsigned = await worker.fetch(
    new Request("https://tinystudio.io/api/webhooks/dodo", { method: "POST", body: event.body, headers: { "content-type": "application/json" } }),
    env
  );
  assert.equal(unsigned.status, 400);
  assert.equal(sqlite.prepare("SELECT plan_status FROM engagements WHERE id = ?").get(engagementId).plan_status, "active", "an unsigned webhook changes nothing");

  const stranger = proposedEngagement(sqlite, "growth");
  const mismatched = signedEvent({ type: "subscription.renewed", webhookId: "wh_sub_mismatch", productId: PRODUCT_IDS.care, engagementId: stranger });
  const refused = await send(env, mismatched);
  assert.equal(refused.status, 400, "a care renewal may not keep a growth engagement alive");
  assert.deepEqual(refused.body, { error: "offer_mismatch" });

  const unknown = signedEvent({ type: "subscription.cancelled", webhookId: "wh_sub_unknown", subscriptionId: "sub_ghost", engagementId: "" });
  const missing = await send(env, unknown);
  assert.equal(missing.status, 409);
  assert.deepEqual(missing.body, { error: "engagement_unknown" });
});

test("subscription events reach the worker route and close a plan end to end", async () => {
  const { env, sqlite } = freshEnv();
  const engagementId = paidEngagement(sqlite, "care");
  const event = signedEvent({ type: "subscription.cancelled", webhookId: "wh_route_cancel", subscriptionId: "sub_started", engagementId, extra: { next_billing_date: "2026-12-01T00:00:00.000Z" } });
  const res = await worker.fetch(
    new Request("https://tinystudio.io/api/webhooks/dodo", { method: "POST", body: event.body, headers: { "content-type": "application/json", ...event.headers } }),
    env
  );
  assert.equal(res.status, 200);
  assert.equal(sqlite.prepare("SELECT plan_status FROM engagements WHERE id = ?").get(engagementId).plan_status, "cancelling");
});

test("a subscription started while the engagement is still proposed opens it", async () => {
  const { env, sqlite } = freshEnv();
  const engagementId = proposedEngagement(sqlite, "growth");
  const started = signedEvent({
    type: "subscription.active",
    webhookId: "wh_start_growth",
    productId: PRODUCT_IDS.growth,
    subscriptionId: "sub_growth",
    engagementId,
    extra: { next_billing_date: "2026-12-13T00:00:00.000Z" }
  });
  const result = await send(env, started);
  assert.equal(result.status, 200);
  const row = sqlite.prepare("SELECT * FROM engagements WHERE id = ?").get(engagementId);
  assert.equal(row.status, "paid");
  assert.equal(row.plan_status, "active");
  assert.equal(row.period_ends_at, "2026-12-13T00:00:00.000Z");
});

test("the subscription payload is read the way Dodo sends it", () => {
  const event = {
    type: "subscription.renewed",
    data: {
      subscription_id: "sub_9",
      product_id: "prod_care",
      currency: "USD",
      monthly_recurring_price: 29900,
      next_billing_date: "2026-12-13T00:00:00.000Z",
      metadata: { engagement_id: "e9", record_id: "r9", request_id: "q9" }
    }
  };
  const sub = extractDodoSubscription(event);
  assert.equal(sub.subscriptionId, "sub_9");
  assert.equal(sub.engagementId, "e9");
  assert.deepEqual(sub.productIds, ["prod_care"]);
  assert.equal(sub.amountCents, 29900);
  assert.equal(sub.nextBillingDate, "2026-12-13T00:00:00.000Z");
  assert.equal(paidProduct(sub, PLAN_ENV)?.productKey, "care");
  assert.equal(paidProduct({ productIds: ["prod_unknown"] }, PLAN_ENV), null);
  assert.equal(paidProduct({ productIds: [] }, PLAN_ENV), null);
  const payment = { paymentId: "pay_9", productIds: ["prod_care"], currency: "USD", amountCents: 29900 };
  assert.equal(paymentMatchesOffer(payment, PLAN_ENV), true);
  assert.equal(paymentMatchesOffer({ ...payment, amountCents: 14900 }, PLAN_ENV), false, "the care amount may not pay for growth");
  assert.equal(paymentMatchesOffer({ ...payment, productIds: ["prod_growth"] }, PLAN_ENV), false);
  assert.equal(paymentMatchesOffer({ ...payment, currency: "EUR" }, PLAN_ENV), false);
  assert.equal(paymentMatchesOffer({ ...payment, paymentId: "" }, PLAN_ENV), false);
});
