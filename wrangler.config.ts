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
			// production route, so the Worker saw `tinystudio.io` and a browser
			// on localhost was refused. Forward to the local server instead:
			// the Worker's request URL, Host header and Origin then all name
			// localhost, and the same-origin check answers as it does live.
			// https://developers.cloudflare.com/workers/wrangler/configuration/#local-development-settings
			host: "localhost:8788",
		},
	};
});
