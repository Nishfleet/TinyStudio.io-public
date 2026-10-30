import { createRemoteJWKSet, jwtVerify } from "jose";

const jwksCache = new Map();

function jwks(team) {
  if (!jwksCache.has(team)) {
    jwksCache.set(team, createRemoteJWKSet(new URL(`https://${team}/cdn-cgi/access/certs`)));
  }
  return jwksCache.get(team);
}

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

export function deskUnauthorized(reason) {
  return new Response("Desk review needs Cloudflare Access.", {
    status: reason === "invalid_token" ? 403 : 401,
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" }
  });
}

export const deskAccessConfigured = (env) =>
  Boolean(String(env.CF_ACCESS_TEAM_DOMAIN || "").trim() && String(env.CF_ACCESS_AUD || "").trim());
