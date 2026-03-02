# Cronos Fichajes - Sistema de Control Horario

## Overview
Cronos Fichajes is a full-stack TypeScript time-tracking application designed for Cronos Gimnasio Palencia. Its primary purpose is to provide a robust system for managing employee time punches, breaks, and overtime, complete with administrative oversight and reporting capabilities. The project aims to modernize time-tracking, reduce manual errors, and provide clear insights into attendance and work hours. Key capabilities include append-only punch records with geolocation, multiple authentication schemes (Admin/Manager, Employee PIN, Employee Portal), a dedicated employee portal for shift viewing and export, a kiosk mode with digital signature capture, and comprehensive overtime management with an approval workflow. The system also features detailed reporting for authorities, including break and correction details.

## User Preferences
I prefer clear, concise explanations and direct answers. For coding, I favor clean, readable TypeScript with a focus on maintainability and established patterns. When proposing changes, please outline the impact and rationale. I appreciate iterative development, with frequent updates on progress and opportunities for feedback. Do not make changes to the `shared/schema.ts` file without explicit confirmation.

## System Architecture
The application follows a full-stack architecture comprising a React frontend (Vite, Tailwind CSS), a Node.js/Express TypeScript backend, and a PostgreSQL database with Drizzle ORM. Authentication is handled via JWT, supporting distinct roles for Admin/Manager and Employees.

**UI/UX Decisions:**
The design system, "Icy Indigo Palette," uses a premium, modern aesthetic.
- **Color Scheme:** Predominantly indigo hues (`--bg-app: #eef2ff`, `--bg-surface: #f8fafc`, `--bg-surface-2: #e0e7ff`) with subtle borders (`--border-subtle: #c7d2fe`).
- **Visual Hierarchy:** A dark blue-black sidebar contrasts with lighter content areas. Cards and panels are designed with subtle shadows and lighter backgrounds to create depth.
- **Accent Colors:** Different sections (Dashboard, Employees, Punches, etc.) are distinguished by specific accent colors (e.g., Blue for Dashboard, Purple for Employees).
- **Component Styling:** Cards feature subtle shadows and colored icon backgrounds. Lists use alternating row backgrounds for readability.
- **Employee Portal:** Designed with a mobile-first approach, adapting views for smaller screens.

**Technical Implementations:**
- **Timezone Management:** All dates and times are consistently handled in `Europe/Madrid` timezone. The database stores timestamps in UTC, with conversion occurring at the display and calculation layers. Helper functions (`ensureDateUTC`, `formatInMadrid`) ensure consistency across server and client.
- **Append-Only Punches:** Punch records are designed to be append-only, ensuring data integrity. Corrections are recorded separately, preserving the original data.
- **Geolocation Capture:** Employee punches include geolocation data, rounded to 4 decimal places.
- **Triple Authentication:**
    - **Admin/Manager:** Username + password via Gestion `users` table (`POST /api/auth/admin-login`). httpOnly cookies (`accessToken`/`refreshToken`) with `source: "gestion_users"`. Proxy employee created on first login (linked via `employees.gestionUserId`). Legacy email/password login available via `POST /api/auth/login` (can be disabled with `ALLOW_LEGACY_EMPLOYEE_ADMINS=false`).
    - **Employee PIN (Kiosk):** 6-digit PIN for kiosk clock-in/out (`POST /api/auth/kiosk-login`, `POST /api/kiosk/punch`). JWT stored in localStorage.
    - **Employee Portal:** 6-digit PIN login (`POST /api/auth/employee/login`). Separate httpOnly cookies (`epAccessToken`/`epRefreshToken`) for portal session, distinct from admin cookies. No email/password required.
- **Employee Portal ("Mis Fichajes"):** Provides employees a read-only view of their shifts, with PDF/CSV export functionality. Login via PIN only. Strict anti-IDOR measures are in place to prevent unauthorized data access.
- **Kiosk Device System:**
    - Supports device enrollment with one-time tokens.
    - Uses `X-KIOSK-TOKEN` header for authentication.
    - Captures digital signatures (JPEG, 0.5 quality) uploaded to S3-compatible storage with SHA-256 checksums and audit trails.
