import offer from "../config/offer.json" with { type: "json" };
import { Webhook } from "standardwebhooks";
import { assertAllowedAction } from "./guardrails.js";
import { advanceEngagement, engagementById, engagementForRequest } from "./engagement.js";

const DODO_LIVE_URL = "https://live.dodopayments.com";
const DODO_TEST_URL = "https://test.dodopayments.com";
const DODO_TIMEOUT_MS = 12000;
const CHECKOUT_ORIGIN = "https://tinystudio.io";
const DODO_HOST_SUFFIX = ".dodopayments.com";

export const DODO_PAYMENT_SUCCESS_EVENTS = new Set(["payment.succeeded", "payment.completed", "payment.paid"]);
export const DODO_PAYMENT_FAILURE_EVENTS = new Set(["payment.failed", "payment.cancelled", "payment.canceled"]);

function dodoEnvironment(env = {}) {
  const mode = String(env.DODO_TINYSTUDIO_MODE || "").trim().toLowerCase();
  if (["live", "production", "prod"].includes(mode)) return "live";
  if (["test", "sandbox"].includes(mode)) return "test";
  return "";
}

function dodoBaseUrl(env = {}) {
  return dodoEnvironment(env) === "test" ? DODO_TEST_URL : DODO_LIVE_URL;
}

export function dodoConfigStatus(env = {}) {
  return {
    mode: dodoEnvironment(env) || "live",
    productId: Boolean(String(env.DODO_TINYSTUDIO_PRODUCT_ID || "").trim()),
    apiKey: Boolean(String(env.DODO_TINYSTUDIO_API_KEY || "").trim()),
    webhookSecret: Boolean(String(env.DODO_TINYSTUDIO_WEBHOOK_SECRET || "").trim())
  };
}

export const dodoWebhookReady = (env) => dodoConfigStatus(env).webhookSecret;

function checkoutHostAllowed(value) {
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "https:") return false;
    const host = parsed.hostname.toLowerCase();
    return host === "dodopayments.com" || host.endsWith(DODO_HOST_SUFFIX);
  } catch {
    return false;
  }
}

export function safeDodoCheckoutUrl(value) {
  const text = String(value || "").trim();
  return checkoutHostAllowed(text) ? text : "";
}

export function decodeWebhookSecret(secret) {
  const raw = String(secret || "").trim();
  if (!raw) return null;
  const body = raw.startsWith("whsec_") ? raw.slice(6) : raw;
  try {
    return Uint8Array.from(atob(body), (char) => char.charCodeAt(0));
  } catch {
    return new TextEncoder().encode(raw);
  }
}

export function verifyDodoWebhookSignature({ payload, webhookId, webhookTimestamp, webhookSignature, secret }) {
  const key = decodeWebhookSecret(secret);
  if (!key || !payload || !webhookId || !webhookSignature) return false;
  try {
    new Webhook(key, { format: "raw" }).verify(String(payload), {
      "webhook-id": webhookId,
      "webhook-timestamp": webhookTimestamp,
      "webhook-signature": webhookSignature
    });
    return true;
  } catch {
    return false;
  }
}

export function parseWebhookHeaders(headers) {
  const read = (name) => String(headers.get?.(name) ?? headers[name] ?? "").trim();
  return {
    webhookId: read("webhook-id"),
    webhookTimestamp: read("webhook-timestamp"),
    webhookSignature: read("webhook-signature")
  };
}

export function dodoEventType(event) {
  return String(event?.type || event?.event_type || "").trim().toLowerCase();
}

export function extractDodoPayment(event) {
  const data = event?.data && typeof event.data === "object" ? event.data : {};
  const metadata = data.metadata && typeof data.metadata === "object" ? data.metadata : {};
  const items = Array.isArray(data.product_cart) ? data.product_cart : [];
  return {
    paymentId: String(data.payment_id || data.id || "").trim(),
    checkoutSessionId: String(data.session_id || data.checkout_session_id || "").trim(),
    engagementId: String(metadata.engagement_id || "").trim(),
    recordId: String(metadata.record_id || "").trim(),
    requestId: String(metadata.request_id || "").trim(),
    customerEmail: String(data.customer_email || data.customer?.email || "").trim().toLowerCase(),
    productIds: items.map((item) => String(item?.product_id || "").trim()).filter(Boolean),
    amountCents: Number(data.total_amount ?? data.amount ?? data.payment_total) || 0,
    currency: String(data.currency || "USD").trim().toUpperCase(),
    status: String(data.status || data.payment_status || "succeeded").trim().toLowerCase()
  };
}

