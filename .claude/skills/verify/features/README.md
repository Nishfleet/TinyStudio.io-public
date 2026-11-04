# TinyStudio.io verification map

This folder is the maintained list of what a visitor or the reviewer can do on tinystudio.io and how to prove each thing works locally. Read this index, then use the matching file as the recipe.

## Baseline preconditions

- `npm run dev` is up at `http://localhost:8788` and the DOCTOR check in `../SKILL.md` passes.
- Workers AI is off locally (`checks.ai: false`). Anything that needs it is proven by `npm test`, not by the harness.
- Production is down (#74), so there is no live check today.

## Features

| Feature | File | Proven by |
| --- | --- | --- |
| Appraisal request form | `appraisal-request.md` | local HTTP drive |
| Pitch and info pages | `pages.md` | local HTTP drive, `npm test` viewport checks |
| Health and retired hosts | `health.md` | local HTTP drive |
| Checkout and Dodo webhook | `payments.md` | `npm run test:payments` |
| Desk | `desk.md` | `npm run test:desk` |

## Proof and skip reporting

- Capture the action and the resulting state: command, status code and body.
- Name the feature file and entry point with every artifact.
- Report a path you could not reach as not run, with the reason. Never report it as verified through another path.
- Each feature file has four H2 sections: `Sub-features`, `How to get to it (user POV)`, `Driving it with <harness>`, `Gotchas`.