- **Overtime System:** Automatically calculates overtime based on configured thresholds and expected daily minutes. Includes an admin approval workflow with audit logging.
- **Pause System:** Implements a 20-minute break feature with `BREAK_START` and `BREAK_END` punch types. An automatic cron job closes breaks after 20 minutes. Pause is available on both kiosk and mobile interfaces. The `useCountdown` and `formatCountdown` hooks are shared via `client/src/hooks/use-countdown.ts`.
- **Global Bearer Token Injection:** The global fetcher (`client/src/lib/queryClient.ts`) automatically injects `Authorization: Bearer <token>` from `localStorage("employeeToken")` into all requests via `injectEmployeeToken()`. This ensures employee endpoints (pause status, punches) work consistently across all React Query operations.
- **Authorities Report (`server/authorities-pdf.ts`):** Generates a compact PDF for regulatory compliance. Features:
    - Signature detection uses `signatureData || signatureSha256 || signatureSignedAt` (covers both S3 and inline signatures).
    - "Pausa" column: shows "Sí"/"No" (green/red) for shifts ≥5h, "—" for shorter shifts. Incidence "Sin pausa (+5h)" added automatically.
    - "Firma" column: "Sí"/"No" per day based on punch signature data.
    - Incident highlighting: rows with "Sin salida", "Sin entrada", or other incidents get a light red background.
    - Labels: "Sin salida" (IN without OUT), "Sin entrada" (OUT without IN), "Doble entrada", "Doble salida".
    - Compact layout: employees chain on same page when space allows, reduced cover page spacing, 20px row height.
    - Annexes: A (event detail) and B (corrections) only. Annex C (SHA-256 signature details) removed as unnecessary for authorities.
    - Employee sections include "Corr." column for corrections.
- **Monitor Sync System (`server/monitor-sync.ts`):** Automatic synchronization from `monitors` table (Gimnasio Cronos) to `employees` table (Cronos Fichajes). Features:
    - `employees.monitorId` (integer, nullable, unique) links each employee to their monitor — this is the stable external ID.
    - `employees.syncDisabled` (boolean, default false) — when true, monitor-sync skips this employee entirely (no updates, no reactivation). Set by Gestion API on archive/deactivate operations.
    - Cron job runs every 5 minutes via `setInterval` (tag `[MONITOR-SYNC]`).
    - Non-destructive: never deletes, never modifies role of existing employees.
    - **Anti-zombie protection:** Employees with `syncDisabled=true` are never reactivated by the sync, even if their monitor becomes active again. Only the Gestion API can re-enable them.
    - **Orphan detection:** After each sync cycle, queries employees with a `monitorId` not found in the current monitors list and logs warnings (`[MONITOR-SYNC] Orphan detected`).
    - PIN sync: if `monitors.pin` is set (non-null), propagates to `employees.pin`. If `monitors.pin` is null, preserves existing employee PIN.
    - Creates new employees from monitors with email, hashes email as temp password, uses monitor PIN if set.
    - Links existing employees by email match (sets monitorId). Skips employees with `syncDisabled=true`.
    - Deactivates employees when monitor becomes inactive.
    - Collision detection: if email already linked to different monitorId, logs error without overwriting.
    - Admin endpoints: `POST /api/admin/sync-monitors` (manual trigger), `GET /api/admin/sync-status`.
    - UI: "Sincronizar Monitores" button in admin employees tab, "Gestión" badge (amber) on linked employees.
    - **Protection:** ALL employee management is done exclusively from Gestion. Fichajes employee list is read-only. `POST /api/employees`, `PATCH /api/employees/:id`, `DELETE /api/employees/:id` all return 403 "Los empleados se gestionan desde Gestión". Admin UI has no create/edit/delete/toggle buttons — only view + sync. The sync service and `/api/gestion/*` endpoints bypass these guards by using Drizzle ORM directly.
