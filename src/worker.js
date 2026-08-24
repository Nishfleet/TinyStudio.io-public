const SECURITY_HEADERS = {
  // Verified missing on the live host before adding: HTTPS already works on
  // tinystudio.io, www, and app, so a year-long max-age with subdomains is safe.
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=()",
  "Content-Security-Policy":
    "default-src 'self'; img-src 'self' data:; style-src 'self' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; script-src 'self' https://static.cloudflareinsights.com; connect-src 'self' https://cloudflareinsights.com; base-uri 'self'; frame-ancestors 'none'; form-action 'self'"
};

// Page-scoped CSP for /brief-requested ONLY when the Google Ads conversion
// tag is configured. gtag.js loads from googletagmanager.com and beacons to
// Google's measurement endpoints; the global CSP above blocks both, which
// made even a real conversion id dead on arrival. The allowances are scoped
// to this one noindex page's response so every other page keeps the strict
// CSP. Only reachable when GOOGLE_ADS_CONVERSION_ID / _LABEL are configured
// (see googleAdsConversion below); when they are not, the page ships with
// the strict CSP and no tag at all.
const GOOGLE_ADS_CSP =
  "default-src 'self'; img-src 'self' data: https://www.googleadservices.com; style-src 'self' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; script-src 'self' https://static.cloudflareinsights.com https://www.googletagmanager.com; connect-src 'self' https://cloudflareinsights.com https://www.googletagmanager.com https://googleads.g.doubleclick.net https://www.googleadservices.com https://www.google-analytics.com https://stats.g.doubleclick.net; base-uri 'self'; frame-ancestors 'none'; form-action 'self'";

const PUBLIC_ASSET_PATHS = new Set([
  "/",
  "/index.html",
  // Leak-audit site. Extensionless twins are listed because the signup
  // redirect targets /brief-requested and Cloudflare serves the .html for it.
  "/audit.html",
  "/audit",
  "/agents.html",
  "/agents",
  "/pricing.html",
  "/pricing",
  "/specimen.html",
  "/specimen",
  // MSP/IT buyer-intent surface for The Website Appraisal. Extensionless twin
  // is listed because the signup redirect and nav link to the clean form.
  "/msp.html",
  "/msp",
  "/brief-requested.html",
  "/brief-requested",
  "/shared.css",
  "/index.css",
  "/index.js",
  "/audit.css",
  "/audit.js",
  "/agents.css",
  "/agents.js",
  "/pricing.css",
  "/pricing.js",
  "/specimen.css",
  "/specimen.js",
  "/msp.css",
  "/msp.js",
  "/brief-requested.css",
  "/brief-requested.js",
  // Same-origin font promotion for the non-blocking Google Fonts stylesheet
  // (render-blocking fix b8f6046e942a). The production CSP forbids inline
  // onload handlers, so public/fonts.js promotes the preloaded css2 URL.
  "/fonts.js",
  // The Agent Desk, now the engine behind the free brief rather than the product.
  "/agent-desk.html",
  "/agent-desk",
  "/styles.css",
  "/script.js",
  "/favicon.svg",
  // Legacy /favicon.ico fallback. Browsers, search-engine crawlers, and
  // screenshot services still hit /favicon.ico even when every page declares
  // <link rel="icon">. /favicon.svg is the canonical asset; we serve its
  // bytes at the .ico path below so the request stops 404-ing. Without this,
  // public/favicon.ico is not in the asset bucket and isAssetLikePath would
  // return asset_not_found for the path.
  "/favicon.ico",
  "/apple-touch-icon.png",
  "/og-image.png",
  "/robots.txt",
  "/sitemap.xml",
  "/llms.txt",
  "/offer.md"
]);

const STALE_PUBLIC_PATHS = new Set([
  "/pipeline-sprint/",
  "/pipeline-sprint/index.html"
]);

const ALLOWED_ORIGINS = new Set([
  "https://tinystudio.io",
  "https://www.tinystudio.io",
  "http://127.0.0.1:8788",
  "http://localhost:8788"
]);
const AGENT_MODELS = [
  "@cf/mistralai/mistral-small-3.1-24b-instruct",
  "@cf/qwen/qwen3-30b-a3b-fp8",
  "@cf/openai/gpt-oss-20b",
  "@cf/meta/llama-3.2-3b-instruct"
];
const AGENT_SECTION_HEADINGS = {
  pipelineBrief: "Pipeline Brief",
  implementationChecklist: "Implementation Checklist",
  weeklyFixReport: "Weekly Fix Report"
};
const MAX_FIELD_LENGTH = 1800;
const MAX_REQUEST_BYTES = 24000;
const SOFT_AGENT_RUNS_PER_EMAIL_PER_DAY = 5;
const MAX_AGENT_RUNS_PER_IP_PER_DAY = 20;
// Public promise: "Six a month. When the sixth is taken, the intake closes
// until the next." (homepage, /audit, /pricing, /agents, llms.txt). The
// signup endpoint must honor it: the sixth valid signup in a calendar month
// is accepted, and any further POST in the same month gets a truthful
// closed-intake response instead of a normal success.
const MAX_APPRAISALS_PER_MONTH = 6;
// The current product's public intake (homepage and /audit) posts to
// /api/signups. Its rows and the public /health surface must be labeled with
// the current offer — The Website Appraisal — never the retired self-serve
// Agent Desk, which keeps its own "agent-self-serve" labels on the legacy
// /api/agent-audit path.
const APPRAISAL_SURFACE = "website-appraisal";
const CURRENCY_AMOUNT_PATTERN = String.raw`(?:(?:₹|\$|€|£|inr|usd|us\$|aud|cad|sgd|gbp|eur|rs\.?|rupees?)\s*\d[\d,.]*(?:\s*(?:k|lakh|lakhs|l|cr))?|\d[\d,.]*\s*(?:inr|usd|aud|cad|sgd|gbp|eur|rupees?))`;
const METRIC_VALUE_PATTERN = String.raw`(?:${CURRENCY_AMOUNT_PATTERN}|\b\d[\d,.]*\b)`;
const WEEKLY_METRIC_LABELS = [
  "Spend",
  "Raw leads",
  "Qualified leads",
  "Booked calls",
  "Showed calls",
  "Closed deals",
  "Cash collected"
];

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

function jsonResponse(body, init = {}) {
  return withSecurityHeaders(
    Response.json(body, {
      ...init,
      headers: {
        "Cache-Control": "no-store",
        ...(init.headers || {})
      }
    })
  );
}

function cleanHeader(value, limit = 320) {
  return value ? value.slice(0, limit) : "";
}

function cleanField(value, limit = MAX_FIELD_LENGTH) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, limit);
}

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254;
}

async function readRequestBody(request) {
  const contentType = request.headers.get("Content-Type") || "";

  if (contentType.includes("application/json")) {
    try {
      return await readJsonBody(request);
    } catch (error) {
      if (error.message === "request_too_large") throw error;
      return {};
    }
  }

  if (contentType.includes("application/x-www-form-urlencoded")) {
    const text = await readTextBodyWithLimit(request);
    return Object.fromEntries(new URLSearchParams(text).entries());
  }

  const formData = await request.formData().catch(() => null);
  if (!formData) return {};

  const body = {};
  for (const [key, value] of formData.entries()) {
    body[key] = value;
  }
  return body;
}

async function readTextBodyWithLimit(request) {
  if (!request.body) return "";

  const reader = request.body.getReader();
  const chunks = [];
  let size = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_REQUEST_BYTES) {
      throw new Error("request_too_large");
    }
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

async function readJsonBody(request) {
  const text = await readTextBodyWithLimit(request);
  return text ? JSON.parse(text) : {};
}

function requestTooLarge(request) {
  const contentLength = Number(request.headers.get("Content-Length") || 0);
  return Number.isFinite(contentLength) && contentLength > MAX_REQUEST_BYTES;
}

function isLoopbackHostname(hostname) {
  return hostname === "127.0.0.1" || hostname === "localhost";
}

function hostHeaderHostname(request) {
  return String(request.headers.get("Host") || "").split(":")[0].toLowerCase();
}

function isLocalPreviewRequest(request, requestUrl) {
  return isLoopbackHostname(requestUrl.hostname) || isLoopbackHostname(hostHeaderHostname(request));
}

