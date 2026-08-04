# LifeHack 2026 Judging Portal

A dependency-free, mobile-first judging portal for an open walking exhibition. It includes:

- secure judge/admin sessions using HTTP-only cookies;
- mandatory company-judge assignments;
- coverage-aware recommendations for general judges;
- challenge-based team browsing;
- 0–10 rubric sliders with local draft recovery;
- backend-only weighted score calculation; and
- a live admin coverage dashboard.

## Run locally

Requires Node.js 20 or newer.

```bash
npm start
```

Open `http://127.0.0.1:3000`.

## Preview accounts

| Role | Email | Password |
| --- | --- | --- |
| General judge | `judge@lifehack.test` | `judge2026` |
| Company judge | `company@lifehack.test` | `judge2026` |
| Administrator | `admin@lifehack.test` | `admin2026` |

These are demo credentials from `seed.js`; replace the seed authentication with the event's identity provider before production.

## Configuration

- `PORT`: HTTP port, defaults to `3000`
- `HOST`: bind address, defaults to `127.0.0.1`
- `MIN_JUDGES`: minimum scores required per team, defaults to `3`

Scores are persisted to `data/scores.json`. Devpost remains the system used by teams for project documentation; this portal is intentionally focused on judging operations.

## Test

```bash
npm test
```

## Production notes

Before deploying, replace seeded users/plaintext passwords with SSO or a password store using a modern password hash, run behind HTTPS, add CSRF protection and persistent session storage, and move score storage to a transactional database with backups and an audit log.
