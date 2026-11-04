import { createRemoteJWKSet, jwtVerify } from "jose";

/** @type {Map<string, ReturnType<typeof createRemoteJWKSet>>} */
const jwksCache = new Map();

/** @param {string} team */
function jwks(team) {
  const cached = jwksCache.get(team);
  if (cached) return cached;
  const fresh = createRemoteJWKSet(new URL(`https://${team}/cdn-cgi/access/certs`));
  jwksCache.set(team, fresh);
  return fresh;
}

/** @param {Env} env @param {Request} request @returns {Promise<{ authenticated: true, email: string } | { authenticated: false, reason: string }>} */
export async function deskIdentity(env, request) {
  const team = String(env.CF_ACCESS_TEAM_DOMAIN || "").trim();
  const aud = String(env.CF_ACCESS_AUD || "").trim();
  const token = request.headers.get("cf-access-jwt-assertion") || "";
  if (!team || !aud || !token) return { authenticated: false, reason: "not_configured" };
  try {
    const { payload } = await jwtVerify(token, jwks(team), { issuer: `https://${team}`, audience: aud });
    const email = typeof payload?.email === "string" ? payload.email.trim().toLowerCase() : "";
    if (!email) return { authenticated: false, reason: "no_email" };
    return { authenticated: true, email };
  } catch {
    return { authenticated: false, reason: "invalid_token" };
  }
}

/** @param {string} reason */
export function deskUnauthorized(reason) {
  return new Response("Desk review needs Cloudflare Access.", {
    status: reason === "invalid_token" ? 403 : 401,
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" }
  });
}

/** @param {Env} env */
export const deskAccessConfigured = (env) =>
  Boolean(String(env.CF_ACCESS_TEAM_DOMAIN || "").trim() && String(env.CF_ACCESS_AUD || "").trim());
