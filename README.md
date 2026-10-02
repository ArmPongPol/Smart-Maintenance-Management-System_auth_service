# my-project: auth and users service

A NestJS 11 service for authentication (JWT access tokens plus rotating
refresh sessions) and user management, backed by PostgreSQL through TypeORM.
It listens on port 3001 and is meant to be called through the api-gateway.

## Setup

```bash
npm install
cp .env.example .env        # then adjust; validated at startup
docker compose up -d        # local Postgres (reads the same .env)
npm run migration:run       # create/upgrade the schema
npm run seed:admin          # first administrator (ADMIN_EMAIL / ADMIN_PASSWORD)
```

## Run

```bash
npm run start:dev       # watch mode
npm run build
npm run start:prod      # one process: node dist/main
npm run start:cluster   # one worker per CPU: node scripts/cluster.mjs
```

Health probes (public, not logged on success): `GET /health/live` (process up)
and `GET /health/ready` (database reachable). Swagger UI is at `/docs` when
`DOCS_ENABLED=true` (on by default outside production).

## Tests

```bash
npm test            # unit tests
npm run test:cov
npx tsc --noEmit && npx eslint src test
```

## Authentication

| Endpoint              | Auth   | Body               | Result |
| --------------------- | ------ | ------------------ | ------ |
| `POST /auth/register` | public | user fields        | new OPERATOR account |
| `POST /auth/login`    | public | `email, password`  | `{ accessToken, refreshToken, tokenType }` |
| `POST /auth/refresh`  | public | `refreshToken`     | new `{ accessToken, refreshToken, tokenType }` |
| `POST /auth/logout`   | public | `refreshToken`     | always `200 { data: null }` |
| `GET /auth/me`        | bearer | none               | the current user |

Access tokens (`JWT_ACCESS_TTL`, 15 min by default) are stateless. Each
request re-checks the user's status and role. That lookup is cached in
process for `USER_CACHE_TTL_MS` (5 s), and a change made through this service
clears the cache immediately in the process that made it.

### Refresh sessions

Each login creates a row in `refresh_sessions`. The refresh token is a JWT
with the claims `{ sub, sid, gen, type: 'refresh' }`, where `sid` is the
session id and `gen` is its generation.

- **Rotation.** A refresh with the current generation moves the session to
  `generation + 1` and returns a new token pair. This is a single conditional
  `UPDATE`, so only one of several concurrent refreshes performs the rotation.
- **Grace window.** A token one generation old is accepted for
  `REFRESH_REUSE_GRACE_SECONDS` (30 s) after a rotation. It gets back the
  *same* refresh token the first caller received, plus a fresh access token.
  This covers two tabs refreshing at once, or a retried request.
- **Reuse detection.** Any older token, or the previous token after the grace
  window, is treated as stolen. The whole session is revoked and the call
  returns `401 Invalid or expired refresh token`, which also logs out the
  legitimate holder.
- **Lifetime.** Each refresh token is valid for `JWT_REFRESH_TTL` (7 d) from
  its rotation. The session as a whole ends `REFRESH_SESSION_MAX_DAYS` (30 d)
  after login, however often it is refreshed.
- **Revocation.** `POST /auth/logout` revokes the token's session. It accepts
  expired tokens, and is idempotent. All of a user's sessions are revoked
  when their password changes, when they are set to INACTIVE, when their role
  changes, and on `DELETE /users/:id`.
- **Brute force.** After `LOGIN_MAX_FAILURES` (5) wrong passwords for an email
  within `LOGIN_FAILURE_WINDOW_SECONDS` (15 min), `POST /auth/login` answers
  429 for that account until the window ends, without running argon2. It is
  keyed by account, not IP, so colleagues behind one NAT address can't lock
  each other out. Counters are per worker process.

> **Upgrade note.** Refresh tokens issued before sessions existed have no
> `sid` and are now rejected with 401. Every user has to log in once after
> this version is deployed. Run `npm run migration:run` before deploying: it
> creates the `refresh_sessions` table.

Login also upgrades password hashes stored with older argon2 parameters to
the current ones (argon2id, 19 MiB, t=2, p=1).

## Users

All `/users` routes require ADMINISTRATOR, except `GET /users/directory`. Any
role can call the directory, which returns only id, name, role and status. It
is cached per role filter for `DIRECTORY_CACHE_TTL_MS` (30 s) and sent with
`Cache-Control: private, max-age=30`.

The service refuses to demote, deactivate or delete the last active
administrator, and returns `409 Cannot remove the last administrator`.

## Configuration

Every variable is validated at startup (`src/config/env.validation.ts`).

