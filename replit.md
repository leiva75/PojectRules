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
│   └── seed.ts       # Database seeding
├── shared/           # Shared types and schemas
│   └── schema.ts     # Drizzle schemas + Zod validation
├── Dockerfile        # Production Docker image
└── docker-compose.yml # Docker orchestration
```

## Key Features
- **Append-only punches**: No edits/deletes, only corrections
- **Geolocation capture**: Lat/lon rounded to 4 decimals
- **Dual auth**: Admin/Manager (httpOnly cookies) vs Employee (localStorage JWT)
- **CSV exports**: By employee and date range with overtime columns
- **Kiosk mode**: Shared terminal with PIN login + digital signature capture
- **Overtime management**: Automatic calculation on OUT punch, admin approval workflow
- **Kiosk Device Management**: Admin can enroll/disable kiosk devices with secure tokens

## Kiosk Device System
- **Device enrollment**: Admin creates kiosk devices, receives one-time token URL
- **Token security**: Tokens are SHA-256 hashed before storage, never stored plaintext
- **X-KIOSK-TOKEN header**: Kiosk devices authenticate via header, not JWT
- **Digital signatures**: When DigitalOcean Spaces is configured, punches require signature
- **Signature storage**: Signatures uploaded to S3-compatible storage with SHA-256 checksum
- **Audit trail**: Each signature records device ID, user agent, and IP address

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
npm run dev          # Start development server
npm run db:push      # Push schema to database
npx tsx server/seed.ts  # Seed database
```

## Production Deployment

### DigitalOcean App Platform (Recommended)

**Build Command:**
```bash
npm ci && npm run build && npm run db:push
```

**Run Command:**
```bash
npm start
```

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

See README_PRODUCCION.md for VPS deployment guide.
