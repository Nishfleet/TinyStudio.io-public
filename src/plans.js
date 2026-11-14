import offer from "../config/offer.json" with { type: "json" };
import { advanceEngagement, engagementById, setPlanState } from "./engagement.js";
import { ENGAGEMENT_SETTLED_STATUSES } from "./guardrails.js";

const CATALOG = new Map(offer.products.map((product) => [product.productKey, product]));

export const DEFAULT_PRODUCT_KEY = "website-correction";

/** @param {Env} env @returns {Map<string, string>} Dodo product id -> product key, one variable per product */
export function configuredProducts(env) {
  const ids = new Map();
  for (const [productKey, variable] of Object.entries(PRODUCT_ID_VARIABLES)) {
    const settings = /** @type {Record<string, unknown>} */ (/** @type {unknown} */ (env));
    const productId = String(settings?.[variable] || "").trim();
    if (productId) ids.set(productId, productKey);
  }
  return ids;
}

const PRODUCT_ID_VARIABLES = {
  "repair-small": "DODO_TINYSTUDIO_REPAIR_SMALL_PRODUCT_ID",
  "repair-medium": "DODO_TINYSTUDIO_REPAIR_MEDIUM_PRODUCT_ID",
  "repair-large": "DODO_TINYSTUDIO_REPAIR_LARGE_PRODUCT_ID",
  care: "DODO_TINYSTUDIO_CARE_PRODUCT_ID",
  growth: "DODO_TINYSTUDIO_GROWTH_PRODUCT_ID",
  "website-correction": "DODO_TINYSTUDIO_PRODUCT_ID"
};

/** @param {string | null | undefined} productKey @returns {typeof offer.products[number] | null} the catalog product the key names, or null */
export function productByKey(productKey) {
  return CATALOG.get(String(productKey || "").trim()) ?? null;
}

/** @param {string} productKey @returns {string} the env variable that holds the Dodo product id for this product */
export function productIdVariable(productKey) {
  const variables = /** @type {Record<string, string>} */ (PRODUCT_ID_VARIABLES);
  return variables[String(productKey || "").trim()] || "";
}

/** @param {{ productIds?: string[] }} payment @param {Env} env @returns {typeof offer.products[number] | null} the one catalog product the payment bought, or null */
export function paidProduct(payment, env) {
  const byId = configuredProducts(env);
  const keys = new Set((payment?.productIds || []).map((id) => byId.get(String(id).trim())).filter(Boolean));
  if (keys.size !== 1) return null;
  const [productKey] = keys;
  return productKey ? CATALOG.get(productKey) ?? null : null;
}

/** @param {Env} env @param {string} subscriptionId @returns {Promise<EngagementRow | null>} */
export async function engagementForSubscription(env, subscriptionId) {
  if (!subscriptionId) return null;
  /** @type {EngagementRow | null} */
  const row = await env.DB.prepare("SELECT * FROM engagements WHERE subscription_id = ?1").bind(subscriptionId).first();
  return row ?? null;
}

/** @param {unknown} event */
export function extractDodoSubscription(event) {
  const raw = /** @type {{ data?: DodoSubscriptionData | null }} | null | undefined */ (event);
  /** @type {DodoSubscriptionData} */
  const data = raw?.data && typeof raw.data === "object" ? raw.data : {};
  /** @type {Record<string, unknown>} */
  const metadata = data.metadata && typeof data.metadata === "object" ? data.metadata : {};
  const items = Array.isArray(data.product_cart) ? data.product_cart : [];
  const productIds = [...items.map((item) => String(item?.product_id || "").trim()), String(data.product_id || "").trim()]
    .filter(Boolean)
    .filter((id, index, all) => all.indexOf(id) === index);
  return {
    subscriptionId: String(data.subscription_id || "").trim(),
    engagementId: String(metadata.engagement_id || "").trim(),
    recordId: String(metadata.record_id || "").trim(),
    requestId: String(metadata.request_id || "").trim(),
    productIds,
    currency: String(data.currency || "").trim().toUpperCase(),
    amountCents: Number(data.monthly_recurring_price ?? data.total_amount ?? data.amount) || 0,
    nextBillingDate: String(data.next_billing_date || "").trim(),
    pastDueEndsAt: String(data.past_due_ends_at || "").trim(),
    cancelledAt: String(data.cancelled_at || "").trim()
  };
}

