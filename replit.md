# Cronos Fichajes - Sistema de Control Horario

## Overview
A full-stack TypeScript time-tracking application for Cronos Gimnasio Palencia with:
- **Frontend**: React + Vite + Tailwind CSS
- **Backend**: Node.js + Express + TypeScript
- **Database**: PostgreSQL with Drizzle ORM
- **Authentication**: JWT with dual systems (Admin/Manager vs Employee)

## Architecture

```
/
├── client/           # React frontend
│   └── src/
│       ├── components/  # Reusable UI components
│       ├── pages/       # Route pages
│       └── lib/         # Auth context, query client
├── server/           # Express backend
│   ├── auth.ts       # JWT authentication
│   ├── db.ts         # Database connection
│   ├── routes.ts     # API endpoints
│   ├── storage.ts    # Data access layer
│   ├── timezone.ts   # Europe/Madrid timezone utilities
│   └── seed.ts       # Database seeding
├── shared/           # Shared types and schemas
│   └── schema.ts     # Drizzle schemas + Zod validation
├── migrations/       # Drizzle versioned migrations
│   └── 0000_*.sql    # Initial schema migration
├── scripts/
│   └── migrate.ts    # Programmatic migration runner
├── Dockerfile        # Production Docker image
└── docker-compose.yml # Docker orchestration
```

## Key Features
- **Append-only punches**: No edits/deletes, only corrections
- **Geolocation capture**: Lat/lon rounded to 4 decimals
- **Triple auth**: Admin/Manager (httpOnly cookies) vs Employee PIN (localStorage JWT) vs Employee Portal (httpOnly cookies, separate session)
- **Employee Portal ("Mis Fichajes")**: Read-only view of own shifts, mobile-first, PDF/CSV export
- **CSV exports**: By employee and date range with overtime columns
- **Kiosk mode**: Shared terminal with PIN login + digital signature capture
- **Overtime management**: Automatic calculation on OUT punch, admin approval workflow
- **Kiosk Device Management**: Admin can enroll/disable kiosk devices with secure tokens
- **Employee profile editing**: Admin/Manager can edit employee name, email, role, password, and 6-digit PIN via EmployeeDialog (create/edit dual mode)

## Timezone Management
- All dates/times are displayed and calculated in **Europe/Madrid** timezone
- Central helper: `ensureDateUTC()` normalizes Date|string|number|null|undefined inputs, appending "Z" to naive strings for UTC interpretation
- Server utilities: `server/timezone.ts` — `ensureDateUTC()`, `formatInMadrid()`, `formatDateES()`, `formatTimeES()`, `formatDateTimeES()`, `toSpainDateKey()`, `startOfDayInSpain()`, `endOfDayInSpain()`, `verifyTimezoneSupport()`
- Client utilities: `client/src/lib/timezone.ts` — same helpers for frontend use
- PDF generator: imports from `server/timezone.ts` (single source of truth, no duplicated formatting)
- Database stores timestamps in UTC (`timestamp without time zone`), conversion happens at display/calculation time
- CSV exports, PDF reports, and all UI elements explicitly specify `timeZone: "Europe/Madrid"`
- Day boundaries for queries (overtime, attendance, reports) use Spain timezone to avoid off-by-one date issues
- Docker: Alpine image includes `tzdata` package and `ENV TZ=UTC` for full timezone support
- Boot verification: `[TZ-CHECK]` log at startup validates CET (+1h) and CEST (+2h) formatting
- General PDF report: sorted chronologically (oldest → newest), not by employee name

## Employee Portal System ("Mis Fichajes")
- **Auth flow**: Email+password login → httpOnly cookies (`epAccessToken` + `epRefreshToken`), separate from admin session
- **Cookie config**: `httpOnly: true`, `secure: prod`, `sameSite: "lax"`, `path: "/"`
- **Token types**: `employee-portal` (access, 1h) + `ep-refresh` (refresh, 7d with rotation)
- **Endpoints** (all filtered by JWT `sub`, no employeeId parameter accepted):
  - `POST /api/auth/employee/login` — email+password, returns cookies
  - `POST /api/auth/employee/refresh` — rotate refresh token
  - `POST /api/auth/employee/logout` — clear cookies + delete refresh from DB
  - `GET /api/auth/employee/me` — verify session
  - `GET /api/me/shifts?from=YYYY-MM-DD&to=YYYY-MM-DD` — read-only shifts with IN/OUT pairing
  - `GET /api/me/shifts/export.pdf?from=&to=` — PDF download (Content-Disposition: attachment, Cache-Control: no-store)
  - `GET /api/me/shifts/export.csv?from=&to=` — CSV download (UTF-8 BOM for Excel)
- **Shift pairing**: Defensive IN→OUT matching with `status: "OK" | "INCOMPLETE"` for anomalies
- **Anti-IDOR**: No employeeId in URL/body/query, no employeeId in response payload
- **Frontend routes**: `/empleado` (login), `/empleado/mis-fichajes` (shifts view)
- **Mobile-first**: Cards (<640px), table (>=640px), sticky PDF download bar, safe-area padding
- **TODO**: RLS Postgres policy for defense-in-depth (currently application-level filtering only)

