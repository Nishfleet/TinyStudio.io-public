import { openEngagement } from "./engagement.js";

const MAX_BODY_BYTES = 24000;
const TIMESTAMP_TOLERANCE_SECONDS = 300;
const REPORT_ID_LIMIT = 128;
const CONSENT_TEXT_LIMIT = 2000;

/** @param {Env} env */
function requestNowMs(env) {
  return env.APPRAISAL_NOW ? new Date(env.APPRAISAL_NOW).getTime() : Date.now();
}

/** @param {string} keyText @param {string} message @returns {Promise<string>} */
async function hmacSha256Hex(keyText, message) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(keyText),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return [...new Uint8Array(signature)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** @param {string} left @param {string} right */
function sameHex(left, right) {
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let index = 0; index < left.length; index += 1) {
    diff |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return diff === 0;
}

/** @param {unknown} body @param {number} status */
function jsonResponse(body, status) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

/** @param {unknown} value @param {number} limit */
function cleanText(value, limit) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, limit);
}

/** @param {unknown} email */
function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

/** @param {string} email */
function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254;
}

/** @param {unknown} value @returns {string | null} */
function normalizeWebsite(value) {
  if (typeof value !== "string") return null;
  const raw = value.trim().slice(0, 300);
  if (!raw) return null;
  const candidate = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    const parsed = new URL(candidate);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    if (!parsed.hostname.includes(".")) return null;
    return parsed.origin + (parsed.pathname === "/" ? "" : parsed.pathname);
  } catch {
    return null;
  }
}

/** @param {Request} request @returns {Promise<string>} */
async function readRawBody(request) {
  const contentLength = Number(request.headers.get("Content-Length") || 0);
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
    throw new Error("request_too_large");
  }
  const reader = request.body?.getReader();
  if (!reader) return "";
  const chunks = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BODY_BYTES) throw new Error("request_too_large");
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

/** @param {Env} env @param {string} email @returns {Promise<boolean>} */
async function rateLimited(env, email) {
  const { success } = await env.APPRAISAL_LIMITER.limit({ key: `seofixkit-email:${email}` });
  return !success;
}

/** @param {Request} request @param {Env} env @returns {Promise<Response>} */
export async function seofixkitRequestResponse(request, env) {
  if (request.method !== "POST") {
    return jsonResponse({ ok: false, error: "method_not_allowed" }, 405);
  }
  if (!env.SEOFIXKIT_REQUEST_SECRET) {
    console.warn("seofixkit_request_rejected", "secret_missing");
    return jsonResponse({ ok: false, error: "secret_missing" }, 503);
  }

  let rawBody;
  try {
    rawBody = await readRawBody(request);
  } catch {
    return jsonResponse({ ok: false, error: "request_too_large" }, 413);
  }

  const timestampHeader = (request.headers.get("X-TinyStudio-Timestamp") || "").trim();
  const signatureHeader = (request.headers.get("X-TinyStudio-Signature") || "").trim();
  /** @param {string} reason */
  const unauthorized = (reason) => {
    console.warn("seofixkit_request_rejected", reason);
    return jsonResponse({ ok: false, error: "unauthorized" }, 401);
  };
  if (!/^\d{1,13}$/.test(timestampHeader)) return unauthorized("timestamp_missing");
  const ageSeconds = Math.abs(requestNowMs(env) / 1000 - Number(timestampHeader));
  if (ageSeconds > TIMESTAMP_TOLERANCE_SECONDS) return unauthorized("timestamp_stale");
  const expectedSignature = `sha256=${await hmacSha256Hex(
    env.SEOFIXKIT_REQUEST_SECRET,
    `${timestampHeader}.${rawBody}`
  )}`;
  if (!sameHex(expectedSignature, signatureHeader)) return unauthorized("signature_invalid");

  let body;
  try {
    body = JSON.parse(rawBody || "{}");
  } catch {
    body = null;
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return jsonResponse({ ok: false, error: "invalid_request", fields: ["body"] }, 400);
  }
  const input = {
    website: normalizeWebsite(body.site),
    email: normalizeEmail(body.email),
    reportId: cleanText(body.reportId, REPORT_ID_LIMIT),
    consentText: cleanText(body.consentText, CONSENT_TEXT_LIMIT)
  };
  const fields = [];
  if (!input.website) fields.push("site");
  if (!isValidEmail(input.email)) fields.push("email");
  if (!input.reportId) fields.push("reportId");
  if (!input.consentText) fields.push("consentText");
  if (fields.length) {
    return jsonResponse({ ok: false, error: "invalid_request", fields }, 400);
  }

  try {
    if (await rateLimited(env, input.email)) {
      return jsonResponse({ ok: false, error: "rate_limited" }, 429);
    }

    /** @type {{ id: string } | null} */
    const existing = await env.DB.prepare(
      "SELECT id FROM appraisal_requests WHERE source = 'seofixkit' AND report_id = ?1 AND email = ?2"
    )
      .bind(input.reportId, input.email)
      .first();
    if (existing) {
      await openEngagement(env, existing.id, new Date(requestNowMs(env)).toISOString());
      return jsonResponse({ id: existing.id }, 202);
    }

    const id = crypto.randomUUID();
    const at = new Date(requestNowMs(env)).toISOString();
    const inserted = await env.DB.prepare(
      `INSERT OR IGNORE INTO appraisal_requests
         (id, site_url, business_type, avg_deal_value, monthly_leads, name, email, month, created_at, source, report_id, consent_text)
       VALUES (?1, ?2, 'seofixkit', 0, 0, '', ?3, 'seofixkit', ?4, 'seofixkit', ?5, ?6)`
    )
      .bind(id, input.website, input.email, at, input.reportId, input.consentText)
      .run();
    if (!Number(inserted.meta?.changes)) {
      /** @type {{ id: string } | null} */
      const raced = await env.DB.prepare(
        `SELECT id FROM appraisal_requests
          WHERE source = 'seofixkit' AND (report_id = ?1 OR (site_url = ?2 AND email = ?3 AND month = 'seofixkit'))
          ORDER BY created_at ASC, id ASC LIMIT 1`
      )
        .bind(input.reportId, input.website, input.email)
        .first();
      if (!raced) throw new Error("seofixkit request insert ignored with no existing row");
      await openEngagement(env, raced.id, at);
      return jsonResponse({ id: raced.id }, 202);
    }

    await env.DB.prepare(
      "INSERT INTO appraisal_events (request_id, type, detail, created_at) VALUES (?1, 'request_accepted', 'seofixkit', ?2)"
    )
      .bind(id, at)
      .run();
    await env.DB.prepare(
      "INSERT OR IGNORE INTO appraisal_audit_jobs (id, request_id, status, created_at) VALUES (?1, ?2, 'queued', ?3)"
    )
      .bind(crypto.randomUUID(), id, at)
      .run();
    await openEngagement(env, id, at);
    console.log("seofixkit_request_saved");
    return jsonResponse({ id }, 202);
  } catch (error) {
    console.warn("seofixkit_request_storage_failed", error instanceof Error ? error.message : "storage failed");
    return jsonResponse({ ok: false, error: "storage_unavailable" }, 503);
  }
}