function isAllowedOrigin(origin, request, requestUrl) {
  if (!origin) return false;
  if (ALLOWED_ORIGINS.has(origin)) return true;

  return isLocalPreviewRequest(request, requestUrl) && /^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(origin);
}

function validateAgentRequest(request) {
  const contentType = request.headers.get("Content-Type") || "";
  const origin = request.headers.get("Origin");
  const requestUrl = new URL(request.url);
  if (origin && !isAllowedOrigin(origin, request, requestUrl)) {
    return jsonResponse({ ok: false, error: "cross_site_blocked" }, { status: 403 });
  }

  if (request.headers.get("Sec-Fetch-Site") === "cross-site") {
    return jsonResponse({ ok: false, error: "cross_site_blocked" }, { status: 403 });
  }

  if (contentType.includes("application/json")) {
    return null;
  }

  if (contentType.includes("application/x-www-form-urlencoded") && origin && isAllowedOrigin(origin, request, requestUrl)) {
    return null;
  }

  if (contentType.includes("application/x-www-form-urlencoded")) {
    return jsonResponse({ ok: false, error: "same_origin_required" }, { status: 403 });
  }

  return jsonResponse({ ok: false, error: "unsupported_media_type" }, { status: 415 });
}

function wantsHtmlRedirect(request) {
  const accept = request.headers.get("Accept") || "";
  const contentType = request.headers.get("Content-Type") || "";
  return accept.includes("text/html") && !contentType.includes("application/json");
}

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

function htmlRedirect(url, signal) {
  const nextUrl = new URL(url);
  if (signal === "saved") {
    // Success lands on the thank-you page, which is the only page that fires
    // the Google Ads conversion. A no-JS browser must reach it too, or it
    // converts silently and untracked.
    nextUrl.pathname = "/brief-requested";
    nextUrl.search = "";
  } else {
    nextUrl.pathname = "/";
    nextUrl.search = `?signal=${encodeURIComponent(signal)}`;
  }
  return withSecurityHeaders(Response.redirect(nextUrl.toString(), 303));
}

// Truthful closed-intake page for the monthly "six a month" cap. The form
// posts with Accept: text/html, so a redirect would need homepage machinery
// to render; a self-contained response (the same pattern as the retired-host
// pages) tells the visitor the truth in place, with no JS and no new asset.
function closedIntakeResponse() {
  return withSecurityHeaders(
    new Response(
      `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>TinyStudio — The intake is closed</title>
    <style>
      body{margin:0;min-height:100vh;display:grid;place-items:center;background:#fffdf7;color:#171713;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
      main{width:min(720px,calc(100% - 40px));padding:48px;border:1px solid rgba(23,23,19,.14);border-radius:8px;background:#fff}
      h1{margin:0;font-size:clamp(34px,6vw,60px);line-height:1.05;letter-spacing:0}
      p{color:#57534b;font-size:18px;line-height:1.55}
      a{display:inline-flex;align-items:center;min-height:46px;padding:0 16px;border-radius:8px;background:#171713;color:#fffdf7;font-weight:800;text-decoration:none}
    </style>
  </head>
  <body>
    <main>
      <h1>The six appraisals for this month are taken.</h1>
      <p>Six a month, done by hand. When the sixth is taken, the intake closes until the next — and it is closed now. The form on the homepage will accept requests again on the first of next month.</p>
      <a href="https://tinystudio.io/">Back to TinyStudio.io</a>
    </main>
  </body>
</html>`,
      {
        status: 409,
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "no-store"
        }
      }
    )
  );
}

function signupPagePath(request, fallback) {
  const referer = request.headers.get("Referer");

  if (!referer) return fallback;

  try {
    const refererUrl = new URL(referer);
    return refererUrl.pathname || fallback;
  } catch {
    return fallback;
  }
}

async function saveEmailSignup(request, env, url, email, source, website = null) {
  const now = new Date().toISOString();

  await env.DB.prepare(
    `INSERT INTO email_signups (email, source, page_path, referer, user_agent, created_at, updated_at, website)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(email) DO UPDATE SET
       source = excluded.source,
       website = COALESCE(excluded.website, email_signups.website),
       page_path = excluded.page_path,
       referer = excluded.referer,
       user_agent = excluded.user_agent,
       updated_at = excluded.updated_at`
  )
    .bind(
      email,
      source,
      signupPagePath(request, url.pathname),
      cleanHeader(request.headers.get("Referer"), 500),
      cleanHeader(request.headers.get("User-Agent"), 500),
      now,
      now,
      website
    )
    .run();
}

async function signupResponse(request, env, url) {
  if (request.method === "OPTIONS") {
    return jsonResponse({ ok: true });
  }

  if (request.method !== "POST") {
    return jsonResponse({ ok: false, error: "method_not_allowed" }, { status: 405 });
  }

  if (requestTooLarge(request)) {
    return jsonResponse({ ok: false, error: "request_too_large" }, { status: 413 });
  }

  let body;
  try {
    body = await readRequestBody(request);
  } catch (error) {
    if (error.message === "request_too_large") {
      return jsonResponse({ ok: false, error: "request_too_large" }, { status: 413 });
    }
    body = {};
  }
  const email = normalizeEmail(body.email);
  const website = normalizeWebsite(body.website);

  if (!isValidEmail(email)) {
    if (wantsHtmlRedirect(request)) {
      return htmlRedirect(url, "invalid");
    }
    return jsonResponse({ ok: false, error: "invalid_email" }, { status: 400 });
  }

  // Monthly intake cap (the "six a month" promise). The bucket key uses the
  // calendar month so the counter resets naturally on the first of the next
  // month; the increment is the reservation, so the sixth request passes and
  // every request after it in the same month is told the truth: the intake
  // is closed until the next. The counter write is a storage operation, so a
  // missing or broken D1 must fail closed (503), never accept the signup.
  let monthCount;
  try {
    const monthBucket = `signup:${new Date().toISOString().slice(0, 7)}`;
    monthCount = await incrementUsageCounter(env, monthBucket);
  } catch (error) {
    console.warn("tinystudio_signup_storage_failed", error.message || "storage failed");
    return jsonResponse({ ok: false, error: "storage_unavailable" }, { status: 503 });
  }

  if (monthCount > MAX_APPRAISALS_PER_MONTH) {
    if (wantsHtmlRedirect(request)) {
      return closedIntakeResponse();
    }
    return jsonResponse(
      { ok: false, error: "intake_closed", message: "The six appraisals for this month are taken. The intake is closed until the next." },
      { status: 409 }
    );
  }

  try {
    await saveEmailSignup(request, env, url, email, APPRAISAL_SURFACE, website);
  } catch (error) {
    console.warn("tinystudio_signup_storage_failed", error.message || "storage failed");
    return jsonResponse({ ok: false, error: "storage_unavailable" }, { status: 503 });
  }

  if (wantsHtmlRedirect(request)) {
    return htmlRedirect(url, "saved");
  }

  return jsonResponse({ ok: true, message: "signal_saved" }, { status: 201 });
}

