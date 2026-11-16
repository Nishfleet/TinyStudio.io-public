import { defineWranglerConfig } from "wrangler/experimental-config";

export default defineWranglerConfig((ctx) => {
	if (ctx.isPreview) {
		return {
			build: {
				command: "node build-fonts.mjs",
			},
			assetsDirectory: "./public",
		};
	}
	return {
		build: {
			command: "node build-fonts.mjs",
		},
		assetsDirectory: "./public",
		dev: {
			port: 8788,
			// The dev server forwards every request to the host of the first
			// production route, and rewrites the request URL, the Host header
			// and the Origin to that host. The Worker therefore saw
			// `tinystudio.io` and refused a browser on http://localhost:8788
			// with 403 `cross_site_blocked`. Forwarding to the local server
			// instead makes all three name localhost, so the same-origin check
			// answers as it does live. Proved by the curl drive in
			// .claude/skills/verify/features/appraisal-request.md.
			// https://developers.cloudflare.com/workers/wrangler/configuration/#local-development-settings
			host: "localhost:8788",
		},
	};
});
