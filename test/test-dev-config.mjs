import assert from "node:assert/strict";
import test from "node:test";
import wranglerConfig from "../wrangler.config.ts";

/** @remarks
 * The local dev server forwards every request to the host of the first production route, so the
 * Worker used to see `tinystudio.io` and refused a browser on http://localhost:8788 with 403
 * `cross_site_blocked`. The dev server now forwards to the local server itself, so the request URL,
 * the Host header and the Origin all name localhost and the same-origin check answers as it does
 * live. This reads the shipped config, so reverting `dev.host` fails here. The end-to-end proof of
 * the 201 lives in `.claude/skills/verify/features/appraisal-request.md`.
 */
test("the dev server forwards to the local server, so the Worker's origin check sees localhost", () => {
  const config = wranglerConfig({ isPreview: false });
  assert.equal(config.dev.host, "localhost:8788");
  assert.equal(config.dev.port, 8788);
});

/** @remarks The preview config carries no dev settings, so the preview build stays as it was. */
test("the preview config leaves the dev settings alone", () => {
  const preview = wranglerConfig({ isPreview: true });
  assert.equal(preview.dev, undefined);
});