/** @param {Pick<EngagementRow, "product_key">} engagement */
export function engagementProductKey(engagement) {
  return String(engagement?.product_key || DEFAULT_PRODUCT_KEY);
}

/** @param {Env} env @param {EngagementRow} row @param {EngagementRow} engagement @param {typeof offer.products[number]} product @param {{ subscriptionId?: string }} payment @param {string} at */
export async function applyPaidProduct(env, row, engagement, product, payment, at) {
  const subscriptionId = String(payment?.subscriptionId || "").trim() || row.subscription_id || null;
  if (product.billing === "monthly") {
    const updated = await setPlanState(env, row, {
      planStatus: "active",
      subscriptionId,
      productKey: product.productKey,
      type: "plan_started",
      detail: `${product.productKey} subscription ${subscriptionId || "pending"}`
    }, at);
    return { ...engagement, product_key: updated.product_key, subscription_id: updated.subscription_id, plan_status: updated.plan_status, period_ends_at: updated.period_ends_at };
  }
  if (!String(row.product_key || "").trim()) {
    const updated = await setPlanState(env, row, { productKey: product.productKey, type: "product_named", detail: product.productKey, journal: false }, at);
    return { ...engagement, product_key: updated.product_key };
  }
  return engagement;
}

/** @param {Env} env @param {EngagementRow} row @param {string} eventType @param {{ subscriptionId?: string }} sub @param {string} at */
async function advanceMonthlyEngagement(env, row, eventType, sub, at) {
  if (row.status !== "proposed") return row;
  return advanceEngagement(env, row, "paid", { type: "status_changed", detail: `${eventType} ${sub.subscriptionId}`, at });
}

export const DODO_SUBSCRIPTION_ACTIVE_EVENTS = new Set(["subscription.active", "subscription.renewed"]);
export const DODO_SUBSCRIPTION_CLOSED_EVENTS = new Set(["subscription.cancelled", "subscription.expired"]);
export const DODO_SUBSCRIPTION_FAILED_EVENTS = new Set(["subscription.past_due", "subscription.on_hold"]);
export const DODO_SUBSCRIPTION_EVENTS = new Set([
  ...DODO_SUBSCRIPTION_ACTIVE_EVENTS,
  ...DODO_SUBSCRIPTION_CLOSED_EVENTS,
  ...DODO_SUBSCRIPTION_FAILED_EVENTS
]);

