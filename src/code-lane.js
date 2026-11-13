import { SignJWT, importPKCS8 } from "jose";
import { assertCorrectionLineStatus } from "./guardrails.js";
import { correctionLineById, correctionLines, engagementById, journalEngagementEvent } from "./engagement.js";
import { deskAccessConfigured, deskIdentity, deskUnauthorized } from "./desk-access.js";

const GITHUB_API_BASE = "https://api.github.com";
const REPO_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9.-]*\/[A-Za-z0-9._-]+$/;
const INSTALLATION_ID_PATTERN = /^\d{1,16}$/;
const FILE_PATH_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/;
const BRANCH_PREFIX = "tinystudio/correction-";
const UNDO_NOTE =
  "Undo: reverting this pull request undoes the whole order. Undoing one line is a new small change, which TinyStudio makes on request.";

/** @param {string} code @param {string} message */
function fail(code, message) {
  return Object.assign(new Error(message), { code });
}

/** @param {unknown} value @param {number} limit */
function clean(value, limit) {
  return String(value ?? "").trim().slice(0, limit);
}

/** @param {unknown} folder */
export function cleanSiteFolder(folder) {
  const cleaned = clean(folder, 400).replace(/^\/+|\/+$/g, "");
  if (!cleaned || cleaned === ".") return ".";
  if (cleaned.split("/").some((part) => !part || part === "." || part === "..")) return "";
  return cleaned;
}

/** @param {unknown} filePath */
export function cleanFilePath(filePath) {
  const cleaned = clean(filePath, 400).replace(/^\/+/, "");
  if (!cleaned || !FILE_PATH_PATTERN.test(cleaned)) return "";
  if (cleaned.split("/").some((part) => !part || part === "." || part === "..")) return "";
  return cleaned;
}

/** @param {string} filePath @param {string} folder */
export function pathInsideFolder(filePath, folder) {
  if (folder === ".") return true;
  return filePath === folder || filePath.startsWith(`${folder}/`);
}

/** @param {Env} env @param {string} requestId @returns {Promise<CodeLaneConnectionRow | null>} */
export async function codeLaneConnection(env, requestId) {
  /** @type {CodeLaneConnectionRow | null} */
  const row = await env.DB.prepare("SELECT * FROM code_lane_connections WHERE request_id = ?1").bind(requestId).first();
  return row ?? null;
}

/** @param {Env} env @param {{ requestId: unknown, repo: unknown, installationId: unknown, siteFolder: unknown }} input @param {string} reviewer @param {string} at */
export async function connectCodeLane(env, input, reviewer, at) {
  const requestId = clean(input.requestId, 64);
  /** @type {AppraisalRequestRow | null} */
  const request = await env.DB.prepare("SELECT id FROM appraisal_requests WHERE id = ?1").bind(requestId).first();
  if (!request) throw fail("NOT_FOUND", "appraisal request not found");
  const repo = clean(input.repo, 400);
  if (!REPO_NAME_PATTERN.test(repo)) throw fail("BAD_REPO", "the repository is owner/name");
  const [repoOwner, repoName] = repo.split("/");
  const installationId = clean(input.installationId, 16);
  if (!INSTALLATION_ID_PATTERN.test(installationId)) throw fail("BAD_INSTALLATION", "the installation id is the number in the app installation URL");
  const siteFolder = cleanSiteFolder(input.siteFolder);
  if (!siteFolder) throw fail("BAD_FOLDER", "the site folder is a path inside the repository, with no .. steps");
  const connectedBy = clean(reviewer, 200);
  if (!connectedBy) throw fail("BAD_REVIEWER", "the connect step needs the reviewer");
  await env.DB.prepare(
    `INSERT INTO code_lane_connections
       (request_id, repo_owner, repo_name, installation_id, site_folder, connected_by, created_at, changed_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)
     ON CONFLICT (request_id) DO UPDATE SET
       repo_owner = excluded.repo_owner, repo_name = excluded.repo_name,
       installation_id = excluded.installation_id, site_folder = excluded.site_folder,
       connected_by = excluded.connected_by, changed_at = excluded.changed_at`
  )
    .bind(requestId, repoOwner, repoName, installationId, siteFolder, connectedBy, at)
    .run();
  const connection = await codeLaneConnection(env, requestId);
  if (!connection) throw fail("CONNECT_FAILED", "the code lane connection could not be read back");
  return connection;
}

