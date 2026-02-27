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
    - **Admin/Manager:** Utilizes httpOnly cookies for session management.
    - **Employee PIN:** Kiosk mode uses a 6-digit PIN for quick login, with JWT stored in localStorage.
    - **Employee Portal:** Separate httpOnly cookies for portal access, distinct from admin sessions.
- **Employee Portal ("Mis Fichajes"):** Provides employees a read-only view of their shifts, with PDF/CSV export functionality. Strict anti-IDOR measures are in place to prevent unauthorized data access.
- **Kiosk Device System:**
    - Supports device enrollment with one-time tokens.
    - Uses `X-KIOSK-TOKEN` header for authentication.
    - Captures digital signatures (JPEG, 0.5 quality) uploaded to S3-compatible storage with SHA-256 checksums and audit trails.
- **Overtime System:** Automatically calculates overtime based on configured thresholds and expected daily minutes. Includes an admin approval workflow with audit logging.
- **Pause System:** Implements a 20-minute break feature with `BREAK_START` and `BREAK_END` punch types. An automatic cron job closes breaks after 20 minutes. Pause is available on both kiosk and mobile interfaces. The `useCountdown` and `formatCountdown` hooks are shared via `client/src/hooks/use-countdown.ts`.
- **Global Bearer Token Injection:** The global fetcher (`client/src/lib/queryClient.ts`) automatically injects `Authorization: Bearer <token>` from `localStorage("employeeToken")` into all requests via `injectEmployeeToken()`. This ensures employee endpoints (pause status, punches) work consistently across all React Query operations.
- **Authorities Report:** Generates a detailed PDF report for regulatory compliance, including daily tables, incident tracking, and optional annexes for detailed event and correction logs.
- **Error Handling:** Robust database error handling returns 503 for connection issues. All API error messages are in Spanish.

**System Design Choices:**
- **Monorepo Structure:** Divided into `client`, `server`, and `shared` directories.
- **Database Migrations:** Drizzle versioned migrations are used for schema evolution.
- **Dockerization:** `Dockerfile` and `docker-compose.yml` for containerized deployment.
- **Security:** JWTs are signed with separate secrets for access, refresh, and employee tokens. Kiosk tokens are SHA-256 hashed. Rate limiting is applied to authentication endpoints.
- **Logging:** Instrumented logging (e.g., `[KIOSK-PUNCH]`, `[PAUSE-CRON]`) for debugging and monitoring.
- **Environment Variables:** Critical configurations are managed via environment variables and validated at startup.

## External Dependencies
- **PostgreSQL:** Primary database for storing application data.
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