/** @description Handles the Dodo subscription lifecycle for a monthly plan; the signature is already verified and the webhook id already deduplicated when this runs. A closing or failing event only lands on an engagement that is settled or whose plan is already active, so a bare proposal cannot be closed or marked past due by a subscription event it never answered. @param {Env} env @param {{ event: unknown, eventType: string, webhookId: string }} input @param {string} at @returns {Promise<{ ok: boolean, status: number, body: Record<string, unknown>, log: { status: string, reason: string | null } | null }>} */
export async function handleSubscriptionWebhook(env, { event, eventType, webhookId }, at = new Date().toISOString()) {
  const sub = extractDodoSubscription(event);
  const row = (sub.engagementId ? await engagementById(env, sub.engagementId) : null) ?? (await engagementForSubscription(env, sub.subscriptionId));
  if (!row) {
    return { ok: false, status: 409, body: { error: "engagement_unknown" }, log: { status: "failed", reason: "engagement_unknown" } };
  }
  const product = paidProduct(sub, env);
  if (!product || product.productKey !== engagementProductKey(row) || (sub.currency && sub.currency !== offer.currency)) {
    console.warn("tinystudio_subscription_offer_mismatch", JSON.stringify({ webhookId, engagementId: row.id, productIds: sub.productIds }));
    return { ok: false, status: 400, body: { error: "offer_mismatch" }, log: { status: "rejected", reason: "offer_mismatch" } };
  }
  const renewal = DODO_SUBSCRIPTION_ACTIVE_EVENTS.has(eventType);
  if (renewal && sub.amountCents > 0 && sub.amountCents < product.priceCents) {
    return { ok: false, status: 400, body: { error: "offer_mismatch" }, log: { status: "rejected", reason: "offer_mismatch" } };
  }
  const openedOrSettled = ENGAGEMENT_SETTLED_STATUSES.includes(row.status) || row.plan_status === "active";

  if (renewal) {
    await advanceMonthlyEngagement(env, row, eventType, sub, at);
    const updated = await setPlanState(env, row, {
      planStatus: "active",
      subscriptionId: sub.subscriptionId || row.subscription_id || null,
      periodEndsAt: sub.nextBillingDate || row.period_ends_at || null,
      type: eventType === "subscription.renewed" ? "plan_renewed" : "plan_started",
      detail: `${product.productKey} renews through ${sub.nextBillingDate || "an unknown date"}`
    }, at);
    return { ok: true, status: 200, body: { received: true, engagementId: row.id, planStatus: updated.plan_status }, log: { status: "processed", reason: null } };
  }

  if (DODO_SUBSCRIPTION_FAILED_EVENTS.has(eventType)) {
    if (!openedOrSettled) {
      return { ok: false, status: 409, body: { error: "engagement_state" }, log: { status: "failed", reason: "engagement_state" } };
    }
    await setPlanState(env, row, {
      planStatus: "past_due",
      subscriptionId: sub.subscriptionId || row.subscription_id || null,
      periodEndsAt: sub.pastDueEndsAt || sub.nextBillingDate || row.period_ends_at || null,
      type: "plan_payment_failed",
      detail: `${product.productKey} payment failed; the provider retries until ${sub.pastDueEndsAt || sub.nextBillingDate || "the period ends"}`
    }, at);
    return { ok: true, status: 200, body: { received: true, engagementId: row.id, planStatus: "past_due" }, log: { status: "failed", reason: "subscription_payment_failed" } };
  }

  if (!openedOrSettled) {
    return { ok: false, status: 409, body: { error: "engagement_state" }, log: { status: "failed", reason: "engagement_state" } };
  }
  const periodEnd = sub.cancelledAt || sub.nextBillingDate || at;
  const endedNow = Date.parse(periodEnd) <= Date.parse(at) || eventType === "subscription.expired";
  if (endedNow) {
    await setPlanState(env, row, {
      planStatus: "closed",
      subscriptionId: sub.subscriptionId || row.subscription_id || null,
      periodEndsAt: periodEnd,
      type: "plan_closed",
      detail: `${product.productKey} closed at period end ${periodEnd}`
    }, at);
    return { ok: true, status: 200, body: { received: true, engagementId: row.id, planStatus: "closed" }, log: { status: "processed", reason: null } };
  }
  await setPlanState(env, row, {
    planStatus: "cancelling",
    subscriptionId: sub.subscriptionId || row.subscription_id || null,
    periodEndsAt: periodEnd,
    type: "plan_cancelling",
    detail: `${product.productKey} runs to period end ${periodEnd}`
  }, at);
  return { ok: true, status: 200, body: { received: true, engagementId: row.id, planStatus: "cancelling", periodEndsAt: periodEnd }, log: { status: "processed", reason: null } };
}

/** @param {Env} env @param {Date} now */
export async function closeDuePlans(env, now) {
  const at = now.toISOString();
  /** @type {D1Result<EngagementRow>} */
  const due = await env.DB.prepare(
    "SELECT * FROM engagements WHERE plan_status = 'cancelling' AND period_ends_at IS NOT NULL AND period_ends_at <= ?1 LIMIT 200"
  )
    .bind(at)
    .all();
  for (const row of due.results ?? []) {
    await setPlanState(env, row, { planStatus: "closed", type: "plan_closed", detail: `period ended ${row.period_ends_at}` }, at);
  }
  console.log("tinystudio_plans_closed", (due.results ?? []).length);
  return (due.results ?? []).length;
}
