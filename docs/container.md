# Container image

The API (`apps/api`) ships as one image, built from the `Dockerfile` in the repository root. The web
app is deployed separately and is not in it. The same image runs the API and the database
migrations; only the command differs.

## Build

From the repository root (the build context):

```sh
docker build -t retail-os-api .
```

The image is built in stages: Node 24 (slim, version pinned in the `Dockerfile`) with the pnpm
version from `packageManager` in `package.json` (through corepack), `pnpm install --frozen-lockfile`,
a build of the API and `@retail/kit` only, then `pnpm deploy --prod` to a pruned production tree. The
final image holds production dependencies, the compiled code (`dist/`, no source maps) and the SQL
migrations (`drizzle/`). It runs as the unprivileged `node` user with `NODE_ENV=production`.

## Run

Migrate first, then start the API. Both read their settings from the environment (see below); pass
them with `-e` or `--env-file`.

```sh
# 1. Apply the migrations (safe to repeat), then exit.
docker run --rm --env-file <env-file> retail-os-api node dist/db/migrate.js

# 2. Start the API.
docker run -d --name retail-os-api --env-file <env-file> -p <host-port>:<PORT> retail-os-api
```

`<PORT>` is the value of `PORT` (default 3000). The migration command needs only `DATABASE_URL`.

The first owner account is created once, after migrating, with the same image:

```sh
docker run --rm --env-file <env-file> -e OWNER_EMAIL=<email> -e OWNER_PASSWORD=<password> \
  retail-os-api node dist/bootstrap-admin.js
```

## Health

| Path                | Meaning                                                                    |
| ------------------- | -------------------------------------------------------------------------- |
| `GET /health/live`  | The process is up. Never touches the database.                             |
| `GET /health/ready` | 200 only while the API can reach its database (`select 1`), otherwise 503. |

The image `HEALTHCHECK` calls `/health/ready` on `PORT` every 30 seconds (20 seconds of start-up
grace), using Node, so no extra tools are in the image. Neither path is rate limited.

## Environment variables

| Variable                    | Required       | Default                            | Meaning                                                                                                                                                                                                                                                                                                                                 |
| --------------------------- | -------------- | ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`              | yes            |                                    | `postgres://` URL of the database. The API and the migrations both use it.                                                                                                                                                                                                                                                              |
| `JWT_SECRET`                | yes            |                                    | HMAC key for access tokens, at least 32 characters.                                                                                                                                                                                                                                                                                     |
| `PORT`                      | no             | 3000 (`ARG PORT`, also `ENV PORT`) | Port the API listens on (all interfaces). Change it at build time with `--build-arg PORT=...` or at run time.                                                                                                                                                                                                                           |
| `NODE_ENV`                  | no             | `production` (set in the image)    | Leave as is.                                                                                                                                                                                                                                                                                                                            |
| `LOG_LEVEL`                 | no             | `info`                             | `fatal`, `error`, `warn`, `info`, `debug`, `trace` or `silent`.                                                                                                                                                                                                                                                                         |
| `TRUST_PROXY_HOPS`          | no             | `0`                                | How many reverse proxies sit in front of the API. Only then is `X-Forwarded-For` believed (rate limiting uses it).                                                                                                                                                                                                                      |
| `BUSINESS_TIMEZONE`         | no             | `Africa/Addis_Ababa`               | The shop's IANA time zone: it decides which day a sale or an expense belongs to.                                                                                                                                                                                                                                                        |
| `OIDC_ISSUER`               | no             |                                    | Single sign-on: issuer URL. Set all three of `OIDC_ISSUER`, `OIDC_CLIENT_ID` and `OIDC_CLIENT_SECRET`, or none.                                                                                                                                                                                                                         |
| `OIDC_CLIENT_ID`            | no             |                                    | Single sign-on: client id.                                                                                                                                                                                                                                                                                                              |
| `OIDC_CLIENT_SECRET`        | no             |                                    | Single sign-on: client secret.                                                                                                                                                                                                                                                                                                          |
| `OIDC_INTERNAL_URL`         | no             |                                    | Single sign-on, optional: where the API itself reaches the identity provider, for example `http://sso:7300` (an absolute http or https URL, no trailing slash). When set, discovery, token, userinfo and signing keys are fetched from there, while `OIDC_ISSUER` stays the public address people use. Browser addresses are unchanged. |
| `ACCESS_TOKEN_TTL_SECONDS`  | no             | `900`                              | Access token lifetime, 60 to 3600.                                                                                                                                                                                                                                                                                                      |
| `REFRESH_TOKEN_TTL_SECONDS` | no             | `1209600`                          | Refresh token lifetime, at least 3600.                                                                                                                                                                                                                                                                                                  |
| `RATE_LIMIT`                | no             | on                                 | `on` or `off`.                                                                                                                                                                                                                                                                                                                          |
| `OWNER_EMAIL`               | bootstrap only |                                    | Used only by `node dist/bootstrap-admin.js`: the first owner's email.                                                                                                                                                                                                                                                                   |
| `OWNER_PASSWORD`            | bootstrap only |                                    | Used only by `node dist/bootstrap-admin.js`: 12 to 128 characters.                                                                                                                                                                                                                                                                      |

Nothing else is read. The image contains no secret, host or credential. With single sign-on set,
the API reaches the provider (`OIDC_INTERNAL_URL` when set, otherwise `OIDC_ISSUER`) over the network at sign-in.
