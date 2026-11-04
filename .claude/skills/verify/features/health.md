# Health and retired hosts

`/health` reports whether the deployment can serve: the D1 binding and every table it needs. `app.tinystudio.io` and `api.tinystudio.io` answer 410 on purpose.

## Sub-features

- `health-ready` answers 200 with `"ok":true` when D1 and its tables are there.
- `health-not-ready` answers 503 with `"ok":false` and names the missing part in `checks`.
- `retired-hosts` answer 410.

## How to get to it (user POV)

- An operator opens `https://tinystudio.io/health` after a deploy.

## Driving it with curl

Preconditions:

- DOCTOR passes.

- **Ready.** Run `curl -s -w '\n%{http_code}\n' http://localhost:8788/health`. It prints `"ok":true`, every table `true`, `"ai":false`, and `200`.
- **Not ready.** `npm run test:worker` proves the 503 answer against the Worker.
- **Retired host.** Run `npm run test:worker`. It asserts 410 for `app.tinystudio.io` and `api.tinystudio.io`.

## Gotchas

- A `Host: app.tinystudio.io` header on the local server still gets 200, because the local server forwards every request to the first route's host. Use the Worker test for the 410.
- Locally `ai` is always `false`, because `--mode local` leaves the AI binding out. In production it must be `true`.