/** @param {CorrectionLineRow} line @returns {EngagementRef} */
function lineJournalRow(line) {
  return { id: line.engagement_id, request_id: line.request_id, status: line.status };
}

/** @param {Env} env @param {string} lineId @param {unknown} rawPath @param {string} at */
export async function setLineFilePath(env, lineId, rawPath, at) {
  const line = await correctionLineById(env, lineId);
  if (!line) throw fail("NOT_FOUND", "correction line not found");
  const filePath = cleanFilePath(rawPath);
  if (!filePath) throw fail("BAD_PATH", "the file path is a path inside the repository, with no .. steps");
  const connection = await codeLaneConnection(env, line.request_id);
  if (!connection) throw fail("NOT_CONNECTED", "connect the code lane on the record before naming files");
  if (!pathInsideFolder(filePath, connection.site_folder)) {
    throw fail("OUTSIDE_FOLDER", `the work is limited to the ${connection.site_folder} folder of ${connection.repo_owner}/${connection.repo_name}`);
  }
  await env.DB.prepare("UPDATE correction_lines SET file_path = ?1, changed_at = ?2 WHERE id = ?3")
    .bind(filePath, at, line.id)
    .run();
  await journalEngagementEvent(env, lineJournalRow(line), { type: "code_lane_file_named", detail: `${line.id} ${filePath}`, at });
  return { ...line, file_path: filePath };
}

/** @param {Env} env */
export function appConfigured(env) {
  return Boolean(clean(env.GITHUB_APP_ID, 32) && clean(env.GITHUB_APP_PRIVATE_KEY, 64));
}

/** @param {Env} env @param {number} now @returns {Promise<string>} */
export async function appJwt(env, now) {
  const appId = clean(env.GITHUB_APP_ID, 32);
  const pem = String(env.GITHUB_APP_PRIVATE_KEY ?? "").replace(/\\n/g, "\n").trim();
  if (!appId || !pem) {
    throw fail(
      "APP_NOT_CONFIGURED",
      "creating the TinyStudio GitHub App is an account step: set GITHUB_APP_ID and GITHUB_APP_PRIVATE_KEY after the app exists"
    );
  }
  const key = await importPKCS8(pem, "RS256");
  return new SignJWT({})
    .setProtectedHeader({ alg: "RS256", typ: "JWT" })
    .setIssuer(appId)
    .setIssuedAt(now - 60)
    .setExpirationTime(now + 480)
    .sign(key);
}

/** @param {Env} env @param {CodeLaneConnectionRow} connection @returns {Promise<string>} */
export async function installationToken(env, connection) {
  const jwt = await appJwt(env, Math.floor(Date.now() / 1000));
  const response = await githubFetch(env, "POST", `/app/installations/${connection.installation_id}/access_tokens`, jwt, "{}");
  const body = await response.json();
  if (!response.ok || typeof body?.token !== "string" || !body.token) {
    throw fail("TOKEN_FAILED", "the installation token exchange failed; check the app installation on the repository");
  }
  return body.token;
}

/** @param {Env} env @param {string} method @param {string} path @param {string | null} bearer @param {string | null} body */
async function githubFetch(env, method, path, bearer, body) {
  const send = env.GITHUB_FETCH || fetch;
  /** @type {Record<string, string>} */
  const headers = {
    accept: "application/vnd.github+json",
    "x-github-api-version": "2022-11-28",
    "user-agent": "tinystudio-code-lane"
  };
  if (bearer) headers.authorization = `Bearer ${bearer}`;
  if (body !== null) headers["content-type"] = "application/json";
  return send(`${GITHUB_API_BASE}${path}`, { method, headers, body });
}

/** @param {Response} response @param {string} code @param {string} message */
async function assertOk(response, code, message) {
  if (!response.ok) throw fail(code, `${message}: ${response.status}`);
  return response.json();
}

/** @param {string} text */
function base64(text) {
  const bytes = new TextEncoder().encode(text);
  const chunkSize = 0x8000;
  let binary = "";
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary);
}

/** @param {string} text */
function decodeBase64(text) {
  return new TextDecoder().decode(Uint8Array.from(atob(text.replace(/\s/g, "")), (ch) => ch.charCodeAt(0)));
}

/** @param {CorrectionLineRow} line */
function lineCommitMessage(line) {
  return `correction line ${line.id.slice(0, 8)}: ${line.fault_title}`;
}

