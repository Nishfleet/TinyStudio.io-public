import { deskAccessConfigured, deskIdentity, deskUnauthorized } from "./desk-access.js";
import { correctionLineById, engagementById, ENGAGEMENT_ID, journalEngagementEvent } from "./engagement.js";
import { assertCorrectionLineStatus } from "./guardrails.js";

export const WORDPRESS_CONNECT_APP_NAME = "TinyStudio";
export const CONNECTOR_NOTE =
  "Rank Math and All in One SEO fields write straight through the core REST API, no plugin needed. Yoast SEO fields need the TinyStudio Connector plugin installed first: Plugins, Add New, Upload, activate. A field that still cannot be written goes on the record as a step for the owner and is not charged.";

const WORDPRESS_CONNECT_STATUSES = ["paid", "in_correction"];
const WORDPRESS_APPLY_STATUSES = ["in_correction"];
const WORDPRESS_UNDO_STATUSES = ["in_correction", "proved"];
const WORDPRESS_RESOURCE_TYPES = new Map([
  ["page", "pages"],
  ["post", "posts"],
  ["media", "media"]
]);
const BASE_FIELDS = new Set(["content", "title", "excerpt", "alt_text"]);
const RANK_MATH_META = new Set(["rank_math_title", "rank_math_description", "rank_math_focus_keyword"]);
const AIOSEO_META = new Set(["aioseo_title", "aioseo_description"]);
const YOAST_META = new Set(["_yoast_wpseo_title", "_yoast_wpseo_metadesc"]);
const MAX_APPLY_TARGETS = 50;
const MAX_BODY_CHARS = 20000;

/** @param {string} code @param {string} message */
function coded(code, message) {
  return Object.assign(new Error(message), { code });
}

/** @param {unknown} value @param {number} limit */
function clean(value, limit) {
  return String(value ?? "")
    .trim()
    .slice(0, limit);
}

/** @param {unknown} error */
function errorCode(error) {
  return error instanceof Error && "code" in error && typeof error.code === "string" ? error.code : "";
}

/** @type {Record<string, string>} */
const HTML_ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

/** @param {unknown} value */
const esc = (value) => String(value).replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]);

/** @param {string} code @param {string} message */
function errorResponse(code, message, status = 400) {
  return Response.json(
    { ok: false, error: code, message },
    { status, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } }
  );
}

/** @param {Record<string, unknown>} body @param {number} [status] */
function jsonOk(body, status = 200) {
  return Response.json(
    { ok: true, ...body },
    { status, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } }
  );
}

/** @param {string} title @param {string} body */
function htmlPage(title, body) {
  return new Response(
    `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${esc(title)} | TinyStudio</title>
<style>
body{font:16px/1.5 Georgia,serif;max-width:44rem;margin:2rem auto;padding:0 1rem;color:#111;background:#fff}
code,input{font:inherit;padding:.4rem;border:1px solid #ccc;border-radius:4px;width:100%;box-sizing:border-box}
button,.approve{display:inline-block;font:inherit;padding:.5rem 1rem;border-radius:6px;background:#171713;color:#fff;text-decoration:none;border:none}
.note{color:#555;font-size:.9rem}
form{margin:1rem 0;display:grid;gap:.75rem}
</style>
</head>
<body>
<main>
${body}
</main>
</body>
</html>`,
    {
      status: 200,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        "X-Robots-Tag": "noindex, nofollow",
        "Referrer-Policy": "strict-origin-when-cross-origin",
        "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'"
      }
    }
  );
}

/** @param {Request} request */
function prefersHtml(request) {
  const mode = String(request.headers?.get?.("sec-fetch-mode") || "").toLowerCase();
  if (mode === "navigate") return true;
  return String(request.headers?.get?.("accept") || "").toLowerCase().includes("text/html");
}

/** @param {Request} request @param {URL} url */
function sameOriginPost(request, url) {
  if (request.headers.get("Sec-Fetch-Site") === "cross-site") return false;
  const origin = request.headers.get("Origin") || request.headers.get("Referer") || "";
  if (!origin) return false;
  try {
    return new URL(origin).origin === url.origin;
  } catch {
    return false;
  }
}

/** @param {Request} request @param {Env} env @returns {Promise<{ email?: string, response?: Response }>} */
async function requireDesk(request, env) {
  if (!deskAccessConfigured(env)) {
    return {
      response: new Response("Desk review is not configured.", {
        status: 503,
        headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" }
      })
    };
  }
  const identity = await deskIdentity(env, request);
  if (!identity.authenticated) return { response: deskUnauthorized(identity.reason) };
  return { email: identity.email };
}