async function hashIp(request, bucket) {
  const ip = request.headers.get("CF-Connecting-IP") || request.headers.get("X-Forwarded-For") || "";
  if (!ip) return "";

  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${bucket}:${ip}`));
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function incrementUsageCounter(env, bucketKey) {
  const now = new Date().toISOString();
  const result = await env.DB.prepare(
    `INSERT INTO agent_usage_limits (bucket_key, count, first_seen_at, updated_at)
     VALUES (?, 1, ?, ?)
     ON CONFLICT(bucket_key) DO UPDATE SET
       count = count + 1,
       updated_at = excluded.updated_at
     RETURNING count`
  )
    .bind(bucketKey, now, now)
    .first();

  return Number(result?.count || 0);
}

async function enforceAgentLimits(request, env, email, url) {
  try {
    // Test-only clock override: production never binds AGENT_LIMITS_NOW, so
    // runtime behaviour is unchanged when it is absent. The worker test suite
    // uses it to roll the daily limit bucket across midnight deterministically
    // (no sleeping).
    const bucket = new Date(env.AGENT_LIMITS_NOW || Date.now()).toISOString().slice(0, 10);
    const ipHash = await hashIp(request, bucket);

    if (ipHash) {
      const ipCount = await incrementUsageCounter(env, `ip:${bucket}:${ipHash}`);

      if (ipCount > MAX_AGENT_RUNS_PER_IP_PER_DAY) {
        return { ok: false, response: jsonResponse({ ok: false, error: "daily_ip_limit" }, { status: 429 }) };
      }
    }

    const emailCount = await incrementUsageCounter(env, `email:${bucket}:${email}`);
    if (emailCount > SOFT_AGENT_RUNS_PER_EMAIL_PER_DAY) {
      console.warn("tinystudio_agent_soft_email_limit", JSON.stringify({ emailCount }));
      return { ok: false, response: jsonResponse({ ok: false, error: "daily_email_limit" }, { status: 429 }) };
    }

    await env.DB.prepare(
      `INSERT INTO agent_runs (id, email, source, page_path, ip_hash, user_agent, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        crypto.randomUUID(),
        email,
        "agent-self-serve",
        signupPagePath(request, url.pathname),
        ipHash,
        cleanHeader(request.headers.get("User-Agent"), 500),
        new Date().toISOString()
      )
      .run();
  } catch (error) {
    console.warn("tinystudio_agent_storage_failed", error.message || "storage failed");
    return { ok: false, response: jsonResponse({ ok: false, error: "storage_unavailable" }, { status: 503 }) };
  }

  return { ok: true };
}

function agentInput(body) {
  return {
    email: normalizeEmail(body.email),
    business: cleanField(body.business),
    offer: cleanField(body.offer),
    audience: cleanField(body.audience),
    proof: cleanField(body.proof),
    market: cleanField(body.market),
    funnel: cleanField(body.funnel),
    followup: cleanField(body.followup),
    constraints: cleanField(body.constraints),
    weeklySpend: cleanField(body.weeklySpend, 240),
    rawLeads: cleanField(body.rawLeads, 120),
    qualifiedLeads: cleanField(body.qualifiedLeads, 120),
    bookedCalls: cleanField(body.bookedCalls, 120),
    showedCalls: cleanField(body.showedCalls, 120),
    closedDeals: cleanField(body.closedDeals, 120),
    cashCollected: cleanField(body.cashCollected, 240),
    bottleneck: cleanField(body.bottleneck, 800)
  };
}

function agentInputWithInferredWeeklyMetrics(input) {
  const inferredMetrics = inferWeeklyMetricsFromBusiness(input.business);

  return {
    ...input,
    weeklySpend: input.weeklySpend || inferredMetrics.weeklySpend || "",
    rawLeads: input.rawLeads || inferredMetrics.rawLeads || "",
    qualifiedLeads: input.qualifiedLeads || inferredMetrics.qualifiedLeads || "",
    bookedCalls: input.bookedCalls || inferredMetrics.bookedCalls || "",
    showedCalls: input.showedCalls || inferredMetrics.showedCalls || "",
    closedDeals: input.closedDeals || inferredMetrics.closedDeals || "",
    cashCollected: input.cashCollected || inferredMetrics.cashCollected || ""
  };
}

function inferWeeklyMetricsFromBusiness(business) {
  const text = String(business || "");
  const numberPattern = String.raw`\d[\d,.]*`;

  return {
    weeklySpend: firstMetricCapture(text, [
      String.raw`\b(?:spent|spend|ad\s+spend|weekly\s+spend)\s+(?:was\s+|is\s+|of\s+)?(${CURRENCY_AMOUNT_PATTERN})\b`,
      String.raw`\b(${CURRENCY_AMOUNT_PATTERN})\s+(?:in\s+)?(?:ad\s+)?spend\b`
    ]),
    rawLeads: firstMetricCapture(text, [
      String.raw`\b(?:got|generated|received|captured|collected)\s+(${numberPattern})\s+(?:raw\s+|new\s+)?leads\b`,
      String.raw`\b(${numberPattern})\s+(?:raw\s+|new\s+)?leads\s+(?:came\s+in|came\s+through|generated|received|captured|arrived)\b`
    ]),
    qualifiedLeads: firstMetricCapture(text, [
      String.raw`\b(?:qualified)\s+(${numberPattern})\s+leads\b`,
      String.raw`\b(${numberPattern})\s+qualified\s+leads\b`
    ]),
    bookedCalls: firstMetricCapture(text, [
      String.raw`\bbooked\s+(${numberPattern})\s+calls?\b`,
      String.raw`\b(${numberPattern})\s+booked\s+calls?\b`,
      String.raw`\b(${numberPattern})\s+calls?\s+booked\b`
    ]),
    showedCalls: firstMetricCapture(text, [
      String.raw`\b(${numberPattern})\s+calls?\s+(?:showed|attended|completed)\b`,
      String.raw`\bshowed\s+(${numberPattern})\s+calls?\b`,
      String.raw`\b(${numberPattern})\s+showed\s+calls?\b`
    ]),
    closedDeals: firstMetricCapture(text, [
      String.raw`\bclosed\s+(${numberPattern})\s+deals?\b`,
      String.raw`\b(${numberPattern})\s+deals?\s+(?:closed|won)\b`,
      String.raw`\b(${numberPattern})\s+closed\s+deals?\b`
    ]),
    cashCollected: firstMetricCapture(text, [
      String.raw`\b(?:collected|cash\s+collected|cash\s+in)\s+(${CURRENCY_AMOUNT_PATTERN})\b`,
      String.raw`\b(${CURRENCY_AMOUNT_PATTERN})\s+(?:collected|cash\s+collected|cash\s+in)\b`
    ])
  };
}

function firstMetricCapture(text, patterns) {
  for (const pattern of patterns) {
    const match = new RegExp(pattern, "i").exec(text);
    if (match?.[1]) return cleanField(match[1], 120);
  }

  return "";
}

function validateAgentInput(input) {
  if (!isValidEmail(input.email)) return "Add a valid email first.";
  if (!input.business) return "Add a business snapshot first.";
  return "";
}

function weeklyMetricValues(input) {
  return weeklyMetricEntries(input).map((entry) => entry.value);
}

function weeklyMetricEntries(input) {
  return [
    ["Spend", input.weeklySpend],
    ["Raw leads", input.rawLeads],
    ["Qualified leads", input.qualifiedLeads],
    ["Booked calls", input.bookedCalls],
    ["Showed calls", input.showedCalls],
    ["Closed deals", input.closedDeals],
    ["Cash collected", input.cashCollected]
  ]
    .filter(([, value]) => Boolean(value))
    .map(([label, value]) => ({ label, value }));
}

function metricLabelPattern(label) {
  return label.replace(/\s+/g, String.raw`\s+`);
}

function weeklySnapshotEntries(input) {
  const entries = weeklyMetricEntries(input);
  if (input.bottleneck) {
    entries.push({ label: "Current bottleneck", value: input.bottleneck });
  }
  return entries;
}

function hasWeeklyMetrics(input) {
  return weeklyMetricValues(input).length > 0;
}

function buildMetricSnapshot(input) {
  const entries = weeklySnapshotEntries(input);
  if (!entries.length) return "";

  return [
    "## Current Metric Snapshot",
    ...entries.map(({ label, value }) => `- **${label}**: ${value}`)
  ].join("\n");
}