export function paymentMatchesOffer(payment, env) {
  const expected = String(env.DODO_TINYSTUDIO_PRODUCT_ID || "").trim();
  if (payment.currency && offer.currency && payment.currency !== offer.currency) return false;
  if (payment.amountCents && payment.amountCents < offer.priceCents) return false;
  if (expected && payment.productIds.length && !payment.productIds.includes(expected)) return false;
  return Boolean(payment.paymentId);
}

export async function webhookAlreadySeen(env, webhookId) {
  const row = await env.DB.prepare("SELECT status FROM dodo_webhook_events WHERE webhook_id = ?1").bind(webhookId).first();
  return row ?? null;
}

async function logWebhook(env, { webhookId, eventType, status, reason, payload, at }) {
  await env.DB.prepare(
    `INSERT INTO dodo_webhook_events (webhook_id, event_type, status, reason, payload, created_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6)
     ON CONFLICT(webhook_id) DO UPDATE SET event_type = excluded.event_type, status = excluded.status,
       reason = excluded.reason, payload = excluded.payload, created_at = excluded.created_at`
  )
    .bind(webhookId, eventType, status, reason || null, JSON.stringify(payload ?? null), at)
    .run();
}

async function recordPaymentRow(env, { payment, engagement, webhookId, at }) {
  await env.DB.prepare(
    `INSERT INTO engagement_payments (payment_id, engagement_id, webhook_id, product_id, amount_cents, currency, status, role, payload, created_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
     ON CONFLICT(payment_id) DO UPDATE SET status = excluded.status, webhook_id = excluded.webhook_id`
  )
    .bind(
      payment.paymentId,
      engagement.id,
      webhookId,
      payment.productIds[0] || "",
      payment.amountCents,
      payment.currency,
      payment.status,
      "correction",
      JSON.stringify(payment),
      at
    )
    .run();
}

export async function openEngagementFromPayment(env, { payment, at }) {
  assertAllowedAction("record_customer_payment");
  const engagementRow = payment.engagementId
    ? await engagementById(env, payment.engagementId)
    : null;
  if (!engagementRow) throw Object.assign(new Error("paid event for an engagement this worker cannot match"), { code: "engagement_unknown" });
  if (["paid", "in_correction", "proved", "tracking", "closed"].includes(engagementRow.status)) return engagementRow;
  if (engagementRow.status !== "proposed") {
    throw Object.assign(new Error(`payment for an engagement in state ${engagementRow.status}`), { code: "engagement_state" });
  }
  const advanced = await advanceEngagement(env, engagementRow, "paid", {
    type: "status_changed",
    detail: `payment ${payment.paymentId}`,
    at
  });
  if (payment.checkoutSessionId) {
    await env.DB.prepare("UPDATE engagements SET checkout_session_id = ?1, changed_at = ?2 WHERE id = ?3")
      .bind(payment.checkoutSessionId, at, advanced.id)
      .run();
  }
  return advanced;
}

export async function handleDodoWebhook(env, { rawBody, headers }, at = new Date().toISOString()) {
  if (!dodoWebhookReady(env)) {
    return { ok: false, status: 503, body: { error: "webhook_secret_missing" } };
  }
  const { webhookId, webhookTimestamp, webhookSignature } = parseWebhookHeaders(headers);
  if (!webhookId || !webhookTimestamp || !webhookSignature) {
    return { ok: false, status: 400, body: { error: "webhook_headers_missing" } };
  }
  const seen = await webhookAlreadySeen(env, webhookId);
  if (seen) {
    return { ok: true, status: 200, body: { received: true, duplicate: true, webhookStatus: seen.status } };
  }
  if (!verifyDodoWebhookSignature({ payload: rawBody, webhookId, webhookTimestamp, webhookSignature, secret: env.DODO_TINYSTUDIO_WEBHOOK_SECRET })) {
    await logWebhook(env, { webhookId, eventType: "unknown", status: "rejected", reason: "bad_signature", payload: null, at });
    return { ok: false, status: 401, body: { error: "signature_invalid" } };
  }

  let event;
  try {
    event = JSON.parse(rawBody);
  } catch {
    await logWebhook(env, { webhookId, eventType: "unknown", status: "rejected", reason: "bad_json", payload: null, at });
    return { ok: false, status: 400, body: { error: "body_invalid" } };
  }
  const eventType = dodoEventType(event);
  if (!DODO_PAYMENT_SUCCESS_EVENTS.has(eventType)) {
    await logWebhook(env, {
      webhookId,
      eventType,
      status: DODO_PAYMENT_FAILURE_EVENTS.has(eventType) ? "failed" : "ignored",
      reason: DODO_PAYMENT_FAILURE_EVENTS.has(eventType) ? "payment_failed" : "unhandled_event",
      payload: event,
      at
    });
    return { ok: true, status: 200, body: { received: true, ignored: true } };
  }

  const payment = extractDodoPayment(event);
  if (!paymentMatchesOffer(payment, env)) {
    await logWebhook(env, { webhookId, eventType, status: "rejected", reason: "offer_mismatch", payload: event, at });
    return { ok: false, status: 400, body: { error: "offer_mismatch" } };
  }
  try {
    const engagement = await openEngagementFromPayment(env, { payment, at });
    await recordPaymentRow(env, { payment, engagement, webhookId, at });
    await logWebhook(env, { webhookId, eventType, status: "processed", reason: null, payload: event, at });
    return { ok: true, status: 200, body: { received: true, engagementId: engagement.id, engagementStatus: engagement.status } };
  } catch (error) {
    const code = String(error?.code || "engagement_open_failed");
    const known = ["engagement_unknown", "engagement_state"].includes(code);
    await logWebhook(env, { webhookId, eventType, status: "failed", reason: String(error?.message || code), payload: event, at });
    return { ok: false, status: known ? 409 : 500, body: known ? { error: code } : { error: "engagement_open_failed" } };
  }
}