/** @param {unknown} value */
export function normalizeSiteUrl(value) {
  const raw = String(value ?? "").trim();
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw coded("BAD_SITE_URL", "the site address is not a URL");
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw coded("BAD_SITE_URL", "the site address must be http or https");
  }
  if (parsed.username || parsed.password) {
    throw coded("BAD_SITE_URL", "the site address must not carry a login");
  }
  return parsed.origin;
}

function aesKeyMaterial(/** @type {Env} */ env) {
  const secret = String(env.WORDPRESS_KEY_ENC_KEY || "").trim();
  if (!secret) return Promise.reject(coded("WORDPRESS_KEY_MISSING", "the key-encryption Worker secret is not set"));
  return crypto.subtle
    .digest("SHA-256", new TextEncoder().encode(secret))
    .then((raw) => crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]));
}

/** @param {Uint8Array} bytes */
function toB64(bytes) {
  let text = "";
  for (const byte of bytes) text += String.fromCharCode(byte);
  return btoa(text);
}

/** @param {string} text */
function fromB64(text) {
  return Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
}

/** @param {Env} env @param {string} plaintext @returns {Promise<string>} */
export async function encryptSecret(env, plaintext) {
  const key = await aesKeyMaterial(env);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(plaintext));
  return `v1:${toB64(iv)}:${toB64(new Uint8Array(cipher))}`;
}

/** @param {Env} env @param {string} stored @returns {Promise<string>} */
export async function decryptSecret(env, stored) {
  const [version, ivB64, cipherB64] = String(stored).split(":");
  if (version !== "v1" || !ivB64 || !cipherB64) {
    throw coded("WORDPRESS_KEY_CORRUPT", "the stored key is unreadable");
  }
  const key = await aesKeyMaterial(env);
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromB64(ivB64) }, key, fromB64(cipherB64));
  return new TextDecoder().decode(plain);
}

/** @param {Env} env @param {string} engagementId @returns {Promise<WordPressConnectionRow | null>} */
export async function connectionForEngagement(env, engagementId) {
  /** @type {WordPressConnectionRow | null} */
  const row = await env.DB.prepare("SELECT * FROM wordpress_connections WHERE engagement_id = ?1")
    .bind(engagementId)
    .first();
  return row ?? null;
}

/** @param {Env} env @param {string} engagementId @param {unknown} siteUrl @param {string} publicOrigin @param {string} at */
export async function startConnect(env, engagementId, siteUrl, publicOrigin, at) {
  const engagement = await engagementById(env, engagementId);
  if (!engagement) throw coded("NOT_FOUND", "engagement not found");
  if (!WORDPRESS_CONNECT_STATUSES.includes(engagement.status)) {
    throw coded("NOT_PAID", "the WordPress connect step waits for the paid engagement");
  }
  const normalized = normalizeSiteUrl(siteUrl);
  const token = crypto.randomUUID();
  const existing = await connectionForEngagement(env, engagementId);
  if (existing && existing.status === "removed") {
    throw coded("WORDPRESS_CLOSED", "the connection was removed when the engagement closed");
  }
  if (existing) {
    await env.DB.prepare(
      "UPDATE wordpress_connections SET site_url = ?1, connect_token = ?2, status = 'connecting', changed_at = ?3 WHERE id = ?4"
    )
      .bind(normalized, token, at, existing.id)
      .run();
  } else {
    await env.DB.prepare(
      "INSERT INTO wordpress_connections (id, engagement_id, request_id, site_url, status, connect_token, created_at, changed_at) VALUES (?1, ?2, ?3, ?4, 'connecting', ?5, ?6, ?6)"
    )
      .bind(crypto.randomUUID(), engagementId, engagement.request_id, normalized, token, at)
      .run();
  }
  const successUrl = `${publicOrigin}/api/wordpress/callback?engagementId=${encodeURIComponent(engagementId)}&token=${encodeURIComponent(token)}`;
  const authorizeUrl = `${normalized}/wp-admin/authorize-application.php?app_name=${encodeURIComponent(WORDPRESS_CONNECT_APP_NAME)}&success_url=${encodeURIComponent(successUrl)}`;
  return { engagementId, authorizeUrl, token, siteUrl: normalized, manualFallback: true };
}

