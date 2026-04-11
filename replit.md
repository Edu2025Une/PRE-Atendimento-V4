# Workspace

## Overview

pnpm workspace monorepo using TypeScript. Each package manages its own dependencies.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (CJS bundle)
- **Frontend**: React + Vite (artifacts/frontend), served at `/`
- **Auth**: JWT via `jsonwebtoken`, signed with `JWT_SECRET` env secret

## Structure

```text
artifacts-monorepo/
├── artifacts/
│   ├── api-server/         # Express API server (served at /api)
│   └── frontend/           # React + Vite frontend (served at /)
├── lib/
│   ├── api-spec/           # OpenAPI spec + Orval codegen config
│   ├── api-client-react/   # Generated React Query hooks
│   ├── api-zod/            # Generated Zod schemas from OpenAPI
│   └── db/                 # Drizzle ORM schema + DB connection
├── scripts/
│   └── src/
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── tsconfig.json
└── package.json
```

## Environment Variables & Secrets

| Key | Type | Description |
|-----|------|-------------|
| `JWT_SECRET` | Secret | Signing key for JWT tokens |
| `ALLOWED_ORIGIN` | Env (shared) | Allowed CORS origin (production domain) |
| `VITE_API_URL` | Env (shared) | Base URL prefix for API calls (empty = relative) |
| `EVOLUTION_API_KEY` | Secret | API key for Evolution API (backend proxy) |
| `EVOLUTION_API_URL` | Env | Base URL of the Evolution API service |

## Authentication Flow

- `POST /api/login` — accepts `{ email, password }`, validates mock credentials, returns `{ token, user, expiresIn }`
- Frontend saves session as `{ token, user, expiresAt }` in `localStorage` under key `prea_session`
- `src/lib/auth.ts` handles save/read/validate (including expiry check)
- `src/lib/api.ts` sends requests using `VITE_API_URL` as base (default: relative `/api`)

## Mock Credentials (development)

- Email: `admin@example.com`
- Password: `password123`

## Evolution API Proxy

- `ALL /api/evolution/:path` — validates JWT, proxies to `EVOLUTION_API_URL` with `EVOLUTION_API_KEY` header
- API key is never exposed to the frontend

## TypeScript & Composite Projects

Every package extends `tsconfig.base.json` which sets `composite: true`. The root `tsconfig.json` lists all packages as project references.

- **Always typecheck from the root** — run `pnpm run typecheck`
- **`emitDeclarationOnly`** — only `.d.ts` files emitted during typecheck
- **Project references** — when package A depends on package B, A's `tsconfig.json` must list B in `references`

## Root Scripts

- `pnpm run build` — runs `typecheck` first, then recursively runs `build` in all packages
- `pnpm run typecheck` — runs `tsc --build --emitDeclarationOnly` using project references

## Packages

### `artifacts/api-server` (`@workspace/api-server`)

Express 5 API server. Routes live in `src/routes/`.

- `src/routes/auth.ts` — `POST /api/login` with JWT signing
- `src/routes/evolution.ts` — proxy route `ALL /api/evolution/:path` (JWT-protected)
- `src/app.ts` — CORS configured via `ALLOWED_ORIGIN` env var

### `artifacts/frontend` (`@workspace/frontend`)

React + Vite frontend served at `/`.

- `src/pages/Login.tsx` — login form (PT-BR, loading state, error handling)
- `src/pages/Dashboard.tsx` — protected dashboard (validates token/expiry)
- `src/lib/auth.ts` — session management (localStorage)
- `src/lib/api.ts` — fetch wrapper using `VITE_API_URL`

### `lib/api-spec` (`@workspace/api-spec`)

OpenAPI 3.1 spec (`openapi.yaml`). Run codegen: `pnpm --filter @workspace/api-spec run codegen`

### `lib/db` (`@workspace/db`)

Drizzle ORM + PostgreSQL. Push schema: `pnpm --filter @workspace/db run push`
