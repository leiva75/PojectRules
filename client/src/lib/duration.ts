/**
 * Compute duration in minutes between entry and exit timestamps
 * @param entryAt - Entry timestamp (IN punch)
 * @param exitAt - Exit timestamp (OUT punch) - can be null/undefined for ongoing vacations
 * @returns Duration in minutes, or null if invalid/ongoing
 */
export function computeDurationMinutes(
  entryAt: Date | string | null | undefined,
  exitAt: Date | string | null | undefined
): number | null {
  // No exit = vacation in progress
  if (!exitAt) return null;
  if (!entryAt) return null;

  const entry = typeof entryAt === "string" ? new Date(entryAt) : entryAt;
  const exit = typeof exitAt === "string" ? new Date(exitAt) : exitAt;

  // Invalid dates
  if (isNaN(entry.getTime()) || isNaN(exit.getTime())) {
    console.warn("[Duration] Invalid date(s):", { entryAt, exitAt });
    return null;
  }

  // Calculate duration in minutes (ignore seconds)
  const entryMinutes = Math.floor(entry.getTime() / 60000);
  const exitMinutes = Math.floor(exit.getTime() / 60000);
  const durationMinutes = exitMinutes - entryMinutes;

  // Abnormal case: exit before entry
  if (durationMinutes < 0) {
    console.warn("[Duration] Abnormal: exit < entry", { 
      entryAt: entry.toISOString(), 
      exitAt: exit.toISOString(),
      durationMinutes 
    });
    return null;
  }

  return durationMinutes;
}

/**
 * Format duration in minutes to human-readable string
 * @param minutes - Duration in minutes (null for invalid/ongoing)
 * @param inProgress - Whether the vacation is in progress (no exit yet)
 * @returns Formatted string like "45m", "3h 05m", "En curso", or "—"
 */
export function formatDuration(
  minutes: number | null,
  inProgress: boolean = false
): string {
  // Vacation in progress
  if (inProgress) {
    return "En curso";
  }

  // Invalid or null duration
  if (minutes === null || minutes < 0) {
    return "—";
  }

  // Less than 1 hour
  if (minutes < 60) {
    return `${minutes}m`;
  }

  // 1 hour or more
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return `${hours}h ${remainingMinutes.toString().padStart(2, "0")}m`;
}

/**
 * Calculate total duration for a list of vacations
 * @param vacations - Array of vacation objects with entryAt and exitAt
 * @returns Total duration in minutes (only valid vacations counted)
 */
export function calculateTotalDuration(
  vacations: Array<{ entryAt: Date | string | null; exitAt: Date | string | null }>
): number {
  let total = 0;
  for (const vacation of vacations) {
    const duration = computeDurationMinutes(vacation.entryAt, vacation.exitAt);
    if (duration !== null && duration >= 0) {
      total += duration;
    }
  }
  return total;
}

/**
 * Interface for a paired vacation (IN → OUT)
 */
export interface Vacation {
  id: string; // Entry punch ID
  employeeId: string;
  entryPunch: {
    id: string;
    timestamp: Date | string;
    latitude?: string | null;
    longitude?: string | null;
    source: string;
  };
  exitPunch: {
    id: string;
    timestamp: Date | string;
    latitude?: string | null;
    longitude?: string | null;
    source: string;
  } | null;
  durationMinutes: number | null;
  isInProgress: boolean;
}

/**
 * Pair punches into vacations (IN → OUT pairs)
 * Assumes punches are sorted by timestamp ascending
 * @param punches - Array of punches for a single employee, sorted by timestamp
 * @returns Array of vacation objects
 */
export function pairPunchesIntoVacations<T extends {
  id: string;
  employeeId: string;
  type: "IN" | "OUT";
  timestamp: Date | string;
  latitude?: string | null;
  longitude?: string | null;
  source: string;
}>(punches: T[]): Vacation[] {
  const vacations: Vacation[] = [];
  let currentEntry: T | null = null;

  for (const punch of punches) {
    if (punch.type === "IN") {
      // If we have a pending entry without exit, it stays orphaned (shouldn't happen normally)
      if (currentEntry) {
        // Create vacation in progress
        vacations.push({
          id: currentEntry.id,
          employeeId: currentEntry.employeeId,
          entryPunch: {
            id: currentEntry.id,
            timestamp: currentEntry.timestamp,
            latitude: currentEntry.latitude,
            longitude: currentEntry.longitude,
            source: currentEntry.source,
          },
          exitPunch: null,
          durationMinutes: null,
          isInProgress: true,
        });
      }
      currentEntry = punch;
    } else if (punch.type === "OUT" && currentEntry) {
      // Pair entry with exit
      const duration = computeDurationMinutes(currentEntry.timestamp, punch.timestamp);
      vacations.push({
        id: currentEntry.id,
        employeeId: currentEntry.employeeId,
        entryPunch: {
          id: currentEntry.id,
          timestamp: currentEntry.timestamp,
          latitude: currentEntry.latitude,
          longitude: currentEntry.longitude,
          source: currentEntry.source,
        },
        exitPunch: {
          id: punch.id,
          timestamp: punch.timestamp,
          latitude: punch.latitude,
          longitude: punch.longitude,
          source: punch.source,
        },
        durationMinutes: duration,
        isInProgress: false,
      });
      currentEntry = null;
    }
    // OUT without entry is ignored (orphan)
  }

  // If there's still a pending entry, it's in progress
  if (currentEntry) {
    vacations.push({
      id: currentEntry.id,
      employeeId: currentEntry.employeeId,
      entryPunch: {
        id: currentEntry.id,
        timestamp: currentEntry.timestamp,
        latitude: currentEntry.latitude,
        longitude: currentEntry.longitude,
        source: currentEntry.source,
      },
      exitPunch: null,
      durationMinutes: null,
      isInProgress: true,
    });
  }

  return vacations;
}
