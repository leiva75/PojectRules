# Pointeuse Hybride - Time Tracking System

## Overview
A full-stack TypeScript time-tracking application with:
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
- **CSV exports**: By employee and date range
- **Kiosk mode**: Shared terminal with PIN login

## Test Accounts
- Admin: `admin@pointeuse.fr` / `admin123` (PIN: 000000)
- Manager: `manager@pointeuse.fr` / `manager123` (PIN: 111111)
- Employee: `jean.martin@pointeuse.fr` / `employee123` (PIN: 123456)

## Development Commands
```bash
npm run dev          # Start development server
npm run db:push      # Push schema to database
npx tsx server/seed.ts  # Seed database
```

## Docker Deployment
```bash
docker-compose up -d --build
```

Environment variables needed:
- `DB_PASSWORD`: PostgreSQL password
- `SESSION_SECRET`: JWT signing secret