/** @param {Env} env @param {{ engagementId: unknown, token: unknown, siteUrl?: unknown, userLogin?: unknown, appPassword?: unknown }} input @param {string} at */
export async function storeCredentials(env, input, at) {
  const engagementId = clean(input.engagementId, 64);
  if (!ENGAGEMENT_ID.test(engagementId)) throw coded("BAD_ENGAGEMENT", "bad engagement id");
  /** @type {WordPressConnectionRow | null} */
  const row = await connectionForEngagement(env, engagementId);
  if (!row) throw coded("NOT_FOUND", "no connect request for this engagement");
  if (row.status === "removed") throw coded("WORDPRESS_CLOSED", "the connection was removed when the engagement closed");
  if (clean(input.token, 64) !== row.connect_token) throw coded("BAD_TOKEN", "the connect token does not match");
  const normalized = normalizeSiteUrl(input.siteUrl || row.site_url);
  if (normalized !== row.site_url) throw coded("SITE_MISMATCH", "the site does not match the connect request");
  const login = clean(input.userLogin, 120);
  const appPassword = String(input.appPassword ?? "").replace(/\s+/g, "");
  if (!login) throw coded("USER_MISSING", "the WordPress username of the separate TinyStudio user is missing");
  if (appPassword.length < 12 || appPassword.length > 248) {
    throw coded("KEY_INVALID", "that does not look like an application password; never paste the wp-admin password");
  }
  const ciphertext = await encryptSecret(env, appPassword);
  await env.DB.prepare(
    "UPDATE wordpress_connections SET wp_user_login = ?1, password_ciphertext = ?2, status = 'connected', connected_at = ?3, changed_at = ?3 WHERE id = ?4"
  )
    .bind(login, ciphertext, at, row.id)
    .run();
  const engagement = await engagementById(env, engagementId);
  if (engagement) {
    await journalEngagementEvent(env, engagement, {
      type: "wordpress_connected",
      detail: `application password stored for ${row.site_url}`,
      at
    });
  }
  return { engagementId, siteUrl: row.site_url, status: "connected" };
}

/** @param {Env} env @param {string} engagementId @param {string} at */
export async function purgeEngagementKey(env, engagementId, at) {
  /** @type {WordPressConnectionRow | null} */
  const row = await connectionForEngagement(env, engagementId);
  if (!row || row.status === "removed") return false;
  await env.DB.prepare(
    "UPDATE wordpress_connections SET status = 'removed', password_ciphertext = NULL, wp_user_login = NULL, connect_token = '', changed_at = ?1 WHERE id = ?2"
  )
    .bind(at, row.id)
    .run();
  const engagement = await engagementById(env, engagementId);
  if (engagement) {
    await journalEngagementEvent(env, engagement, {
      type: "wordpress_key_deleted",
      detail: "the application password was deleted with the closed engagement",
      at
    });
  }
  return true;
}

/** @param {unknown} field @returns {{ kind: string, metaKey: string } | null} */
export function parseField(field) {
  const name = String(field ?? "").trim();
  if (BASE_FIELDS.has(name)) return { kind: name, metaKey: "" };
  if (!name.startsWith("meta:")) return null;
  const metaKey = name.slice(5).trim();
  if (RANK_MATH_META.has(metaKey) || AIOSEO_META.has(metaKey) || YOAST_META.has(metaKey)) {
    return { kind: "meta", metaKey };
  }
  return null;
}

/** @param {unknown} field */
export function isConnectorField(field) {
  const spec = parseField(field);
  return Boolean(spec && spec.kind === "meta" && YOAST_META.has(spec.metaKey));
}

/** @param {unknown} postType @param {unknown} postId @returns {string | null} */
function resourcePath(postType, postId) {
  const plural = WORDPRESS_RESOURCE_TYPES.get(String(postType ?? "").trim());
  if (!plural) return null;
  return `/wp-json/wp/v2/${plural}/${postId}`;
}

/** @param {any} resource @param {{ kind: string, metaKey: string }} spec */
function resourceValue(resource, spec) {
  if (!resource) return null;
  if (spec.kind === "content") return resource.content?.raw ?? null;
  if (spec.kind === "title") return resource.title?.raw ?? null;
  if (spec.kind === "excerpt") return resource.excerpt?.raw ?? null;
  if (spec.kind === "alt_text") return typeof resource.alt_text === "string" ? resource.alt_text : null;
  const meta = resource.meta;
  if (!meta || typeof meta !== "object" || !(spec.metaKey in meta)) return null;
  const value = meta[spec.metaKey];
  return typeof value === "string" ? value : JSON.stringify(value ?? null);
}

