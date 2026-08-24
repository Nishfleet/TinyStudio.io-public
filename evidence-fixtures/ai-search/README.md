# AI-search evidence fixtures

This directory is the single source of truth for the AI-search evidence
artifact shown on `public/audit.html`.

- `controlled-questions.json` — the controlled questions every engine was
  asked. Each question has a stable `id`, a short `name`, the exact `prompt`
  sent to each engine, and the ground `truth` the verdict is checked against.
- `evidence.json` — the captured runs: which engine answered which question,
  the state (`found`, `wrong`, `absent`, `not-tested`), the verbatim captured
  answer, cited sources, and any remediation note.

`public/audit.html` embeds a copy of both files as a single JSON bundle inside
`<script type="application/json" id="ai-search-evidence">`. `scripts/check-site.mjs`
refuses to let the embedded bundle drift from these files: if you edit a
fixture, regenerate the embed so the two stay identical.
