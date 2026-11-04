# Pitch and info pages

The public site: the pitch on `/`, then `/appraisal`, `/pricing`, `/specimen`, `/waitlist`, `/contact`, `/privacy`, `/terms`, the agent-readable `/llms.txt` and `/offer.md`, and `/brief-requested` after a request.

## Sub-features

- `pages-render` serves each page with 200 and its heading.
- `pages-signup` is the email form on `/`, which posts to `/api/signups`.
- `pages-agent` serves `/llms.txt` and `/offer.md` as text.

## How to get to it (user POV)

- Open `https://tinystudio.io/` and follow the navigation.

## Driving it with curl

Preconditions:

- DOCTOR passes.

- **Each page.** Run `for p in / /appraisal /pricing /specimen /waitlist /contact /privacy /terms /llms.txt /offer.md; do curl -s -o /dev/null -w "$p %{http_code}\n" http://localhost:8788$p; done`. Every line ends `200`.
- **Signup form.** `curl -s http://localhost:8788/ | grep -o '<form[^>]*>'` shows `action="/api/signups"`.
- **Layout.** `npm run test:viewport`, `npm run test:narrow-pages` and `npm run test:narrow` check the first viewport and the 320 px width.

## Gotchas

- Prices and refund words come from `config/`. `npm run test:contract` fails when a page carries a stale promise.