/** @param {{ kind: string, metaKey: string }} spec @param {string} value */
function writePayload(spec, value) {
  if (spec.kind === "meta") return { meta: { [spec.metaKey]: value } };
  return { [spec.kind]: value };
}

/** @param {typeof fetch} fetchImpl @param {WordPressConnectionRow} connection @param {string} appPassword @param {string} path @param {RequestInit} [init] */
async function wpRequest(fetchImpl, connection, appPassword, path, init = {}) {
  const headers = new Headers(init.headers || {});
  headers.set("Authorization", `Basic ${btoa(`${connection.wp_user_login}:${appPassword}`)}`);
  headers.set("Accept", "application/json");
  if (init.body) headers.set("Content-Type", "application/json");
  try {
    const response = await fetchImpl(`${connection.site_url}${path}`, { ...init, headers });
    /** @type {any} */
    let resource = null;
    try {
      resource = await response.json();
    } catch {
      resource = null;
    }
    return { ok: response.ok, status: response.status, resource };
  } catch {
    return { ok: false, status: 0, resource: null };
  }
}

/** @param {Env} env @param {EngagementRef} engagement @param {{ lineId: string, postType: string, postId: number, field: string, oldValue: string | null, hadOld: boolean, status: string, charged: boolean, detail?: string | null }} write @param {string} at */
async function insertWriteRow(env, engagement, write, at) {
  const id = crypto.randomUUID();
  await env.DB.prepare(
    "INSERT INTO wordpress_line_writes (id, engagement_id, request_id, line_id, post_type, post_id, field, old_value, had_old, status, charged, detail, created_at, changed_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?13)"
  )
    .bind(
      id,
      engagement.id,
      engagement.request_id,
      write.lineId,
      write.postType,
      write.postId,
      write.field,
      write.oldValue,
      write.hadOld ? 1 : 0,
      write.status,
      write.charged ? 1 : 0,
      write.detail ?? null,
      at
    )
    .run();
  return id;
}

/** @param {Env} env @param {EngagementRow} engagement @param {string} lineId @param {string} at */
async function markLineRecorded(env, engagement, lineId, at) {
  const line = await correctionLineById(env, lineId);
  if (!line || line.status !== "approved") return;
  assertCorrectionLineStatus(line.status, "recorded");
  await env.DB.prepare("UPDATE correction_lines SET status = 'recorded', changed_at = ?1 WHERE id = ?2 AND status = 'approved'")
    .bind(at, lineId)
    .run();
  await journalEngagementEvent(env, engagement, {
    type: "wordpress_line_applied",
    detail: `${lineId} applied on WordPress`,
    at,
    from: "approved",
    to: "recorded"
  });
}

/** @param {string} siteUrl @param {typeof fetch} fetchImpl */
async function probeConnector(siteUrl, fetchImpl) {
  try {
    const response = await fetchImpl(`${siteUrl}/wp-json/tinystudio-connector/v1`, { method: "GET" });
    return response.ok;
  } catch {
    return false;
  }
}