## Kiosk Device System
- **Device enrollment**: Admin creates kiosk devices, receives one-time token URL
- **Token security**: Tokens are SHA-256 hashed before storage, never stored plaintext
- **X-KIOSK-TOKEN header**: Kiosk devices authenticate via header, not JWT; explicitly listed in CORS `allowedHeaders`
- **Digital signatures**: JPEG 0.5 quality (reduced from PNG for ~10x smaller payload)
- **Signature storage**: Signatures uploaded to S3-compatible storage with SHA-256 checksum
- **Audit trail**: Each signature records device ID, user agent, and IP address
- **PIN ref**: Authenticated PIN stored in useRef for stable punch submission (not React state)
- **Rate limiting**: Separate `employeeLimiter` (50/15min) for employee/kiosk login vs `authLimiter` (10/15min) for admin login
- **DB error handling**: `isDbError()` helper detects connection errors → returns 503 instead of 500; client shows "Servicio temporalmente no disponible"
- **Instrumented logging**: `[KIOSK-PUNCH]` prefix on all kiosk punch operations for production debugging
- **Pool config**: `max:10`, `connectionTimeoutMillis:5000`, `idleTimeoutMillis:30000` — fails fast instead of 134s timeout
- **SSL with CA certificate**: `certs/ca-certificate.crt` (DigitalOcean CA) loaded by `server/db.ts`; if present → `rejectUnauthorized: true` (full verification); fallback → `rejectUnauthorized: false`; for `drizzle-kit`: use `NODE_EXTRA_CA_CERTS=./certs/ca-certificate.crt npm run db:push`
- **DATABASE_URL hardening**: Validated at startup (non-empty, starts with `postgres://`), cleaned via `URL` API, masked in logs (`[PG-URL]`), `process.exit(1)` on invalid
- **Startup diagnostics**: `validateConfig()` logs presence of all required env vars (DATABASE_URL, JWT secrets, CORS_ORIGIN, KIOSK_KEY, DO_SPACES_KEY) without exposing values
- **Auth error handling**: All auth catch blocks (`login`, `employee-login`, `kiosk-login`, `refresh`, `me`, `logout`) use `handleRouteError` for 503 on DB errors

## Pause System (20-minute break)
- **Punch types**: `BREAK_START` and `BREAK_END` added to `punch_type` enum
- **DB column**: `is_auto` boolean on punches table (true for cron-generated BREAK_END)
- **Migration**: `migrations/0001_add_break_types.sql` (idempotent DO $$ block)
- **Endpoints** (all `authenticateEmployee`):
  - `GET /api/pause/status` — returns `{ status: "OFF"|"ON"|"BREAK", breakStartedAt?: ISO }` (single source of truth)
  - `POST /api/pause/start` — starts a 20-min break (validates status=ON)
  - `POST /api/pause/end` — ends break early (validates status=BREAK)
- **Status helper** `getEmployeeStatus()`:
  - `getLastWorkPunch()` queries only IN/OUT → determines ON/OFF base
  - If ON and last overall punch is BREAK_START → status=BREAK
  - Robust against dirty data (orphan BREAK without IN, etc.)
- **Auto-close cron**: `setInterval(60s)` in `server/index.ts`
  - Module-level `pauseCronStarted` guard prevents double-fire in dev (HMR)
  - Finds open BREAK_START with no subsequent BREAK_END via NOT EXISTS subquery
  - Re-checks before insert (idempotent)
  - Sets BREAK_END timestamp = startTime + 20min (not "now")
  - `isAuto: true` on auto-generated BREAK_END
  - Log prefix: `[PAUSE-CRON]`
- **Frontend (mobile.tsx)**: 3 states driven by `/api/pause/status`
  - OFF: green ENTRADA button
  - ON: orange SALIDA button + indigo "Pausa (20 min)" button
  - BREAK: countdown timer (20:00→00:00) + "Reanudar ahora" button
  - Auto-refetch when countdown reaches 0
- **Pairing safety**: All report/export pairing logic uses `if (IN) / else if (OUT)` to skip BREAK events
- **StatusBadge**: Extended with BREAK_START ("Pausa") and BREAK_END ("Fin pausa") styles (indigo theme)
- **CSV export**: BREAK events labeled "Inicio Pausa" / "Fin Pausa" in Tipo column
- **No changes** to existing `/api/punches` or `punchRequestSchema`

## Localization
- All API error messages are in **Spanish** (no French remaining)
- Frontend UI is fully in Spanish
- Backend responses use consistent terminology: "fichaje", "empleado", "firma", etc.

## Overtime System
- Automatic calculation: On each OUT punch, daily minutes are calculated from all IN->OUT pairs
- Configurable threshold: OVERTIME_MIN_THRESHOLD (default: 15 minutes) before creating request
- Expected daily minutes: EXPECTED_DAILY_MINUTES (default: 480 = 8 hours)
- Admin workflow: Filter by status (pending/approved/rejected), mandatory comment for approval/rejection
- Audit trail: All overtime_create and overtime_review actions logged
- CSV export includes Overtime_Minutos and Overtime_Estado columns

