# BookOrbit automatic backup (Cloudflare R2)

Daily, free backups of your BookOrbit server to **Cloudflare R2** object
storage. R2 gives you 10 GB free with **zero egress fees** (restoring never
costs anything) and the setup is just two API keys — no OAuth app creation,
no consent screens.

| What                                    | Frequency    | Contents                                                                  | Kept |
| --------------------------------------- | ------------ | ------------------------------------------------------------------------- | ---- |
| `daily/bookorbit-YYYYMMDD.sql.gz`       | every day    | Postgres dump (metadata, progress, ratings, users, public shelf) + `.env` | 14   |
| `weekly/bookorbit-YYYYMMDD-full.tar.gz` | every Sunday | your books + app data (covers, etc.)                                      | 8    |

Retention is enforced both **locally and on R2**, so the free 10 GB stays
comfortable for a personal library.

> Why weekly for books? Book files barely change after import — uploading
> the full library every day would just burn quota and bandwidth.
> The database (which _does_ change daily) is backed up every day.

> 📚 Google Drive / Backblaze B2 work too — see [Other destinations](#other-destinations).

---

## One-time setup (on the VPS)

### 1. Install rclone

```bash
sudo apt update && sudo apt install -y rclone
rclone version
```

### 2. Create your R2 bucket + API token (~5 minutes, no credit card)

1. Create a free Cloudflare account: <https://dash.cloudflare.com/sign-up>
   (setup link: <https://dash.cloudflare.com/?to=/:account/r2>)
2. Open **R2 Object Storage → Create bucket** → name it `bookorbit-backups`.
3. Open **R2 → Manage R2 API Tokens → Create API Token**.
   - Permission: **Object Read & Write** (scope to just that bucket if you like).
   - Copy the **Access Key ID** and **Secret Access Key** — shown once!
4. Note your **Account ID** (R2 page, top right).

### 3. Configure rclone for R2

```bash
rclone config
```

- `n` (new remote) → name it **`r2`** → type **`s3`**
- `provider`: **`Cloudflare`**
- `access_key_id`: paste your **Access Key ID**
- `secret_access_key`: paste your **Secret Access Key**
- `endpoint`: `https://<YOUR_ACCOUNT_ID>.r2.cloudflarestorage.com`
- `region`: `auto`
- accept defaults for the rest, then `q`

Verify:

```bash
rclone lsd r2:
# should list bookorbit-backups
```

### 4. Test a backup run

```bash
cd /path/to/bookorbit
chmod +x scripts/backup/backup.sh
./scripts/backup/backup.sh
```

Check R2 → `bookorbit-backups/daily/` and `bookorbit-backups/weekly/`.

### 5. Install the daily cron job

```bash
sudo ./scripts/backup/install-cron.sh --user root
# default runs at 03:00 daily; override with --hour/--minute
crontab -u root -l   # verify
```

---

## Restoring

**Database (metadata, progress, users):**

```bash
# pull the dump down, then restore into a fresh/empty DB
# (run from the repo directory, where docker-compose.yml lives)
rclone copy r2:bookorbit-backups/daily/bookorbit-20260808.sql.gz .
gunzip -c bookorbit-20260808.sql.gz | docker compose exec -T bookorbit-db \
  psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"
```

**Books & app data:**

```bash
# download the weekly archive and extract it back into the compose directory
rclone copy r2:bookorbit-backups/weekly/bookorbit-20260808-full.tar.gz .
tar -xzf bookorbit-20260808-full.tar.gz -C /path/to/bookorbit
docker compose up -d   # rebuild containers, data is back
```

## Configuration (environment variables)

| Variable                        | Default             | Meaning                                      |
| ------------------------------- | ------------------- | -------------------------------------------- |
| `BOOKORBIT_DIR`                 | repo root           | where `docker-compose.yml` lives             |
| `BACKUP_DIR`                    | `<repo>/backups`    | local staging dir                            |
| `RCLONE_REMOTE`                 | `r2`                | rclone remote name (`r2`, `gdrive`, `b2`, …) |
| `RCLONE_PATH`                   | `bookorbit-backups` | folder in the remote                         |
| `KEEP_DAILY`                    | `14`                | number of daily dumps retained               |
| `KEEP_WEEKLY`                   | `8`                 | number of weekly archives retained           |
| `WEEKLY_WEEKDAY`                | `0`                 | day of week for full archive (0=Sunday)      |
| `BACKUP_HOUR` / `BACKUP_MINUTE` | `3` / `0`           | cron time (used by install-cron.sh)          |

## Other destinations

The script works with any rclone remote — you only change `RCLONE_REMOTE`.

**Google Drive** (if you prefer Drive): create your own OAuth client first —
Google retired rclone's shared client in 2026, so the default client fails
with "authorization error". Create a Desktop-app OAuth client at
<https://console.cloud.google.com/apis/credentials>, then:
`rclone authorize "drive" --client-id=... --client-secret=...` on a machine
with a browser, paste the token into `rclone config` on the VPS, name the
remote `gdrive`, and set `RCLONE_REMOTE=gdrive`. Then skip to step 4 above.

**Backblaze B2**: create an Application Key (keyID + applicationKey) in the
B2 console (no OAuth), `rclone config` → type `b2`, name it `b2`, and set
`RCLONE_REMOTE=b2`.

## Notes & tips

> 🔐 **Biggest exposure in this setup:** the daily dump folder contains a
> copy of your `.env` — `JWT_SECRET`, `POSTGRES_PASSWORD` and
> `SETUP_BOOTSTRAP_TOKEN` — uploaded in **plaintext**. Anyone with access
> to your R2 token or bucket can take over your whole server. If that
> bothers you:
>
> - skip `.env` entirely (delete it from `backups/daily/` before upload —
>   secrets can be re-typed from your notes on restore), **or**
> - use rclone's `crypt` remote as a wrapper for encryption (see below).

- **Storage math (10 GB free tier):** `KEEP_WEEKLY=8` × full library size
  - 14 dumps ≈ 8× your library. If your books total more than ~1 GB, lower
    `KEEP_WEEKLY` (e.g. 3) or upgrade the R2 plan.
- **R2 egress is always free** — restoring costs nothing, ever.
- The script is safe to re-run any time; it overwrites today's dump.
- To also protect against _accidental deletion on the server_, the local
  `backups/` folder keeps the same retention window — don't `rm -rf` it.
- For zero-knowledge encryption, configure an rclone `crypt` remote pointing
  at `r2:bookorbit-backups` and set `RCLONE_REMOTE=bookorbit-encrypted`.