/** @param {Env} env @param {EngagementRow} engagement @param {WordPressConnectionRow} connection @param {string} appPassword @param {any} target @param {{ fetchImpl: typeof fetch, connectorInstalled: boolean }} options @param {string} at */
async function applyOne(env, engagement, connection, appPassword, target, options, at) {
  /** @type {{ lineId: string, field: string, status: string, pluginNeeded?: string, lineStatus?: string }} */
  const baseResult = { lineId: "", field: "", status: "invalid" };
  const lineId = clean(target?.lineId, 64);
  const postType = clean(target?.postType, 16);
  const postId = Number(target?.postId);
  const field = clean(target?.field, 120);
  const spec = parseField(field);
  const path = resourcePath(postType, postId);
  const result = { ...baseResult, lineId, field };
  if (!ENGAGEMENT_ID.test(lineId) && !/^[0-9a-f-]{36}$/.test(lineId)) return result;
  if (!spec || !path || !Number.isInteger(postId) || postId <= 0) return result;
  if (spec.kind === "alt_text" && postType !== "media") return { ...result, status: "invalid" };
  const line = await correctionLineById(env, lineId);
  if (!line || line.engagement_id !== engagement.id) return { ...result, status: "not_found" };
  if (line.status !== "approved") return { ...result, status: "skipped", lineStatus: line.status };
  if (isConnectorField(field) && !options.connectorInstalled) {
    await insertWriteRow(
      env,
      engagement,
      {
        lineId,
        postType,
        postId,
        field,
        oldValue: null,
        hadOld: false,
        status: "owner_step",
        charged: false,
        detail: "needs the TinyStudio Connector plugin for Yoast fields"
      },
      at
    );
    return { lineId, field, status: "owner_step", pluginNeeded: "TinyStudio Connector" };
  }
  const current = await wpRequest(options.fetchImpl, connection, appPassword, `${path}?context=edit`);
  if (!current.ok) {
    await insertWriteRow(
      env,
      engagement,
      { lineId, postType, postId, field, oldValue: null, hadOld: false, status: "owner_step", charged: false, detail: `wordpress_read_failed_${current.status}` },
      at
    );
    return { lineId, field, status: "owner_step" };
  }
  const oldValue = resourceValue(current.resource, spec);
  const hadOld = typeof oldValue === "string";
  const writeRowId = await insertWriteRow(
    env,
    engagement,
    { lineId, postType, postId, field, oldValue: hadOld ? oldValue : null, hadOld, status: "applied", charged: true, detail: null },
    at
  );
  const written = await wpRequest(options.fetchImpl, connection, appPassword, path, {
    method: "POST",
    body: JSON.stringify(writePayload(spec, line.after_text))
  });
  if (!written.ok) {
    await env.DB.prepare(
      "UPDATE wordpress_line_writes SET status = 'owner_step', charged = 0, detail = ?1, changed_at = ?2 WHERE id = ?3"
    )
      .bind(`wordpress_write_failed_${written.status}`, at, writeRowId)
      .run();
    return { lineId, field, status: "owner_step" };
  }
  return { lineId, field, status: "applied" };
}

/** @param {Env} env @param {string} engagementId @param {any[]} targets @param {{ fetchImpl?: typeof fetch, connector?: boolean }} [options] @param {string} [at] */
export async function applyApprovedLines(env, engagementId, targets, options = {}, at = new Date().toISOString()) {
  const engagement = await engagementById(env, engagementId);
  if (!engagement) throw coded("NOT_FOUND", "engagement not found");
  if (!WORDPRESS_APPLY_STATUSES.includes(engagement.status)) {
    throw coded("NOT_IN_CORRECTION", "approved lines apply while the engagement is in correction");
  }
  const connection = await connectionForEngagement(env, engagementId);
  if (!connection || connection.status !== "connected" || !connection.password_ciphertext || !connection.wp_user_login) {
    throw coded("NOT_CONNECTED", "the engagement has no connected WordPress site");
  }
  const appPassword = await decryptSecret(env, connection.password_ciphertext);
  const fetchImpl = options.fetchImpl || fetch;
  const connectorInstalled = options.connector ?? (await probeConnector(connection.site_url, fetchImpl));
  const results = [];
  for (const target of (Array.isArray(targets) ? targets : []).slice(0, MAX_APPLY_TARGETS)) {
    results.push(await applyOne(env, engagement, connection, appPassword, target, { fetchImpl, connectorInstalled }, at));
  }
  for (const lineId of new Set(results.filter((r) => r.status === "applied").map((r) => r.lineId))) {
    await markLineRecorded(env, engagement, lineId, at);
  }
  return {
    engagementId,
    applied: results.filter((r) => r.status === "applied").length,
    ownerSteps: results.filter((r) => r.status === "owner_step").length,
    results
  };
}

