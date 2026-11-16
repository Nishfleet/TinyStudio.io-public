import { RECORD_ID } from "./record.js";
import { engagementAllows } from "./guardrails.js";
import {
  correctionLineById,
  correctionLines,
  decideCorrectionLine,
  engagementByRecordId
} from "./engagement.js";
import { settleCorrectionLines } from "./settle.js";

const RECORD_LINES_ROUTE = /^\/api\/records\/([0-9a-f-]+)\/lines(?:\/([0-9a-f-]+))?$/;

/** @type {Record<string, string>} */
const DECISION_MESSAGES = {
  approve: "Approved. The line is ready to apply.",
  edit: "Your wording went back to the reviewer.",
  skip: "Skipped. We leave that change alone."
};

const SECURITY_HEADERS = {
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=()",
  "Content-Security-Policy":
    "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'"
};

const PAGE_CSP = "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'";

/** @type {Record<string, string>} */
const HTML_ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

/** @param {unknown} value */
function esc(value) {
  return String(value).replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]);
}

/** @param {unknown} value @param {number} [limit] */
function cleanField(value, limit = 4000) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, limit);
}

/** @param {unknown} error */
function errorCode(error) {
  return error instanceof Error && "code" in error && typeof error.code === "string" ? error.code : "";
}

/** @param {unknown} body @param {ResponseInit & { headers?: Record<string, string> }} [init] */
function jsonResponse(body, init = {}) {
  return withSecurityHeaders(
    Response.json(body, {
      ...init,
      headers: { "Cache-Control": "no-store", ...(init.headers || {}) }
    })
  );
}

