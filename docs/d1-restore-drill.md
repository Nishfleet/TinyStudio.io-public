# D1 restore drill: unseal one weekly backup and load it

The weekly job in [`.github/workflows/d1-export.yml`](../.github/workflows/d1-export.yml)
dumps `tinystudio_email_signups`, seals the dump with `age` and keeps only the
ciphertext as the GitHub artifact `d1-backup-tinystudio_email_signups` (90 days,
13 weekly points). This page is the other half: it takes one downloaded artifact,
decrypts it, loads it into a local D1 database, and counts rows to prove the load
worked.

Until one weekly run goes green, the repository has no backup artifact and
this drill has nothing to restore.

> **Status (2026-10-30).** The producer landed in
> [Nishfleet/TinyStudio.io-public#89](https://github.com/Nishfleet/TinyStudio.io-public/issues/89),
> but its first run failed because the D1 database it exports is the one the
> account no longer holds
> ([Nishfleet/TinyStudio.io-public#74](https://github.com/Nishfleet/TinyStudio.io-public/issues/74)).
> Delete this note once a weekly run has gone green.

**Warning: the decrypted dump holds real customer email addresses from the
waitlist form.** Keep it in a scratch directory that is outside the repository,
never commit it, and never paste rows into an issue or a PR. Delete the scratch
directory when the drill ends.

## What makes the drill real

- The private key never enters GitHub Actions. The workflow holds only the
  public recipient, and that key is safe to publish.
- The first real drill is Nish's, because it needs the private key. The key is
  on the fleet host only, at `~/.config/drive/d1-backup-key.txt`, which is the
  path fleet-ops's monthly drill unit reads
  ([`systemd/fleet-d1-restore-drill.service`](https://github.com/Nishfleet/fleet-ops/blob/main/systemd/fleet-d1-restore-drill.service),
  `DRILL_KEY`, path as of 2026-10-30). Nothing in this repository or its
  workflows holds it, and no runner can reach it.
- Run the drill after the first green weekly backup, after a key rotation, and
  after a change to the workflow or the schema. A backup nobody has restored is
  a claim, not a backup.

## 0. Open a scratch directory outside the repository

Run every step from the repository root, so `npx --no-install` finds the
wrangler the committed lockfile installed. Every file the drill writes goes to
one scratch directory outside the repository:

```bash
DRILL="$(mktemp -d)"
echo "$DRILL"
```

If you skip this, the decrypted dump lands in the checkout, where one `git add`
commits customer email addresses.

## 1. List the artifacts

```bash
gh api repos/Nishfleet/TinyStudio.io-public/actions/artifacts \
  --jq '.artifacts[]
        | select(.name == "d1-backup-tinystudio_email_signups")
        | "run \(.workflow_run.id)  \(.name)  created \(.created_at)  expires \(.expires_at)  \(.size_in_bytes) bytes"'
```

Take the newest run id that has not expired. An empty answer means no weekly run
has produced a backup yet, or every artifact is past 90 days.

## 2. Download one artifact

```bash
mkdir -p "$DRILL/download"
gh run download <run-id> \
  -R Nishfleet/TinyStudio.io-public \
  -n d1-backup-tinystudio_email_signups \
  -D "$DRILL/download"
ls -l "$DRILL"/download/*.sql.age
```

The file is named `tinystudio_email_signups-YYYYMMDD.sql.age`. The date is the
UTC day the dump ran, which is the Monday of that week.

## 3. Decrypt it with the fleet host's private key

```bash
age -d -i ~/.config/drive/d1-backup-key.txt \
  -o "$DRILL/tinystudio_email_signups-YYYYMMDD.sql" \
  "$DRILL/download/tinystudio_email_signups-YYYYMMDD.sql.age"
```

Use the date from step 2 in the file name. If your key is not at that path,
pass your own path to `-i`. `age` writes nothing and exits 1 with
`no identity matched any of the recipients` when the key does not match the
artifact, so a wrong key cannot pass silently. Any age 1.x opens it: the weekly
job pins 1.3.2 for the seal and the format is stable across the 1.x line.

## 4. Load it into a local D1 database

```bash
npx --no-install wrangler d1 execute tinystudio_email_signups \
  --local \
  --persist-to "$DRILL/db" \
  --file "$DRILL/tinystudio_email_signups-YYYYMMDD.sql"
```

`--local` keeps this off Cloudflare. `--persist-to` sends the local database to
the scratch directory, so the drill never mixes with the state `wrangler dev`
uses. `--no-install` makes `npx` use the wrangler already installed from the
committed lockfile and fail when it is absent, instead of fetching another
version. The load ends with one summary line, `N commands executed successfully`.

## 5. Prove the load: count rows in a table that has rows

`d1_migrations` is the table every dump of this database has rows in: it holds
one row per applied migration, so it is never empty. Count it and the signups
in one query:

```bash
npx --no-install wrangler d1 execute tinystudio_email_signups \
  --local \
  --persist-to "$DRILL/db" \
  --command "SELECT (SELECT count(*) FROM d1_migrations) AS migration_rows, (SELECT count(*) FROM email_signups) AS email_signups_rows"
```

`migration_rows` must be non-zero. Zero rows, or `no such table:
d1_migrations`, means the dump did not load. It must also stay at or below the
number of migration files in the repository (`ls migrations/*.sql | wc -l`):
a dump holding more rows than that was sealed from a database carrying a
migration this repository does not have, so it is not this database's dump.
Fewer rows mean the database is behind the repository's migrations, which is a
note for the report, not a failed drill.

The D1 database is named `tinystudio_email_signups` and the table inside it is
`email_signups`. The name `tinystudio_email_signups` goes to `wrangler d1
execute`, and `email_signups` goes to the SQL.

`email_signups` is the customer table, and its count may legitimately be zero:
a site nobody has signed up on yet exports a dump with no signup rows, and
that is a good restore. It is the number to write in the log below, not the
number that proves the load.

`PRAGMA integrity_check` is not available here: on this repository's local D1
it answers `not authorized: SQLITE_AUTH`, so the row count is the check.

A count on its own does not prove the whole dump loaded, because a load that
stops halfway still counts rows. Compare the `N` in the load line with the
number of statements in the dump:

```bash
grep -c ';$' "$DRILL/tinystudio_email_signups-YYYYMMDD.sql"
```

The two numbers must match. A smaller `N` on the load line means statements
were skipped, and the drill failed even though the count is above zero.

`grep -c ';$'` counts lines that end in a semicolon, and wrangler's export
writes one statement per line, with a value that holds a newline escaped as
`replace(..., char(10))` and a value that holds a semicolon left inside its
quotes. So for this format the line count is the statement count. The export
also ends its last statement with a semicolon, so the count is not off by one.

If the two numbers ever differ, the dump's format changed and the line count
is the wrong measure: count the statements in the dump again before calling
the drill failed.

To see every table the dump created, run the same command with:

```bash
--command "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name"
```

A full dump creates every table the migrations create, including `d1_migrations`,
`email_signups`, `engagements` and `correction_lines`.

## 6. Clean up

```bash
rm -r "$DRILL"
```

Run each attempt in a fresh scratch directory, because `--persist-to
"$DRILL/db"` reuses the local database from an earlier attempt and a second
load then counts rows the first load left behind. Delete `$DRILL/db` between
attempts, or start over from step 0.

The ciphertext is in the artifact and can be downloaded again. The decrypted SQL
and the local database are the only copies that are not sealed, so delete both.

## Record the drill

Add one line here for each real drill: the date, the artifact date, and the row
count. Whoever runs the drill writes the row, so the table cannot stay empty
because nobody thought to update it. Replace the placeholder row, not sit
beside it.

| drill date | artifact | `email_signups` rows |
|---|---|---|
| not yet run | — | — |
