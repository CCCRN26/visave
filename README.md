# CCCRN VSLA Management Platform

Phase 1 of a multi-organization VSLA platform: organizations, projects, Nigerian locations, users, scoped roles, facilitators, groups, sessions, audit trails, and real dashboard counts.

**NO ORM. NO TYPESCRIPT.** The codebase uses JavaScript, Next.js App Router, React, Tailwind CSS, PostgreSQL through `pg`, Zod, and bcryptjs. SQL remains explicit and parameterized in server modules.

## Local setup

1. Install Node.js 20.9+ and PostgreSQL with `pgcrypto` available.
2. Run `npm install`.
3. Copy `.env.example` to `.env` and configure `DATABASE_URL`, a strong `SESSION_SECRET`, and optional seed-admin credentials. Admin seed passwords must contain at least 12 characters.
4. Create the empty database, then run `npm run db:migrate` and `npm run db:seed`.
5. Start with `npm run dev` and open `http://localhost:3000/login`.

Validation commands are `npm run lint`, `npm test`, and `npm run build`. The reset script is guarded and intentionally refuses to destroy data; recreate only a disposable development database manually.

## Architecture

App Router handlers are thin adapters. Zod validates external input, cookie sessions authenticate, permission and scope helpers authorize, services coordinate transactions and auditing, repositories own parameterized SQL, and a hot-reload-safe `pg` pool owns connections. JSON APIs consistently return `{ success, data }` or a sanitized `{ success, error }` envelope.

Web login creates a 256-bit random token, stores only its SHA-256 hash, and places the token in an HttpOnly, SameSite=Lax cookie (Secure in production). Logout revokes the database session. This token-neutral service boundary allows a future mobile client to return the same session token through a different transport.

RBAC is permission based. Assignments can be global or scoped to project and state. Group list and detail SQL enforce organization, project/state assignment, and facilitator ownership before rows leave PostgreSQL. A facilitator cannot retrieve another facilitator's group merely by changing its UUID.

Audit entries capture login/logout and service-layer creates/updates while recursively excluding keys resembling passwords, secrets, or tokens. Significant records use statuses instead of destructive deletion.

## Structure

- `database/migrations`: ordered, tracked SQL migrations
- `database/seeds`: idempotent roles, permissions, CCCRN, pilot, Niger locations, facilitators, and four groups
- `scripts`: migration and seed runners
- `src/lib`: pool, transactions, auth, permissions, validation, auditing, errors
- `src/modules`: schemas, repositories, and services
- `src/app/api`: versioned API and health endpoint
- `src/app/(protected)`: authenticated Phase 1 pages

## Phase 2 readiness

Members, constitutions, cycles, meetings, savings, social fund, loans, immutable ledger, and share-out can be added as modules without replacing identity, project/group scope, database access, or auditing. See `ARCHITECTURE.md` for the non-negotiable monetary and reversal rules.