/** @param {Env} env @param {string} engagementId @param {string} lineId @param {{ fetchImpl?: typeof fetch }} [options] @param {string} [at] */
export async function undoLineWrites(env, engagementId, lineId, options = {}, at = new Date().toISOString()) {
  const engagement = await engagementById(env, engagementId);
  if (!engagement) throw coded("NOT_FOUND", "engagement not found");
  if (!WORDPRESS_UNDO_STATUSES.includes(engagement.status)) {
    throw coded("NOT_IN_CORRECTION", "undo runs while the engagement is in correction or proved");
  }
  const connection = await connectionForEngagement(env, engagementId);
  if (!connection || connection.status !== "connected" || !connection.password_ciphertext || !connection.wp_user_login) {
    throw coded("NOT_CONNECTED", "the engagement has no connected WordPress site");
  }
  const appPassword = await decryptSecret(env, connection.password_ciphertext);
  const fetchImpl = options.fetchImpl || fetch;
  /** @type {D1Result<WordPressLineWriteRow>} */
  const rows = await env.DB.prepare(
    "SELECT * FROM wordpress_line_writes WHERE engagement_id = ?1 AND line_id = ?2 AND status = 'applied' AND charged = 1 ORDER BY created_at ASC"
  )
    .bind(engagementId, lineId)
    .all();
  const undone = [];
  for (const row of rows.results ?? []) {
    const spec = parseField(row.field);
    const path = resourcePath(row.post_type, row.post_id);
    if (!spec || !path) continue;
    const restoreValue = Number(row.had_old) === 1 ? (row.old_value ?? "") : "";
    const written = await wpRequest(fetchImpl, connection, appPassword, path, {
      method: "POST",
      body: JSON.stringify(writePayload(spec, restoreValue))
    });
    if (!written.ok) {
      undone.push({ field: row.field, status: "failed" });
      continue;
    }
    await env.DB.prepare("UPDATE wordpress_line_writes SET status = 'undone', changed_at = ?1 WHERE id = ?2")
      .bind(at, row.id)
      .run();
    await journalEngagementEvent(env, engagement, { type: "wordpress_line_undone", detail: `${lineId} ${row.field} restored`, at });
    undone.push({ field: row.field, status: "undone" });
  }
  return { engagementId, lineId, undone };
}

/** @param {Request} request @returns {Promise<any>} */
async function readJsonBody(request) {
  const text = await request.text();
  if (text.length > MAX_BODY_CHARS) throw coded("REQUEST_TOO_LARGE", "the request body is too large");
  return JSON.parse(text);
}

/** @param {{ engagementId: string, authorizeUrl: string, token: string, siteUrl: string }} connect */
function connectPage(connect) {
  return htmlPage(
    "Connect TinyStudio to WordPress",
    `<h1>Connect TinyStudio to WordPress</h1>
<ol>
<li>On the site's WordPress, create a separate user for TinyStudio with the Editor role. Never hand over an owner login, and never give us a wp-admin password.</li>
<li>Click Approve below. WordPress core (5.6 and later) shows its own Application Passwords approve screen; the customer clicks Approve and the key comes back here. The customer can revoke it any time under Users, then Profile.</li>
<li>If the site's WordPress refuses our return address, create the application password under Users, then Profile, then Application Passwords, and paste it below.</li>
</ol>
<p><a class="approve" href="${esc(connect.authorizeUrl)}" rel="noreferrer">Approve on WordPress</a></p>
<p class="note">${esc(CONNECTOR_NOTE)}</p>
<form method="post" action="/api/wordpress/callback">
<input type="hidden" name="engagementId" value="${esc(connect.engagementId)}">
<input type="hidden" name="token" value="${esc(connect.token)}">
<input type="hidden" name="siteUrl" value="${esc(connect.siteUrl)}">
<label>WordPress username of the separate TinyStudio user<br><input name="userLogin" required autocomplete="off"></label>
<label>Application password, never the wp-admin password<br><input name="appPassword" required autocomplete="off"></label>
<button type="submit">Save the key</button>
</form>
<p class="note">The key is encrypted before it is stored, is read only by the applier, never appears in a log, a record or an email, and is deleted when the engagement closes.</p>`
  );
}

/** @param {string} siteUrl */
function connectedPage(siteUrl) {
  return htmlPage(
    "WordPress connected",
    `<h1>Connected.</h1>
<p>TinyStudio can now apply the approved lines on ${esc(siteUrl)} through the core REST API. The old value of every field is saved first, and one click puts it back.</p>
<p class="note">${esc(CONNECTOR_NOTE)}</p>`
  );
}

/** @param {string} siteUrl */
function declinedPage(siteUrl) {
  return htmlPage("Connection declined", `<h1>Not connected.</h1><p>The approve screen was closed without approving. Nothing was stored for ${esc(siteUrl)}.</p>`);
}

