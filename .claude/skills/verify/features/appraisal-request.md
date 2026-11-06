# Appraisal request form

A visitor asks for the free appraisal by giving their website, business type, deal value, monthly leads, name and work email. The Worker stores the request in D1, or a waitlist place when the month's six slots are full, and sends one confirmation email.

## Sub-features

- `appraisal-submit` stores a new request and answers `201` with `"duplicate":false`.
- `appraisal-duplicate` answers a repeat from the same email with `"duplicate":true` and sends no second email.
- `appraisal-waitlist` stores a waitlist place when the month is full.
- `appraisal-guards` refuse cross-site posts (403), oversize bodies (413) and too many requests (the `APPRAISAL_LIMITER` rate limit, 5 a minute).

## How to get to it (user POV)

- `/appraisal` and `/waitlist` each have the form `id="start"` that posts to `/api/appraisal-requests`.
- The button reads `Request the appraisal`.

## Driving it with curl

Preconditions:

- DOCTOR passes. Use a fresh email for each run, because a repeat is a duplicate.

- **Open the form.** Run `curl -s -o /tmp/verify-tinystudio/appraisal-page.html -w '%{http_code}\n' http://localhost:8788/appraisal`. It prints `200`, and the page contains `action="/api/appraisal-requests"`.
- **Submit.** Run `curl -s -w ' %{http_code}\n' -X POST http://localhost:8788/api/appraisal-requests -H 'Origin: http://localhost:8788' -H 'Content-Type: application/x-www-form-urlencoded' --data 'website=verify-example.com&businessType=Private+dental+clinic&dealValue=8000&monthlyLeads=40&name=Verify+Run&email=verify-<run-id>%40example.com&referral='`. It prints `{"ok":true,"status":"accepted","duplicate":false,...,"confirmation":"sent"}` and `201`. The `Origin` header is the local server's own origin, the same one a browser sends.
- **Read back.** Send the same command again. It prints `"duplicate":true`, `"confirmation":"already_sent"` and `200`. That proves the first request was stored.
- **Proof.** `grep 'POST /api/appraisal-requests' /tmp/verify-tinystudio/server.log` shows `201 Created`, then `200 OK`. The sent email is listed in Local Explorer.

## Gotchas

- `wrangler d1 execute --local` reads a different local database file than `cf dev`, so it reports `no such table`. Use the read-back step or Local Explorer instead.