/** @param {Response} response @param {string} [contentSecurityPolicy] */
function withSecurityHeaders(response, contentSecurityPolicy) {
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(SECURITY_HEADERS)) {
    headers.set(key, key === "Content-Security-Policy" && contentSecurityPolicy ? contentSecurityPolicy : value);
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

/** @param {Request} request @param {URL} url */
function isSameOriginPost(request, url) {
  if (request.headers.get("Sec-Fetch-Site") === "cross-site") return false;
  /** @param {string} value */
  const allowed = (value) => value === url.origin;
  const origin = request.headers.get("Origin");
  if (origin) return allowed(origin);
  const referer = request.headers.get("Referer");
  if (!referer) return false;
  try {
    return allowed(new URL(referer).origin);
  } catch {
    return false;
  }
}

/** @param {Request} request */
function prefersHtmlDocument(request) {
  const mode = String(request.headers?.get?.("sec-fetch-mode") || "").toLowerCase();
  if (mode === "navigate") return true;
  const accept = String(request.headers?.get?.("accept") || "").toLowerCase();
  return accept.includes("text/html");
}

/** @param {Request} request @returns {Promise<string>} */
async function readTextBodyWithLimit(request) {
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 24000) throw new Error("request_too_large");
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

/** @param {string} recordId @param {string} message @param {number} [status] */
function decisionPage(recordId, message, status = 200) {
  const body = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<meta http-equiv="refresh" content="0; url=/records/${esc(recordId)}">
<title>Record decision | TinyStudio</title>
<style>body{font:16px/1.6 Georgia,serif;max-width:42rem;margin:2rem auto;padding:0 1rem}</style>
</head>
<body>
<main>
<p>${esc(message)}</p>
<p><a href="/records/${esc(recordId)}">Back to your record</a></p>
</main>
</body>
</html>
`;
  return withSecurityHeaders(
    new Response(body, {
      status,
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
        "x-robots-tag": "noindex, nofollow"
      }
    }),
    PAGE_CSP
  );
}

/** @param {EngagementRow} engagement */
function assertCustomerCanDecide(engagement) {
  if (!engagementAllows(engagement, "decide_correction_line")) {
    throw Object.assign(new Error("the customer decides lines while the correction is in progress"), {
      code: "NOT_IN_CORRECTION"
    });
  }
}

/** @param {Env} env @param {{ recordId: string, lineId: string, decision: string, text?: string }} input @param {string} at @returns {Promise<{ engagement: EngagementRow, line: CorrectionLineRow, message: string }>} */
export async function decideCustomerLine(env, input, at) {
  const engagement = await engagementByRecordId(env, input.recordId);
  if (!engagement) throw Object.assign(new Error("no engagement carries this record"), { code: "NOT_FOUND" });
  assertCustomerCanDecide(engagement);
  const line = await correctionLineById(env, input.lineId);
  if (!line || line.engagement_id !== engagement.id) {
    throw Object.assign(new Error("correction line not found"), { code: "NOT_FOUND" });
  }
  const alreadyDecided =
    (input.decision === "approve" && (line.status === "approved" || line.status === "recorded")) ||
    (input.decision === "skip" && line.status === "skipped");
  let decided = line;
  let message = DECISION_MESSAGES[input.decision];
  if (alreadyDecided) {
    message = input.decision === "approve" ? "Already approved." : "Already skipped.";
  } else {
    decided = await decideCorrectionLine(env, line, input.decision, { text: input.text }, at);
  }
  const current = await settleCorrectionLines(env, engagement, at, { republish: true });
  const stored = await correctionLineById(env, input.lineId);
  return { engagement: current, line: stored ?? decided, message };
}

/** @param {Env} env @param {{ recordId: string, decision: string }} input @param {string} at @returns {Promise<{ engagement: EngagementRow, line: CorrectionLineRow, count: number, message: string }>} */
export async function approveAllCustomerLines(env, input, at) {
  if (input.decision !== "approve-all") {
    throw Object.assign(new Error("unknown customer decision"), { code: "BAD_DECISION" });
  }
  const engagement = await engagementByRecordId(env, input.recordId);
  if (!engagement) throw Object.assign(new Error("no engagement carries this record"), { code: "NOT_FOUND" });
  assertCustomerCanDecide(engagement);
  const pending = (await correctionLines(env, engagement.id)).filter((row) => row.status === "proposed");
  if (!pending.length) {
    throw Object.assign(new Error("no correction line waits for the customer"), { code: "NOTHING_PENDING" });
  }
  let line = null;
  for (const row of pending) line = await decideCorrectionLine(env, row, "approve", {}, at);
  if (!line) throw Object.assign(new Error("no correction line waits for the customer"), { code: "NOTHING_PENDING" });
  const current = await settleCorrectionLines(env, engagement, at, { republish: true });
  return {
    engagement: current,
    line,
    count: pending.length,
    message: `Approved ${pending.length} ${pending.length === 1 ? "line" : "lines"}.`
  };
}

/** @param {Request} request @param {Env} env @param {URL} url */
export async function customerDecisionResponse(request, env, url) {
  if (request.method !== "POST") {
    return jsonResponse({ ok: false, error: "method_not_allowed" }, { status: 405 });
  }
  const match = url.pathname.match(RECORD_LINES_ROUTE);
  const recordId = match?.[1] ?? "";
  const lineId = match?.[2] ?? "";
  if (!match || !RECORD_ID.test(recordId) || (lineId && !RECORD_ID.test(lineId))) {
    return jsonResponse({ ok: false, error: "not_found" }, { status: 404 });
  }
  if (!isSameOriginPost(request, url)) {
    return jsonResponse({ ok: false, error: "cross_site_blocked" }, { status: 403 });
  }
  const at = new Date().toISOString();
  const browserForm = prefersHtmlDocument(request);
  let form;
  try {
    form = new URLSearchParams(await readTextBodyWithLimit(request));
  } catch {
    return jsonResponse({ ok: false, error: "request_too_large" }, { status: 413 });
  }
  const decision = cleanField(form.get("decision"), 16);
  try {
    const result = lineId
      ? await decideCustomerLine(env, { recordId, lineId, decision, text: cleanField(form.get("text"), 4000) }, at)
      : await approveAllCustomerLines(env, { recordId, decision }, at);
    /** @type {Record<string, unknown>} */
    const payload = { ok: true, engagementStatus: result.engagement.status, lineStatus: result.line.status };
    if ("count" in result) payload.count = result.count;
    return browserForm ? decisionPage(recordId, result.message) : jsonResponse(payload);
  } catch (error) {
    const code = errorCode(error) || "customer_decision_failed";
    const status = code === "NOT_FOUND" ? 404 : 400;
    return browserForm
      ? decisionPage(recordId, `Not recorded: ${code}`, status)
      : jsonResponse({ ok: false, error: code }, { status });
  }
}
