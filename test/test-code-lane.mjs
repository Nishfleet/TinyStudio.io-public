import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { decodeJwt } from "jose";
import {
  appConfigured,
  appJwt,
  applyApprovedLines,
  cleanFilePath,
  cleanSiteFolder,
  codeLaneConnection,
  codeLaneResponse,
  connectCodeLane,
  installationToken,
  pathInsideFolder,
  recheckCodeLane,
  setLineFilePath
} from "../src/code-lane.js";
import { addCorrectionLine, advanceEngagement, openEngagement, reviewCorrectionLine } from "../src/engagement.js";
import worker from "../src/worker.js";

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

const APP_KEY_PAIR = generateKeyPairSync("rsa", { modulusLength: 2048 });
const APP_PRIVATE_KEY = APP_KEY_PAIR.privateKey.export({ type: "pkcs8", format: "pem" }).toString();

function githubStub({ repoMissing = false, fileOverrides = new Map(), pullState = null } = {}) {
  const calls = [];
  const files = new Map([
    ["site/index.html", "<h1>Welcome</h1>\n<p>Book a visit today.</p>\n"],
    ["src/private.js", "const secret = 'private code';\n"]
  ]);
  for (const [path, body] of fileOverrides) files.set(path, body);
  const branches = new Set(["refs/heads/main"]);
  const pulls = new Map();
  let nextCommit = 0;
  let nextPull = 7;
  const fetchStub = async (url, init = {}) => {
    const target = new URL(String(url));
    const body = init.body ? JSON.parse(init.body) : null;
    const call = { method: init.method ?? "GET", path: `${target.pathname}${target.search}`, body };
    calls.push(call);
    const respond = (payload, status = 200) =>
      new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json" } });
    if (target.pathname === "/app/installations/4242/access_tokens") {
      if (init.method !== "POST") return respond({ message: "bad method" }, 405);
      return respond({ token: "ghs_stub_token", expires_at: "2026-11-12T23:00:00Z" });
    }
    if (repoMissing) return respond({ message: "Not Found" }, 404);
    if (target.pathname === "/repos/acme/site-repo") return respond({ default_branch: "main" });
    if (target.pathname === "/repos/acme/site-repo/git/ref/heads/main") return respond({ object: { sha: "sha-base" } });
    if (target.pathname === "/repos/acme/site-repo/git/refs") {
      if (branches.has(body.ref)) return respond({ message: "Reference already exists" }, 422);
      branches.add(body.ref);
      return respond({ ref: body.ref });
    }
    const contents = target.pathname.match(/^\/repos\/acme\/site-repo\/contents\/(.+)$/);
    if (contents) {
      const path = decodeURIComponent(contents[1]);
      if (!files.has(path)) return respond({ message: "Not Found" }, 404);
      if (init.method === "PUT") {
        nextCommit += 1;
        files.set(path, Buffer.from(body.content, "base64").toString("utf8"));
        return respond({ commit: { sha: `commit-${nextCommit}` } });
      }
      return respond({ sha: `file-sha-${path}`, content: Buffer.from(files.get(path)).toString("base64") });
    }
    if (target.pathname === "/repos/acme/site-repo/pulls" && init.method === "POST") {
      const number = nextPull;
      nextPull += 1;
      pulls.set(number, { state: "open", merged: false, base: { ref: body.base } });
      return respond({ number, html_url: `https://github.com/acme/site-repo/pull/${number}` });
    }
    const pull = target.pathname.match(/^\/repos\/acme\/site-repo\/pulls\/(\d+)$/);
    if (pull) {
      const number = Number(pull[1]);
      const stored = pulls.get(number);
      const state = pullState ?? stored.state;
      return respond({ state: state === "merged" ? "closed" : state, merged: state === "merged", base: { ref: stored.base.ref } });
    }
    return respond({ message: "Not Found" }, 404);
  };
  return { calls, files, pulls, fetchStub };
}

