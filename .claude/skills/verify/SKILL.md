---
name: verify
description: Launch, health-check, drive, and prove the TinyStudio.io site (a Cloudflare Worker with D1, R2 and static pages) on a local cf dev server. Use before claiming any change to the pitch pages, the appraisal form, the record page, checkout and the Dodo webhook, the desk, or /health works end to end, and to write the `run-proof:` line of a PR.
---

TinyStudio.io (repo `TinyStudio.io-public`) is one Cloudflare Worker, `src/worker.js`, that serves the static pages in `public/` and the `/api/*` endpoints. Data lives in D1 (`DB`) and R2 (`RECORDS`). `npm run dev` runs it on your machine with local D1, R2, rate limit and email. No Cloudflare login is needed.

Agents doing end-to-end verification use this harness instead of improvising a launch. Whoever ships a feature updates its file in `features/` in the same PR.

## LAUNCH

```bash
npm ci
mkdir -p /tmp/verify-tinystudio
npm run dev > /tmp/verify-tinystudio/server.log 2>&1 &
echo $! > /tmp/verify-tinystudio/server.pid
```

- `npm run dev` applies every D1 migration to the local database, then runs `cf dev --mode local`. The `local` mode leaves out the Workers AI binding, because it has no local mode. Everything else is local.
- Base URL: `http://localhost:8788`.
- Ready: the log prints `Ready on http://localhost:8788`, and `/health` answers 200 with `"ok":true`. An empty data folder works: the migrations run first.
- One instance per checkout. The port is fixed (8788), and the local data lives in `.wrangler/state/` in the checkout. Do not start a second copy, and do not drive a server you did not start.

### Never

- `wrangler dev --remote` or `cf dev` without `--mode local`. Both reach Cloudflare and need a login.
- Trusting `/health` 200 alone. Read `checks`: every table must be `true`. `ai` is `false` locally, and that is expected.
- Killing by process name. Kill the PID you recorded.

## DOCTOR

```bash
curl -s -w '\n%{http_code}\n' http://localhost:8788/health
```

Healthy: `{"ok":true,"service":"tinystudio-io-public",...,"checks":{"db":true,"signupsTable":true,"ai":false,"agentRunsTable":true,"usageLimitsTable":true,"engagementsTable":true,"correctionLinesTable":true}}` and `200`. A table that is `false` means the migrations did not run: stop the server and start again with `npm run dev`. `lsof -i :8788` shows who owns the port.

## DRIVE

Per-feature steps live in `features/`. Start with `features/README.md`.

| Feature | File |
| --- | --- |
| Appraisal request form | `features/appraisal-request.md` |
| Pitch and info pages | `features/pages.md` |
| Health and retired hosts | `features/health.md` |
| Checkout and Dodo webhook | `features/payments.md` |
| Desk (reviewer queue) | `features/desk.md` |

Two drive styles:

- **HTTP drive.** `curl` against `http://localhost:8788`. Send what a browser sends: form posts are `application/x-www-form-urlencoded`.
- **Browser drive.** Playwright (`playwright` is in devDependencies). Needed for layout, the 320 px viewport and anything a user clicks.

## EVIDENCE

- Keep everything under `/tmp/verify-tinystudio/`: the server log, each response body, and each status code.
- The server log has one line per request (`[wrangler:info] POST /api/appraisal-requests 201 Created`). It is the proof that the request reached this server.
- Prove side effects through a second user-visible view. For a write, send it again and show the app reports the stored record (`"duplicate":true`), or open the page that shows it.
- Local Explorer at `http://localhost:8788/cdn-cgi/local/explorer` shows D1 rows, sent emails, logs and traces in a browser (https://developers.cloudflare.com/workers/local-development/local-explorer/).
- **PR proof line.** Paste the commands you ran and their key output into the PR body as one `run-proof:` line, copied from the terminal, never retyped. Name the feature file you drove.
- Never commit evidence to this public repo.

## CLEANUP

```bash
kill "$(cat /tmp/verify-tinystudio/server.pid)"
sleep 2
lsof -i :8788 -t
```

If the last command still prints a PID, check with `ps -o args= -p <pid>` that it runs from this checkout, then kill that PID. Cleanup never deletes `/tmp/verify-tinystudio/`. To reset local data, stop the server and delete `.wrangler/state/`. The next `npm run dev` rebuilds it.

## Keeping the map true

See `README.md` in this folder. Run `/maintain-verification-skill` to check the map against the code.

## Source pattern

pstack `/create-verification-skill` (https://github.com/cursor/plugins). Local dev: https://developers.cloudflare.com/cf/projects/