/** @param {CodeLaneConnectionRow} connection @param {{ defaultBranch: string, branch: string, lines: { line: CorrectionLineRow, commit: string }[] }} order */
function pullRequestBody(connection, { defaultBranch, branch, lines }) {
  const sections = lines.map(({ line, commit }) =>
    [
      `### ${line.fault_title}`,
      `File \`${line.file_path}\` on \`${branch}\`, commit ${commit}.`,
      "",
      "Before:",
      "",
      "```",
      line.before_text,
      "```",
      "",
      "After:",
      "",
      "```",
      line.after_text,
      "```"
    ].join("\n")
  );
  return [
    `Site folder \`${connection.site_folder}\` in \`${connection.repo_owner}/${connection.repo_name}\`; the base branch is \`${defaultBranch}\`.`,
    "",
    ...sections,
    "",
    UNDO_NOTE,
    "",
    "This pull request is an owner hold: TinyStudio does not merge it. The owner reviews it and merges it."
  ].join("\n");
}

/** @param {Env} env @param {{ engagementId: unknown }} input @param {string} reviewer @param {string} at */
export async function applyApprovedLines(env, input, reviewer, at) {
  const engagementId = clean(input.engagementId, 64);
  const engagement = await engagementById(env, engagementId);
  if (!engagement) throw fail("NOT_FOUND", "engagement not found");
  if (engagement.status !== "in_correction") {
    throw fail("NOT_IN_CORRECTION", "an order is applied only while the correction is in progress");
  }
  const approved = (await correctionLines(env, engagement.id)).filter((line) => line.status === "approved");
  if (approved.length === 0) throw fail("NO_APPROVED_LINES", "no approved correction lines to apply");
  const connection = await codeLaneConnection(env, engagement.request_id);
  if (!connection) throw fail("NOT_CONNECTED", "connect the code lane on the record before applying an order");
  for (const line of approved) {
    const filePath = cleanFilePath(line.file_path);
    if (!filePath) throw fail("LINE_PATH_MISSING", `line ${line.id.slice(0, 8)} has no file path; name the file before applying`);
    if (!pathInsideFolder(filePath, connection.site_folder)) {
      throw fail("OUTSIDE_FOLDER", `the work is limited to the ${connection.site_folder} folder of ${connection.repo_owner}/${connection.repo_name}`);
    }
  }
  const token = await installationToken(env, connection);
  const repo = `/repos/${connection.repo_owner}/${connection.repo_name}`;
  const repoData = await assertOk(await githubFetch(env, "GET", repo, token, null), "REPO_NOT_FOUND", "the repository did not answer");
  const defaultBranch = String(repoData.default_branch ?? "");
  if (!defaultBranch) throw fail("REPO_NOT_FOUND", "the repository has no default branch");
  const refData = await assertOk(await githubFetch(env, "GET", `${repo}/git/ref/heads/${defaultBranch}`, token, null), "REPO_NOT_FOUND", "the default branch did not answer");
  const baseSha = String(refData?.object?.sha ?? "");
  const branch = `${BRANCH_PREFIX}${engagement.id.slice(0, 8)}`;
  /** @type {Map<string, string>} */
  const fileState = new Map();
  /** @type {{ line: CorrectionLineRow, path: string, content: string }[]} */
  const staged = [];
  for (const line of approved) {
    const filePath = cleanFilePath(line.file_path);
    let current = fileState.get(filePath);
    if (current === undefined) {
      const fileData = await assertOk(
        await githubFetch(env, "GET", `${repo}/contents/${filePath}?ref=${encodeURIComponent(defaultBranch)}`, token, null),
        "FILE_NOT_FOUND",
        `${filePath} did not answer on ${defaultBranch}`
      );
      current = decodeBase64(String(fileData.content ?? ""));
    }
    const matches = current.split(line.before_text).length - 1;
    if (matches === 0) throw fail("BEFORE_TEXT_NOT_FOUND", `the before state of line ${line.id.slice(0, 8)} is not in ${filePath}`);
    if (matches > 1) throw fail("BEFORE_TEXT_NOT_UNIQUE", `the before state of line ${line.id.slice(0, 8)} appears ${matches} times in ${filePath}`);
    current = current.replace(line.before_text, line.after_text);
    fileState.set(filePath, current);
    staged.push({ line, path: filePath, content: current });
  }
  await assertOk(
    await githubFetch(env, "POST", `${repo}/git/refs`, token, JSON.stringify({ ref: `refs/heads/${branch}`, sha: baseSha })),
    "BRANCH_EXISTS",
    "an order for this engagement is already open on the repository"
  );
  try {
    /** @type {{ line: CorrectionLineRow, commit: string }[]} */
    const applied = [];
    for (const { line, path, content } of staged) {
      const fileData = await assertOk(
        await githubFetch(env, "GET", `${repo}/contents/${path}?ref=${encodeURIComponent(branch)}`, token, null),
        "COMMIT_FAILED",
        `${path} did not answer on ${branch}`
      );
      const commitData = await assertOk(
        await githubFetch(
          env,
          "PUT",
          `${repo}/contents/${path}`,
          token,
          JSON.stringify({ message: lineCommitMessage(line), content: base64(content), branch, sha: String(fileData.sha ?? "") })
        ),
        "COMMIT_FAILED",
        `the commit for line ${line.id.slice(0, 8)} failed`
      );
      applied.push({ line, commit: String(commitData?.commit?.sha ?? "") });
    }
    const pullData = await assertOk(
      await githubFetch(
        env,
        "POST",
        `${repo}/pulls`,
        token,
        JSON.stringify({
          title: `TinyStudio correction: ${engagement.id.slice(0, 8)}`,
          head: branch,
          base: defaultBranch,
          body: pullRequestBody(connection, { defaultBranch, branch, lines: applied })
        })
      ),
      "PR_FAILED",
      "the pull request failed"
    );
    const pullId = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO code_lane_pulls
         (id, engagement_id, request_id, branch, pr_number, pr_url, lines_json, status, created_at, changed_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'opened', ?8, ?8)`
    )
      .bind(
        pullId,
        engagement.id,
        engagement.request_id,
        branch,
        Number(pullData.number) || null,
        String(pullData.html_url ?? ""),
        JSON.stringify(applied.map(({ line, commit }) => ({ lineId: line.id, path: line.file_path, commit }))),
        at
      )
      .run();
    await journalEngagementEvent(env, engagement, {
      type: "code_lane_order_applied",
      detail: `${applied.length} lines as ${pullData.html_url} by ${reviewer}`,
      at
    });
    return {
      connection,
      branch,
      prUrl: String(pullData.html_url ?? ""),
      prNumber: Number(pullData.number) || null,
      lines: applied.map(({ line, commit }) => ({ lineId: line.id, title: line.fault_title, path: line.file_path, commit }))
    };
  } catch (error) {
    try {
      await githubFetch(env, "DELETE", `${repo}/git/refs/heads/${branch}`, token, null);
    } catch (cleanup) {
      void cleanup;
    }
    throw error;
  }
}

/** @param {Env} env @param {CorrectionLineRow} line @param {number} version @param {string} at */
async function markLineRecorded(env, line, version, at) {
  assertCorrectionLineStatus(line.status, "recorded");
  await env.DB.prepare("UPDATE correction_lines SET status = 'recorded', recorded_version = ?1, changed_at = ?2 WHERE id = ?3")
    .bind(version, at, line.id)
    .run();
  await journalEngagementEvent(env, lineJournalRow(line), {
    type: "correction_line_recorded",
    detail: `${line.id} v${version}`,
    at,
    from: line.status,
    to: "recorded"
  });
}

/** @param {Env} env @param {{ engagementId: unknown }} input @param {string} reviewer @param {string} at */
export async function recheckCodeLane(env, input, reviewer, at) {
  const engagementId = clean(input.engagementId, 64);
  const engagement = await engagementById(env, engagementId);
  if (!engagement) throw fail("NOT_FOUND", "engagement not found");
  /** @type {CodeLanePullRow | null} */
  const pull = await env.DB.prepare(
    "SELECT * FROM code_lane_pulls WHERE engagement_id = ?1 ORDER BY created_at DESC, id DESC LIMIT 1"
  )
    .bind(engagement.id)
    .first();
  if (!pull) throw fail("NOT_FOUND", "no order was applied on this engagement");
  if (pull.status !== "opened") return { status: pull.status, lines: JSON.parse(pull.lines_json) };
  const connection = await codeLaneConnection(env, engagement.request_id);
  if (!connection) throw fail("NOT_CONNECTED", "the code lane connection is gone; reconnect the record");
  const token = await installationToken(env, connection);
  const repo = `/repos/${connection.repo_owner}/${connection.repo_name}`;
  const pullData = await assertOk(await githubFetch(env, "GET", `${repo}/pulls/${pull.pr_number}`, token, null), "PR_NOT_FOUND", "the pull request did not answer");
  if (pullData.state !== "closed" || !pullData.merged) {
    return { status: pullData.state === "closed" ? "closed_unmerged" : "open", prUrl: pull.pr_url, lines: JSON.parse(pull.lines_json) };
  }
  const defaultBranch = String(pullData.base?.ref ?? "");
  /** @type {{ lineId: string, path: string, commit: string, fixed: boolean }[]} */
  const checked = [];
  for (const entry of JSON.parse(pull.lines_json)) {
    const line = await correctionLineById(env, entry.lineId);
    if (!line || line.status !== "approved") continue;
    const fileData = await assertOk(
      await githubFetch(env, "GET", `${repo}/contents/${entry.path}?ref=${encodeURIComponent(defaultBranch)}`, token, null),
      "FILE_NOT_FOUND",
      `${entry.path} did not answer on ${defaultBranch}`
    );
    const fixed = decodeBase64(String(fileData.content ?? "")).includes(line.after_text);
    if (fixed) await markLineRecorded(env, line, Number(pull.pr_number) || 0, at);
    checked.push({ lineId: entry.lineId, path: entry.path, commit: entry.commit, fixed });
  }
  const fixedCount = checked.filter((entry) => entry.fixed).length;
  const allFixed = checked.length > 0 ? fixedCount === checked.length : true;
  if (allFixed) {
    await env.DB.prepare("UPDATE code_lane_pulls SET status = 'rechecked', changed_at = ?1 WHERE id = ?2").bind(at, pull.id).run();
  }
  await journalEngagementEvent(env, engagement, {
    type: "code_lane_order_rechecked",
    detail: `${fixedCount}/${checked.length} lines fixed on ${pull.pr_url} by ${reviewer}`,
    at
  });
  return { status: allFixed ? "rechecked" : "partially_fixed", prUrl: pull.pr_url, lines: checked };
}

/** @param {Request} request @param {Env} env @param {URL} url */
export async function codeLaneResponse(request, env, url) {
  if (request.method !== "POST") {
    return Response.json({ ok: false, error: "method_not_allowed" }, { status: 405 });
  }
  const origin = request.headers.get("origin") ?? "";
  const expected = `${url.protocol}//${url.host}`;
  if (origin && origin !== expected) {
    return Response.json({ ok: false, error: "cross_site_blocked" }, { status: 403 });
  }
  if (!deskAccessConfigured(env)) {
    return new Response("Desk review is not configured.", {
      status: 503,
      headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" }
    });
  }
  const identity = await deskIdentity(env, request);
  if (!identity.authenticated) return deskUnauthorized(identity.reason);
  const at = new Date().toISOString();
  const action = url.pathname.split("/").pop() ?? "";
  let form;
  try {
    form = new URLSearchParams(String(await request.text()).slice(0, 60000));
  } catch {
    return Response.json({ ok: false, error: "request_too_large" }, { status: 413 });
  }
  try {
    if (action === "connect") {
      const connection = await connectCodeLane(
        env,
        {
          requestId: form.get("requestId"),
          repo: form.get("repo"),
          installationId: form.get("installationId"),
          siteFolder: form.get("siteFolder")
        },
        identity.email,
        at
      );
      return Response.json({
        ok: true,
        requestId: connection.request_id,
        repo: `${connection.repo_owner}/${connection.repo_name}`,
        siteFolder: connection.site_folder
      });
    }
    if (action === "line-path") {
      const line = await setLineFilePath(env, clean(form.get("lineId"), 64), form.get("filePath"), at);
      return Response.json({ ok: true, lineId: line.id, filePath: line.file_path });
    }
    if (action === "apply") {
      const result = await applyApprovedLines(env, { engagementId: form.get("engagementId") }, identity.email, at);
      return Response.json({ ok: true, prUrl: result.prUrl, prNumber: result.prNumber, branch: result.branch, lines: result.lines });
    }
    if (action === "recheck") {
      const result = await recheckCodeLane(env, { engagementId: form.get("engagementId") }, identity.email, at);
      return Response.json({ ok: true, ...result });
    }
    return Response.json({ ok: false, error: "unknown_action" }, { status: 404 });
  } catch (error) {
    const code = error instanceof Error && "code" in error && typeof error.code === "string" && error.code ? error.code : "code_lane_failed";
    return Response.json({ ok: false, error: code }, { status: code === "NOT_FOUND" ? 404 : 400 });
  }
}