async function freshEnv(github = {}) {
  const sqlite = new DatabaseSync(":memory:");
  for (const file of readdirSync(new URL("../migrations/", import.meta.url)).sort()) {
    sqlite.exec(readFileSync(new URL(`../migrations/${file}`, import.meta.url), "utf8"));
  }
  sqlite.prepare(
    "INSERT INTO appraisal_requests (id, site_url, business_type, avg_deal_value, monthly_leads, name, email, month, created_at) VALUES ('req-1','https://clinic.example','Dental clinic',8000,40,'Dana Reyes','dana@clinic.example','2026-10','2026-10-12T09:00:00.000Z')"
  ).run();
  const stub = githubStub(github);
  const env = {
    DB: d1(sqlite),
    GITHUB_APP_ID: "123456",
    GITHUB_APP_PRIVATE_KEY: APP_PRIVATE_KEY,
    GITHUB_FETCH: stub.fetchStub,
    ...github.env
  };
  return { sqlite, env, stub };
}

async function engagementWithApprovedLine(env, { folder = "site", path = "site/index.html", namePath = true } = {}) {
  let current = await openEngagement(env, "req-1", "2026-10-12T09:00:00.000Z");
  current = await advanceEngagement(env, current, "appraised", { type: "audit_recorded", detail: "appraised", at: "2026-10-12T09:30:00.000Z" });
  current = await advanceEngagement(env, current, "proposed", { type: "status_changed", detail: "proposal", at: "2026-10-12T09:45:00.000Z" });
  current = await advanceEngagement(env, current, "paid", { type: "payment_recorded", detail: "pay_1", at: "2026-10-12T10:00:00.000Z" });
  current = await advanceEngagement(env, current, "in_correction", { type: "status_changed", detail: "start", at: "2026-10-12T11:00:00.000Z" });
  const line = await addCorrectionLine(
    env,
    current,
    { faultId: "f1", faultTitle: "Home page loads in 6.1 seconds", beforeText: "<p>Book a visit today.</p>", afterText: "<p>Call today: a visit takes five minutes to book.</p>", legalCopy: 0 },
    "2026-10-12T11:30:00.000Z"
  );
  await connectCodeLane(env, { requestId: "req-1", repo: "acme/site-repo", installationId: "4242", siteFolder: folder }, "Jev", "2026-10-12T12:00:00.000Z");
  if (namePath) await setLineFilePath(env, line.id, path, "2026-10-12T12:10:00.000Z");
  const approved = await reviewCorrectionLine(env, line, "approve", { reviewer: "Jev", note: "", at: "2026-10-12T12:20:00.000Z" });
  return { engagement: current, line: approved };
}

test("code lane: the connect step names one repository and one folder on the record", async () => {
  const { env, sqlite } = await freshEnv();
  await openEngagement(env, "req-1", "2026-10-12T09:00:00.000Z");
  const connection = await connectCodeLane(env, { requestId: "req-1", repo: "acme/site-repo", installationId: "4242", siteFolder: "site" }, "Jev", "2026-10-12T09:30:00.000Z");
  assert.equal(connection.repo_owner, "acme");
  assert.equal(connection.repo_name, "site-repo");
  assert.equal(connection.site_folder, "site");
  assert.equal((await codeLaneConnection(env, "req-1")).installation_id, "4242");
  await assert.rejects(connectCodeLane(env, { requestId: "req-1", repo: "https://github.com/acme/site-repo", installationId: "4242", siteFolder: "site" }, "Jev", "2026-10-12T09:30:00.000Z"), /owner\/name/);
  await assert.rejects(connectCodeLane(env, { requestId: "req-1", repo: "acme/site-repo", installationId: "not-a-number", siteFolder: "site" }, "Jev", "2026-10-12T09:30:00.000Z"), /installation id/);
  await assert.rejects(connectCodeLane(env, { requestId: "req-1", repo: "acme/site-repo", installationId: "4242", siteFolder: "../elsewhere" }, "Jev", "2026-10-12T09:30:00.000Z"), /no \.\. steps/);
  await assert.rejects(connectCodeLane(env, { requestId: "req-missing", repo: "acme/site-repo", installationId: "4242", siteFolder: "site" }, "Jev", "2026-10-12T09:30:00.000Z"), /appraisal request not found/);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM code_lane_connections").get().n, 1);
});

