# Build & Deployment Guide - Cronos Fichajes

## Development

### Prerequisites
- Node.js 20+
- PostgreSQL 14+ (or use DATABASE_URL from managed DB)

### Local Setup
```bash
# Install dependencies
npm ci

# Copy environment variables
cp .env.example .env
# Edit .env with your local config

# Push database schema
npm run db:push

# Seed initial data (optional)
npx tsx server/seed.ts

# Start development server
npm run dev
```

### Development Commands
| Command | Description |
|---------|-------------|
| `npm run dev` | Start dev server (Vite + Express) |
| `npm run check` | TypeScript type checking |
| `npm run db:push` | Push schema to database |

---

## Production Build

### Build Commands
```bash
# Build frontend and backend
npm run build

# Start production server
npm start
```

### Build Output
- Frontend: `dist/public/` (static files)
- Backend: `dist/index.cjs` (Node.js server)

---

## Database Migrations

Using Drizzle ORM with PostgreSQL.

```bash
# Push schema changes (development)
npm run db:push

# Force push (if conflicts)
npm run db:push -- --force

# Generate migration files (optional)
npx drizzle-kit generate

# Apply migrations
npx drizzle-kit migrate
```

---

## DigitalOcean App Platform Deployment

### App Configuration

**Build Command:**
```
npm ci && npm run build && npm run db:push
```

**Run Command:**
```
npm start
```

**HTTP Port:** `5000`

**Health Check Path:** `/health`

### Environment Variables (Required)

| Variable | Description | Example |
|----------|-------------|---------|
| `DATABASE_URL` | PostgreSQL connection string | `postgresql://user:pass@host:25060/db?sslmode=require` |
| `NODE_ENV` | Environment | `production` |
| `JWT_ACCESS_SECRET` | JWT secret (min 32 chars) | `openssl rand -base64 48` |
| `JWT_REFRESH_SECRET` | JWT refresh secret (min 32 chars) | `openssl rand -base64 48` |
| `KIOSK_KEY` | Kiosk mode key (min 16 chars) | `openssl rand -base64 24` |
| `CORS_ORIGIN` | Allowed origin | `https://cronosfichajes.es` |

### Environment Variables (Optional - Spaces)

| Variable | Description | Example |
|----------|-------------|---------|
| `DO_SPACES_KEY` | Spaces access key | From DO console |
| `DO_SPACES_SECRET` | Spaces secret key | From DO console |
| `DO_SPACES_REGION` | Bucket region | `ams3` |
| `DO_SPACES_BUCKET` | Bucket name | `cronos-fichajes` |

### Managed PostgreSQL Setup

1. Create a Managed PostgreSQL cluster in DigitalOcean
2. Create a database named `cronos_fichajes`
3. Get the connection string from "Connection Details"
4. Add `?sslmode=require` to the URL
5. Set as `DATABASE_URL` in App Platform

### Spaces Setup (for signatures/exports)

1. Create a Space in DigitalOcean
2. Generate API keys in "Spaces Keys"
3. Configure CORS on the Space (if needed for direct uploads)
4. Set environment variables in App Platform

---

## Health Check

```bash
curl https://your-app.ondigitalocean.app/health
# Response: {"status":"ok","timestamp":"...","version":"1.0.0"}
```

---

## Test Accounts

| Role | Email | Password | PIN |
|------|-------|----------|-----|
| Admin | admin@cronosfichajes.es | admin123 | 000000 |
| Gerente | gerente@cronosfichajes.es | manager123 | 111111 |
| Empleado | carlos.lopez@cronosfichajes.es | employee123 | 123456 |

---

## Troubleshooting

### Database Connection Issues
- Verify `DATABASE_URL` format: `postgresql://user:pass@host:port/db?sslmode=require`
- Check if IP is whitelisted in managed DB firewall
- Test connection: `psql $DATABASE_URL -c "SELECT 1"`

### Build Failures
- Ensure Node.js 20+ is used
- Clear node_modules: `rm -rf node_modules && npm ci`
- Check TypeScript errors: `npm run check`

### CORS Issues
- Verify `CORS_ORIGIN` matches your frontend URL exactly
- Include protocol: `https://` not just domain
