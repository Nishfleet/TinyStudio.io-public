// The public pages promise "refreshed daily" and "this number is today's"
// (index.html, audit.html, pricing.html, specimen.html). These guards make
// that promise durable:
//
//   1. render.py --check — the pages' data-study spans must match the newest
//      snapshot in study/snapshots/. A partial import (snapshot without
//      render, or render without snapshot) fails here.
//   2. Freshness — the newest snapshot must be recent enough to back the
//      daily-refresh claim. The scan runs daily at 07:00 IST in the scan
//      checkout and the snapshots are imported into this repo by hand, so a
//      small window is allowed; a multi-day drift (the 2026-08-06 -> 08-12
//      gap this guard was written against) turns red.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const MAX_SNAPSHOT_AGE_DAYS = 4;

function newestSnapshotFile() {
  const snaps = readdirSync(path.join(ROOT, "study", "snapshots"))
    .filter((name) => name.endsWith(".json"))
    .sort();
  assert.ok(snaps.length > 0, "study/snapshots/ must contain at least one dated snapshot");
  return snaps[snaps.length - 1];
}

test("public pages are rendered from the newest study snapshot", () => {
  execFileSync("python3", ["study/render.py", "--check"], { cwd: ROOT, stdio: "pipe" });
});

test("the newest study snapshot is fresh enough to back the daily-refresh promise", () => {
  const file = newestSnapshotFile();
  const date = file.replace(/\.json$/, "");
  const snapshotEnd = Date.parse(`${date}T23:59:59Z`);
  assert.ok(Number.isFinite(snapshotEnd), `snapshot filename ${file} must be an ISO date (YYYY-MM-DD.json)`);

  const ageDays = (Date.now() - snapshotEnd) / 86_400_000;
  assert.ok(
    ageDays <= MAX_SNAPSHOT_AGE_DAYS,
    `newest snapshot is ${date} (${Math.floor(ageDays)} days old) but the site promises "refreshed daily" — import the newer snapshots from the scan checkout and re-run study/render.py (max allowed age: ${MAX_SNAPSHOT_AGE_DAYS} days)`
  );
});
