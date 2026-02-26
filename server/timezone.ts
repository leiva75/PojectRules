export const TIMEZONE = "Europe/Madrid";

export function ensureDateUTC(value: Date | string | number | null | undefined): Date | null {
  if (value === null || value === undefined) return null;

  if (value instanceof Date) {
    return isNaN(value.getTime()) ? null : value;
  }

  if (typeof value === "number") {
    const ms = value < 1e12 ? value * 1000 : value;
    const d = new Date(ms);
    return isNaN(d.getTime()) ? null : d;
  }

  if (typeof value === "string") {
    const str = value.trim();
    if (!str) return null;
    const hasTimezone = str.endsWith("Z") || /[+-]\d{2}:\d{2}$/.test(str) || /[+-]\d{2}$/.test(str);
    const d = new Date(hasTimezone ? str : str + "Z");
    return isNaN(d.getTime()) ? null : d;
  }

  return null;
}

interface FormatOptions {
  withSeconds?: boolean;
  dateOnly?: boolean;
  timeOnly?: boolean;
}

export function formatInMadrid(value: Date | string | number | null | undefined, opts?: FormatOptions): string {
  const d = ensureDateUTC(value);
  if (!d) return "-";

  const base: Intl.DateTimeFormatOptions = {
    timeZone: TIMEZONE,
    hourCycle: "h23",
  };

  if (opts?.dateOnly) {
    return d.toLocaleDateString("es-ES", {
      ...base,
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });
  }

  if (opts?.timeOnly) {
    const timeOpts: Intl.DateTimeFormatOptions = {
      ...base,
      hour: "2-digit",
      minute: "2-digit",
    };
    if (opts.withSeconds) timeOpts.second = "2-digit";
    return d.toLocaleTimeString("es-ES", timeOpts);
  }

  const fullOpts: Intl.DateTimeFormatOptions = {
    ...base,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  };
  if (opts?.withSeconds) fullOpts.second = "2-digit";
  return d.toLocaleString("es-ES", fullOpts);
}

export function formatDateES(date: Date | string | number | null | undefined): string {
  return formatInMadrid(date, { dateOnly: true });
}

export function formatTimeES(date: Date | string | number | null | undefined): string {
  return formatInMadrid(date, { timeOnly: true, withSeconds: true });
}

export function formatDateTimeES(date: Date | string | number | null | undefined): string {
  return formatInMadrid(date);
}

export function toSpainDateKey(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);

  const year = parts.find(p => p.type === "year")!.value;
  const month = parts.find(p => p.type === "month")!.value;
  const day = parts.find(p => p.type === "day")!.value;
  return `${year}-${month}-${day}`;
}

export function startOfDayInSpain(date: Date): Date {
  const dateKey = toSpainDateKey(date);
  const [year, month, day] = dateKey.split("-").map(Number);
  const utcMidnight = new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0));
  const offsetMs = getSpainOffsetMs(utcMidnight);
  return new Date(utcMidnight.getTime() + offsetMs);
}

export function endOfDayInSpain(date: Date): Date {
  const dateKey = toSpainDateKey(date);
  const [year, month, day] = dateKey.split("-").map(Number);
  const utcEnd = new Date(Date.UTC(year, month - 1, day, 23, 59, 59, 999));
  const offsetMs = getSpainOffsetMs(utcEnd);
  return new Date(utcEnd.getTime() + offsetMs);
}

function getSpainOffsetMs(date: Date): number {
  const utcStr = date.toLocaleString("en-US", { timeZone: "UTC" });
  const spainStr = date.toLocaleString("en-US", { timeZone: TIMEZONE });
  const utcDate = new Date(utcStr);
  const spainDate = new Date(spainStr);
  return utcDate.getTime() - spainDate.getTime();
}

export function verifyTimezoneSupport(): { ok: boolean; details: string } {
  const cetDate = new Date("2026-02-25T22:01:00Z");
  const cestDate = new Date("2026-07-01T12:00:00Z");

  const cetResult = formatInMadrid(cetDate, { timeOnly: true });
  const cestResult = formatInMadrid(cestDate, { timeOnly: true });

  const cetOk = cetResult.includes("23:01");
  const cestOk = cestResult.includes("14:00");

  const resolved = new Intl.DateTimeFormat("es-ES", { timeZone: TIMEZONE }).resolvedOptions();

  if (cetOk && cestOk) {
    return {
      ok: true,
      details: `CET: 2026-02-25T22:01:00Z → ${cetResult} (expect 23:01) ✓ | CEST: 2026-07-01T12:00:00Z → ${cestResult} (expect 14:00) ✓ | resolvedTZ=${resolved.timeZone}`,
    };
  }

  return {
    ok: false,
    details: `CET: 2026-02-25T22:01:00Z → ${cetResult} (expect 23:01) ${cetOk ? "✓" : "✗"} | CEST: 2026-07-01T12:00:00Z → ${cestResult} (expect 14:00) ${cestOk ? "✓" : "✗"} | resolvedTZ=${resolved.timeZone} | node=${process.version}`,
  };
}