export async function createDodoCheckout(env, { recordId, requestId, engagementId, customerEmail }, fetchImpl = fetch) {
  assertAllowedAction("open_checkout_for_customer");
  const status = dodoConfigStatus(env);
  if (!status.productId || !status.apiKey) {
    throw Object.assign(new Error("Dodo checkout is not configured"), { code: "checkout_not_configured" });
  }
  const engagement = engagementId ? await engagementById(env, engagementId) : null;
  const response = await fetchImpl(`${dodoBaseUrl(env)}/checkouts`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${env.DODO_TINYSTUDIO_API_KEY}`
    },
    body: JSON.stringify({
      product_cart: [{ product_id: env.DODO_TINYSTUDIO_PRODUCT_ID, quantity: 1 }],
      return_url: `${CHECKOUT_ORIGIN}/records/${recordId || ""}?paid=1`,
      customer_email: customerEmail || undefined,
      metadata: {
        engagement_id: engagement?.id || "",
        record_id: recordId || "",
        request_id: requestId || engagement?.request_id || "",
        product_key: offer.productKey,
        source: "tinystudio.io"
      }
    }),
    signal: AbortSignal.timeout(DODO_TIMEOUT_MS)
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw Object.assign(new Error(payload?.message || "Dodo checkout could not be created"), {
      code: payload?.code || "dodo_checkout_rejected",
      status: response.status
    });
  }
  const checkoutUrl = safeDodoCheckoutUrl(payload.checkout_url || payload.payment_link || "");
  const sessionId = String(payload.session_id || payload.id || "").trim();
  if (!checkoutUrl || !sessionId) {
    throw Object.assign(new Error("Dodo returned no usable checkout"), { code: "dodo_checkout_url_invalid" });
  }
  return { checkoutUrl, sessionId };
}

export async function startCheckoutForRequest(env, { recordId }, at = new Date().toISOString(), fetchImpl = fetch) {
  const record = await env.DB.prepare("SELECT id, request_id FROM appraisal_records WHERE id = ?1").bind(recordId).first();
  if (!record) throw Object.assign(new Error("record not found"), { code: "record_not_found" });
  const engagement = await engagementForRequest(env, record.request_id);
  if (!engagement) throw Object.assign(new Error("engagement not found"), { code: "engagement_not_found" });
  if (engagement.status !== "proposed") {
    throw Object.assign(new Error("this engagement is not awaiting payment"), { code: "not_awaiting_payment" });
  }
  const request = await env.DB.prepare("SELECT email FROM appraisal_requests WHERE id = ?1").bind(record.request_id).first();
  const checkout = await createDodoCheckout(
    env,
    {
      recordId: record.id,
      requestId: record.request_id,
      engagementId: engagement.id,
      customerEmail: request?.email
    },
    fetchImpl
  );
  await env.DB.prepare("UPDATE engagements SET checkout_session_id = ?1, changed_at = ?2 WHERE id = ?3")
    .bind(checkout.sessionId, at, engagement.id)
    .run();
  await env.DB.prepare(
    "INSERT INTO engagement_events (engagement_id, request_id, type, from_status, to_status, detail, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)"
  )
    .bind(engagement.id, engagement.request_id, "checkout_session_created", "proposed", "proposed", `checkout session ${checkout.sessionId}`, at)
    .run();
  return checkout;
}
