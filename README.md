# Tempik — Disposable Temp Mail on Cloudflare Workers

Tempik is a **self-hosted disposable email** service that runs entirely on **Cloudflare Workers** — no VPS required. It uses Cloudflare Email Workers to receive inbound email, D1 for storage, and serves a clean web UI from the edge.

> **Repo**: [github.com/hirotomasato/tempik](https://github.com/hirotomasato/tempik)

---

## How it works

```
Sender → Cloudflare MX → Email Worker (email handler)
                                  │
                                  ▼
                          D1 Database (SQLite)
                                  │
                                  ▼
                   Worker HTTP handler → Web UI + API
```

- **No VPS** — everything runs on Cloudflare's edge
- **No Postfix** — Cloudflare Email Workers handle SMTP ingestion natively
- **No Docker** — just `wrangler deploy`
- **Zero cost** — fits within Cloudflare's free tier

---

## Prerequisites

Before you start, you need:

| Requirement | Details |
|---|---|
| **Cloudflare account** | [Sign up here](https://dash.cloudflare.com/sign-up) (free) |
| **A domain** | Must be added to Cloudflare (nameservers pointed to Cloudflare) |
| **Node.js** | v18 or later ([download](https://nodejs.org/)) |
| **npm** | Comes with Node.js |

---

## Step 1 — Clone & install dependencies

```bash
git clone https://github.com/hirotomasato/tempik.git
cd tempik
npm install
```

---

## Step 2 — Login to Cloudflare

```bash
npx wrangler login
```

This opens a browser window. Log in with your Cloudflare account and approve the OAuth scopes.

> **What scopes are needed?**
> Wrangler will request permissions for Workers, D1, Email Routing, Pages, and more. You must approve all of them so the CLI can create the database and deploy the worker.

Verify you're logged in:

```bash
npx wrangler whoami
```

---

## Step 3 — Configure wrangler.toml

Open `wrangler.toml` and replace the placeholder values with your own:

```toml
name = "tempik"
main = "src/index.ts"
compatibility_date = "2025-06-01"

# Set to false when using your own domain (skip workers.dev)
workers_dev = false

# D1 Database — leave database_id empty for now, we'll fill it in Step 4
[[d1_databases]]
binding = "DB"
database_name = "tempik-db"
database_id = ""

# Email Worker — no config block needed; see the note below
# Custom domain — CHANGE THIS to your own domain
[[routes]]
pattern = "tempik.YOURDOMAIN.com"
custom_domain = true

# Environment — CHANGE THESE
[vars]
APP_NAME = "Tempik"
MAIL_DOMAIN = "YOURDOMAIN.com"
WEB_HOST = "tempik.YOURDOMAIN.com"
MAX_INBOXES_PER_SESSION = "50"   # inboxes one browser session may hold
RETENTION_DAYS = "7"             # data older than this is purged nightly

# Retention sweep
[triggers]
crons = ["17 3 * * *"]

# Static assets (don't change)
[assets]
directory = "./src/web"

[observability]
enabled = true
```

**No `[email]` block is required.** A Worker that exports `email()` receives mail as soon as the
Email Routing rule points at it (Step 7b). Wrangler ignores a top-level `[email]` table and prints
`Unexpected fields found in top-level field: email` if one is present.

**All three `vars` + the routes `pattern` must be updated:**
- `YOURDOMAIN.com` → your actual domain (e.g. `example.com`)
- `tempik.YOURDOMAIN.com` → the subdomain for the web UI

**Keeping deployment values out of git.** The committed `wrangler.toml` only holds
placeholders. If you would rather not publish your domain and D1 id, put the real values in
`wrangler.local.toml` (already in `.gitignore`) and deploy with:

```bash
npx wrangler deploy --config wrangler.local.toml
```

A plain `npx wrangler deploy` would read the placeholder file — with an empty `database_id` and a
domain that is not in your account — so use the `--config` form whenever a local file exists.

---

## Step 4 — Create the D1 database

```bash
npx wrangler d1 create tempik-db
```

You'll see output like:

```
✅ Successfully created DB 'tempik-db'

[[d1_databases]]
binding = "DB"
database_name = "tempik-db"
database_id = "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
```

Copy the `database_id` into your `wrangler.toml`.

---

## Step 5 — Apply the database schema

Push the schema to your **remote** D1 database on Cloudflare:

```bash
npx wrangler d1 execute tempik-db --remote --file=src/db/schema.sql
```

This creates four tables:
- `inboxes` — email addresses
- `messages` — received emails
- `sessions` — browser session tokens
- `session_inboxes` — which inboxes belong to which session

> **Note:** The `--remote` flag is important — without it, the schema only applies locally. You want it on Cloudflare's servers.

---

## Step 6 — Deploy the Worker

```bash
npx wrangler deploy
```

This does three things:
1. Uploads the TypeScript Worker code
2. Uploads the static frontend files (HTML/CSS/JS) to Cloudflare Assets (edge CDN)
3. Registers the custom domain route

After a successful deploy, you'll see:

```
Deployed tempik triggers
  tempik.YOURDOMAIN.com (custom domain)
```

---

## Step 7 — Setup DNS on Cloudflare

### 7a. Web UI (automatic)

Cloudflare automatically creates the DNS record for your Worker's custom domain. If it doesn't:

- Go to **Cloudflare Dashboard → Workers & Pages → tempik → Settings → Domains**
- The custom domain `tempik.YOURDOMAIN.com` should already be listed

### 7b. MX Records (automatic with Email Routing)

Email Routing should already be enabled on your domain. Verify:

```bash
npx wrangler email routing settings YOURDOMAIN.com
```

It should show `Enabled: true`. The catch-all rule is also automatically set up — every `*@YOURDOMAIN.com` is routed to the `tempik` Worker:

```bash
npx wrangler email routing rules list YOURDOMAIN.com
```

Expected output:
```
Catch-all rule: enabled, action: worker:tempik
```

### 7c. SPF Record (optional but recommended)

If you don't already have an SPF record, add one so emails don't get flagged as spam:

| Type | Name | Content |
|---|---|---|
| TXT | `@` | `v=spf1 include:_spf.mx.cloudflare.net ~all` |

---

## Step 8 — Test it

1. Open `https://tempik.YOURDOMAIN.com` in your browser
2. Click **New** → **Random** to create a disposable address
3. Send an email from Gmail/any provider to that address
4. Click **Refresh** — the email appears in your inbox

---

## Commands cheat sheet

| Command | What it does |
|---|---|
| `npm run deploy` | Deploy Worker + static assets |
| `npm run db:migrate` | Apply schema to production D1 |
| `npm run db:local` | Apply schema to local D1 (for dev) |
| `npx wrangler dev` | Run Worker locally |
| `npx wrangler tail` | Stream live logs from production |
| `npx wrangler d1 execute tempik-db --remote --command="SELECT * FROM messages LIMIT 10"` | Query the database |

### Check if emails are being received

```bash
npx wrangler d1 execute tempik-db --remote --command="SELECT * FROM messages ORDER BY received_at DESC LIMIT 5;"
```

### Watch live logs

```bash
npx wrangler tail --format pretty
```

Then send a test email — you'll see the Worker processing it in real time.

---

## Project structure

```
tempik/
├── wrangler.toml              # Worker config, D1 binding, routes, env vars
├── package.json
├── tsconfig.json
├── .gitignore
└── src/
    ├── index.ts               # Entry point: fetch() + email() + scheduled()
    ├── email-handler.ts       # Parses inbound email via PostalMime → D1
    ├── maintenance.ts         # Cron: purge data past RETENTION_DAYS
    ├── api/
    │   └── routes.ts          # Hono router: /api/config, /api/session, /api/inboxes, /api/messages
    ├── db/
    │   ├── schema.sql         # D1 tables (inboxes, messages, sessions, session_inboxes)
    │   └── queries.ts         # Typed query functions
    ├── utils/
    │   ├── random-address.ts  # Human-like random email generator
    │   ├── html-to-text.ts    # Flattens HTML mail to text (no innerHTML anywhere)
    │   ├── time.ts            # SQLite timestamps → ISO-8601 UTC
    │   └── validate.ts        # local-part / domain / session-id rules
    └── web/
        ├── index.html         # Frontend UI
        ├── app.js             # Frontend logic (vanilla JS)
        └── styles.css         # Dark theme styles
tests/                         # Vitest unit tests (no network, no Worker runtime)
```

---

## Tech stack

| Layer | Tech |
|---|---|
| **Runtime** | Cloudflare Workers |
| **Router** | Hono |
| **Email parsing** | PostalMime |
| **Database** | Cloudflare D1 (SQLite) |
| **Static hosting** | Cloudflare Workers Assets (edge CDN) |
| **Language** | TypeScript |
| **CLI** | Wrangler v4 |
| **Tests** | Vitest |

---

## Data retention

Nothing used to delete a row: `DELETE /api/inboxes/:address` only unlinks the
inbox from your session, and every message ever received stayed in D1 forever.

A cron trigger now purges data older than `RETENTION_DAYS` (default 7) every
night at 03:17 UTC. It removes messages first, then inboxes that no longer have
messages, then sessions with no remaining links — respecting the foreign keys.

Run the sweep on demand:

```bash
npx wrangler d1 execute tempik-db --remote \
  --command "DELETE FROM messages WHERE received_at < datetime('now','-7 days');"
```

Changing `RETENTION_DAYS` only affects the next scheduled run, and a shorter
window will delete mail that a long-running automation still expects.

---

## Development

```bash
npm install
npx wrangler d1 execute tempik-db --local --file=src/db/schema.sql
npm run dev          # http://localhost:8787
npm test             # Vitest: validation, HTML flattening, timestamp handling
```

`npm test` is plain Node — no Worker runtime, no network, no Cloudflare account.
It covers the parts that were actually broken: address validation, the
HTML-to-text conversion that keeps mail bodies inert, and UTC timestamp
normalisation.

**Invariants worth keeping** (each is a bug that already happened):

1. The web UI must never assign untrusted strings to `innerHTML` — `from`,
   `subject` and `body` are all attacker-controlled. Use `textContent`.
2. Bodies are stored as plain text; `htmlToText()` is what makes that safe.
3. Timestamps leaving the API are ISO-8601 with `Z`, otherwise browsers read
   D1's UTC strings as local time.
4. `POST /api/inboxes` must `ensureSession()` before linking, or the foreign key
   on `session_inboxes.session_id` answers 500.
5. Only unowned addresses may be claimed; otherwise knowing an address is
   equivalent to reading its mail.

---

## Troubleshooting

### "This site can't be reached / DNS_PROBE_FINISHED_NXDOMAIN"

Your domain's nameservers are not pointed to Cloudflare, or the DNS record hasn't propagated yet. Check:

```bash
dig +short YOURDOMAIN.com NS
```

Should show `*.ns.cloudflare.com`. Propagation can take up to 24 hours after changing nameservers.

### Emails not appearing in the web UI

1. The email was received but the inbox hasn't been linked to your browser session. Click **New** → type the exact local-part → click **Create** to claim it.
2. Check the database:
   ```bash
   npx wrangler d1 execute tempik-db --remote --command="SELECT * FROM messages ORDER BY received_at DESC LIMIT 5;"
   ```
3. Check live logs:
   ```bash
   npx wrangler tail --format pretty
   ```

### "Unexpected fields found in top-level field: email"

You have a `[email]` block in `wrangler.toml`. It does nothing — wrangler ignores it, and the
warning is how it tells you. Delete the block. Inbound mail depends only on two things: the
Worker exports `email()`, and the Email Routing rule points at that Worker.

### Wrangler version mismatch

This project uses **Wrangler v4**. If you're on v3:

```bash
npm install --save-dev wrangler@4
```

---

## License

MIT

---

Developer by [masantoid](https://github.com/hirotomasato)