## Premium Design System - Icy Indigo Palette

### Color Tokens (CSS Variables)
| Token | Light Mode | Description |
|-------|------------|-------------|
| `--bg-app` | #eef2ff | Pale indigo app background |
| `--bg-surface` | #f8fafc | Near-white for cards/panels |
| `--bg-surface-2` | #e0e7ff | Light indigo for alternating rows |
| `--border-subtle` | #c7d2fe | Subtle indigo borders |
| `--input-bg` | #ffffff | White input backgrounds |
| `--input-border` | #a5b4fc | Indigo input borders |
| `--input-focus` | #1e40af | Blue focus rings |

### Visual Hierarchy
- **Sidebar**: Dark blue-black background (#0f172a) with light text
- **Active states**: Blue accent bar on left side + highlighted background
- **Content areas**: Subtle indigo tint (NOT pure white) for depth
- **Cards**: Lighter than background (creates layered depth effect)
- **Inputs**: White backgrounds that stand out from page background

### Section Accent Colors
| Section | Color | Hex |
|---------|-------|-----|
| Dashboard | Blue | #3b82f6 |
| Employees | Purple | #8b5cf6 |
| Punches | Teal | #14b8a6 |
| Revision | Amber | #f59e0b |
| Overtime | Cyan | #06b6d4 |
| Reports | Indigo | #6366f1 |

### Component Styling
- **Cards**: Subtle shadows, colored icon backgrounds (rounded squares)
- **Lists**: Alternating row backgrounds using bg-surface-2
- **Informes**: CSV export merged into Reports section (no separate menu item)

## Test Accounts
- Admin: `admin@cronosfichajes.es` / `admin123` (PIN: 000000)
- Gerente: `gerente@cronosfichajes.es` / `manager123` (PIN: 111111)
- Empleado: `carlos.lopez@cronosfichajes.es` / `employee123` (PIN: 123456)

## Development Commands
```bash
npm run dev              # Start development server
npm run db:push          # Push schema to database (DEV ONLY)
npx drizzle-kit generate # Generate migration from schema changes
npx tsx scripts/migrate.ts # Apply versioned migrations
npx tsx server/seed.ts   # Seed database
```

## Production Deployment

### Health Endpoints
- `GET /health` - Lightweight check (NO DB) - Use for platform healthchecks
- `GET /api/health` - Deep check (includes DB status) - For monitoring dashboards

### JWT Authentication
- **Access tokens**: Signed with `JWT_ACCESS_SECRET` (15m expiry)
- **Refresh tokens**: Signed with `JWT_REFRESH_SECRET` (7 days expiry)
- **Employee tokens**: Signed with `JWT_ACCESS_SECRET` (12h expiry)
- Secrets must be different and at least 32 characters in production

### Payload Limits
- JSON body: 10MB max (for base64 signatures)
- File uploads: 2MB max per file

### DigitalOcean App Platform (Recommended)

**Build Command:**
```bash
npm ci && npm run build
```

**Run Command (with migrations):**
```bash
npx tsx scripts/migrate.ts && npm start
```

**Run Command (without migrations):**
```bash
npm start
```

**Health Check Endpoint:** `/health` (NOT `/api/health`)

**Database Migrations:**
- **Production**: Run `npx tsx scripts/migrate.ts` before `npm start` (safe for single-instance deploys)
- **Scaling**: If running multiple instances, run migrations as a separate job/command before starting the app, NOT at startup
- **Dev only**: `npm run db:push` for quick schema sync without versioned migrations
- **Generate new migration**: After changing `shared/schema.ts`, run `npx drizzle-kit generate`

**Required Environment Variables:**
| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | PostgreSQL connection string (with `?sslmode=require`) |
| `NODE_ENV` | `production` |
| `JWT_ACCESS_SECRET` | Min 32 chars (`openssl rand -base64 48`) |
| `JWT_REFRESH_SECRET` | Min 32 chars (`openssl rand -base64 48`) |
| `KIOSK_KEY` | Min 16 chars (`openssl rand -base64 24`) |
| `CORS_ORIGIN` | Frontend URL (e.g., `https://app.example.com`) |

**Optional - DigitalOcean Spaces (for signatures):**
| Variable | Description |
|----------|-------------|
| `DO_SPACES_KEY` | Spaces access key |
| `DO_SPACES_SECRET` | Spaces secret key |
| `DO_SPACES_REGION` | Bucket region (e.g., `ams3`) |
| `DO_SPACES_BUCKET` | Bucket name |

See `BUILD.md` for detailed deployment instructions.

### Docker Deployment
```bash
cp .env.production.example .env.production
nano .env.production
docker compose up -d --build
docker compose exec app npm run db:push
docker compose exec app npx tsx server/seed.ts
```

The Dockerfile HEALTHCHECK uses `/health` (lightweight, no DB dependency).

See README_PRODUCCION.md for VPS deployment guide.