test("code lane: paths are cleaned, kept inside the named folder and nowhere else", async () => {
  const { env } = await freshEnv();
  assert.equal(cleanSiteFolder(" /site/ "), "site");
  assert.equal(cleanSiteFolder("./site"), "");
  assert.equal(cleanFilePath("/site/index.html"), "site/index.html");
  assert.equal(cleanFilePath("site/../../etc/passwd"), "");
  assert.equal(pathInsideFolder("site/index.html", "site"), true);
  assert.equal(pathInsideFolder("src/private.js", "site"), false);
  assert.equal(pathInsideFolder("site/index.html", "."), true);
  const { line } = await engagementWithApprovedLine(env);
  await assert.rejects(setLineFilePath(env, line.id, "src/private.js", "2026-10-12T12:15:00.000Z"), /limited to the site folder/);
  const named = await setLineFilePath(env, line.id, "site/index.html", "2026-10-12T12:15:00.000Z");
  assert.equal(named.file_path, "site/index.html");
});

test("code lane: the app token is signed by the app key and never stored", async () => {
  const { env, sqlite } = await freshEnv();
  assert.equal(appConfigured(env), true);
  const jwt = await appJwt(env, Math.floor(Date.parse("2026-11-12T12:00:00Z") / 1000));
  const claims = decodeJwt(jwt);
  assert.equal(claims.iss, "123456");
  assert.equal(claims.iat, Math.floor(Date.parse("2026-11-12T12:00:00Z") / 1000) - 60);
  await assert.rejects(appJwt({ ...env, GITHUB_APP_ID: "" }, 0), /account step/);
  await assert.rejects(appJwt({ ...env, GITHUB_APP_PRIVATE_KEY: "" }, 0), /account step/);
  const withoutKey = await freshEnv({ env: { GITHUB_APP_ID: "", GITHUB_APP_PRIVATE_KEY: "" } });
  assert.equal(appConfigured(withoutKey.env), false);
  const connection = await connectCodeLane(env, { requestId: "req-1", repo: "acme/site-repo", installationId: "4242", siteFolder: "site" }, "Jev", "2026-10-12T09:30:00.000Z");
  const token = await installationToken(env, connection);
  assert.equal(token, "ghs_stub_token");
  const stored = sqlite.prepare("SELECT COUNT(*) AS n FROM code_lane_connections WHERE installation_id LIKE 'ghs%'").get().n;
  assert.equal(stored, 0, "no installation token is written to any table");
});

test("code lane: an approved list becomes one pull request, one commit per line, each named by its line", async () => {
  const { env, stub } = await freshEnv();
  const { engagement, line } = await engagementWithApprovedLine(env);
  const result = await applyApprovedLines(env, { engagementId: engagement.id }, "Jev", "2026-10-12T13:00:00.000Z");
  assert.equal(result.prUrl, "https://github.com/acme/site-repo/pull/7");
  assert.equal(result.branch, `tinystudio/correction-${engagement.id.slice(0, 8)}`);
  assert.deepEqual(result.lines, [{ lineId: line.id, title: line.fault_title, path: "site/index.html", commit: "commit-1" }]);
  const puts = stub.calls.filter((call) => call.method === "PUT" && call.path.startsWith("/repos/acme/site-repo/contents/"));
  assert.equal(puts.length, 1, "one commit per line");
  assert.match(puts[0].body.message, new RegExp(`correction line ${line.id.slice(0, 8)}: Home page loads in 6.1 seconds`));
  assert.equal(stub.files.get("site/index.html"), "<h1>Welcome</h1>\n<p>Call today: a visit takes five minutes to book.</p>\n");
  const pullCall = stub.calls.find((call) => call.path === "/repos/acme/site-repo/pulls");
  assert.ok(pullCall.body.body.includes("<p>Book a visit today.</p>"), "the pull request body carries the before state");
  assert.ok(pullCall.body.body.includes("<p>Call today: a visit takes five minutes to book.</p>"), "the pull request body carries the after state");
  assert.ok(pullCall.body.body.includes("reverting this pull request undoes the whole order"), "the pull request body states the undo honestly");
  assert.ok(pullCall.body.body.includes("owner hold"), "the pull request is an owner hold");
  assert.ok(pullCall.body.body.includes("`site` in `acme/site-repo`"), "the pull request names the folder it is limited to");
  const tokenCalls = stub.calls.filter((call) => call.path === "/app/installations/4242/access_tokens");
  assert.equal(tokenCalls.length, 1, "one installation token per job");
});

