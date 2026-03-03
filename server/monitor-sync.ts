import { pool } from "./db";
import { db } from "./db";
import { employees } from "@shared/schema";
import { eq, isNotNull } from "drizzle-orm";
import { hashPassword } from "./auth";
import { logInfo, logError, logWarn } from "./logger";
import crypto from "crypto";

interface Monitor {
  id: number;
  nombre: string;
  prenom: string | null;
  nom: string | null;
  email: string | null;
  activo: boolean;
  horas_contratadas: number | null;
  pin: string | null;
}

export interface SyncResult {
  created: number;
  updated: number;
  linked: number;
  deactivated: number;
  errors: Array<{ monitorId?: number; email?: string; reason: string }>;
}

export interface SyncStatus {
  lastSyncAt: string | null;
  lastSyncResult: SyncResult | null;
}

let syncStatus: SyncStatus = { lastSyncAt: null, lastSyncResult: null };

export function getLastSyncStatus(): SyncStatus {
  return syncStatus;
}

export function setLastSyncStatus(status: SyncStatus): void {
  syncStatus = status;
}

let syncInProgress = false;

function resolveNames(monitor: Monitor): { firstName: string; lastName: string } {
  const prenom = (monitor.prenom ?? "").trim();
  const nom = (monitor.nom ?? "").trim();

  if (prenom || nom) {
    return {
      firstName: prenom || nom || "Sin nombre",
      lastName: prenom ? nom : "",
    };
  }

  const parts = monitor.nombre.trim().split(/\s+/);
  if (parts.length === 0 || (parts.length === 1 && !parts[0])) {
    return { firstName: "Sin nombre", lastName: "" };
  }
  if (parts.length === 1) {
    return { firstName: parts[0], lastName: "" };
  }
  return { firstName: parts[0], lastName: parts.slice(1).join(" ") };
}

