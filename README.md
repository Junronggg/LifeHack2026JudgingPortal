# LifeHack 2026 Judging Portal

A mobile-first Cloudflare Worker judging portal for a small, pre-approved judge group. Accounts are stored as password-hashed Worker secrets, sessions use signed cookies, and Google Sheets is the authoritative score store.

There is no public registration. Organizers create every judge and administrator account.

## Architecture

```text
Browser
  -> Cloudflare Worker
       - Static frontend
       - API and weighted scoring
       - Password-hashed USERS_JSON secret
       - Signed session cookies
       -> Signed requests -> Google Apps Script -> Google Sheet
```

The spreadsheet contains:

- **Score Log**: immutable history of every submission and edit.
- **Latest Scores**: one current row per team/judge pair.

## 1. Create the Google Sheet

1. Create a blank Google Sheet named `LifeHack 2026 Judging Results`.
2. Copy the spreadsheet ID from its URL: `https://docs.google.com/spreadsheets/d/SPREADSHEET_ID/edit`.
3. Open **Extensions > Apps Script**.
4. Replace `Code.gs` with the contents of `google-apps-script/Code.gs` from this repository.

Generate a shared secret locally:

```powershell
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

In Apps Script, open **Project Settings > Script properties** and add:

| Property | Value |
| --- | --- |
| `SPREADSHEET_ID` | The ID copied from the Google Sheet URL |
| `SHARED_SECRET` | The generated random value |

In the Apps Script editor:

1. Select `setupSpreadsheet` from the function list.
2. Click **Run**.
3. Approve Google Sheets access.
4. Confirm the two tabs were created.

Deploy Apps Script:

1. Select **Deploy > New deployment**.
2. Choose **Web app**.
3. Set **Execute as** to `Me`.
4. Set **Who has access** to `Anyone`.
5. Deploy and copy the URL ending in `/exec`.

The web app is anonymous at the Google layer because Cloudflare cannot complete an interactive Google login. Every request is nevertheless timestamped, nonce-protected, and HMAC-signed with `SHARED_SECRET`.

## 2. Prepare judge accounts

```powershell
Copy-Item users.example.json users.private.json
```

Edit `users.private.json`. Valid category IDs for company judges are:

- `sustainability`
- `health`
- `inclusion`

Every password must be at least 12 characters. Generate hashes:

```powershell
npm.cmd run users:generate
```

This creates `users.secret.private.json`. Store its entire one-line contents as the Cloudflare `USERS_JSON` secret. Do not commit either private file.

To regenerate the output, delete `users.secret.private.json` first. The generator deliberately refuses to overwrite an existing secret file.

## 3. Configure Cloudflare Worker secrets

Generate a separate session secret:

```powershell
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

In Cloudflare, open:

```text
Workers & Pages > lifehack2026judgingportal > Settings > Variables and Secrets
```

Add these four **Secret** values:

| Name | Value |
| --- | --- |
| `USERS_JSON` | Entire contents of `users.secret.private.json` |
| `SESSION_SECRET` | The newly generated session secret |
| `SHEETS_WEB_APP_URL` | The Apps Script `/exec` URL |
| `SHEETS_SHARED_SECRET` | The same value as the Apps Script `SHARED_SECRET` property |

Do not store these values under `vars` in `wrangler.jsonc`.

For CLI configuration, the equivalent command for each value is:

```powershell
npx.cmd wrangler secret put SECRET_NAME
```

Paste the value when Wrangler prompts. Note that `wrangler secret put` immediately creates and deploys a new Worker version.

## Optional local development

After generating the account file, create an ignored `.dev.vars` file:

```dotenv
USERS_JSON=[paste the single-line JSON here]
SESSION_SECRET=paste-a-separate-random-secret-here
SHEETS_WEB_APP_URL=https://script.google.com/macros/s/DEPLOYMENT_ID/exec
SHEETS_SHARED_SECRET=paste-the-apps-script-shared-secret-here
```

Then start the local Worker:

```powershell
npm.cmd run dev
```

The local portal still writes to the configured Google Sheet, so use a separate test spreadsheet if you do not want local test scores mixed with event scores.

## 4. Deploy

Configure Apps Script and all four Cloudflare secrets before pushing. Then run:

```powershell
npm.cmd install
npm.cmd test
npx.cmd wrangler deploy --dry-run
git add .
git commit -m "Use Google Sheets for judging results"
git push
```

The connected Cloudflare build runs automatically. The Worker name in `wrangler.jsonc` is `lifehack2026judgingportal` and matches the connected build.

## 5. Verify

Open:

```text
https://lifehack2026judgingportal.nuscomputing.com/api/health
```

Expected:

```json
{"ok":true,"storage":"google-sheets"}
```

Then:

1. Sign in as a judge.
2. Submit one test score.
3. Confirm a row appears in **Score Log**.
4. Confirm the current row appears in **Latest Scores**.
5. Edit the score in the portal.
6. Confirm Score Log has a second row while Latest Scores still has one row for that judge/team.
7. Sign in as administrator and verify coverage and weighted average.

## Updating accounts

Edit `users.private.json`, delete the previous generated output, and run:

```powershell
npm.cmd run users:generate
npx.cmd wrangler secret put USERS_JSON
```

Paste the newly generated `users.secret.private.json` contents. Changing `SESSION_SECRET` signs everyone out; changing only `USERS_JSON` does not invalidate valid sessions for accounts that still exist.

To disable an account immediately, remove it from `users.private.json`, regenerate `USERS_JSON`, and update the Worker secret. Existing sessions for that account will then stop working.

## Updating Apps Script

After editing `Code.gs`:

1. Open **Deploy > Manage deployments**.
2. Edit the web-app deployment.
3. Select **New version**.
4. Deploy.

Keep using the `/exec` URL. The `/dev` URL is only for script editors and must not be configured in Cloudflare.

## Security notes

- Real passwords never enter Git or Google Sheets.
- Passwords use PBKDF2-SHA-256 with per-user random salts.
- Browser sessions are signed, expire after 12 hours, and use `HttpOnly`, `Secure`, `SameSite=Strict` cookies.
- Google requests use HMAC-SHA-256 signatures, timestamps, and one-time nonces.
- The Worker calculates weighted scores; judges never receive the weighted result.
- Spreadsheet text is escaped to prevent formula injection.
- Protect access to the Google Sheet because it contains scores and private judge notes.

## Troubleshooting

- **Build reports a missing secret:** add all four required secrets to the correct Worker before pushing.
- **`/api/health` returns 404:** the custom domain still points to an older Worker deployment.
- **Login returns 500:** `USERS_JSON` or `SESSION_SECRET` is missing or malformed.
- **Login returns 401:** email/password does not match `USERS_JSON`.
- **Dashboard returns 502:** Apps Script URL, shared secret, deployment access, or spreadsheet properties are incorrect.
- **Apps Script says permission denied:** redeploy as `Execute as me` and ensure the production `/exec` deployment allows `Anyone`.
- **Scores do not appear:** run `setupSpreadsheet`, then inspect Apps Script **Executions** for the rejected request.