function stripModelMetricSnapshot(report) {
  return String(report || "")
    .replace(/(?:^|\n+)#{1,6}\s+Current Metric Snapshot\s*[\s\S]*?(?=\n#{1,6}\s+|$)/i, "\n")
    .trim();
}

function reportInventsMetrics(report) {
  return String(report || "")
    .split("\n")
    .some((line) => metricLabelsWithValuesInLine(line).length > 0);
}

function stripUnsupportedMetricValues(report, input) {
  const suppliedValues = new Map(weeklyMetricEntries(input).map((entry) => [entry.label.toLowerCase(), entry.value]));

  return String(report || "")
    .split("\n")
    .filter((line) => {
      const metricLabelsInLine = metricLabelsWithValuesInLine(line);

      if (!metricLabelsInLine.length) return true;

      return metricLabelsInLine.every((label) => {
        const suppliedValue = suppliedValues.get(label.toLowerCase());
        return suppliedValue && metricLineContainsSuppliedValue(line, suppliedValue);
      });
    })
    .join("\n")
    .trim();
}

function stripUnsupportedMetricsFromArtifactSections(sections, input) {
  return {
    ...sections,
    pipelineBrief: stripUnsupportedMetricValues(sections.pipelineBrief, input),
    implementationChecklist: stripUnsupportedMetricValues(sections.implementationChecklist, input)
  };
}

function metricLabelsWithValuesInLine(line) {
  const labels = new Set();

  for (const label of WEEKLY_METRIC_LABELS) {
    if (metricLabelHasValueInClause(line, label)) {
      labels.add(label);
    }
  }

  for (const label of currentMetricPhraseLabels(line)) {
    labels.add(label);
  }

  return [...labels];
}

function currentMetricPhraseLabels(line) {
  const source = String(line || "");
  const patterns = [
    {
      label: "Raw leads",
      tests: [
        String.raw`${METRIC_VALUE_PATTERN}\s+(?:raw\s+|new\s+)?leads\b[^.\n]{0,64}\b(?:came\s+in|came\s+through|arrived|generated|received|captured|this\s+week|last\s+week|current\s+week)`,
        String.raw`\bleads\b[^.\n]{0,32}\b(?:were|are|came\s+to|hit|reached|total(?:ed)?)\b[^.\n]{0,32}${METRIC_VALUE_PATTERN}`
      ]
    },
    {
      label: "Qualified leads",
      tests: [
        String.raw`${METRIC_VALUE_PATTERN}\s+qualified\s+leads\b`,
        String.raw`\bqualified\s+leads\b[^.\n]{0,32}\b(?:were|are|came\s+to|hit|reached|total(?:ed)?)\b[^.\n]{0,32}${METRIC_VALUE_PATTERN}`
      ]
    },
    {
      label: "Booked calls",
      tests: [
        String.raw`${METRIC_VALUE_PATTERN}\s+(?:booked\s+calls?|calls?\s+booked)\b`,
        String.raw`\bcalls?\b[^.\n]{0,32}\bbooked\b[^.\n]{0,32}${METRIC_VALUE_PATTERN}`
      ]
    },
    {
      label: "Showed calls",
      tests: [
        String.raw`${METRIC_VALUE_PATTERN}\s+(?:showed\s+calls?|calls?\s+(?:showed|attended|completed))\b`,
        String.raw`${METRIC_VALUE_PATTERN}\s+calls?\b[^.\n]{0,64}\b(?:showed|attended|completed|this\s+week|last\s+week|current\s+week)`,
        String.raw`\bcalls?\b[^.\n]{0,32}\b(?:showed|attended|completed)\b[^.\n]{0,32}${METRIC_VALUE_PATTERN}`
      ]
    },
    {
      label: "Closed deals",
      tests: [
        String.raw`${METRIC_VALUE_PATTERN}\s+(?:closed\s+deals?|deals?\s+closed|clients?\s+closed|sales\s+closed)\b`,
        String.raw`\b(?:deals?|clients?|sales)\b[^.\n]{0,32}\b(?:closed|won)\b[^.\n]{0,32}${METRIC_VALUE_PATTERN}`
      ]
    },
    {
      label: "Cash collected",
      tests: [
        String.raw`${CURRENCY_AMOUNT_PATTERN}[^.\n]{0,48}\b(?:cash\s+collected|collected\s+cash|collected|cash\s+in)\b`,
        String.raw`\b(?:cash\s+collected|collected\s+cash|cash\s+in)\b[^.\n]{0,48}${CURRENCY_AMOUNT_PATTERN}`
      ]
    }
  ];

  return patterns
    .filter(({ tests }) => tests.some((test) => new RegExp(test, "i").test(source)))
    .map(({ label }) => label);
}

function metricLabelHasValueInClause(line, label) {
  const source = String(line || "");
  const labelPattern = metricLabelPattern(label);
  const labelThenValuePatterns = [
    String.raw`\b${labelPattern}\b\s*(?::|=|\|)\s*${METRIC_VALUE_PATTERN}`,
    String.raw`\b${labelPattern}\b[^.\n|;]{0,32}\b(?:was|were|is|are|hit|reached|total(?:ed)?|came\s+to|at)\b\s*${METRIC_VALUE_PATTERN}`
  ];
  const valueThenLabelPatterns = [
    String.raw`${METRIC_VALUE_PATTERN}\s+(?:in\s+|of\s+|out\s+of\s+)?\b${labelPattern}\b`
  ];

  return [...labelThenValuePatterns, ...valueThenLabelPatterns].some((pattern) => new RegExp(pattern, "i").test(source));
}

function normalizeMetricValueForCompare(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/,/g, "");
}

function metricLineContainsSuppliedValue(line, suppliedValue) {
  const lineTokens = metricComparableTokens(line);
  const suppliedTokens = metricComparableTokens(suppliedValue);

  return [...suppliedTokens].some((token) => lineTokens.has(token));
}

function metricComparableTokens(value) {
  const source = String(value || "");
  const tokens = new Set();
  const tokenPattern = new RegExp(String.raw`${CURRENCY_AMOUNT_PATTERN}|\b\d[\d,.]*(?:\s*(?:k|lakh|lakhs|l|cr))?\b`, "gi");

  for (const match of source.matchAll(tokenPattern)) {
    const normalized = normalizeMetricValueForCompare(match[0]);
    if (normalized) tokens.add(normalized);

    const digits = String(match[0] || "").replace(/\D/g, "");
    if (digits) tokens.add(digits);
  }

  return tokens;
}

function metricsToCollectBlock() {
  return [
    "## Metrics To Collect",
    "- Spend",
    "- Raw leads",
    "- Qualified leads",
    "- Booked calls",
    "- Showed calls",
    "- Closed deals",
    "- Cash collected",
    "- Current bottleneck"
  ].join("\n");
}

function appendMetricsToCollect(report) {
  const cleanReport = String(report || "").trim();
  if (!cleanReport || cleanReport.length < 40) {
    return buildWeeklyTrackerReport();
  }

  if (/Lead-to-Call Metric Tracker Template|Metrics To Collect/i.test(cleanReport)) {
    return cleanReport;
  }

  return `${cleanReport}\n\n${metricsToCollectBlock()}`;
}

function buildWeeklyTrackerReport() {
  return [
    "# Weekly Fix Report",
    "",
    "## Lead-to-Call Metric Tracker Template",
    "| Metric | Current week | Notes |",
    "| --- | --- | --- |",
    "| Spend |  | Use actual ad spend or outreach cost. |",
    "| Raw leads |  | Count every new lead before qualification. |",
    "| Qualified leads |  | Count leads that meet the offer's minimum criteria. |",
    "| Booked calls |  | Count calls booked from qualified leads. |",
    "| Showed calls |  | Count completed calls. |",
    "| Closed deals |  | Count won customers only after buyer commitment is clear. |",
    "| Cash collected |  | Track collected cash, not projected revenue. |",
    "",
    "## First Review Cadence",
    "- Fill this tracker for 7-15 days before treating the report as a performance diagnosis.",
    "- Review the biggest drop-off between raw leads, qualified leads, booked calls, showed calls, and closed deals.",
    "- Change offer, hook, qualification, or follow-up before changing spend."
  ].join("\n");
}

