# Chatind

Chatind is a responsive, installable messaging web app built with React, TypeScript, Express, Socket.IO and PostgreSQL/Prisma. This foundational release includes account registration/login, bearer access tokens with rotating refresh sessions, user discovery, direct conversations, group conversations, real-time message delivery, read receipts, typing indicators, and an S3-compatible upload adapter.

This repository starts with an empty workspace, so the project is implemented as a clean monorepo. It is not an end-to-end encrypted messenger: messages and files are accessible to the service and its authorized database/storage administrators.

## Local development

Requirements: Node.js 20+, npm 10+, Docker Desktop (or a local PostgreSQL 15+ server).

1. Copy `.env.example` to `.env`. Its PostgreSQL credentials are local-development defaults only. For non-local deployments, replace them and both JWT secrets with strong independent values of at least 32 characters.
2. Start PostgreSQL: `docker compose up -d db`
3. Install and initialize: `npm install`, `npm run db:generate`, `npm run db:migrate`, `npm run db:seed`
4. Start both apps: `npm run dev`
5. Open http://localhost:5173. API health check: http://localhost:4000/health.

Development seed accounts (only created when the database is empty):
- `maya` / `ChatindDemo123!`
- `arjun` / `ChatindDemo123!`

Never use the seeded credentials outside local development.

## Configuration and storage

The API validates required environment variables at startup. `DATABASE_URL`, `JWT_SECRET`, `REFRESH_TOKEN_SECRET` and `CORS_ORIGIN` are required. On managed PostgreSQL, use the provider's runtime connection string for `DATABASE_URL` and a direct/non-pooling URL for `DIRECT_URL` when the provider supplies one (otherwise use the same URL). File attachments require an S3-compatible bucket; configure `STORAGE_ENDPOINT`, `STORAGE_REGION`, `STORAGE_BUCKET`, `STORAGE_ACCESS_KEY`, `STORAGE_SECRET_KEY`, and optionally `STORAGE_PUBLIC_URL`. By default, attachment links are short-lived signed URLs; setting `STORAGE_PUBLIC_URL` requires the bucket/object policy to intentionally allow public reads. If storage is not configured, upload requests fail explicitly while text messaging remains available.

The API keeps access tokens in memory at the web client and refresh tokens in HTTP-only, Secure-in-production cookies. `COOKIE_SAME_SITE` defaults to `strict`; set it to `none` when the frontend and API are on different sites (for example, their default Vercel and Railway hostnames). `none` requires HTTPS in production. Refresh tokens are hashed in the sessions table and rotated on refresh. CORS is restricted to `CORS_ORIGIN`; cookie-authenticated state-changing requests also check their `Origin`. Passwords use bcrypt. Input is validated with Zod, upload size/type is constrained, and the API applies rate limiting and secure headers.

## Docker deployment

Set production secrets and the public frontend origin in your deployment environment, then run `docker compose up --build -d`. The `web` nginx container serves the static PWA at http://localhost:5173 and proxies `/api` and `/socket.io` to the API service. Persistent PostgreSQL data is stored in the `postgres_data` Docker volume. Run `npm run db:migrate` as a release step before routing production traffic; do not rely on development `db push`.

### Render/Railway

Create a managed PostgreSQL database and a persistent S3-compatible object bucket (AWS S3, Cloudflare R2, or another compatible service). Deploy the API as a Docker web service and the web app as a Docker/static service using the provided Dockerfiles or Compose. Set the API variables from `.env.example` in the API service: `NODE_ENV=production`, `DATABASE_URL`, `DIRECT_URL` (the same connection URL if your provider has no separate direct URL), `JWT_SECRET`, `REFRESH_TOKEN_SECRET`, `CORS_ORIGIN` (the exact public web origin), `FRONTEND_URL`, and all storage variables. Set the web build argument `API_BASE_URL` to the public API base ending in `/api` if the web app is hosted separately; keep `/api` when using the included nginx proxy. Add HTTPS and configure the provider's health check to `GET /health`. Run migrations as a one-off release command (`npm run db:migrate -w @chatind/api`). Use provider-managed backups for PostgreSQL and lifecycle/backup policies for object storage.

### Vercel web + Railway API

The Socket.IO API needs a persistent Node service; deploy it on Railway (not as a Vercel Function). Create a Railway PostgreSQL service, then deploy the repository's API Dockerfile (`apps/api/Dockerfile`) as a web service. Set its `DATABASE_URL` and `DIRECT_URL` to the database URLs, generate independent `JWT_SECRET` and `REFRESH_TOKEN_SECRET` values of at least 32 characters, and set `NODE_ENV=production`, `CORS_ORIGIN` and `FRONTEND_URL` to the exact Vercel site origin. Use `COOKIE_SAME_SITE=none` when using different-site default provider hostnames; custom frontend/API subdomains on the same site can keep `strict`. Enable HTTPS and set the service health check to `/health`. Run `npm run db:migrate -w @chatind/api` as a release step before serving traffic.

Import the repository into Vercel with the repository root as the project root. The included `vercel.json` builds the web workspace and publishes `apps/web/dist`. Set the Vercel environment variable `VITE_API_BASE_URL` to `https://<railway-api-host>/api` for every deployed environment, then redeploy. Keep uploads disabled until S3-compatible storage variables are configured on the API. Browser privacy settings may block cross-site cookies on default provider hostnames; using custom frontend and API domains under the same registrable domain is the most compatible option.

## Android PWA

Serve the web app over HTTPS, then in Android Chrome choose **Install app** / **Add to Home screen**. The app includes a web manifest, installable service worker shell, icons, standalone display, and an offline fallback. This repository does not include a built APK. To package later with Capacitor: build the web workspace, add Capacitor and its Android platform to `apps/web`, set its web asset directory to `dist`, run `npx cap add android`, `npx cap sync android`, then build/sign from Android Studio. Provide a trusted HTTPS API origin; native packaging does not make the API available offline.

## API outline

- OpenAPI description: [apps/api/openapi.yaml](apps/api/openapi.yaml)
- `POST /api/auth/register`, `/login`, `/refresh`, `/logout`
- `GET /api/auth/me`, `PATCH /api/users/me`, `GET /api/users?search=`
- `GET /api/conversations`, `POST /api/conversations`
- `GET /api/conversations/:id/messages`, `POST /api/conversations/:id/messages`
- `POST /api/uploads`
- `GET /health`

Socket.IO events: `conversation:join`, `message:send`, `message:new`, `message:read`, `message:read-receipt`, `typing:start`, `typing:stop`, and `presence:update`. Socket authentication uses the short-lived access token, and conversation membership is checked server-side.

## Quality status and limitations

Run `npm test` and `npm run build`. The schema includes contacts, blocks, reports, notification preferences, attachments, reactions and read receipts, but the schema alone does not mean each workflow is available. Account deletion/recovery and OTP delivery, profile photo upload, push notifications, admin console, block/report moderation and enforcement, group member administration, message editing/forwarding/reactions, voice recording/playback, contact synchronization, full-history message search, notification/privacy controls, and end-to-end tests are not implemented yet. Do not treat these as implemented. No real credentials are checked in.
