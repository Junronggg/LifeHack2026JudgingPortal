# LifeHack 2026 Judging Portal

A mobile-first judging portal deployed as a Cloudflare Worker. Static assets and API routes share one origin, while Cloudflare D1 durably stores users, sessions, and score submissions.

## Architecture

```text
Browser
  └─ Cloudflare Worker
       ├─ /api/*  → src/worker.mjs
       ├─ /*      → public static assets
       └─ DB      → Cloudflare D1
```

## Requirements

- Node.js 20 or newer
- A Cloudflare account with access to `nuscomputing.com`
- Wrangler authenticated to that Cloudflare account

## Local setup

```powershell
npm.cmd install
npm.cmd run db:migrate:local
npm.cmd run db:seed:local
npm.cmd start
```

Open `http://127.0.0.1:8787`.

Local-only preview users are created by `seeds/local-users.sql`:

| Role | Email | Password |
| --- | --- | --- |
| General judge | `judge@lifehack.test` | `judge2026` |
| Company judge | `company@lifehack.test` | `judge2026` |
| Administrator | `admin@lifehack.test` | `admin2026` |

These users are not added to the production database unless somebody explicitly executes the local seed against production. Do not do that.

## Production deployment

### 1. Authenticate Wrangler

```powershell
npx.cmd wrangler login
```

### 2. Create the production D1 database

```powershell
npx.cmd wrangler d1 create lifehack-2026-judging --location apac
```

Copy the returned database UUID into `wrangler.jsonc`, replacing:

```json
"database_id": "00000000-0000-0000-0000-000000000000"
```

### 3. Apply the database schema

```powershell
npm.cmd run db:migrate:remote
```

### 4. Create production users securely

Copy the example file:

```powershell
Copy-Item users.example.json users.private.json
```

Edit `users.private.json` with the real judge/admin names, email addresses, assignments, and unique passwords. Company judges require one of these category IDs:

- `sustainability`
- `health`
- `inclusion`

Generate password-hashed SQL:

```powershell
npm.cmd run users:generate
```

Apply it to production:

```powershell
npx.cmd wrangler d1 execute lifehack-2026-judging --remote --file=./seed-users.private.sql
```

Both `users.private.json` and `seed-users.private.sql` are ignored by Git. Delete them after securely recording judge credentials.

### 5. Deploy the full-stack Worker

```powershell
npm.cmd test
npm.cmd run deploy
```

Before deploying, confirm that the `name` in `wrangler.jsonc` matches the existing Cloudflare Worker you intend to update. A different name creates or updates a different Worker.

### 6. Attach the custom domain

In Cloudflare:

1. Open **Workers & Pages**.
2. Select the deployed Worker.
3. Open **Settings → Domains & Routes**.
4. Choose **Add → Custom Domain**.
5. Enter `lifehack2026judgingportal.nuscomputing.com`.
6. Confirm the DNS record Cloudflare proposes.

If the hostname is currently attached to the old static-only Worker, remove that custom-domain association from the old Worker and attach it to this Worker. Do not delete unrelated `nuscomputing.com` records.

## Verify production

The following URL must return JSON before login can work:

```text
https://lifehack2026judgingportal.nuscomputing.com/api/health
```

Expected response:

```json
{"ok":true}
```

Then verify:

1. Sign in as a judge.
2. Submit one score.
3. Sign in as an administrator in a private window.
4. Confirm the team has one submission and the expected weighted average.
5. Deploy the same Worker again.
6. Confirm the score remains in D1.

## Common commands

```powershell
# Run tests
npm.cmd test

# Start local Worker and local D1
npm.cmd start

# Apply new migrations locally
npm.cmd run db:migrate:local

# Apply new migrations to production
npm.cmd run db:migrate:remote

# Deploy
npm.cmd run deploy

# Export a production backup
npx.cmd wrangler d1 export lifehack-2026-judging --remote --output=lifehack-scores-backup.sql
```

## Security and operational notes

- Passwords use PBKDF2-SHA-256 with per-user random salts.
- Only SHA-256 hashes of session tokens are stored in D1.
- Session cookies are `HttpOnly`, `Secure`, and `SameSite=Strict`.
- State-changing API requests reject cross-origin browser requests.
- Weighted totals are calculated in the Worker and are never returned to judges.
- Do not deploy during active judging; deployments invalidate no D1 data, but active sessions may be disrupted.
- Export D1 before judging, after judging, and before any destructive database operation.