test("code lane: the order stops before anything is written when the lines are not ready", async () => {
  const { env } = await freshEnv();
  const engagement = await openEngagement(env, "req-1", "2026-10-12T09:00:00.000Z");
  await assert.rejects(applyApprovedLines(env, { engagementId: "no-such-engagement" }, "Jev", "2026-10-12T13:00:00.000Z"), /engagement not found/);
  await assert.rejects(applyApprovedLines(env, { engagementId: engagement.id }, "Jev", "2026-10-12T13:00:00.000Z"), /only while the correction is in progress/);
  const { env: env2 } = await freshEnv();
  const unnamed = await engagementWithApprovedLine(env2, { namePath: false });
  await assert.rejects(applyApprovedLines(env2, { engagementId: unnamed.engagement.id }, "Jev", "2026-10-12T13:00:00.000Z"), /has no file path/);
  const { env: env3 } = await freshEnv({ fileOverrides: new Map([["site/index.html", "<h1>Something else entirely</h1>\n"]]) });
  const applied = await engagementWithApprovedLine(env3);
  await assert.rejects(applyApprovedLines(env3, { engagementId: applied.engagement.id }, "Jev", "2026-10-12T13:00:00.000Z"), /before state.*not in/);
  const { env: env4 } = await freshEnv({ fileOverrides: new Map([["site/index.html", "<p>Book a visit today.</p>\n<p>Book a visit today.</p>\n"]]) });
  const twice = await engagementWithApprovedLine(env4);
  await assert.rejects(applyApprovedLines(env4, { engagementId: twice.engagement.id }, "Jev", "2026-10-12T13:00:00.000Z"), /appears 2 times/);
  const { env: env5 } = await freshEnv({ repoMissing: true });
  const missing = await engagementWithApprovedLine(env5);
  await assert.rejects(applyApprovedLines(env5, { engagementId: missing.engagement.id }, "Jev", "2026-10-12T13:00:00.000Z"), /did not answer/);
});

test("code lane: an open order is a hold, and the re-check after the merge marks each line fixed or not fixed", async () => {
  const { env, stub } = await freshEnv();
  const { engagement } = await engagementWithApprovedLine(env);
  await applyApprovedLines(env, { engagementId: engagement.id }, "Jev", "2026-10-12T13:00:00.000Z");
  const open = await recheckCodeLane(env, { engagementId: engagement.id }, "Jev", "2026-10-12T14:00:00.000Z");
  assert.equal(open.status, "open", "the merged decision belongs to the owner, not to us");
  stub.pulls.get(7).state = "merged";
  const rechecked = await recheckCodeLane(env, { engagementId: engagement.id }, "Jev", "2026-10-12T15:00:00.000Z");
  assert.equal(rechecked.status, "rechecked");
  assert.equal(rechecked.lines[0].fixed, true);
});

test("code lane: the desk route answers behind the same Access door as the rest of the desk", async () => {
  const { env } = await freshEnv();
  const unconfigured = new Request("https://tinystudio.io/api/desk/code-lane/apply", { method: "POST" });
  const blocked = await worker.fetch(unconfigured, env, { ctx: { waitUntil() {} } });
  assert.equal(blocked.status, 503);
  const envWithAccess = { ...env, CF_ACCESS_TEAM_DOMAIN: "team.example", CF_ACCESS_AUD: "aud" };
  const request = new Request("https://tinystudio.io/api/desk/code-lane/apply", { method: "POST" });
  const unauthorized = await codeLaneResponse(request, envWithAccess, new URL("https://tinystudio.io/api/desk/code-lane/apply"));
  assert.equal(unauthorized.status, 401);
  const crossSite = await codeLaneResponse(
    new Request("https://tinystudio.io/api/desk/code-lane/apply", { method: "POST", headers: { origin: "https://elsewhere.example" } }),
    envWithAccess,
    new URL("https://tinystudio.io/api/desk/code-lane/apply")
  );
  assert.equal(crossSite.status, 403);
  const unknown = await codeLaneResponse(
    new Request("https://tinystudio.io/api/desk/code-lane/nope", { method: "POST", headers: { cf_access_jwt: "x" } }),
    envWithAccess,
    new URL("https://tinystudio.io/api/desk/code-lane/nope")
  );
  assert.equal(unknown.status, 401, "an unknown action still needs the reviewer first");
});
