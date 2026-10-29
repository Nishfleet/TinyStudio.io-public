# D1 restore drill: unseal one weekly backup and load it

The weekly job in `.github/workflows/d1-export.yml` dumps `tinystudio_email_signups`,
seals the dump with `age` and keeps only the ciphertext as the GitHub artifact
`d1-backup-tinystudio_email_signups` (90 days, 13 weekly points). This page is the
other half: it takes one downloaded artifact, decrypts it, loads it into a local
D1 database, and counts rows to prove the load worked.

The producer lands with #89. Until its first green run, the repository has no
backup artifact and this drill has nothing to restore.

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
  (`systemd/fleet-d1-restore-drill.service`, `DRILL_KEY`). Nothing in this
  repository or its workflows holds it, and no runner can reach it.
- Run the drill after the first green weekly backup, after a key rotation, and
  after a change to the workflow or the schema. A backup nobody has restored is
  a claim, not a backup.

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
mkdir -p d1-drill/download
gh run download <run-id> \
  -R Nishfleet/TinyStudio.io-public \
  -n d1-backup-tinystudio_email_signups \
  -D d1-drill/download
ls -l d1-drill/download/*.sql.age
```

The file is named `tinystudio_email_signups-YYYYMMDD.sql.age`. The date is the
UTC day the dump ran, which is the Monday of that week.

## 3. Decrypt it with the fleet host's private key

```bash
age -d -i ~/.config/drive/d1-backup-key.txt \
  -o d1-drill/tinystudio_email_signups-YYYYMMDD.sql \
  d1-drill/download/tinystudio_email_signups-YYYYMMDD.sql.age
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
  --persist-to d1-drill/db \
  --file d1-drill/tinystudio_email_signups-YYYYMMDD.sql
```

`--local` keeps this off Cloudflare. `--persist-to` sends the local database to a
scratch directory, so the drill never mixes with the state `wrangler dev` uses.
`--no-install` makes the committed lockfile the only wrangler the drill can run,
the same pin the weekly job uses. The load ends with an
`N commands executed successfully` line, one per statement in the dump.

## 5. Prove the load: count rows in a table that has rows

`email_signups` is the table the public form writes, so a real dump always has
rows in it.

```bash
npx --no-install wrangler d1 execute tinystudio_email_signups \
  --local \
  --persist-to d1-drill/db \
  --command "SELECT count(*) AS email_signups_rows FROM email_signups"
```

The answer must be a non-zero `email_signups_rows`. Zero rows, or
`no such table: email_signups`, means the dump did not load. `PRAGMA
integrity_check` is not available through `wrangler d1 execute` (it answers
`not authorized: SQLITE_AUTH`), so the row count is the check.

To see every table the dump created, run the same command with:

```bash
--command "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name"
```

## 6. Clean up

```bash
rm -r d1-drill
```

The ciphertext is in the artifact and can be downloaded again. The decrypted SQL
and the local database are the only copies that are not sealed, so delete both.

## Record the drill

Add one line here for each real drill: the date, the artifact date, and the row
count.

| drill date | artifact | `email_signups` rows |
|---|---|---|
| not yet run | — | — |
