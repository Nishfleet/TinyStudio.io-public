import { bindings, defineConfig, triggers } from "cf/config";

export default defineConfig((ctx) => {
	if (ctx.isPreview) {
		return {
			worker: {
				name: "tinystudio-io-public",
				compatibilityDate: "2026-05-29",
				entrypoint: "src/worker.js",
				workersDev: false,
				previewUrls: true,
				observability: {
					enabled: true,
					headSamplingRate: 1,
				},
				assets: {
					runWorkerFirst: [
						"/*",
					],
				},
				triggers: [
					triggers.fetch({
						pattern: "tinystudio.io/*",
						zone: "tinystudio.io",
					}),
					triggers.fetch({
						pattern: "www.tinystudio.io/*",
						zone: "tinystudio.io",
					}),
					triggers.fetch({
						pattern: "app.tinystudio.io/*",
						zone: "tinystudio.io",
					}),
					triggers.fetch({
						pattern: "api.tinystudio.io/*",
						zone: "tinystudio.io",
					}),
					triggers.scheduled({
						schedule: "17 6 * * *",
					}),
				],
				env: {
					ASSETS: bindings.assets(),
				},
			},
		};
	}
	return {
		worker: {
			name: "tinystudio-io-public",
			compatibilityDate: "2026-05-29",
			entrypoint: "src/worker.js",
			workersDev: false,
			previewUrls: true,
			observability: {
				enabled: true,
				headSamplingRate: 1,
			},
			assets: {
				runWorkerFirst: [
					"/*",
				],
			},
			triggers: [
				triggers.fetch({
					pattern: "tinystudio.io/*",
					zone: "tinystudio.io",
				}),
				triggers.fetch({
					pattern: "www.tinystudio.io/*",
					zone: "tinystudio.io",
				}),
				triggers.fetch({
					pattern: "app.tinystudio.io/*",
					zone: "tinystudio.io",
				}),
				triggers.fetch({
					pattern: "api.tinystudio.io/*",
					zone: "tinystudio.io",
				}),
				triggers.scheduled({
					schedule: "17 6 * * *",
				}),
			],
			env: {
				DB: bindings.d1({
					name: "tinystudio_email_signups",
					id: "772176da-86b4-4d73-a1dc-8f50af9de419",
				}),
				RECORDS: bindings.r2({
					name: "tinystudio-records",
				}),
				EMAIL: bindings.sendEmail({}),
				...(ctx.mode === "local" ? {} : { AI: bindings.ai({}) }),
				APPRAISAL_LIMITER: bindings.rateLimit({
					namespace: "1001",
					simple: {
						limit: 5,
						period: 60,
					},
				}),
				ASSETS: bindings.assets(),
			},
		},
	};
});
