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
	};
});