/** @param {Request} request @param {Env} env @param {URL} url */
async function connectResponse(request, env, url) {
  if (request.method !== "GET") return errorResponse("method_not_allowed", "use GET", 405);
  const desk = await requireDesk(request, env);
  if (desk.response) return desk.response;
  const engagementId = clean(url.searchParams.get("engagementId"), 64);
  if (!ENGAGEMENT_ID.test(engagementId)) return errorResponse("bad_engagement", "bad engagement id");
  const siteUrl = clean(url.searchParams.get("siteUrl"), 300);
  const at = new Date().toISOString();
  const connect = await startConnect(env, engagementId, siteUrl, url.origin, at);
  if (prefersHtml(request)) return connectPage(connect);
  return jsonOk({ engagementId: connect.engagementId, authorizeUrl: connect.authorizeUrl, siteUrl: connect.siteUrl, manualFallback: connect.manualFallback, connectorNote: CONNECTOR_NOTE });
}

/** @param {Request} request @param {Env} env @param {URL} url */
async function callbackResponse(request, env, url) {
  if (request.method !== "GET" && request.method !== "POST") return errorResponse("method_not_allowed", "use GET or POST", 405);
  if (request.method === "POST" && !sameOriginPost(request, url)) return errorResponse("cross_site_blocked", "cross-site posts are blocked", 403);
  /** @type {Record<string, string>} */
  const params = Object.fromEntries(request.method === "GET" ? url.searchParams : new URLSearchParams(await request.text()));
  const at = new Date().toISOString();
  if (params.error) return declinedPage(clean(params.siteUrl || params.site_url, 300));
  const result = await storeCredentials(
    env,
    {
      engagementId: clean(params.engagementId, 64),
      token: clean(params.token, 64),
      siteUrl: params.siteUrl || params.site_url,
      userLogin: params.userLogin || params.user_login,
      appPassword: params.appPassword || params.password
    },
    at
  );
  if (prefersHtml(request)) return connectedPage(result.siteUrl);
  return jsonOk(result);
}

/** @param {Request} request @param {Env} env @param {URL} url */
async function applyResponse(request, env, url) {
  if (request.method !== "POST") return errorResponse("method_not_allowed", "use POST", 405);
  if (!sameOriginPost(request, url)) return errorResponse("cross_site_blocked", "cross-site posts are blocked", 403);
  const desk = await requireDesk(request, env);
  if (desk.response) return desk.response;
  const body = await readJsonBody(request);
  const engagementId = clean(body?.engagementId, 64);
  if (!ENGAGEMENT_ID.test(engagementId)) return errorResponse("bad_engagement", "bad engagement id");
  const targets = Array.isArray(body?.targets) ? body.targets.slice(0, MAX_APPLY_TARGETS) : [];
  if (!targets.length) return errorResponse("targets_missing", "the apply call needs the lines and their targets");
  return jsonOk(await applyApprovedLines(env, engagementId, targets, {}, new Date().toISOString()));
}

/** @param {Request} request @param {Env} env @param {URL} url */
async function undoResponse(request, env, url) {
  if (request.method !== "POST") return errorResponse("method_not_allowed", "use POST", 405);
  if (!sameOriginPost(request, url)) return errorResponse("cross_site_blocked", "cross-site posts are blocked", 403);
  const desk = await requireDesk(request, env);
  if (desk.response) return desk.response;
  const body = await readJsonBody(request);
  const engagementId = clean(body?.engagementId, 64);
  const lineId = clean(body?.lineId, 64);
  if (!ENGAGEMENT_ID.test(engagementId)) return errorResponse("bad_engagement", "bad engagement id");
  if (!lineId) return errorResponse("line_missing", "the undo call needs the line");
  const result = await undoLineWrites(env, engagementId, lineId, {}, new Date().toISOString());
  return jsonOk(result);
}

/** @param {Request} request @param {Env} env @param {URL} url */
export async function wordpressApi(request, env, url) {
  try {
    if (url.pathname === "/api/wordpress/connect") return await connectResponse(request, env, url);
    if (url.pathname === "/api/wordpress/callback") return await callbackResponse(request, env, url);
    if (url.pathname === "/api/wordpress/apply") return await applyResponse(request, env, url);
    if (url.pathname === "/api/wordpress/undo") return await undoResponse(request, env, url);
    return errorResponse("not_found", "unknown WordPress endpoint", 404);
  } catch (error) {
    const code = errorCode(error) || "wordpress_action_failed";
    return errorResponse(code, error instanceof Error ? error.message : "WordPress action failed", code === "NOT_FOUND" ? 404 : 400);
  }
}
