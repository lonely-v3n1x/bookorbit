# BookOrbit → Google Drive automatic backup

Daily, free backups of your BookOrbit server to your personal Google Drive.

| What                                    | Frequency    | Contents                                                                  | Kept |
| --------------------------------------- | ------------ | ------------------------------------------------------------------------- | ---- |
| `daily/bookorbit-YYYYMMDD.sql.gz`       | every day    | Postgres dump (metadata, progress, ratings, users, public shelf) + `.env` | 14   |
| `weekly/bookorbit-YYYYMMDD-full.tar.gz` | every Sunday | your books + app data (covers, etc.)                                      | 8    |

Retention is enforced both **locally and on Google Drive**, so the free
15 GB stays comfortable for a personal library.

> Why weekly for books? Book files barely change after import — uploading
> the full library every day would just burn Drive quota and bandwidth.
> The database (which _does_ change daily) is backed up every day.

---

## One-time setup (on the VPS)

### 1. Install rclone

```bash
sudo apt update && sudo apt install -y rclone
rclone version
```

### 2. Create your own Google OAuth client (required since 2026)

> ⚠️ **Important:** Google retired rclone's shared default client ID.
> Without your own OAuth client, `rclone` will fail with
> "Access blocked / authorization error". This step is free and takes ~5 min.

1. Go to <https://console.cloud.google.com/apis/credentials> (create a project if asked, e.g. `rclone-backup`).
2. Click **+ Create Credentials → OAuth client ID**.
3. App type: **Desktop app**. Name it `rclone`. Click Create.
4. Copy the **Client ID** and **Client secret**.
   (You may first need to configure the **OAuth consent screen**: External, app name, your email as test user. No verification needed for personal use.)

### 3. Authorize rclone for Google Drive (one-time)

On **your laptop** (has a browser), install rclone there too and run:

```bash
rclone authorize "drive" --client-id=YOUR_CLIENT_ID --client-secret=YOUR_CLIENT_SECRET
```

A browser opens → sign in to the Google account whose Drive you want to
use → allow access. The command prints a long **token JSON** — copy it.

Now on the **VPS**:

```bash
rclone config
```

- `n` (new remote) → name it `gdrive` → type `drive`
- paste your `client_id` and `client_secret`
- answer **n** to "Use web browser to automatically authenticate?"
- paste the token JSON when prompted (`config_token`)
- accept defaults for the remaining questions, then `q`

Verify:

```bash
rclone lsd gdrive:
# should list your Google Drive folders
```

### 4. Test a backup run

```bash
cd /path/to/bookorbit
chmod +x scripts/backup/backup.sh
./scripts/backup/backup.sh
tail -20 scripts/backup/backup.log    # if you've run it via cron
```

Check the folders appear in Google Drive:
`bookorbit-backups/daily/` and `bookorbit-backups/weekly/`.

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
# copy the dump onto the server, then restore into a fresh/empty DB
# (run from the repo directory, where docker-compose.yml lives)
gunzip -c bookorbit-20260808.sql.gz | docker compose exec -T bookorbit-db \
  psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"
```

**Books & app data:**

```bash
# extract the weekly archive back into the compose directory
tar -xzf bookorbit-20260808-full.tar.gz -C /path/to/bookorbit
docker compose up -d   # rebuild containers, data is back
```

## Configuration (environment variables)

| Variable                        | Default             | Meaning                                 |
| ------------------------------- | ------------------- | --------------------------------------- |
| `BOOKORBIT_DIR`                 | repo root           | where `docker-compose.yml` lives        |
| `BACKUP_DIR`                    | `<repo>/backups`    | local staging dir                       |
| `RCLONE_REMOTE`                 | `gdrive`            | rclone remote name                      |
| `RCLONE_PATH`                   | `bookorbit-backups` | folder in Drive                         |
| `KEEP_DAILY`                    | `14`                | number of daily dumps retained          |
| `KEEP_WEEKLY`                   | `8`                 | number of weekly archives retained      |
| `WEEKLY_WEEKDAY`                | `0`                 | day of week for full archive (0=Sunday) |
| `BACKUP_HOUR` / `BACKUP_MINUTE` | `3` / `0`           | cron time (used by install-cron.sh)     |

## Notes & tips

> 🔐 **Biggest exposure in this setup:** the daily dump folder contains a
> copy of your `.env` — `JWT_SECRET`, `POSTGRES_PASSWORD` and
> `SETUP_BOOTSTRAP_TOKEN` — uploaded to Google Drive in **plaintext**.
> That's fine as long as your Google account stays secure, but anyone with
> read access to that Drive folder can take over your whole server. If that
> bothers you:
>
> - skip `.env` entirely (delete it from `backups/daily/` before upload —
>   secrets can be re-typed from your notes on restore), **or**
> - use an encrypted destination: rclone `crypt` remote or restic (see below).

- **Storage math (15 GB free tier):** `KEEP_WEEKLY=8` × full library size
  - 14 dumps ≈ 8× your library. If your books total more than ~1.5 GB,
    lower `KEEP_WEEKLY` (e.g. 3) or use a Shared Drive with more space.
- Backups land in your **own Google Drive** — anyone with your Google
  account can see them (including `.env` secrets). If you want the server
  unrecoverable-by-compromise, prefer rclone's `crypt` remote or restic.
- The script is safe to re-run any time; it overwrites today's dump.
- If your library grows past ~12 GB total on Drive, either raise retention
  values or point `RCLONE_PATH` at a bigger Drive/Shared Drive.
- To also protect against _accidental deletion on the server_, the local
  `backups/` folder keeps the same retention window — don't `rm -rf` it.
