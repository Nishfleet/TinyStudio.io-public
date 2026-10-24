# Agent notes for TinyStudio.io

`docs/PLAN.md` is the single current plan (pages, architecture, milestones), and `README.md` lists the pages, the endpoints and the run commands. Keep both: this file adds only what an agent must not get wrong.

## Run it and prove it

Live: https://tinystudio.io. The site is the pitch and the appraisal request form; `app.tinystudio.io` and `api.tinystudio.io` answer 410 on purpose.

- Run: `npm ci && npm test`. `npm test` is the gate: site check, headings, sitemap, worker, UI, contract and viewport.
- Prove readiness: `curl -s -w '\n%{http_code}\n' https://tinystudio.io/health`. A ready deployment prints `{"ok":true,"service":"tinystudio-io-public","surface":"website-appraisal",...}` and `200`. When the D1 binding or a table it needs is missing, `ok` is `false`, the status is `503`, and the `checks` object names the part. `test/test-agent-worker.mjs` proves both answers against the Worker.
- A `522`, `525` or a timeout is not a pass. It means the Worker for the zone is not answering, so look at the latest `deploy-production` run before reading the site at all.
- Test login: none. The appraisal form is the only write on the public site, and it needs no account.
