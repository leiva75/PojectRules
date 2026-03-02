# Cronos Fichajes - Sistema de Control Horario

## Overview
Cronos Fichajes is a full-stack TypeScript time-tracking application for Cronos Gimnasio Palencia. It aims to modernize time-tracking by providing a robust system for managing employee punches, breaks, and overtime. Key features include append-only punch records with geolocation, multiple authentication methods (Admin/Manager SSO/Fallback, Employee PIN, Employee Portal), a kiosk mode with digital signature capture, and comprehensive overtime management with an approval workflow. The system also generates detailed reports for regulatory compliance. The project focuses on reducing manual errors and providing clear insights into attendance.

## User Preferences
I prefer clear, concise explanations and direct answers. For coding, I favor clean, readable TypeScript with a focus on maintainability and established patterns. When proposing changes, please outline the impact and rationale. I appreciate iterative development, with frequent updates on progress and opportunities for feedback. Do not make changes to the `shared/schema.ts` file without explicit confirmation.

## System Architecture
The application uses a full-stack architecture consisting of a React frontend (Vite, Tailwind CSS), a Node.js/Express TypeScript backend, and a PostgreSQL database with Drizzle ORM. JWTs handle authentication for distinct Admin/Manager and Employee roles.

**UI/UX Decisions:**
The "Icy Indigo Palette" design system provides a modern aesthetic with a focus on usability and visual hierarchy. It uses a predominantly indigo color scheme with accent colors for different sections, subtle shadows for depth, and alternating row backgrounds for readability. The Employee Portal is designed with a mobile-first approach.

**Technical Implementations:**
- **Timezone Management:** All dates/times are consistently handled in `Europe/Madrid`, with UTC storage and conversion at display/calculation.
- **Append-Only Punches:** Punch records are immutable; corrections are recorded separately.
- **Geolocation:** Employee punches capture geolocation data, rounded to 4 decimal places.
- **Quadruple Authentication:**
    - **Admin/Manager SSO:** JWT-based authentication via a `GET /sso` endpoint, verifying signature and consuming nonces.
    - **Admin/Manager Fallback:** Username/password login (`POST /api/auth/admin-login`) for direct access.
    - **Employee PIN (Kiosk):** 6-digit PIN for clock-in/out at kiosks (`POST /api/kiosk/punch`).
    - **Employee Portal:** 6-digit PIN login (`POST /api/auth/employee/login`) for employees to view their shifts.
- **Employee Portal:** Provides read-only shift views and PDF/CSV export for employees, with strict anti-IDOR measures.
- **Kiosk Device System:** Supports device enrollment, `X-KIOSK-TOKEN` authentication, and captures digital signatures (JPEG to S3-compatible storage with SHA-256 checksums).
- **Overtime System:** Automatic overtime calculation based on configurations, with an admin approval workflow and audit logging.
- **Pause System:** Implements a 20-minute break feature (`BREAK_START`/`BREAK_END` punch types), with an automatic cron job for closing breaks.
- **Authorities Report:** Generates a compact PDF for regulatory compliance, including signature detection, pause status, incident highlighting (e.g., "Sin salida," "Sin entrada"), and annexes for event and correction details.
- **Monitor Sync System:** A cron job synchronizes `monitors` from the Gimnasio Cronos app to `employees` in Fichajes. It uses `monitorId` as a stable external ID, supports `syncDisabled` for skipping employees, handles PIN propagation, creates new employees, links existing ones by email, deactivates inactive monitors, and logs orphans/collisions. All employee management is strictly through Gestion or the sync process, with Fichajes UI being read-only.
- **Gestion External API (`/api/gestion/*`):** A REST API authenticated by `X-GESTION-API-KEY` for Gestion to manage Fichajes employees (UPSERT, activate/deactivate, delete/archive) using `monitorId` as the identifier. Includes collision detection and audit logging.
- **Cleanup/Purge System:** Admin-only functionality to preview and purge test/orphan employees. Features dry-run mode, guards against accidental deletion of active or protected accounts, and logs purge actions.
- **Error Handling:** Robust error handling, including 503 for database connection issues and Spanish API error messages.

**System Design Choices:**
- **Monorepo:** Organized into `client`, `server`, and `shared` directories.
- **Database Migrations:** Drizzle ORM manages schema evolution.
- **Dockerization:** Multi-stage `Dockerfile` with `docker-compose.yml`, including healthchecks and Nginx configuration examples.
- **Database URL Priority:** Prioritizes `EXTERNAL_DATABASE_URL` over `DATABASE_URL`, with auto-detection for DigitalOcean SSL.
- **Security:** Uses separate JWT secrets, SHA-256 hashed kiosk tokens, and rate limiting for authentication.
- **Logging:** Instrumented logging for monitoring.
- **Environment Variables:** Critical configurations are managed and validated via environment variables.

## External Dependencies
- **PostgreSQL:** Shared database (`defaultdb`) with Gimnasio Cronos app. Cronos Fichajes manages its own tables (`employees`, `punches`, `punch_corrections`, `punch_reviews`, `overtime_requests`, `audit_log`, `kiosk_devices`, `refresh_tokens`, `sso_nonces`, `gestion_admin_links`), while linking to the `monitors` table from Gimnasio Cronos.
- **Drizzle ORM:** Database interaction and schema management.
- **React, Vite, Tailwind CSS:** Frontend development stack.
- **Node.js, Express:** Backend runtime and framework.
- **jsonwebtoken (JWT):** Authentication and authorization.
- **Zod:** Schema validation.
- **S3-compatible Storage:** For digital signature storage.
- **`tsx`:** For running TypeScript files directly.
- **`openssl`:** For secure key generation.