export async function syncMonitorsToEmployees(): Promise<SyncResult> {
  if (syncInProgress) {
    logInfo("[MONITOR-SYNC] Sync already in progress, skipping");
    return { created: 0, updated: 0, linked: 0, deactivated: 0, errors: [{ reason: "Sync already in progress" }] };
  }

  syncInProgress = true;
  const result: SyncResult = { created: 0, updated: 0, linked: 0, deactivated: 0, errors: [] };

  try {
    const { rows: allMonitors } = await pool.query<Monitor>(
      `SELECT id, nombre, prenom, nom, email, activo, horas_contratadas, pin FROM monitors WHERE email IS NOT NULL AND email != ''`
    );

    const activeMonitors = allMonitors.filter(m => m.activo);
    const inactiveMonitors = allMonitors.filter(m => !m.activo);

    for (const monitor of activeMonitors) {
      try {
        const { firstName, lastName } = resolveNames(monitor);

        const [existingByMonitorId] = await db
          .select()
          .from(employees)
          .where(eq(employees.monitorId, monitor.id));

        if (existingByMonitorId) {
          if (existingByMonitorId.syncDisabled) {
            logInfo(`[MONITOR-SYNC] Skipping employee ${existingByMonitorId.id} (monitorId=${monitor.id}): syncDisabled=true`);
            continue;
          }

          const pinNeedsUpdate = monitor.pin !== null && existingByMonitorId.pin !== monitor.pin;
          const needsUpdate =
            existingByMonitorId.firstName !== firstName ||
            existingByMonitorId.lastName !== lastName ||
            existingByMonitorId.email !== monitor.email ||
            existingByMonitorId.isActive !== true ||
            pinNeedsUpdate;

          if (needsUpdate) {
            const updateData: Record<string, any> = { firstName, lastName, email: monitor.email!, isActive: true };
            if (pinNeedsUpdate) {
              updateData.pin = monitor.pin;
              logInfo(`[MONITOR-SYNC] PIN updated for employee ${existingByMonitorId.id} from monitor ${monitor.id}`);
            }
            await db
              .update(employees)
              .set(updateData)
              .where(eq(employees.id, existingByMonitorId.id));
            result.updated++;
            logInfo(`[MONITOR-SYNC] Updated employee ${existingByMonitorId.id} from monitor ${monitor.id}`);
          }
          continue;
        }

        const [existingByEmail] = await db
          .select()
          .from(employees)
          .where(eq(employees.email, monitor.email!));

        if (existingByEmail) {
          if (existingByEmail.syncDisabled) {
            logInfo(`[MONITOR-SYNC] Skipping employee ${existingByEmail.id} (email match, monitorId=${monitor.id}): syncDisabled=true`);
            continue;
          }

          if (existingByEmail.monitorId !== null && existingByEmail.monitorId !== monitor.id) {
            result.errors.push({
              monitorId: monitor.id,
              email: monitor.email!,
              reason: `Email collision: employee ${existingByEmail.id} already linked to monitor ${existingByEmail.monitorId}`,
            });
            logError(`[MONITOR-SYNC] Email collision`, { monitorId: monitor.id, email: monitor.email, existingMonitorId: existingByEmail.monitorId });
            continue;
          }

          const linkData: Record<string, any> = { monitorId: monitor.id, firstName, lastName, isActive: true };
          if (monitor.pin !== null) {
            linkData.pin = monitor.pin;
            logInfo(`[MONITOR-SYNC] PIN set for linked employee ${existingByEmail.id} from monitor ${monitor.id}`);
          }
          await db
            .update(employees)
            .set(linkData)
            .where(eq(employees.id, existingByEmail.id));
          result.linked++;
          logInfo(`[MONITOR-SYNC] Linked employee ${existingByEmail.id} to monitor ${monitor.id}`);
          continue;
        }

        const hashedPw = await hashPassword(monitor.email!);
        const newId = crypto.randomUUID();

        await db.insert(employees).values({
          id: newId,
          email: monitor.email!,
          password: hashedPw,
          firstName,
          lastName,
          role: "employee",
          pin: monitor.pin ?? null,
          isActive: true,
          monitorId: monitor.id,
        });

        result.created++;
        logInfo(`[MONITOR-SYNC] Created employee ${newId} from monitor ${monitor.id} (${monitor.email})`);
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        result.errors.push({ monitorId: monitor.id, email: monitor.email ?? undefined, reason });
        logError(`[MONITOR-SYNC] Error processing monitor ${monitor.id}`, err);
      }
    }

    for (const monitor of inactiveMonitors) {
      try {
        const [linked] = await db
          .select()
          .from(employees)
          .where(eq(employees.monitorId, monitor.id));

        if (linked && linked.isActive) {
          await db
            .update(employees)
            .set({ isActive: false })
            .where(eq(employees.id, linked.id));
          result.deactivated++;
          logInfo(`[MONITOR-SYNC] Deactivated employee ${linked.id} (monitor ${monitor.id} inactive)`);
        }
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        result.errors.push({ monitorId: monitor.id, email: monitor.email ?? undefined, reason });
        logError(`[MONITOR-SYNC] Error deactivating for monitor ${monitor.id}`, err);
      }
    }

    const monitorIds = new Set(allMonitors.map(m => m.id));
    const linkedEmployees = await db
      .select({ id: employees.id, monitorId: employees.monitorId, email: employees.email })
      .from(employees)
      .where(isNotNull(employees.monitorId));

    for (const emp of linkedEmployees) {
      if (emp.monitorId !== null && !monitorIds.has(emp.monitorId)) {
        logWarn(`[MONITOR-SYNC] Orphan detected: employee ${emp.id} (${emp.email}) has monitorId=${emp.monitorId} but no matching monitor`);
        result.errors.push({
          monitorId: emp.monitorId,
          email: emp.email,
          reason: `Orphan: monitorId=${emp.monitorId} not found in monitors table`,
        });
      }
    }

    logInfo(`[MONITOR-SYNC] Sync completed`, result);
  } catch (err) {
    logError("[MONITOR-SYNC] Fatal sync error", err);
    result.errors.push({ reason: err instanceof Error ? err.message : String(err) });
  } finally {
    syncInProgress = false;
  }

  return result;
}