| Variable | Default | Meaning |
| --- | --- | --- |
| `NODE_ENV` | `development` | `development`, `test` or `production` |
| `APP_NAME` | none | Swagger title |
| `APP_HOST` | `127.0.0.1` | interface to listen on (`0.0.0.0` in containers) |
| `PORT` | `3001` | HTTP port |
| `LOG_LEVEL` | `log` | `fatal`, `error`, `warn`, `log`, `debug` or `verbose` |
| `API_PREFIX` | none | global route prefix |
| `API_VERSION` | none | reserved |
| `CORS_ORIGINS` | none (no cross-origin requests allowed) | comma-separated allowed origins |
| `CORS_CREDENTIALS` | `true` | CORS `credentials` |
| `DATABASE_HOST` | none (falls back to `HOST`) | Postgres host; one of the two is required |
| `HOST` | none | older name for `DATABASE_HOST` |
| `DATABASE_PORT` | `5432` | Postgres port |
| `DATABASE_USERNAME` / `DATABASE_PASSWORD` / `DATABASE_DATABASE` | required | credentials and database name |
| `DATABASE_POOL_SIZE` | `10` | connections per process |
| `DATABASE_SYNCHRONIZE` | `false` | never `true` in production |
| `DB_LOGGING` | `false` | log every SQL query |
| `DATABASE_SSL` | `false` | TLS to Postgres |
| `DATABASE_SSL_REJECT_UNAUTHORIZED` | `true` | verify the server certificate |
| `DOCS_ENABLED` | `true`, or `false` when `NODE_ENV=production` | serve Swagger |
| `DOCS_PATH` | `docs` | Swagger path |
| `DOCS_DESCRIPTION` | none | Swagger description |
| `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` | required | at least 32 characters each, and they must differ |
| `JWT_ACCESS_TTL` | `15m` | access token lifetime |
| `JWT_REFRESH_TTL` | `7d` | lifetime of one refresh token |
| `JWT_ISSUER` / `JWT_AUDIENCE` | `auth-service` / `auth-service-clients` | `iss` / `aud` claims |
| `REFRESH_SESSION_MAX_DAYS` | `30` | absolute session lifetime |
| `REFRESH_REUSE_GRACE_SECONDS` | `30` | how long the previous refresh token is still accepted |
| `USER_CACHE_TTL_MS` | `5000` | user cache for token checks (0 turns it off) |
| `DIRECTORY_CACHE_TTL_MS` | `30000` | directory cache (0 turns it off) |
| `HASH_CONCURRENCY` | CPU count | concurrent argon2 operations per process |
| `HASH_QUEUE_MAX` | `200` | callers that may wait for a hashing slot before getting 503 `Server busy, please retry` |
| `WORKERS` | CPU count | worker processes for `start:cluster` |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `ADMIN_FIRST_NAME`, `ADMIN_LAST_NAME` | none, `System`, `Administrator` | `seed:admin` only |

Database connections also get these server-side limits:

- `statement_timeout` 5 s
- `idle_in_transaction_session_timeout` 10 s
- `application_name=my-project`
- a 3 s connect timeout

Queries slower than 500 ms are logged. The migration CLI turns off the
statement timeout. Postgres errors map to HTTP statuses as follows:

- constraint and format errors: 400
- unique violations: 409
- lock and statement timeouts: 503

## Scaling and deployment

- **Cluster.** `npm run start:cluster` runs `dist/main.js` in `WORKERS`
  processes. A crashed worker is restarted with backoff (0.5 s up to 30 s),
  and SIGTERM/SIGINT are forwarded so every worker shuts down gracefully.
  Unless `HASH_CONCURRENCY` is set, each worker gets its share of the CPUs for
  hashing.
- **Per-worker state.** Each worker has its own database pool and caches.
  Plan for `WORKERS × DATABASE_POOL_SIZE` connections. Another worker sees a
  change after at most the cache TTL (5 s for users, 30 s for the directory).
- **HTTP server.** The service uses helmet's security headers, does not send
  `X-Powered-By`, and sets keep-alive timeouts of 65 s and 66 s. Those are
  longer than a typical 60 s proxy idle timeout.

### Container

```bash
podman build -t my-project -f Containerfile .
podman run --env-file .env.production -p 3001:3001 my-project
```

The image is multi-stage on `node:24-alpine`. Both stages use musl, so
argon2's prebuilt binary matches. It runs as `node`, with
`NODE_ENV=production`, `UV_THREADPOOL_SIZE=8` and `APP_HOST=0.0.0.0`, and
starts `scripts/cluster.mjs`. Migrations are not run by the image; run
`npm run migration:run` before rolling out. Podman and Buildah read
`.containerignore`. For `docker build`, copy it to `.dockerignore`.