- **Gestion External API (`/api/gestion/*`):** REST API for Gestion (Gimnasio Cronos) to directly manage Fichajes employees. Authenticated via `X-GESTION-API-KEY` header. Uses `monitorId` as stable external identifier.
    - **Authentication:** Header `X-GESTION-API-KEY` validated against env var `GESTION_API_KEY`. Returns 401 if missing/invalid.
    - **PUT /api/gestion/employees/:monitorId** — Idempotent UPSERT by monitorId.
        - Body: `{ nombre: string, email: string, pin?: string, activo: boolean }`
        - Logic: If monitorId exists → update. If email matches unlinked employee → link + update. Otherwise → create new.
        - Email collision (email used by different monitorId) → 409.
        - Returns: `{ action: "created"|"updated"|"linked", employee: {...} }` with 200/201.
    - **PATCH /api/gestion/employees/:monitorId/status** — Activate/Deactivate.
        - Body: `{ activo: boolean }`
        - Sets `syncDisabled=true` when deactivating (prevents sync reactivation).
        - Clears `syncDisabled=false` when activating.
        - Returns 200 or 404.
    - **DELETE /api/gestion/employees/:monitorId** — Archive or delete.
        - If employee has punches → deactivate + `syncDisabled=true` (409 with explanation).
        - If no punches → hard delete.
        - Returns: `{ action: "deleted"|"archived", ... }`
    - **GET /api/gestion/employees** — List all employees for reconciliation.
        - Returns: `{ employees: [{ id, monitorId, email, firstName, lastName, isActive, syncDisabled, hasPunches }] }`
    - All operations log to audit_log with source `gestion-api`.
- **Error Handling:** Robust database error handling returns 503 for connection issues. All API error messages are in Spanish.

**System Design Choices:**
- **Monorepo Structure:** Divided into `client`, `server`, and `shared` directories.
- **Database Migrations:** Drizzle versioned migrations are used for schema evolution.
- **Dockerization:** Multi-stage `Dockerfile` (node:20-alpine + tini) with `docker-entrypoint.sh`. SSL cert embedded at build time. `docker-compose.yml` exposes port 3001 (Gimnasio Cronos uses 3000). Container name: `cronos_fichajes_app`. Healthcheck on `/healthz`. Reference Nginx config in `nginx.conf.example`.
- **Database URL Priority:** `EXTERNAL_DATABASE_URL` (preferred) → `DATABASE_URL` (fallback). Auto-detects DigitalOcean hosts for SSL. Looks for CA cert in `certs/ca-certificate.crt` or `certs/do-ca-certificate.crt`.
- **Security:** JWTs are signed with separate secrets for access, refresh, and employee tokens. Kiosk tokens are SHA-256 hashed. Rate limiting is applied to authentication endpoints.
- **Logging:** Instrumented logging (e.g., `[KIOSK-PUNCH]`, `[PAUSE-CRON]`) for debugging and monitoring.
- **Environment Variables:** Critical configurations are managed via environment variables and validated at startup. Key vars: `GESTION_API_KEY` (required for `/api/gestion/*` endpoints), `ALLOW_LEGACY_EMPLOYEE_ADMINS` (default true, controls legacy email/password admin login).

## External Dependencies
- **PostgreSQL:** Shared database (`defaultdb` on DigitalOcean `db-postgresql-fra1-86634`) with Gimnasio Cronos app. Cronos Fichajes manages its own tables (`employees`, `punches`, `punch_corrections`, `punch_reviews`, `overtime_requests`, `audit_log`, `kiosk_devices`, `refresh_tokens`). The Gimnasio Cronos app has 34+ tables in the same database — DO NOT modify or delete them. The `monitors` table (Gimnasio Cronos) can be linked to `employees` via email.
- **Drizzle ORM:** Used for database interaction and schema management.
- **React:** Frontend library for building user interfaces.
- **Vite:** Build tool for the React frontend.
- **Tailwind CSS:** Utility-first CSS framework for styling.
- **Node.js/Express:** Backend runtime and framework.
- **jsonwebtoken (JWT):** For user authentication and authorization.
- **Zod:** For schema validation, integrated with Drizzle.
- **S3-compatible Storage (e.g., DigitalOcean Spaces):** For storing digital signatures.
- **`tsx`:** For running TypeScript files directly (scripts, migrations, server).
- **`openssl`:** Used for generating secure random keys.