function ensureWeeklyMetricSnapshot(sections, input) {
  if (!hasWeeklyMetrics(input)) {
    return sections;
  }

  const snapshot = buildMetricSnapshot(input);
  if (!snapshot) return sections;

  const weeklyReport = stripModelMetricSnapshot(sections.weeklyFixReport);
  const weeklyBody = weeklyReport.replace(/^#{1,2}\s+Weekly Fix Report\s*$/im, "").trim();
  const diagnosis = weeklyBody
    ? [/^#{1,6}\s+/.test(weeklyBody) ? "" : "## Agent Diagnosis", weeklyBody].filter(Boolean).join("\n")
    : "";

  return {
    ...sections,
    weeklyFixReport: ["# Weekly Fix Report", "", snapshot, diagnosis ? `\n${diagnosis}` : ""].join("\n").trim()
  };
}

function ensureWeeklyReportContract(sections, input) {
  if (!hasWeeklyMetrics(input)) {
    if (reportInventsMetrics(sections.weeklyFixReport)) {
      return {
        ...sections,
        weeklyFixReport: buildWeeklyTrackerReport()
      };
    }

    return {
      ...sections,
      weeklyFixReport: appendMetricsToCollect(sections.weeklyFixReport)
    };
  }

  return ensureWeeklyMetricSnapshot(
    {
      ...sections,
      weeklyFixReport: stripUnsupportedMetricValues(stripModelMetricSnapshot(sections.weeklyFixReport), input)
    },
    input
  );
}

function composeAgentBrief(sections) {
  return ["pipelineBrief", "implementationChecklist", "weeklyFixReport"]
    .map((key) => sections[key])
    .filter(Boolean)
    .join("\n\n")
    .trim();
}

function agentSystemPrompt() {
  return [
    "You are TinyStudio's Pipeline Agent Desk for high-ticket coaches, consultants, service businesses, course sellers, and agencies.",
    "Generate practical lead-to-call pipeline artifacts from the user's inputs.",
    "Act like a coordinated team of specialist agents: Offer Agent, Funnel Agent, Creative Agent, Qualification Agent, Follow-Up Agent, CRM Agent, Tracking Agent, and Decision Agent.",
    "Do the heavy lifting. The user may provide only a rough business snapshot. Infer missing offer, buyer, funnel, follow-up, CRM, tracking, and weekly-review assumptions before asking for more input.",
    "State assumptions clearly. Ask only true blocker questions when missing information prevents a useful next step.",
    "Do not invent exact prices, demographics, city lists, dates, proof details, revenue, budgets, or existing tools when the user did not provide them. Use directional assumptions or placeholders for missing precise facts.",
    "Do not turn the output into another intake form. Give a useful first pass even with imperfect context.",
    "Stay proof-safe. Do not promise revenue, ROAS, profit, booked calls, sales lift, or specific close rates.",
    "Do not invent testimonials, client quotes, named outcomes, fake proof, or before/after results.",
    "Do not say the system will deliver a specific number of calls, clients, sales, or revenue.",
    "Do not require a kickoff or sales call to complete the self-serve output; the user may request help separately.",
    "Do not say you will publish ads, change budgets, connect to ad accounts, send messages, or replace the sales team.",
    "Do not imply this app sends emails, WhatsApp messages, DMs, SMS, or CRM updates. It only drafts scripts, maps, and checklists unless the user separately implements them.",
    "Keep Meta/Google actions approval-gated and mention human approval where needed.",
    "For India-first high-ticket validation, you may suggest WhatsApp message ads or lead forms before a landing page and a small INR 500-INR 1,000/day validation range only as a test-plan input, not a profit promise.",
    "For India-first validation, do not make a landing page a first-week requirement unless the user already has one. Treat landing pages as later after message and funnel validation.",
    "Do not calculate ROI. Do not include internal benchmark targets like 30% booking, 80% show-up, or 10%-18% close rate.",
    "Return markdown only. Use concrete bullet points.",
    "Return exactly three top-level sections with these exact headings: # Pipeline Brief, # Implementation Checklist, # Weekly Fix Report."
  ].join("\n");
}

function agentUserPrompt(input) {
  const metricsMode = hasWeeklyMetrics(input) ? "metrics provided" : "no metrics provided";

  return [
    "Build the self-serve TinyStudio Pipeline Loop for this user.",
    "Use optional fields when present. When they are missing, infer the most likely useful version from the business snapshot, label it as an assumption, and continue.",
    "Only include blocker questions for missing facts that would make the next action unsafe, impossible, or materially misleading.",
    "Keep assumptions directional. If offer price, target demographics, proof details, market cities, tools, or current numbers are not supplied, say they were not supplied and show where the user should plug in the real value instead of inventing one.",
    "",
    `Business snapshot: ${input.business}`,
    `Offer: ${input.offer || "Not provided; infer from business snapshot and mark as assumption"}`,
    `Target buyer: ${input.audience || "Not provided; infer from business snapshot and mark as assumption"}`,
    `Proof/assets: ${input.proof || "Not provided"}`,
    `Market/channel preference: ${input.market && input.market !== "Let the agent infer" ? input.market : "Not provided; infer from business snapshot"}`,
    `Current funnel: ${input.funnel && input.funnel !== "Let the agent infer" ? input.funnel : "Not provided; infer from business snapshot"}`,
    `Current follow-up/CRM: ${input.followup || "Not provided"}`,
    `Constraints: ${input.constraints || "Not provided"}`,
    "",
    "Current weekly numbers, if any:",
    `Spend: ${input.weeklySpend || "Not provided"}`,
    `Raw leads: ${input.rawLeads || "Not provided"}`,
    `Qualified leads: ${input.qualifiedLeads || "Not provided"}`,
    `Booked calls: ${input.bookedCalls || "Not provided"}`,
    `Showed calls: ${input.showedCalls || "Not provided"}`,
    `Closed deals: ${input.closedDeals || "Not provided"}`,
    `Cash collected: ${input.cashCollected || "Not provided"}`,
    `Current bottleneck: ${input.bottleneck || "Not provided"}`,
    `Weekly metrics mode: ${metricsMode}`,
    "",
    "Return exactly these three sections:",
    "# Pipeline Brief",
    "- Include assumptions used, readiness diagnosis, recommended funnel path, audience and pain map, first four creative tests, lead qualification form, follow-up/setter flow, CRM/tracking checklist, true blocker questions if any, and 7-day or 15-day decision plan.",
    "# Implementation Checklist",
    "- Convert the brief into a practical setup checklist across offer, funnel, creative, qualification, follow-up, booking/reminders, CRM stages, tracking events, and human approval gates.",
    "- For India-first validation, prioritize WhatsApp/DM or lead form setup before landing-page work unless a landing page already exists.",
    "# Weekly Fix Report",
    "- If weekly metrics mode is 'metrics provided', diagnose the likely bottleneck from spend, raw leads, qualified leads, booked calls, showed calls, closed deals, cash collected, and current bottleneck. Do not write a Current Metric Snapshot block; the server adds the authoritative snapshot.",
    "- If weekly metrics mode is 'no metrics provided', provide a lead-to-call metric tracker template and first-week review cadence.",
    "- Do not return a blank tracker template when metrics were provided.",
    "- Do not calculate ROI, ROAS, return on investment, or return on ad spend.",
    "- Recommend what to fix next without guaranteeing performance."
  ].join("\n");
}

function splitAgentSections(markdown) {
  const text = String(markdown || "").replace(/\r\n/g, "\n").trim();
  const sections = Object.fromEntries(Object.keys(AGENT_SECTION_HEADINGS).map((key) => [key, ""]));

  if (!text) return sections;

  const headingToKey = Object.fromEntries(
    Object.entries(AGENT_SECTION_HEADINGS).map(([key, heading]) => [heading.toLowerCase(), key])
  );
  const headingPattern = /^#{1,2}\s+(Pipeline Brief|Implementation Checklist|Weekly Fix Report)\s*$/gim;
  const matches = [...text.matchAll(headingPattern)];

  if (!matches.length) {
    sections.pipelineBrief = text;
    return sections;
  }

  matches.forEach((match, index) => {
    const key = headingToKey[String(match[1] || "").toLowerCase()];
    if (!key) return;
    const start = match.index || 0;
    const end = matches[index + 1]?.index ?? text.length;
    sections[key] = text.slice(start, end).trim();
  });

  return sections;
}

function missingAgentSections(sections) {
  return Object.entries(AGENT_SECTION_HEADINGS)
    .filter(([key]) => !sections[key] || sections[key].length < 40)
    .map(([, heading]) => heading);
}

function unknownTopLevelHeadings(markdown) {
  const allowedHeadings = new Set(Object.values(AGENT_SECTION_HEADINGS).map((heading) => heading.toLowerCase()));

  return [...String(markdown || "").matchAll(/^#\s+(.+?)\s*$/gim)]
    .map((match) => String(match[1] || "").trim())
    .filter((heading) => heading && !allowedHeadings.has(heading.toLowerCase()));
}

function extractAiText(result) {
  if (!result) return "";
  if (typeof result === "string") return result;
  if (typeof result.response === "string") return result.response;
  if (typeof result.result?.response === "string") return result.result.response;
  if (typeof result.text === "string") return result.text;
  const content = result.choices?.[0]?.message?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.map((part) => part.text || part.content || "").join("\n").trim();
  }
  return "";
}

function scrubUnsafeOutput(text) {
  return String(text || "")
    .replace(/guaranteed\s+(revenue|roas|booked calls?|sales|profit)/gi, "projected $1")
    .replace(/fully autonomous ad buying/gi, "approval-gated ad workflow")
    .replace(/I doubled my qualified calls in 30 days\./gi, "Use only a real approved proof clip; do not invent client outcomes.")
    .replace(/delivers\s+X\s+qualified calls per week/gi, "sets up the follow-up and tracking system")
    .replace(/delivers\s+\d+\s+qualified calls per week/gi, "sets up the follow-up and tracking system")
    .replace(/will deliver\s+\d+\s+qualified calls/gi, "will support qualified-call tracking")
    .replace(/will generate\s+\d+\s+qualified calls/gi, "will support qualified-call tracking")
    .replace(/Automated emails and WhatsApp messages/gi, "Drafted email and WhatsApp sequence for human-approved automation")
    .replace(/automate your lead-to-call process/gi, "map your lead-to-call process")
    .replace(/automate your lead-to-call/gi, "map your lead-to-call")
    .replace(/30%\s+booking\s+rate/gi, "booking-rate benchmark")
    .replace(/80%\s+show-up\s+rate/gi, "show-up benchmark")
    .replace(/10%\s*-\s*18%\s+close\s+rate/gi, "close-rate benchmark")
    .slice(0, 12000);
}

function hasProvidedOfferPrice(input) {
  if (new RegExp(CURRENCY_AMOUNT_PATTERN, "i").test(input.offer || "")) return true;

  const offerTermPattern = String.raw`(?:offer|program|sprint|package|service|retainer|fee|price|priced|costs|charges?)`;
  const contextualPricePattern = new RegExp(
    String.raw`\b${offerTermPattern}\b[^.\n]{0,60}${CURRENCY_AMOUNT_PATTERN}|${CURRENCY_AMOUNT_PATTERN}[^.\n]{0,60}\b${offerTermPattern}\b`,
    "i"
  );
  return contextualPricePattern.test(input.business || "");
}

function hasProvidedAgeRange(input) {
  const agePattern = /\b(age|aged|years?\s+old|yo)\b[^.\n]{0,30}\d{2}/i;
  return agePattern.test(`${input.audience || ""} ${input.business || ""}`);
}

function scrubUnsupportedPrecision(text, input) {
  let output = String(text || "");

  if (!hasProvidedOfferPrice(input)) {
    const priceRangePattern = String.raw`${CURRENCY_AMOUNT_PATTERN}(?:\s*-\s*${CURRENCY_AMOUNT_PATTERN})?`;
    const priceRangeRegex = new RegExp(priceRangePattern, "gi");
    const priceTermRegex = /\b(retainer|fee|price|priced|costs?|charges?|charge)\b/i;
    const paidOfferTermRegex = /\b(program|sprint|package|service)\b/i;
    const validationSpendRegex = /\b(validation|test|ad\s+spend|spend|budget|daily|per\s+day|\/day)\b/i;

    output = output
      .replace(new RegExp(String.raw`\bpriced at\s+${priceRangePattern}`, "gi"), "price not supplied; use the actual offer price.")
      .replace(new RegExp(String.raw`\bprice(?:d)?\s*:\s*${priceRangePattern}`, "gi"), "price: not supplied; use the actual offer price.")
      .replace(new RegExp(String.raw`\boffer\s+price\s+(?:is|=)\s*${priceRangePattern}`, "gi"), "offer price is not supplied; use the actual offer price.")
      .replace(new RegExp(String.raw`\b(?:charge|charges|costs?)\s+${priceRangePattern}`, "gi"), "charge the actual offer price.");

    output = output
      .split("\n")
      .map((line) => {
        const hasPriceLikeContext = priceTermRegex.test(line) || (paidOfferTermRegex.test(line) && !validationSpendRegex.test(line));
        if (!hasPriceLikeContext || !new RegExp(priceRangePattern, "i").test(line)) return line;
        return line.replace(priceRangeRegex, "actual offer price not supplied");
      })
      .join("\n");
  }

  if (!hasProvidedAgeRange(input)) {
    output = output.replace(/\baged\s+\d{2}\s*(?:-|to)\s*\d{2}\b/gi, "with age range not supplied");
  }

  return output;
}

function unsafeOutputReasons(text) {
  const value = String(text || "");
  const checks = [
    { reason: "outcome guarantee", pattern: /\bguaranteed\s+(revenue|roas|booked calls?|qualified calls?|sales|profit)\b/i },
    { reason: "ranking guarantee", pattern: /\b(guaranteed?|guarantees?|promise[sd]?)\s+(seo\s+)?rankings?\b/i },
    { reason: "ai visibility guarantee", pattern: /\b(guaranteed?|guarantees?|promise[sd]?)\s+(ai\s+)?visibility\b/i },
    { reason: "conversion lift guarantee", pattern: /\b(guaranteed?|guarantees?|promise[sd]?)\s+conversion\s+lift\b/i },
    { reason: "sales lift guarantee", pattern: /\b(guaranteed?|guarantees?|promise[sd]?)\s+sales[-\s]?lift\b/i },
    { reason: "roi calculation", pattern: /\b(roi|return\s+on\s+investment)\b[\w\s:=.%+-]{0,32}\d+(\.\d+)?\s*%/i },
    { reason: "roi percentage", pattern: /\b\d+(\.\d+)?\s*%\s*(roi|return\s+on\s+investment)\b/i },
    { reason: "roas calculation", pattern: /\b(roas|return\s+on\s+ad\s+spend)\b[\w\s:=.%+-]{0,32}\d+(\.\d+)?\s*x?\b/i },
    { reason: "roas multiple", pattern: /\b\d+(\.\d+)?\s*x\s*(roas|return\s+on\s+ad\s+spend)\b/i },
    { reason: "10x claim", pattern: /\b10x\s+(revenue|sales|profit|roas|booked calls?|qualified calls?)\b/i },
    { reason: "rank number one", pattern: /\brank\s*(#\s*1|number\s+one|first)\b/i },
    { reason: "guaranteed calls", pattern: /\bguaranteed\s+calls?\b/i },
    { reason: "specific outcome count", pattern: /\bwill\s+(deliver|generate|produce)\s+\d+\s+(booked calls?|qualified calls?|clients|sales|leads)\b/i },
    { reason: "autonomous ad buying", pattern: /\bfully autonomous ad buying\b/i },
    { reason: "campaign publishing", pattern: /\bpublish\s+(ads?|campaigns?)\b/i, allowApprovalGate: true },
    { reason: "unapproved publishing", pattern: /\bpublish\s+(ads?|campaigns?)\s+without\s+approval\b/i },
    { reason: "unapproved spend change", pattern: /\bchange\s+(ad\s+)?spend\s+without\s+approval\b/i },
    { reason: "approval not required", pattern: /\b(?:no\s+approval\s+(?:needed|required)|approval\s+(?:is\s+)?not\s+(?:needed|required))\b[^.\n]{0,80}\b(?:publish\s+(?:ads?|campaigns?)|connect\s+(?:to\s+)?(?:your\s+|the\s+|a\s+|an\s+)?(?:(?:meta|google)\s+)?(?:ad\s+)?accounts?|change\s+(?:ad\s+)?spend|sync\s+crm\s+outcomes?)\b/i },
    { reason: "ad account connection", pattern: /\bconnect\s+(?:to\s+)?(?:your\s+|the\s+|a\s+|an\s+)?(?:(?:meta|google)\s+)?(?:ad\s+)?accounts?\b|\bconnect\s+(?:to\s+)?(?:your\s+|the\s+|a\s+|an\s+)?(?:meta|google)\b/i, allowApprovalGate: true },
    { reason: "crm outcome sync", pattern: /\bsync\s+crm\s+outcomes?\s+(to|back\s+to)\s+(meta|google|ad platforms?)\b/i },
    { reason: "invented proof", pattern: /\bi doubled my qualified calls in 30 days\b/i }
  ];

  return checks
    .filter(({ pattern, allowApprovalGate }) => hasUnsafeMatch(value, pattern, { allowApprovalGate }))
    .map(({ reason }) => reason);
}

function hasUnsafeMatch(text, pattern, options = {}) {
  const globalPattern = new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`);

  for (const match of text.matchAll(globalPattern)) {
    const prefix = text.slice(Math.max(0, match.index - 96), match.index).toLowerCase();
    const clausePrefix = prefix.split(/(?:[.;:!?]\s*|\n+|,\s*|\bbut\b|\bhowever\b|\bthough\b|\byet\b)/).pop() || "";
    const approvalPrefix = prefix.split(/(?:[.;:!?]\s*|\n+|\bbut\b|\bhowever\b|\bthough\b|\byet\b)/).pop() || "";
    const suffix = text.slice(match.index, match.index + 96).toLowerCase();
    const clauseSuffix = suffix.split(/(?:[.;:!?]\s*|\n+|,\s*|\bbut\b|\bhowever\b|\bthough\b|\byet\b)/)[0] || "";

    if (/\b(no|not|never|cannot|can't|doesn't|does not|do not|won't|will not)\b(?:\s+\w+){0,8}\s*$/.test(clausePrefix)) {
      continue;
    }
    if (options.allowApprovalGate && hasApprovalGate(approvalPrefix, clauseSuffix)) {
      continue;
    }
    return true;
  }

  return false;
}

function hasApprovalGate(clausePrefix, clauseSuffix) {
  const clause = `${clausePrefix} ${clauseSuffix}`.toLowerCase();
  if (/\bwithout\s+approval\b/.test(clause)) return false;

  return /\b(approval|approved|human-approved|approval-gated)\b/.test(clause);
}

async function agentAuditResponse(request, env, url) {
  if (request.method === "OPTIONS") {
    return jsonResponse({ ok: true });
  }

  if (request.method !== "POST") {
    return jsonResponse({ ok: false, error: "method_not_allowed" }, { status: 405 });
  }

  if (!env.AI) {
    return jsonResponse({ ok: false, error: "ai_unavailable" }, { status: 503 });
  }

  const requestError = validateAgentRequest(request);
  if (requestError) return requestError;

  if (requestTooLarge(request)) {
    return jsonResponse({ ok: false, error: "request_too_large" }, { status: 413 });
  }

  let body;
  try {
    body = await readRequestBody(request);
  } catch (error) {
    if (error.message === "request_too_large") {
      return jsonResponse({ ok: false, error: "request_too_large" }, { status: 413 });
    }
    body = {};
  }
  const input = agentInputWithInferredWeeklyMetrics(agentInput(body));
  const validationError = validateAgentInput(input);

  if (validationError) {
    return jsonResponse({ ok: false, error: "invalid_input", message: validationError }, { status: 400 });
  }

  const limit = await enforceAgentLimits(request, env, input.email, url);
  if (!limit.ok) return limit.response;

  try {
    await saveEmailSignup(request, env, url, input.email, "agent-self-serve");
  } catch (error) {
    console.warn("tinystudio_agent_signup_storage_failed", error.message || "storage failed");
    return jsonResponse({ ok: false, error: "storage_unavailable" }, { status: 503 });
  }

  const messages = [
    { role: "system", content: agentSystemPrompt() },
    { role: "user", content: agentUserPrompt(input) }
  ];

  let brief = "";
  let model = "";
  let sections = splitAgentSections("");
  const modelErrors = [];

  for (const candidateModel of AGENT_MODELS) {
    try {
      const aiResult = await env.AI.run(candidateModel, {
        messages,
        temperature: 0.35,
        max_tokens: 2400
      });
      const rawBrief = extractAiText(aiResult);
      const rawUnsafeReasons = unsafeOutputReasons(rawBrief);
      const scrubbedBrief = scrubUnsupportedPrecision(scrubUnsafeOutput(rawBrief), input);
      const unknownHeadings = unknownTopLevelHeadings(scrubbedBrief);
      const modelSections = splitAgentSections(scrubbedBrief);
      const artifactSections = stripUnsupportedMetricsFromArtifactSections(modelSections, input);
      const candidateSections = ensureWeeklyReportContract(artifactSections, input);
      const validationSections = hasWeeklyMetrics(input)
        ? {
            ...candidateSections,
            weeklyFixReport: stripModelMetricSnapshot(candidateSections.weeklyFixReport)
          }
        : candidateSections;
      const modelMissingSections = missingAgentSections(validationSections);
      const missingSections = hasWeeklyMetrics(input)
        ? modelMissingSections
        : modelMissingSections.filter((heading) => heading !== "Weekly Fix Report");
      const candidateBrief = composeAgentBrief(candidateSections) || scrubbedBrief;
      const scrubbedUnsafeReasons = unsafeOutputReasons(candidateBrief);
      const unsafeReasons = [...new Set([...rawUnsafeReasons, ...scrubbedUnsafeReasons])];

      if (candidateBrief && unsafeReasons.length === 0 && missingSections.length === 0 && unknownHeadings.length === 0) {
        brief = candidateBrief;
        sections = candidateSections;
        model = candidateModel;
        break;
      }

      modelErrors.push(
        `${candidateModel}: ${
          candidateBrief
            ? [
                unsafeReasons.length ? `unsafe output (${unsafeReasons.join(", ")})` : "",
                missingSections.length ? `missing sections (${missingSections.join(", ")})` : "",
                unknownHeadings.length ? `unknown top-level headings (${unknownHeadings.length})` : ""
              ]
                .filter(Boolean)
                .join("; ")
            : "empty output"
        }`
      );
    } catch (error) {
      modelErrors.push(`${candidateModel}: ${error.message || "failed"}`);
    }
  }

  if (!brief) {
    console.warn("tinystudio_agent_ai_failed", JSON.stringify({ modelErrors }));
    return jsonResponse({ ok: false, error: "empty_agent_output" }, { status: 502 });
  }

  return jsonResponse({
    ok: true,
    mode: "cloudflare-workers-ai",
    model,
    sections,
    brief,
    safety: {
      approvalGated: true,
      storesBusinessBrief: false,
      noSpendChanges: true,
      noAutopublishing: true,
      noOutcomeGuarantee: true
    }
  });
}

async function healthResponse(env) {
  // The current product (The Website Appraisal) depends on exactly one
  // backend: the D1 `email_signups` table behind /api/signups. The retired
  // self-serve Agent Desk's machinery (the AI binding and its own agent_runs /
  // agent_usage_limits tables) is reported as legacy state, never as the
  // current product's readiness: /health must not go red when the appraisal
  // intake is healthy, nor green when the signup path is broken.
  const checks = {
    db: Boolean(env.DB),
    signupsTable: false,
    ai: Boolean(env.AI),
    agentRunsTable: false,
    usageLimitsTable: false
  };

  if (env.DB) {
    try {
      const tableResult = await env.DB.prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('email_signups', 'agent_runs', 'agent_usage_limits')"
      ).all();
      const tables = new Set((tableResult.results || []).map((row) => row.name));
      checks.signupsTable = tables.has("email_signups");
      checks.agentRunsTable = tables.has("agent_runs");
      checks.usageLimitsTable = tables.has("agent_usage_limits");
    } catch (error) {
      console.warn("tinystudio_health_check_failed", error.message || "health check failed");
    }
  }

  // The current-product readiness verdict keys off the intake path only.
  const ok = checks.db && checks.signupsTable;

  return jsonResponse(
    {
      ok,
      service: "tinystudio-io-public",
      surface: APPRAISAL_SURFACE,
      db: checks.db ? "configured" : "missing",
      checks,
      routes: ["tinystudio.io", "www.tinystudio.io", "app.tinystudio.io", "api.tinystudio.io"]
    },
    { status: ok ? 200 : 503 }
  );
}

function notFoundResponse(error, status = 404) {
  return jsonResponse({ ok: false, error }, { status });
}

function rootRedirect(url) {
  return withSecurityHeaders(Response.redirect(new URL("/", url).toString(), 307));
}

function retiredAppResponse() {
  return withSecurityHeaders(
    new Response(
      `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>TinyStudio App Retired</title>
    <style>
      body{margin:0;min-height:100vh;display:grid;place-items:center;background:#fffdf7;color:#171713;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
      main{width:min(720px,calc(100% - 40px));padding:48px;border:1px solid rgba(23,23,19,.14);border-radius:8px;background:#fff}
      h1{margin:0;font-size:clamp(38px,6vw,72px);line-height:1;letter-spacing:0}
      p{color:#57534b;font-size:18px;line-height:1.55}
      a{display:inline-flex;align-items:center;min-height:46px;padding:0 16px;border-radius:8px;background:#171713;color:#fffdf7;font-weight:800;text-decoration:none}
    </style>
  </head>
  <body>
    <main>
      <h1>TinyStudio app retired.</h1>
      <p>The old TinyStudio app has been retired. TinyStudio.io now runs The Website Appraisal — the free leak audit of high-ticket service homepages, reviewed by a person — and the human-reviewed desk that closes what the audit finds.</p>
      <a href="https://tinystudio.io/">Go to TinyStudio.io</a>
    </main>
  </body>
</html>`,
      {
        status: 410,
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "no-store"
        }
      }
    )
  );
}

function retiredApiResponse() {
  return withSecurityHeaders(
    Response.json(
      {
        ok: false,
        status: "retired",
        message: "The old TinyStudio API has been retired. TinyStudio.io now runs The Website Appraisal — the free leak audit of high-ticket service homepages — and the human-reviewed desk that closes what the audit finds.",
        publicSite: "https://tinystudio.io/"
      },
      {
        status: 410,
        headers: {
          "Cache-Control": "no-store"
        }
      }
    )
  );
}

function assetRequest(url, request, pathname) {
  const nextUrl = new URL(url);
  nextUrl.pathname = pathname;
  return new Request(nextUrl, request);
}

function isAssetLikePath(pathname) {
  return /\.[a-z0-9]{1,12}$/i.test(pathname);
}

function isHtmlNavigation(request) {
  const accept = request.headers.get("Accept") || "";
  return (request.method === "GET" || request.method === "HEAD") && accept.includes("text/html");
}

// ---- Google Ads conversion tag (funnel measurement) -----------------------
// The funnel's only conversion measurement used to be dead by construction:
// brief-requested.html shipped a hardcoded gtag loader with a placeholder
// conversion id, and the production CSP blocked googletagmanager.com
// entirely, so the event could never record. The tag is now generated at
// request time from env values and only emitted on /brief-requested when
// BOTH are configured and well-formed; a partial or malformed config emits
// nothing rather than a dead tag. The strict patterns also mean the values
// are safe to interpolate into the generated script.
const GOOGLE_ADS_ID_PATTERN = /^AW-\d{6,15}$/;
const GOOGLE_ADS_LABEL_PATTERN = /^[A-Za-z0-9_-]{10,50}$/;

function googleAdsConversion(env) {
  const id = String(env.GOOGLE_ADS_CONVERSION_ID || "").trim();
  const label = String(env.GOOGLE_ADS_CONVERSION_LABEL || "").trim();
  if (!GOOGLE_ADS_ID_PATTERN.test(id) || !GOOGLE_ADS_LABEL_PATTERN.test(label)) return null;
  return { id, label };
}

function googleAdsLoader({ id }) {
  return `<!-- Google Ads conversion: injected by the worker from env (fires once, on this noindex page only) -->
<script async src="https://www.googletagmanager.com/gtag/js?id=${id}"></script>`;
}

function googleAdsScript({ id, label }) {
  return `window.dataLayer = window.dataLayer || [];
function gtag(){dataLayer.push(arguments);}
gtag('js', new Date());
gtag('config', '${id}');
gtag('event', 'conversion', {
  'send_to': '${id}/${label}'
});
`;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const host = url.hostname.toLowerCase();

    // ---- Canonical host redirect (dogfood: Google still presents the retired
    // self-serve "TinyStudio Agent Desk" title/snippet for tinystudio.io) ----
    // wrangler.jsonc routes www.tinystudio.io/* at this worker, but nothing
    // ever sent that host anywhere: it answered 200 with a byte-identical copy
    // of the public site, on a second hostname and over plain http. Google
    // therefore holds www.tinystudio.io as its own site, with its own site
    // name, and that entity still carries the retired "TinyStudio Agent Desk"
    // name from when the self-serve desk owned the root — which is why the
    // retired product name keeps surfacing for this site even though the apex
    // host's own title, description and site name are long since correct.
    // robots.txt, sitemap.xml and every canonical and og:url on the site name
    // https://tinystudio.io as the single address, so the duplicate host is
    // sent there permanently and drops out of the index. A page-level
    // canonical is only a hint; a 301 is the directive that retires the
    // duplicate site entity along with its stale name.
    if (host === "www.tinystudio.io") {
      const canonical = new URL(url);
      canonical.protocol = "https:";
      canonical.hostname = "tinystudio.io";
      canonical.port = "";
      return withSecurityHeaders(
        new Response(null, {
          status: 301,
          headers: { Location: canonical.toString() }
        })
      );
    }

    if (host === "app.tinystudio.io") {
      return retiredAppResponse();
    }

    if (host === "api.tinystudio.io") {
      return retiredApiResponse();
    }

    if (url.pathname === "/api/signups") {
      return signupResponse(request, env, url);
    }

    if (url.pathname === "/api/agent-audit") {
      return agentAuditResponse(request, env, url);
    }

    if (url.pathname === "/health") {
      return healthResponse(env);
    }

    // Legacy /favicon.ico fallback. Browsers and crawlers still hit
    // /favicon.ico even when every served page declares
    // <link rel="icon" href="/favicon.svg">, and the asset bucket only
    // contains /favicon.svg, so the generic allow-list branch below would
    // 404 it. Fetch the SVG bytes and return them with the conservative
    // image/x-icon content-type (browsers accept SVG bytes here). Modern
    // browsers that already saw the <link rel="icon"> declaration will
    // keep using /favicon.svg; this path only fires for legacy clients.
    if (url.pathname === "/favicon.ico") {
      const icoResponse = await env.ASSETS.fetch(
        assetRequest(url, request, "/favicon.svg")
      );
      if (icoResponse.ok) {
        const headers = new Headers(icoResponse.headers);
        headers.set("Content-Type", "image/x-icon");
        // Allow the legacy fallback to be cached separately from the
        // canonical SVG. A year is fine — the asset is content-hashed by
        // the served URL, not by query string.
        headers.set(
          "Cache-Control",
          "public, max-age=31536000, immutable"
        );
        return withSecurityHeaders(
          new Response(icoResponse.body, {
            status: icoResponse.status,
            statusText: icoResponse.statusText,
            headers
          })
        );
      }
      return notFoundResponse("asset_not_found");
    }

    if (PUBLIC_ASSET_PATHS.has(url.pathname)) {
      const ads = googleAdsConversion(env);
      const isBriefRequestedPage =
        url.pathname === "/brief-requested" || url.pathname === "/brief-requested.html";
      const isBriefRequestedScript = url.pathname === "/brief-requested.js";

      if (ads && request.method === "GET" && (isBriefRequestedPage || isBriefRequestedScript)) {
        if (isBriefRequestedScript) {
          return withSecurityHeaders(
            new Response(googleAdsScript(ads), {
              headers: { "Content-Type": "text/javascript;charset=UTF-8" }
            })
          );
        }
        const assetResponse = await env.ASSETS.fetch(request);
        if (assetResponse.ok) {
          const html = await assetResponse.text();
          const rewritten = html.includes("</head>")
            ? html.replace("</head>", `${googleAdsLoader(ads)}\n</head>`)
            : html;
          return withSecurityHeaders(
            new Response(rewritten, {
              status: assetResponse.status,
              statusText: assetResponse.statusText,
              headers: { "Content-Type": "text/html; charset=utf-8" }
            }),
            GOOGLE_ADS_CSP
          );
        }
      }

      const assetResponse = await env.ASSETS.fetch(request);
      return withSecurityHeaders(assetResponse);
    }

    if ((request.method === "GET" || request.method === "HEAD") && STALE_PUBLIC_PATHS.has(url.pathname)) {
      return rootRedirect(url);
    }

    if (url.pathname.startsWith("/api/")) {
      return notFoundResponse("api_not_found");
    }

    if (isAssetLikePath(url.pathname)) {
      return notFoundResponse("asset_not_found");
    }

    if (!isHtmlNavigation(request)) {
      return notFoundResponse("not_found");
    }

    const indexResponse = await env.ASSETS.fetch(assetRequest(url, request, "/index.html"));
    return withSecurityHeaders(indexResponse);
  }
};
