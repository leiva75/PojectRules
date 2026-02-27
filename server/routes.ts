import type { Express } from "express";
import { createServer, type Server } from "http";
import { createHash } from "crypto";
import multer from "multer";
import { storage } from "./storage";
import { pool, db } from "./db";
import { punches } from "@shared/schema";
import { eq, and, gt } from "drizzle-orm";
import { 
  hashPassword, 
  verifyPassword, 
  generateAccessToken, 
  generateRefreshToken, 
  generateEmployeeToken,
  generateEmployeePortalAccessToken,
  generateEmployeePortalRefreshToken,
  verifyToken,
  getRefreshTokenExpiry,
  authenticateAdminManager,
  authenticateEmployee,
  authenticateEmployeePortal,
  EP_COOKIE_OPTIONS
} from "./auth";
import { authenticateKiosk, generateKioskToken, hashToken, getClientIp } from "./kiosk";
import { uploadSignature, isSpacesConfigured, getSignedDownloadUrl } from "./spaces";
import { logInfo, logError } from "./logger";
import { 
  loginSchema, 
  employeeLoginSchema, 
  insertEmployeeSchema,
  punchRequestSchema,
  correctionRequestSchema,
  exportQuerySchema,
  reviewRequestSchema,
  overtimeReviewRequestSchema,
  kioskPunchRequestSchema,
  updateEmployeeSchema,
  correctPunchSchema,
  kioskDeviceSchema,
  updateKioskDeviceSchema,
  employeePortalLoginSchema,
  shiftsQuerySchema,
  pauseRequestSchema
} from "@shared/schema";
import { Parser } from "json2csv";
import rateLimit from "express-rate-limit";
import type { Response } from "express";

function isDbError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const msg = error.message || "";
  const code = (error as { code?: string }).code || "";
  return (
    code === "ETIMEDOUT" ||
    code === "ECONNREFUSED" ||
    code === "ECONNRESET" ||
    msg.includes("connection terminated") ||
    msg.includes("Connection terminated") ||
    msg.includes("timeout expired") ||
    msg.includes("too many clients") ||
    msg.includes("remaining connection slots")
  );
}

function handleRouteError(res: Response, error: unknown, context: string, fallbackMessage = "Error del servidor") {
  const errMsg = error instanceof Error ? error.message : String(error);
  logError(`${context}: ${errMsg}`, error);
  if (isDbError(error)) {
    return res.status(503).json({ message: "Servicio temporalmente no disponible. Inténtelo de nuevo." });
  }
  return res.status(500).json({ message: fallbackMessage });
}
import { generateReportPDF, type PunchRecord } from "./pdf-generator";
import { generateAuthoritiesPDF } from "./authorities-pdf";
import { formatDateES, formatTimeES, formatDateTimeES, formatInMadrid, toSpainDateKey, startOfDayInSpain, endOfDayInSpain, ensureDateUTC } from "./timezone";

function pdfSortKey(r: PunchRecord): number {
  return ensureDateUTC(r.inTimestamp ?? r.outTimestamp)?.getTime() ?? Infinity;
}

function logPdfDebug(routeTag: string, records: PunchRecord[]): void {
  const generatedAt = new Date();
  console.log(`[PDF-GEN] ${routeTag}`, {
    generatedAtUTC: generatedAt.toISOString(),
    generatedAtMadrid: formatInMadrid(generatedAt, { withSeconds: true }),
    recordCount: records.length,
  });

  const top5 = records.slice(0, 5).map((r, idx) => {
    const raw = r.inTimestamp ?? r.outTimestamp;
    const ensured = ensureDateUTC(raw);
    return {
      idx,
      employee: `${r.lastName} ${r.firstName}`,
      rawTimestamp: raw instanceof Date ? raw.toISOString() : String(raw),
      isoTimestamp: ensured?.toISOString() ?? "INVALID",
      epochMs: ensured?.getTime() ?? null,
    };
  });
  console.log(`[PDF-SORT-CHECK] ${routeTag}`, JSON.stringify(top5));

  if (records.length > 0) {
    const first = records[0];
    const raw = first.inTimestamp ?? first.outTimestamp;
    const ensured = ensureDateUTC(raw);
    console.log(`[PDF-TIME-DEBUG] ${routeTag}`, {
      raw: raw instanceof Date ? raw.toISOString() : String(raw),
      rawType: raw === null ? "null" : raw instanceof Date ? "Date" : typeof raw,
      ensuredISO: ensured?.toISOString() ?? "INVALID",
      madridFormatted: formatInMadrid(raw, { withSeconds: true }),
    });
  }

  let monotonic = true;
  for (let i = 1; i < records.length; i++) {
    const prevEpoch = pdfSortKey(records[i - 1]);
    const currEpoch = pdfSortKey(records[i]);
    if (currEpoch < prevEpoch) {
      const prevRaw = records[i - 1].inTimestamp ?? records[i - 1].outTimestamp;
      const currRaw = records[i].inTimestamp ?? records[i].outTimestamp;
      console.error(`[PDF-SORT-FAIL] ${routeTag}`, {
        index: i,
        prevEpoch,
        currEpoch,
        prevISO: ensureDateUTC(prevRaw)?.toISOString() ?? "INVALID",
        currISO: ensureDateUTC(currRaw)?.toISOString() ?? "INVALID",
        prevEmployee: `${records[i - 1].lastName} ${records[i - 1].firstName}`,
        currEmployee: `${records[i].lastName} ${records[i].firstName}`,
      });
      monotonic = false;
      break;
    }
  }
  if (monotonic) {
    console.log(`[PDF-SORT-OK] ${routeTag}`, { count: records.length, monotonic: true });
  }
}

const upload = multer({ 
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 }
});

interface ShiftEntry {
  date: string;
  clockIn: string | null;
  clockInTime: string | null;
  clockOut: string | null;
  clockOutTime: string | null;
  durationMin: number | null;
  status: "OK" | "INCOMPLETE";
  inLatitude: string | null;
  inLongitude: string | null;
  outLatitude: string | null;
  outLongitude: string | null;
}

function pairPunchesIntoShifts(rawPunches: { type: string; timestamp: Date | null; latitude: string | null; longitude: string | null }[]): ShiftEntry[] {
  const shifts: ShiftEntry[] = [];
  let openShift: { timestamp: Date; latitude: string | null; longitude: string | null } | null = null;

  for (const punch of rawPunches) {
    const ts = ensureDateUTC(punch.timestamp);
    if (!ts) continue;

    if (punch.type === "IN") {
      if (openShift) {
        shifts.push({
          date: formatDateES(openShift.timestamp),
          clockIn: openShift.timestamp.toISOString(),
          clockInTime: formatTimeES(openShift.timestamp),
          clockOut: null,
          clockOutTime: null,
          durationMin: null,
          status: "INCOMPLETE",
          inLatitude: openShift.latitude,
          inLongitude: openShift.longitude,
          outLatitude: null,
          outLongitude: null,
        });
      }
      openShift = { timestamp: ts, latitude: punch.latitude, longitude: punch.longitude };
    } else if (punch.type === "OUT") {
      if (openShift) {
        const durationMs = ts.getTime() - openShift.timestamp.getTime();
        const durationMin = Math.round(durationMs / 60000);
        shifts.push({
          date: formatDateES(openShift.timestamp),
          clockIn: openShift.timestamp.toISOString(),
          clockInTime: formatTimeES(openShift.timestamp),
          clockOut: ts.toISOString(),
          clockOutTime: formatTimeES(ts),
          durationMin,
          status: "OK",
          inLatitude: openShift.latitude,
          inLongitude: openShift.longitude,
          outLatitude: punch.latitude,
          outLongitude: punch.longitude,
        });
        openShift = null;
      } else {
        shifts.push({
          date: formatDateES(ts),
          clockIn: null,
          clockInTime: null,
          clockOut: ts.toISOString(),
          clockOutTime: formatTimeES(ts),
          durationMin: null,
          status: "INCOMPLETE",
          inLatitude: null,
          inLongitude: null,
          outLatitude: punch.latitude,
          outLongitude: punch.longitude,
        });
      }
    }
  }

  if (openShift) {
    shifts.push({
      date: formatDateES(openShift.timestamp),
      clockIn: openShift.timestamp.toISOString(),
      clockInTime: formatTimeES(openShift.timestamp),
      clockOut: null,
      clockOutTime: null,
      durationMin: null,
      status: "INCOMPLETE",
      inLatitude: openShift.latitude,
      inLongitude: openShift.longitude,
      outLatitude: null,
      outLongitude: null,
    });
  }

  return shifts;
}

function formatDateForQuery(date: Date): string {
  return date.toISOString().split("T")[0];
}

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { message: "Demasiados intentos, inténtelo más tarde" },
});

const employeeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 50,
  message: { message: "Demasiados intentos, inténtelo más tarde" },
});

const APP_VERSION = "1.0.0";

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {

  app.get("/api/health", async (_req, res) => {
    let dbOk = false;
    try {
      await storage.getAllEmployees();
      dbOk = true;
    } catch {
      dbOk = false;
    }
    
    const status = dbOk ? "ok" : "degraded";
    const statusCode = dbOk ? 200 : 503;
    
    res.status(statusCode).json({ 
      status,
      db: dbOk,
      version: APP_VERSION,
      env: process.env.NODE_ENV || "development",
      timestamp: new Date().toISOString()
    });
  });

  app.get("/api/debug/timezone", authenticateAdminManager, async (_req, res) => {
    const now = new Date();
    const serverInfo = {
      TZ: process.env.TZ,
      nodeDate: now.toISOString(),
      nodeLocal: now.toString(),
      nodeTZOffset: now.getTimezoneOffset(),
    };
    const displayInfo = {
      formatDateES: formatDateES(now),
      formatTimeES: formatTimeES(now),
      toSpainDateKey: toSpainDateKey(now),
    };
    let dbInfo: Record<string, unknown> = {};
    try {
      const dbPromise = pool.query("SELECT now() AS db_now, current_setting('timezone') AS db_tz");
      const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 3000));
      const dbResult = await Promise.race([dbPromise, timeoutPromise]) as any;
      const dbRow = dbResult.rows[0];
      dbInfo = { now: dbRow.db_now, timezone: dbRow.db_tz };
    } catch (error) {
      dbInfo = { error: String(error) };
    }
    res.json({ server: serverInfo, database: dbInfo, display: displayInfo });
  });

  app.get("/api/estado", authenticateAdminManager, async (_req, res) => {
    try {
      const employees = await storage.getAllEmployees();
      
      let dbStatus = "ok";
      try {
        await storage.getAllEmployees();
      } catch {
        dbStatus = "error";
      }

      const activeEmployees = employees.filter(e => e.isActive).length;

      res.json({
        version: APP_VERSION,
        environment: process.env.NODE_ENV || "development",
        database: {
          status: dbStatus,
          connection: dbStatus === "ok" ? "conectado" : "desconectado",
        },
        stats: {
          employees: employees.length,
          sites: activeEmployees,
        },
        uptime: process.uptime(),
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      handleRouteError(res, error, "[ESTADO]", "Error al obtener estado");
    }
  });

  app.post("/api/auth/login", authLimiter, async (req, res) => {
    try {
      const result = loginSchema.safeParse(req.body);
      if (!result.success) {
        return res.status(400).json({ message: "Datos inválidos", errors: result.error.errors });
      }

      const { email, password } = result.data;
      const employee = await storage.getEmployeeByEmail(email);

      if (!employee) {
        return res.status(401).json({ message: "Email o contraseña incorrectos" });
      }

      const validPassword = await verifyPassword(password, employee.password);
      if (!validPassword) {
        return res.status(401).json({ message: "Email o contraseña incorrectos" });
      }

      if (!employee.isActive) {
        return res.status(401).json({ message: "Cuenta desactivada" });
      }

      if (!["admin", "manager"].includes(employee.role)) {
        return res.status(403).json({ message: "Use el acceso de empleado para conectarse" });
      }

      const accessToken = generateAccessToken(employee);
      const refreshToken = generateRefreshToken(employee);

      await storage.createRefreshToken(employee.id, refreshToken, getRefreshTokenExpiry());

      res.cookie("accessToken", accessToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "strict",
        maxAge: 60 * 60 * 1000,
      });

      res.cookie("refreshToken", refreshToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "strict",
        maxAge: 7 * 24 * 60 * 60 * 1000,
      });

      await storage.createAuditLog({
        action: "login",
        actorId: employee.id,
        targetType: "session",
        targetId: employee.id,
        details: JSON.stringify({ role: employee.role, method: "admin" }),
        ipAddress: (req.ip || req.socket.remoteAddress || "") as string,
      });

      const { password: _, ...userWithoutPassword } = employee;
      res.json({ user: userWithoutPassword });
    } catch (error) {
      handleRouteError(res, error, "[AUTH-LOGIN]");
    }
  });

  app.post("/api/auth/employee-login", employeeLimiter, async (req, res) => {
    try {
      const result = employeeLoginSchema.safeParse(req.body);
      if (!result.success) {
        return res.status(400).json({ message: "PIN inválido" });
      }

      const { pin } = result.data;
      const employee = await storage.getEmployeeByPin(pin);

      if (!employee) {
        return res.status(401).json({ message: "PIN incorrecto" });
      }

      if (!employee.isActive) {
        return res.status(401).json({ message: "Cuenta desactivada" });
      }

      const token = generateEmployeeToken(employee);

      await storage.createAuditLog({
        action: "login",
        actorId: employee.id,
        targetType: "session",
        targetId: employee.id,
        details: JSON.stringify({ role: employee.role, method: "employee-mobile" }),
        ipAddress: (req.ip || req.socket.remoteAddress || "") as string,
      });

      const { password: _, ...userWithoutPassword } = employee;
      
      res.json({ user: userWithoutPassword, token });
    } catch (error) {
      handleRouteError(res, error, "[AUTH-EMPLOYEE-LOGIN]");
    }
  });

  app.post("/api/auth/kiosk-login", employeeLimiter, async (req, res) => {
    try {
      const result = employeeLoginSchema.safeParse(req.body);
      if (!result.success) {
        return res.status(400).json({ message: "PIN inválido" });
      }

      const { pin } = result.data;
      const employee = await storage.getEmployeeByPin(pin);

      if (!employee) {
        return res.status(401).json({ message: "PIN incorrecto" });
      }

      if (!employee.isActive) {
        return res.status(401).json({ message: "Cuenta desactivada" });
      }

      const lastPunch = await storage.getLastPunchByEmployee(employee.id);
      const token = generateEmployeeToken(employee);

      await storage.createAuditLog({
        action: "login",
        actorId: employee.id,
        targetType: "session",
        targetId: employee.id,
        details: JSON.stringify({ role: employee.role, method: "kiosk" }),
        ipAddress: (req.ip || req.socket.remoteAddress || "") as string,
      });

      const { password: _, ...userWithoutPassword } = employee;
      
      res.json({ 
        user: userWithoutPassword, 
        token,
        lastPunchType: lastPunch?.type || null 
      });
    } catch (error) {
      handleRouteError(res, error, "[KIOSK-LOGIN]");
    }
  });

  app.post("/api/auth/refresh", async (req, res) => {
    try {
      const refreshToken = req.cookies?.refreshToken;
      
      if (!refreshToken) {
        return res.status(401).json({ message: "No autenticado" });
      }

      const payload = verifyToken(refreshToken);
      if (!payload || payload.type !== "refresh") {
        return res.status(401).json({ message: "Token inválido" });
      }

      const storedToken = await storage.getRefreshToken(refreshToken);
      if (!storedToken || new Date() > storedToken.expiresAt) {
        return res.status(401).json({ message: "Token expirado" });
      }

      const employee = await storage.getEmployee(payload.employeeId);
      if (!employee || !employee.isActive) {
        return res.status(401).json({ message: "Cuenta desactivada" });
      }

      const newAccessToken = generateAccessToken(employee);

      res.cookie("accessToken", newAccessToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "strict",
        maxAge: 60 * 60 * 1000,
      });

      const { password: _, ...userWithoutPassword } = employee;
      res.json({ user: userWithoutPassword });
    } catch (error) {
      handleRouteError(res, error, "[AUTH-REFRESH]");
    }
  });

  app.get("/api/auth/me", async (req, res) => {
    try {
      const accessToken = req.cookies?.accessToken;
      const authHeader = req.headers.authorization;
      
      let token: string | undefined;
      if (authHeader?.startsWith("Bearer ")) {
        token = authHeader.substring(7);
      } else if (accessToken) {
        token = accessToken;
      }

      if (!token) {
        return res.status(401).json({ message: "No autenticado" });
      }

      const payload = verifyToken(token);
      if (!payload) {
        return res.status(401).json({ message: "Token inválido" });
      }

      const employee = await storage.getEmployee(payload.employeeId);
      if (!employee || !employee.isActive) {
        return res.status(401).json({ message: "Cuenta desactivada" });
      }

      const { password: _, ...userWithoutPassword } = employee;
      res.json({ user: userWithoutPassword });
    } catch (error) {
      handleRouteError(res, error, "[AUTH-ME]");
    }
  });

  app.post("/api/auth/logout", async (req, res) => {
    try {
      const refreshToken = req.cookies?.refreshToken;
      if (refreshToken) {
        await storage.deleteRefreshToken(refreshToken);
      }

      res.clearCookie("accessToken");
      res.clearCookie("refreshToken");
      res.json({ message: "Sesión cerrada" });
    } catch (error) {
      handleRouteError(res, error, "[AUTH-LOGOUT]");
    }
  });

  // ==================== EMPLOYEE PORTAL AUTH ====================

  app.post("/api/auth/employee/login", employeeLimiter, async (req, res) => {
    try {
      const result = employeePortalLoginSchema.safeParse(req.body);
      if (!result.success) {
        return res.status(400).json({ message: "Datos inválidos", errors: result.error.errors });
      }

      const { email, password } = result.data;
      const employee = await storage.getEmployeeByEmail(email);

      if (!employee) {
        return res.status(401).json({ message: "Email o contraseña incorrectos" });
      }

      const validPassword = await verifyPassword(password, employee.password);
      if (!validPassword) {
        return res.status(401).json({ message: "Email o contraseña incorrectos" });
      }

      if (!employee.isActive) {
        return res.status(401).json({ message: "Cuenta desactivada" });
      }

      const accessToken = generateEmployeePortalAccessToken(employee);
      const refreshToken = generateEmployeePortalRefreshToken(employee);

      await storage.createRefreshToken(employee.id, refreshToken, getRefreshTokenExpiry());

      res.cookie("epAccessToken", accessToken, {
        ...EP_COOKIE_OPTIONS,
        maxAge: 60 * 60 * 1000,
      });

      res.cookie("epRefreshToken", refreshToken, {
        ...EP_COOKIE_OPTIONS,
        maxAge: 7 * 24 * 60 * 60 * 1000,
      });

      await storage.createAuditLog({
        action: "login",
        actorId: employee.id,
        targetType: "session",
        targetId: employee.id,
        details: JSON.stringify({ role: employee.role, method: "employee-portal" }),
        ipAddress: (req.ip || req.socket.remoteAddress || "") as string,
      });

      const { password: _, id: _id, ...userWithoutSensitive } = employee;
      res.json({ user: { ...userWithoutSensitive, role: employee.role } });
    } catch (error) {
      handleRouteError(res, error, "[EP-LOGIN]");
    }
  });

  app.post("/api/auth/employee/refresh", async (req, res) => {
    try {
      const refreshToken = req.cookies?.epRefreshToken;

      if (!refreshToken) {
        return res.status(401).json({ message: "No autenticado" });
      }

      const payload = verifyToken(refreshToken);
      if (!payload || payload.type !== "ep-refresh") {
        return res.status(401).json({ message: "Token inválido" });
      }

      const storedToken = await storage.getRefreshToken(refreshToken);
      if (!storedToken || new Date() > storedToken.expiresAt) {
        return res.status(401).json({ message: "Token expirado" });
      }

      const employee = await storage.getEmployee(payload.employeeId);
      if (!employee || !employee.isActive) {
        return res.status(401).json({ message: "Cuenta desactivada" });
      }

      await storage.deleteRefreshToken(refreshToken);

      const newAccessToken = generateEmployeePortalAccessToken(employee);
      const newRefreshToken = generateEmployeePortalRefreshToken(employee);

      await storage.createRefreshToken(employee.id, newRefreshToken, getRefreshTokenExpiry());

      res.cookie("epAccessToken", newAccessToken, {
        ...EP_COOKIE_OPTIONS,
        maxAge: 60 * 60 * 1000,
      });

      res.cookie("epRefreshToken", newRefreshToken, {
        ...EP_COOKIE_OPTIONS,
        maxAge: 7 * 24 * 60 * 60 * 1000,
      });

      const { password: _, id: _id, ...userWithoutSensitive } = employee;
      res.json({ user: { ...userWithoutSensitive, role: employee.role } });
    } catch (error) {
      handleRouteError(res, error, "[EP-REFRESH]");
    }
  });

  app.get("/api/auth/employee/me", async (req, res) => {
    try {
      const token = req.cookies?.epAccessToken;

      if (!token) {
        return res.status(401).json({ message: "No autenticado" });
      }

      const payload = verifyToken(token);
      if (!payload || payload.type !== "employee-portal") {
        return res.status(401).json({ message: "Token inválido" });
      }

      const employee = await storage.getEmployee(payload.employeeId);
      if (!employee || !employee.isActive) {
        return res.status(401).json({ message: "Cuenta desactivada" });
      }

      const { password: _, id: _id, ...userWithoutSensitive } = employee;
      res.json({ user: { ...userWithoutSensitive, role: employee.role } });
    } catch (error) {
      handleRouteError(res, error, "[EP-ME]");
    }
  });

  app.post("/api/auth/employee/logout", async (req, res) => {
    try {
      const refreshToken = req.cookies?.epRefreshToken;
      if (refreshToken) {
        await storage.deleteRefreshToken(refreshToken);
      }

      res.clearCookie("epAccessToken", { path: "/" });
      res.clearCookie("epRefreshToken", { path: "/" });
      res.json({ message: "Sesión cerrada" });
    } catch (error) {
      handleRouteError(res, error, "[EP-LOGOUT]");
    }
  });

  // ==================== EMPLOYEE PORTAL DATA (READ-ONLY) ====================
  // TODO: Phase 2 — Add RLS Postgres policy for defense-in-depth
  // Currently using application-level filtering: WHERE employee_id = req.employee.id

  app.get("/api/me/shifts", authenticateEmployeePortal, async (req, res) => {
    try {
      const result = shiftsQuerySchema.safeParse(req.query);
      if (!result.success) {
        return res.status(400).json({ message: "Parámetros inválidos", errors: result.error.errors });
      }

      const { from, to } = result.data;
      const now = new Date();

      const fromDate = from
        ? startOfDayInSpain(new Date(from + "T12:00:00Z"))
        : startOfDayInSpain(new Date(now.getFullYear(), now.getMonth(), 1));

      const toDate = to
        ? endOfDayInSpain(new Date(to + "T12:00:00Z"))
        : endOfDayInSpain(now);

      const rawPunches = await storage.getPunchesByEmployeeAndDateRange(
        req.employee!.id,
        fromDate,
        toDate
      );

      const shifts = pairPunchesIntoShifts(rawPunches);

      res.json({ shifts, period: { from: from || formatDateForQuery(fromDate), to: to || formatDateForQuery(toDate) } });
    } catch (error) {
      handleRouteError(res, error, "[ME-SHIFTS]", "Error al obtener fichajes");
    }
  });

  app.get("/api/me/shifts/export.pdf", authenticateEmployeePortal, async (req, res) => {
    try {
      const result = shiftsQuerySchema.safeParse(req.query);
      if (!result.success) {
        return res.status(400).json({ message: "Parámetros inválidos" });
      }

      const { from, to } = result.data;
      const now = new Date();

      const fromDate = from
        ? startOfDayInSpain(new Date(from + "T12:00:00Z"))
        : startOfDayInSpain(new Date(now.getFullYear(), now.getMonth(), 1));

      const toDate = to
        ? endOfDayInSpain(new Date(to + "T12:00:00Z"))
        : endOfDayInSpain(now);

      const rawPunches = await storage.getPunchesByEmployeeAndDateRange(
        req.employee!.id,
        fromDate,
        toDate
      );

      const shifts = pairPunchesIntoShifts(rawPunches);
      const employee = req.employee!;

      const records: PunchRecord[] = shifts.map(s => ({
        lastName: employee.lastName,
        firstName: employee.firstName,
        inTimestamp: s.clockIn,
        inSignatureData: null,
        inLatitude: s.inLatitude,
        inLongitude: s.inLongitude,
        outTimestamp: s.clockOut,
        outSignatureData: null,
        outLatitude: s.outLatitude,
        outLongitude: s.outLongitude,
      }));

      const fromLabel = from || formatDateForQuery(fromDate);
      const toLabel = to || formatDateForQuery(toDate);

      const pdfBuffer = await generateReportPDF({
        title: "Mis Fichajes",
        subtitle: `${employee.firstName} ${employee.lastName} — ${fromLabel} a ${toLabel}`,
        records,
        generatedAt: new Date(),
        periodStart: fromDate,
        periodEnd: toDate,
        employeeName: `${employee.firstName} ${employee.lastName}`,
        isEmployeeReport: true,
      });

      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="fichajes_${fromLabel}_${toLabel}.pdf"`);
      res.setHeader("Cache-Control", "no-store");
      res.send(pdfBuffer);
    } catch (error) {
      handleRouteError(res, error, "[ME-SHIFTS-PDF]", "Error al generar PDF");
    }
  });

  app.get("/api/me/shifts/export.csv", authenticateEmployeePortal, async (req, res) => {
    try {
      const result = shiftsQuerySchema.safeParse(req.query);
      if (!result.success) {
        return res.status(400).json({ message: "Parámetros inválidos" });
      }

      const { from, to } = result.data;
      const now = new Date();

      const fromDate = from
        ? startOfDayInSpain(new Date(from + "T12:00:00Z"))
        : startOfDayInSpain(new Date(now.getFullYear(), now.getMonth(), 1));

      const toDate = to
        ? endOfDayInSpain(new Date(to + "T12:00:00Z"))
        : endOfDayInSpain(now);

      const rawPunches = await storage.getPunchesByEmployeeAndDateRange(
        req.employee!.id,
        fromDate,
        toDate
      );

      const shifts = pairPunchesIntoShifts(rawPunches);

      const csvRows = shifts.map(s => ({
        Fecha: s.date,
        Entrada: s.clockInTime || "-",
        Salida: s.clockOutTime || "-",
        "Duración (min)": s.durationMin !== null ? s.durationMin : "-",
        Estado: s.status,
      }));

      const parser = new Parser({ fields: ["Fecha", "Entrada", "Salida", "Duración (min)", "Estado"] });
      const csv = "\ufeff" + parser.parse(csvRows);

      const fromLabel = from || formatDateForQuery(fromDate);
      const toLabel = to || formatDateForQuery(toDate);

      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="fichajes_${fromLabel}_${toLabel}.csv"`);
      res.setHeader("Cache-Control", "no-store");
      res.send(csv);
    } catch (error) {
      handleRouteError(res, error, "[ME-SHIFTS-CSV]", "Error al generar CSV");
    }
  });

  // ==================== ADMIN EMPLOYEE MANAGEMENT ====================

  app.get("/api/employees", authenticateAdminManager, async (req, res) => {
    try {
      const employees = await storage.getAllEmployees();
      const sanitized = employees.map(({ password, ...emp }) => emp);
      res.json(sanitized);
    } catch (error) {
      handleRouteError(res, error, "[GET-EMPLOYEES]");
    }
  });

  app.post("/api/employees", authenticateAdminManager, async (req, res) => {
    try {
      const result = insertEmployeeSchema.safeParse(req.body);
      if (!result.success) {
        return res.status(400).json({ message: "Datos inválidos", errors: result.error.errors });
      }

      const existingEmail = await storage.getEmployeeByEmail(result.data.email);
      if (existingEmail) {
        return res.status(400).json({ message: "Ya existe una cuenta con este email" });
      }

      if (result.data.pin) {
        const existingPin = await storage.getEmployeeByPin(result.data.pin);
        if (existingPin) {
          return res.status(400).json({ message: "Este PIN ya está en uso" });
        }
      }

      const hashedPassword = await hashPassword(result.data.password);
      const employee = await storage.createEmployee({
        ...result.data,
        password: hashedPassword,
      });

      const { password, ...sanitized } = employee;
      res.status(201).json(sanitized);
    } catch (error) {
      handleRouteError(res, error, "[CREATE-EMPLOYEE]");
    }
  });

  app.patch("/api/employees/:id", authenticateAdminManager, async (req, res) => {
    try {
      const id = req.params.id as string;
      const validation = updateEmployeeSchema.safeParse(req.body);
      if (!validation.success) {
        return res.status(400).json({ message: "Datos inválidos", errors: validation.error.errors });
      }

      const { firstName, lastName, email, pin, role, isActive, password } = validation.data;

      const existing = await storage.getEmployee(id);
      if (!existing) {
        return res.status(404).json({ message: "Empleado no encontrado" });
      }

      if (email && email !== existing.email) {
        const emailExists = await storage.getEmployeeByEmail(email);
        if (emailExists) {
          return res.status(400).json({ message: "Este email ya está en uso" });
        }
      }

      if (pin && pin !== existing.pin) {
        const pinExists = await storage.getEmployeeByPin(pin);
        if (pinExists) {
          return res.status(400).json({ message: "Este PIN ya está en uso" });
        }
      }

      const updateData: Record<string, any> = {};
      if (firstName !== undefined) updateData.firstName = firstName;
      if (lastName !== undefined) updateData.lastName = lastName;
      if (email !== undefined) updateData.email = email;
      if (pin !== undefined) updateData.pin = pin;
      if (role !== undefined) updateData.role = role;
      if (isActive !== undefined) updateData.isActive = isActive;
      if (password) updateData.password = await hashPassword(password);

      const updated = await storage.updateEmployee(id, updateData);
      if (!updated) {
        return res.status(404).json({ message: "Empleado no encontrado" });
      }

      const { password: _, ...sanitized } = updated;
      res.json(sanitized);
    } catch (error) {
      handleRouteError(res, error, "[UPDATE-EMPLOYEE]");
    }
  });

  app.post("/api/punches", authenticateEmployee, async (req, res) => {
    try {
      const result = punchRequestSchema.safeParse(req.body);
      if (!result.success) {
        return res.status(400).json({ message: "Datos inválidos", errors: result.error.errors });
      }

      const employee = req.employee!;
      const { type, latitude, longitude, accuracy, source, signatureData } = result.data;

      const lastPunch = await storage.getLastPunchByEmployee(employee.id);
      
      if (type === "IN" && lastPunch?.type === "IN") {
        return res.status(400).json({ message: "Ya está fichado como presente. Realice una salida primero." });
      }

      if (type === "OUT" && (!lastPunch || lastPunch.type === "OUT")) {
        return res.status(400).json({ message: "No está fichado como presente. Realice una entrada primero." });
      }

      if (!signatureData || signatureData.length < 100) {
        return res.status(400).json({ message: "La firma es obligatoria para fichar" });
      }

      const needsReview = !latitude || !longitude;

      const punch = await storage.createPunch({
        employeeId: employee.id,
        type,
        latitude: latitude?.toString(),
        longitude: longitude?.toString(),
        accuracy: accuracy?.toString(),
        needsReview,
        source,
        signatureData,
        signatureSignedAt: new Date(),
      });

      await storage.createAuditLog({
        action: "create",
        actorId: employee.id,
        targetType: "punch",
        targetId: punch.id,
        details: JSON.stringify({ type, needsReview, source }),
        ipAddress: (req.ip || req.socket.remoteAddress || "") as string,
      });

      if (type === "OUT") {
        const { calculateOvertime } = await import("./overtime");
        const expectedDailyMinutes = parseInt(process.env.EXPECTED_DAILY_MINUTES || "480", 10);
        const overtimeThreshold = parseInt(process.env.OVERTIME_MIN_THRESHOLD || "15", 10);
        
        const punchDate = punch.timestamp;
        const dayPunches = await storage.getPunchesByEmployeeAndDate(employee.id, punchDate);
        
        const result = calculateOvertime(dayPunches, expectedDailyMinutes, overtimeThreshold);
        
        if (result.shouldCreateRequest) {
          const punchDay = startOfDayInSpain(new Date(punchDate));
          
          const existingRequest = await storage.getOvertimeRequestByDateAndEmployee(employee.id, punchDay);
          
          if (existingRequest) {
            await storage.updateOvertimeRequest(existingRequest.id, {
              minutes: result.overtimeMinutes,
              reason: "AUTO",
            });
            
            await storage.createAuditLog({
              action: "overtime_create",
              actorId: employee.id,
              targetType: "overtime_request",
              targetId: existingRequest.id,
              details: JSON.stringify({ dailyMinutes: result.dailyMinutes, expectedDailyMinutes, overtimeMinutes: result.overtimeMinutes, updated: true }),
              ipAddress: (req.ip || req.socket.remoteAddress || "") as string,
            });
          } else {
            const overtimeRequest = await storage.createOvertimeRequest({
              employeeId: employee.id,
              date: punchDay,
              minutes: result.overtimeMinutes,
              reason: "AUTO",
              status: "pending",
            });
            
            await storage.createAuditLog({
              action: "overtime_create",
              actorId: employee.id,
              targetType: "overtime_request",
              targetId: overtimeRequest.id,
              details: JSON.stringify({ dailyMinutes: result.dailyMinutes, expectedDailyMinutes, overtimeMinutes: result.overtimeMinutes, updated: false }),
              ipAddress: (req.ip || req.socket.remoteAddress || "") as string,
            });
          }
        }
      }

      res.status(201).json({ punch });
    } catch (error) {
      handleRouteError(res, error, "[CREATE-PUNCH]");
    }
  });

  app.get("/api/punches/my", authenticateEmployee, async (req, res) => {
    try {
      const employee = req.employee!;
      const punches = await storage.getPunchesByEmployee(employee.id);
      res.json(punches);
    } catch (error) {
      handleRouteError(res, error, "[GET-MY-PUNCHES]");
    }
  });

  app.get("/api/punches/last", authenticateEmployee, async (req, res) => {
    try {
      const employee = req.employee!;
      const punch = await storage.getLastPunchByEmployee(employee.id);
      res.json(punch || null);
    } catch (error) {
      handleRouteError(res, error, "[GET-LAST-PUNCH]");
    }
  });

  async function getEmployeeStatus(employeeId: string): Promise<{ status: "OFF" | "ON" | "BREAK"; breakStartedAt?: string; pauseAlreadyTaken: boolean }> {
    const lastWorkPunch = await storage.getLastWorkPunch(employeeId);
    const lastOverall = await storage.getLastPunchByEmployee(employeeId);

    let base: "OFF" | "ON" = "OFF";
    if (lastWorkPunch && lastWorkPunch.type === "IN") {
      base = "ON";
    }

    if (base === "ON" && lastOverall && lastOverall.type === "BREAK_START") {
      return { status: "BREAK", breakStartedAt: lastOverall.timestamp.toISOString(), pauseAlreadyTaken: false };
    }

    let pauseAlreadyTaken = false;
    if (base === "ON" && lastWorkPunch) {
      const breakEndAfterIn = await db.select({ id: punches.id }).from(punches)
        .where(and(
          eq(punches.employeeId, employeeId),
          eq(punches.type, "BREAK_END"),
          gt(punches.timestamp, lastWorkPunch.timestamp)
        ))
        .limit(1);
      pauseAlreadyTaken = breakEndAfterIn.length > 0;
    }

    return { status: base, pauseAlreadyTaken };
  }

  app.get("/api/pause/status", authenticateEmployee, async (req, res) => {
    try {
      const employee = req.employee!;
      const result = await getEmployeeStatus(employee.id);
      res.json(result);
    } catch (error) {
      handleRouteError(res, error, "[PAUSE-STATUS]");
    }
  });

  app.post("/api/pause/start", employeeLimiter, authenticateEmployee, async (req, res) => {
    try {
      const employee = req.employee!;
      const body = pauseRequestSchema.safeParse(req.body || {});
      if (!body.success) {
        return res.status(400).json({ message: "Datos inválidos", errors: body.error.errors });
      }

      const status = await getEmployeeStatus(employee.id);
      if (status.status !== "ON") {
        return res.status(400).json({ message: "Debe estar en servicio para iniciar pausa" });
      }

      const punch = await storage.createPunch({
        employeeId: employee.id,
        type: "BREAK_START",
        timestamp: new Date(),
        source: body.data.source,
        latitude: body.data.latitude?.toString(),
        longitude: body.data.longitude?.toString(),
        accuracy: body.data.accuracy?.toString(),
        isAuto: false,
      });

      await storage.createAuditLog({
        action: "create",
        actorId: employee.id,
        targetType: "punch",
        targetId: punch.id,
        details: JSON.stringify({ type: "BREAK_START", mode: "manual" }),
      });

      logInfo(`[PAUSE-START] employee=${employee.id} punch=${punch.id}`);
      res.json({ message: "Pausa iniciada", punch });
    } catch (error) {
      handleRouteError(res, error, "[PAUSE-START]");
    }
  });

  app.post("/api/pause/end", employeeLimiter, authenticateEmployee, async (req, res) => {
    try {
      const employee = req.employee!;
      const status = await getEmployeeStatus(employee.id);
      if (status.status !== "BREAK") {
        return res.status(400).json({ message: "No hay pausa activa" });
      }

      const punch = await storage.createPunch({
        employeeId: employee.id,
        type: "BREAK_END",
        timestamp: new Date(),
        source: "mobile",
        isAuto: false,
      });

      await storage.createAuditLog({
        action: "create",
        actorId: employee.id,
        targetType: "punch",
        targetId: punch.id,
        details: JSON.stringify({ type: "BREAK_END", mode: "manual" }),
      });

      logInfo(`[PAUSE-END] employee=${employee.id} punch=${punch.id}`);
      res.json({ message: "Pausa finalizada", punch });
    } catch (error) {
      handleRouteError(res, error, "[PAUSE-END]");
    }
  });

  app.get("/api/punches", authenticateAdminManager, async (req, res) => {
    try {
      const limit = req.query.limit ? parseInt(req.query.limit as string) : 50;
      const needsReview = req.query.needsReview === "true" ? true : undefined;
      
      const punches = await storage.getAllPunches({ limit, needsReview });
      res.json(punches);
    } catch (error) {
      handleRouteError(res, error, "[GET-ALL-PUNCHES]");
    }
  });

  app.post("/api/corrections", authenticateAdminManager, async (req, res) => {
    try {
      const result = correctionRequestSchema.safeParse(req.body);
      if (!result.success) {
        return res.status(400).json({ message: "Datos inválidos", errors: result.error.errors });
      }

      const admin = req.employee!;
      const { originalPunchId, reason, newTimestamp, newType } = result.data;

      const originalPunch = await storage.getPunchById(originalPunchId);
      if (!originalPunch) {
        return res.status(404).json({ message: "Fichaje original no encontrado" });
      }

      const correction = await storage.createCorrection({
        originalPunchId,
        correctedById: admin.id,
        reason,
        newTimestamp: newTimestamp ? new Date(newTimestamp) : undefined,
        newType,
      });

      await storage.createAuditLog({
        action: "correction",
        actorId: admin.id,
        targetType: "punch",
        targetId: originalPunchId,
        details: JSON.stringify({ reason, newTimestamp, newType }),
        ipAddress: (req.ip || req.socket.remoteAddress || "") as string,
      });

      res.status(201).json(correction);
    } catch (error) {
      handleRouteError(res, error, "[CREATE-CORRECTION]");
    }
  });

  app.post("/api/punches/:id/correct", authenticateAdminManager, async (req, res) => {
    try {
      const id = req.params.id as string;
      const validation = correctPunchSchema.safeParse(req.body);
      if (!validation.success) {
        return res.status(400).json({ message: "Datos inválidos", errors: validation.error.errors });
      }

      const { reason, newTimestamp, newType } = validation.data;

      const admin = req.employee!;
      const originalPunch = await storage.getPunchById(id);
      
      if (!originalPunch) {
        return res.status(404).json({ message: "Fichaje no encontrado" });
      }

      const correction = await storage.createCorrection({
        originalPunchId: id,
        correctedById: admin.id,
        reason,
        newTimestamp: newTimestamp ? new Date(newTimestamp) : undefined,
        newType,
      });

      await storage.createAuditLog({
        action: "correction",
        actorId: admin.id,
        targetType: "punch",
        targetId: id,
        details: JSON.stringify({ reason, newTimestamp, newType }),
        ipAddress: (req.ip || req.socket.remoteAddress || "") as string,
      });

      res.status(201).json(correction);
    } catch (error) {
      handleRouteError(res, error, "[CORRECT-PUNCH]");
    }
  });

  app.get("/api/punches/needs-review", authenticateAdminManager, async (req, res) => {
    try {
      const punches = await storage.getPunchesNeedingReview();
      res.json(punches);
    } catch (error) {
      handleRouteError(res, error, "[GET-NEEDS-REVIEW]");
    }
  });

  app.post("/api/punches/:id/review", authenticateAdminManager, async (req, res) => {
    try {
      const id = req.params.id as string;
      const result = reviewRequestSchema.safeParse(req.body);
      
      const admin = req.employee!;
      const punch = await storage.getPunchById(id);
      
      if (!punch) {
        return res.status(404).json({ message: "Fichaje no encontrado" });
      }

      const existingReview = await storage.getPunchReview(id);
      if (existingReview) {
        return res.status(400).json({ message: "Este fichaje ya ha sido revisado" });
      }

      const review = await storage.createPunchReview({
        punchId: id,
        reviewedById: admin.id,
        note: result.success ? result.data.note : undefined,
      });

      await storage.createAuditLog({
        action: "review",
        actorId: admin.id,
        targetType: "punch",
        targetId: id,
        details: JSON.stringify({ note: result.success ? result.data.note : null }),
        ipAddress: (req.ip || req.socket.remoteAddress || "") as string,
      });

      res.status(201).json(review);
    } catch (error) {
      handleRouteError(res, error, "[REVIEW-PUNCH]");
    }
  });

  app.get("/api/admin/stats", authenticateAdminManager, async (req, res) => {
    try {
      const stats = await storage.getStats();
      res.json(stats);
    } catch (error) {
      handleRouteError(res, error, "[GET-STATS]");
    }
  });

  app.get("/api/exports/punches", authenticateAdminManager, async (req, res) => {
    try {
      const result = exportQuerySchema.safeParse(req.query);
      if (!result.success) {
        return res.status(400).json({ message: "Parámetros inválidos" });
      }

      const { employeeId, startDate, endDate } = result.data;
      const admin = req.employee!;

      const punches = await storage.getAllPunchesForExport({
        employeeId,
        startDate: new Date(startDate + "T00:00:00Z"),
        endDate: new Date(endDate + "T23:59:59.999Z"),
        limit: 10000,
      });

      const overtimeRequests = await storage.getOvertimeRequests({ 
        employeeId,
        limit: 10000 
      });
      const startDateObj = new Date(startDate + "T00:00:00Z");
      const endDateObj = new Date(endDate + "T23:59:59.999Z");
      
      const overtimeMap = new Map<string, { minutes: number; status: string }>();
      overtimeRequests.forEach((ot) => {
        const otDate = new Date(ot.date);
        if (otDate >= startDateObj && otDate <= endDateObj) {
          const dateKey = toSpainDateKey(otDate);
          const key = `${ot.employeeId}_${dateKey}`;
          overtimeMap.set(key, { minutes: ot.minutes, status: ot.status });
        }
      });

      await storage.createAuditLog({
        action: "export",
        actorId: admin.id,
        targetType: "punches",
        targetId: "bulk",
        details: JSON.stringify({ employeeId, startDate, endDate, count: punches.length }),
        ipAddress: (req.ip || req.socket.remoteAddress || "") as string,
      });



      const data = punches.map((punch) => {
        const punchDate = toSpainDateKey(new Date(punch.timestamp));
        const otKey = `${punch.employeeId}_${punchDate}`;
        const overtime = overtimeMap.get(otKey);
        
        const statusMap: Record<string, string> = {
          pending: "Pendiente",
          approved: "Aprobado",
          rejected: "Rechazado",
        };

        return {
          "ID": punch.id,
          "Empleado": `${punch.employee.firstName} ${punch.employee.lastName}`,
          "Tipo": punch.type === "IN" ? "Entrada" : punch.type === "OUT" ? "Salida" : punch.type === "BREAK_START" ? "Inicio Pausa" : punch.type === "BREAK_END" ? "Fin Pausa" : punch.type,
          "Fecha": formatDateES(punch.timestamp),
          "Hora": formatTimeES(punch.timestamp),
          "Latitud": punch.latitude || "",
          "Longitud": punch.longitude || "",
          "Precision_m": punch.accuracy || "",
          "Requiere_Revision": punch.needsReview ? "Sí" : "No",
          "Revisado": punch.reviewed ? "Sí" : "No",
          "Corregido": punch.corrected ? "Sí" : "No",
          "Fuente": punch.source,
          "Overtime_Minutos": overtime?.minutes || 0,
          "Overtime_Estado": overtime ? statusMap[overtime.status] || "" : "",
        };
      });

      const fields = [
        "ID",
        "Empleado",
        "Tipo",
        "Fecha",
        "Hora",
        "Latitud",
        "Longitud",
        "Precision_m",
        "Requiere_Revision",
        "Revisado",
        "Corregido",
        "Fuente",
        "Overtime_Minutos",
        "Overtime_Estado",
      ];

      const parser = new Parser({ fields, delimiter: ";" });
      const csv = parser.parse(data);

      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename=pointages_${startDate}_${endDate}.csv`);
      res.send("\ufeff" + csv);
    } catch (error) {
      handleRouteError(res, error, "[EXPORT-PUNCHES]");
    }
  });

  app.get("/api/overtime-requests", authenticateAdminManager, async (req, res) => {
    try {
      const status = req.query.status as "pending" | "approved" | "rejected" | undefined;
      const employeeId = req.query.employeeId as string | undefined;
      const limit = req.query.limit ? parseInt(req.query.limit as string) : 100;

      const requests = await storage.getOvertimeRequests({ status, employeeId, limit });
      res.json(requests);
    } catch (error) {
      handleRouteError(res, error, "[GET-OVERTIME]");
    }
  });

  app.post("/api/overtime-requests/:id/review", authenticateAdminManager, async (req, res) => {
    try {
      const id = req.params.id as string;
      const result = overtimeReviewRequestSchema.safeParse(req.body);
      
      if (!result.success) {
        return res.status(400).json({ message: "Datos inválidos", errors: result.error.errors });
      }

      const { status, comment } = result.data;
      const admin = req.employee!;

      const existingRequests = await storage.getOvertimeRequests({ limit: 1000 });
      const existing = existingRequests.find(r => r.id === id);
      
      if (!existing) {
        return res.status(404).json({ message: "Solicitud de horas extra no encontrada" });
      }

      if (existing.status !== "pending") {
        return res.status(400).json({ message: "Esta solicitud ya ha sido procesada" });
      }

      await storage.updateOvertimeRequest(id, {
        status,
        reviewerId: admin.id,
        reviewerComment: comment,
        reviewedAt: new Date(),
      });

      await storage.createAuditLog({
        action: "overtime_review",
        actorId: admin.id,
        targetType: "overtime_request",
        targetId: id,
        details: JSON.stringify({ status, comment, employeeId: existing.employeeId }),
        ipAddress: (req.ip || req.socket.remoteAddress || "") as string,
      });

      res.json({ message: status === "approved" ? "Horas extra aprobadas" : "Horas extra rechazadas" });
    } catch (error) {
      handleRouteError(res, error, "[REVIEW-OVERTIME]");
    }
  });

  // ==================== KIOSK DEVICE MANAGEMENT (Admin) ====================

  app.get("/api/admin/kiosk-devices", authenticateAdminManager, async (_req, res) => {
    try {
      const devices = await storage.getAllKioskDevices();
      res.json(devices.map(d => ({ ...d, tokenHash: undefined })));
    } catch (error) {
      handleRouteError(res, error, "[GET-KIOSK-DEVICES]", "Error al obtener dispositivos");
    }
  });

  app.post("/api/admin/kiosk-devices", authenticateAdminManager, async (req, res) => {
    try {
      const validation = kioskDeviceSchema.safeParse(req.body);
      if (!validation.success) {
        return res.status(400).json({ message: "Datos inválidos", errors: validation.error.errors });
      }
      const { name } = validation.data;

      const token = generateKioskToken();
      const tokenHash = hashToken(token);

      const device = await storage.createKioskDevice({
        name,
        tokenHash,
        enabled: true,
      });

      logInfo("Kiosk device created", { deviceId: device.id, name });

      res.status(201).json({
        id: device.id,
        name: device.name,
        token,
        enabled: device.enabled,
        createdAt: device.createdAt,
        message: "Guarde el token, no se mostrará de nuevo",
      });
    } catch (error) {
      handleRouteError(res, error, "[CREATE-KIOSK-DEVICE]", "Error al crear dispositivo");
    }
  });

  app.patch("/api/admin/kiosk-devices/:id", authenticateAdminManager, async (req, res) => {
    try {
      const id = req.params.id as string;
      const validation = updateKioskDeviceSchema.safeParse(req.body);
      if (!validation.success) {
        return res.status(400).json({ message: "Datos inválidos", errors: validation.error.errors });
      }
      const { name, enabled } = validation.data;

      const updates: { name?: string; enabled?: boolean } = {};
      if (name !== undefined) updates.name = name;
      if (enabled !== undefined) updates.enabled = enabled;

      const device = await storage.updateKioskDevice(id, updates);
      if (!device) {
        return res.status(404).json({ error: { code: "NOT_FOUND", message: "Dispositivo no encontrado" } });
      }

      logInfo("Kiosk device updated", { deviceId: id, updates });
      res.json({ ...device, tokenHash: undefined });
    } catch (error) {
      handleRouteError(res, error, "[UPDATE-KIOSK-DEVICE]", "Error al actualizar dispositivo");
    }
  });

  app.delete("/api/admin/kiosk-devices/:id", authenticateAdminManager, async (req, res) => {
    try {
      const id = req.params.id as string;
      await storage.deleteKioskDevice(id);
      logInfo("Kiosk device deleted", { deviceId: id });
      res.json({ message: "Dispositivo eliminado" });
    } catch (error) {
      handleRouteError(res, error, "[DELETE-KIOSK-DEVICE]", "Error al eliminar dispositivo");
    }
  });

  // ==================== KIOSK PUNCH ROUTES ====================

  app.post("/api/kiosk/punch", authenticateKiosk, async (req, res) => {
    const reqMeta = {
      kioskDeviceId: req.kioskDevice?.id,
      hasPin: !!req.body?.pin,
      type: req.body?.type,
      hasSignature: !!req.body?.signatureData,
      signatureLen: req.body?.signatureData?.length ?? 0,
      hasLat: req.body?.latitude != null,
      hasLon: req.body?.longitude != null,
    };
    logInfo("[KIOSK-PUNCH] request received", reqMeta);

    try {
      const parseResult = kioskPunchRequestSchema.safeParse(req.body);
      if (!parseResult.success) {
        logInfo("[KIOSK-PUNCH] schema validation failed", { errors: parseResult.error.errors });
        return res.status(400).json({ error: { code: "INVALID_REQUEST", message: "Datos inválidos" } });
      }

      const { pin } = req.body;
      if (!pin || typeof pin !== "string" || pin.length !== 6) {
        return res.status(400).json({ error: { code: "INVALID_PIN", message: "PIN inválido" } });
      }

      logInfo("[KIOSK-PUNCH] looking up employee by PIN");
      const employee = await storage.getEmployeeByPin(pin);
      if (!employee) {
        return res.status(404).json({ error: { code: "EMPLOYEE_NOT_FOUND", message: "Empleado no encontrado" } });
      }

      if (!employee.isActive) {
        return res.status(403).json({ error: { code: "EMPLOYEE_INACTIVE", message: "Empleado inactivo" } });
      }

      const { type, latitude, longitude, accuracy, signatureData } = parseResult.data;

      if (!signatureData || signatureData.length < 100) {
        return res.status(400).json({ error: { code: "SIGNATURE_REQUIRED", message: "La firma es obligatoria para fichar" } });
      }

      logInfo("[KIOSK-PUNCH] checking last punch", { employeeId: employee.id });
      const lastPunch = await storage.getLastPunchByEmployee(employee.id);
      
      if (type === "IN" && lastPunch?.type === "IN") {
        return res.status(400).json({ error: { code: "ALREADY_IN", message: "Ya está fichado como presente. Realice una salida primero." } });
      }

      if (type === "OUT" && (!lastPunch || lastPunch.type === "OUT")) {
        return res.status(400).json({ error: { code: "NOT_IN", message: "No está fichado como presente. Realice una entrada primero." } });
      }

      logInfo("[KIOSK-PUNCH] creating punch", { employeeId: employee.id, type, signatureLen: signatureData?.length ?? 0 });
      const punch = await storage.createPunch({
        employeeId: employee.id,
        type,
        latitude: latitude?.toString(),
        longitude: longitude?.toString(),
        accuracy: accuracy?.toString(),
        source: "kiosk",
        needsReview: false,
        signatureData,
        signatureSignedAt: new Date(),
        kioskDeviceId: req.kioskDevice?.id,
      });

      logInfo("[KIOSK-PUNCH] punch created successfully", { 
        punchId: punch.id, 
        employeeId: employee.id, 
        type, 
        status: punch.status,
        kioskDeviceId: req.kioskDevice?.id,
      });

      res.status(201).json({
        id: punch.id,
        type: punch.type,
        timestamp: punch.timestamp,
        status: punch.status,
        requiresSignature: false,
        employee: {
          id: employee.id,
          firstName: employee.firstName,
          lastName: employee.lastName,
        },
      });
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      const errStack = error instanceof Error ? error.stack : undefined;
      logError("[KIOSK-PUNCH] unhandled error", { message: errMsg, stack: errStack, ...reqMeta });
      if (isDbError(error)) {
        return res.status(503).json({ error: { code: "SERVICE_UNAVAILABLE", message: "Servicio temporalmente no disponible. Inténtelo de nuevo." } });
      }
      res.status(500).json({ error: { code: "PUNCH_ERROR", message: "Error al registrar fichaje" } });
    }
  });

  app.post("/api/kiosk/punches/:id/signature", authenticateKiosk, upload.single("signature"), async (req, res) => {
    try {
      const id = req.params.id as string;

      if (!isSpacesConfigured()) {
        return res.status(503).json({ 
          error: { code: "SPACES_NOT_CONFIGURED", message: "Almacenamiento de firmas no configurado" } 
        });
      }

      const punch = await storage.getPunchById(id);
      if (!punch) {
        return res.status(404).json({ error: { code: "PUNCH_NOT_FOUND", message: "Fichaje no encontrado" } });
      }

      if (punch.status === "SIGNED") {
        return res.status(400).json({ error: { code: "ALREADY_SIGNED", message: "Fichaje ya firmado" } });
      }

      if (!req.file || !req.file.buffer) {
        return res.status(400).json({ error: { code: "EMPTY_SIGNATURE", message: "Firma vacía" } });
      }

      if (req.file.size < 500) {
        return res.status(400).json({ error: { code: "EMPTY_SIGNATURE", message: "Firma muy pequeña" } });
      }

      const signatureBuffer = req.file.buffer;
      const sha256 = createHash("sha256").update(signatureBuffer).digest("hex");

      const signatureKey = await uploadSignature(parseInt(id), signatureBuffer.toString("base64"));

      const updated = await storage.updatePunchSignature(id, {
        signatureUrl: signatureKey,
        signatureSha256: sha256,
        kioskDeviceId: req.kioskDevice?.id,
        kioskUserAgent: req.headers["user-agent"],
        kioskIp: getClientIp(req),
      });

      logInfo("Signature uploaded", { 
        punchId: id, 
        sha256, 
        size: req.file.size,
        kioskDeviceId: req.kioskDevice?.id 
      });

      res.json({
        ok: true,
        punchId: id,
        signedAt: updated?.signatureSignedAt,
        status: updated?.status,
      });
    } catch (error) {
      handleRouteError(res, error, "[SIGNATURE-UPLOAD]", "Error al guardar firma");
    }
  });

  app.get("/api/admin/punches/:id/signature-url", authenticateAdminManager, async (req, res) => {
    try {
      const id = req.params.id as string;
      const punch = await storage.getPunchById(id);

      if (!punch) {
        return res.status(404).json({ error: { code: "PUNCH_NOT_FOUND", message: "Fichaje no encontrado" } });
      }

      if (!punch.signatureUrl) {
        return res.status(404).json({ error: { code: "NO_SIGNATURE", message: "Sin firma" } });
      }

      if (!isSpacesConfigured()) {
        return res.status(503).json({ error: { code: "SPACES_NOT_CONFIGURED", message: "Almacenamiento no configurado" } });
      }

      const signedUrl = await getSignedDownloadUrl(punch.signatureUrl, 3600);
      res.json({ signatureUrl: signedUrl, sha256: punch.signatureSha256 });
    } catch (error) {
      handleRouteError(res, error, "[GET-SIGNATURE-URL]", "Error al obtener firma");
    }
  });

  app.get("/api/reports/general", authenticateAdminManager, async (req, res) => {
    try {
      const { period, year, month, week } = req.query;
      
      let startDate: Date;
      let endDate: Date;
      let subtitle: string;

      const yearNum = parseInt(year as string) || new Date().getFullYear();
      
      if (period === "week") {
        const weekNum = parseInt(week as string) || 1;
        const jan4 = new Date(Date.UTC(yearNum, 0, 4));
        const dayOfWeek = jan4.getUTCDay() || 7;
        startDate = new Date(jan4);
        startDate.setUTCDate(jan4.getUTCDate() - dayOfWeek + 1 + (weekNum - 1) * 7);
        endDate = new Date(startDate);
        endDate.setUTCDate(startDate.getUTCDate() + 6);
        endDate.setUTCHours(23, 59, 59, 999);
        subtitle = `Semana ${weekNum} - ${yearNum}`;
      } else {
        const monthNum = parseInt(month as string) || 1;
        startDate = new Date(Date.UTC(yearNum, monthNum - 1, 1));
        endDate = new Date(Date.UTC(yearNum, monthNum, 0, 23, 59, 59, 999));
        const monthNames = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", 
                          "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
        subtitle = `${monthNames[monthNum - 1]} ${yearNum}`;
      }

      const punchesData = await storage.getAllPunchesForReport({ startDate, endDate });

      const punchPairs = new Map<string, { in: typeof punchesData[0] | null; out: typeof punchesData[0] | null; employee: typeof punchesData[0]["employee"] }[]>();

      for (const punch of punchesData) {
        const dateKey = toSpainDateKey(punch.timestamp);
        const key = `${punch.employeeId}-${dateKey}`;
        
        if (!punchPairs.has(key)) {
          punchPairs.set(key, []);
        }
        
        const pairs = punchPairs.get(key)!;
        
        if (punch.type === "IN") {
          pairs.push({ in: punch, out: null, employee: punch.employee });
        } else if (punch.type === "OUT") {
          const lastPair = pairs[pairs.length - 1];
          if (lastPair && lastPair.in && !lastPair.out) {
            lastPair.out = punch;
          } else {
            pairs.push({ in: null, out: punch, employee: punch.employee });
          }
        } else {
          continue;
        }
      }

      const records: PunchRecord[] = [];
      for (const pairs of Array.from(punchPairs.values())) {
        for (const pair of pairs) {
          records.push({
            lastName: pair.employee.lastName,
            firstName: pair.employee.firstName,
            inTimestamp: pair.in?.timestamp ?? null,
            inSignatureData: pair.in?.signatureData ?? null,
            inLatitude: pair.in?.latitude ?? null,
            inLongitude: pair.in?.longitude ?? null,
            outTimestamp: pair.out?.timestamp ?? null,
            outSignatureData: pair.out?.signatureData ?? null,
            outLatitude: pair.out?.latitude ?? null,
            outLongitude: pair.out?.longitude ?? null,
          });
        }
      }

      records.sort((a, b) => pdfSortKey(a) - pdfSortKey(b));
      logPdfDebug("GENERAL", records);

      const generatedAt = new Date();
      const pdfBuffer = await generateReportPDF({
        title: "Informe General de Fichajes",
        subtitle,
        records,
        generatedAt,
        periodStart: startDate,
        periodEnd: endDate,
        isEmployeeReport: false,
      });

      await storage.createAuditLog({
        action: "export",
        actorId: req.employee!.id,
        targetType: "report",
        targetId: "general",
        details: JSON.stringify({ period, year: yearNum, month: month ? parseInt(month as string) : undefined, week: week ? parseInt(week as string) : undefined }),
      });

      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="informe-general-${subtitle.replace(/\s+/g, "-")}.pdf"`);
      res.send(pdfBuffer);
    } catch (error) {
      handleRouteError(res, error, "[REPORT-GENERAL]", "Error al generar informe");
    }
  });

  app.get("/api/reports/employee/:id", authenticateAdminManager, async (req, res) => {
    try {
      const employeeId = req.params.id;
      const { startDate: startStr, endDate: endStr } = req.query;
      
      if (!startStr || !endStr) {
        return res.status(400).json({ error: { code: "INVALID_DATES", message: "Fechas inicio y fin requeridas" } });
      }

      const refDateStart = new Date(startStr as string + "T12:00:00Z");
      const refDateEnd = new Date(endStr as string + "T12:00:00Z");
      const startDate = startOfDayInSpain(refDateStart);
      const endDate = endOfDayInSpain(refDateEnd);

      const diffDays = (endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24);
      if (diffDays > 366) {
        return res.status(400).json({ error: { code: "RANGE_TOO_LARGE", message: "El rango máximo es de 1 año" } });
      }

      const employee = await storage.getEmployee(employeeId as string);
      if (!employee) {
        return res.status(404).json({ error: { code: "EMPLOYEE_NOT_FOUND", message: "Empleado no encontrado" } });
      }

      const punchesData = await storage.getAllPunchesForReport({ startDate, endDate, employeeId: employeeId as string });

      const punchPairs: { in: typeof punchesData[0] | null; out: typeof punchesData[0] | null }[] = [];

      for (const punch of punchesData) {
        if (punch.type === "IN") {
          punchPairs.push({ in: punch, out: null });
        } else if (punch.type === "OUT") {
          const lastPair = punchPairs[punchPairs.length - 1];
          if (lastPair && lastPair.in && !lastPair.out) {
            lastPair.out = punch;
          } else {
            punchPairs.push({ in: null, out: punch });
          }
        } else {
          continue;
        }
      }

      const records: PunchRecord[] = punchPairs.map(pair => ({
        lastName: employee.lastName,
        firstName: employee.firstName,
        inTimestamp: pair.in?.timestamp ?? null,
        inSignatureData: pair.in?.signatureData ?? null,
        inLatitude: pair.in?.latitude ?? null,
        inLongitude: pair.in?.longitude ?? null,
        outTimestamp: pair.out?.timestamp ?? null,
        outSignatureData: pair.out?.signatureData ?? null,
        outLatitude: pair.out?.latitude ?? null,
        outLongitude: pair.out?.longitude ?? null,
      }));

      records.sort((a, b) => pdfSortKey(a) - pdfSortKey(b));

      const subtitle = `${employee.lastName} ${employee.firstName} - Del ${formatDateES(startDate)} al ${formatDateES(endDate)}`;
      logPdfDebug("EMPLOYEE", records);

      const generatedAt = new Date();
      const pdfBuffer = await generateReportPDF({
        title: "Informe de Fichajes por Empleado",
        subtitle,
        records,
        generatedAt,
        periodStart: startDate,
        periodEnd: endDate,
        employeeName: `${employee.firstName} ${employee.lastName}`,
        isEmployeeReport: true,
      });

      await storage.createAuditLog({
        action: "export",
        actorId: req.employee!.id,
        targetType: "report",
        targetId: employeeId as string,
        details: JSON.stringify({ startDate: startStr, endDate: endStr, employeeName: `${employee.firstName} ${employee.lastName}` }),
      });

      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="informe-${employee.lastName}-${employee.firstName}.pdf"`);
      res.send(pdfBuffer);
    } catch (error) {
      handleRouteError(res, error, "[REPORT-EMPLOYEE]", "Error al generar informe");
    }
  });

  app.get("/api/reports/authorities.pdf", authenticateAdminManager, async (req, res) => {
    try {
      const { scope, year: yearStr, month: monthStr, employeeId, includeAnnexes: annexesStr } = req.query;

      if (!scope || (scope !== "month" && scope !== "year")) {
        return res.status(400).json({ error: { code: "INVALID_SCOPE", message: "Scope debe ser 'month' o 'year'" } });
      }

      const yearNum = parseInt(yearStr as string);
      if (!yearNum || yearNum < 2020 || yearNum > 2100) {
        return res.status(400).json({ error: { code: "INVALID_YEAR", message: "Año inválido" } });
      }

      let monthNum: number | undefined;
      if (scope === "month") {
        monthNum = parseInt(monthStr as string);
        if (!monthNum || monthNum < 1 || monthNum > 12) {
          return res.status(400).json({ error: { code: "INVALID_MONTH", message: "Mes inválido (1-12)" } });
        }
      }

      let periodStart: Date;
      let periodEnd: Date;

      if (scope === "month") {
        const refStart = new Date(Date.UTC(yearNum, monthNum! - 1, 1, 12, 0, 0));
        const lastDay = new Date(Date.UTC(yearNum, monthNum!, 0)).getUTCDate();
        const refEnd = new Date(Date.UTC(yearNum, monthNum! - 1, lastDay, 12, 0, 0));
        periodStart = startOfDayInSpain(refStart);
        periodEnd = endOfDayInSpain(refEnd);
      } else {
        const refStart = new Date(Date.UTC(yearNum, 0, 1, 12, 0, 0));
        const refEnd = new Date(Date.UTC(yearNum, 11, 31, 12, 0, 0));
        periodStart = startOfDayInSpain(refStart);
        periodEnd = endOfDayInSpain(refEnd);
      }

      const includeAnnexes = annexesStr !== undefined
        ? annexesStr === "true"
        : scope === "month";

      const empId = employeeId as string | undefined;

      const [allPunches, correctionsData] = await Promise.all([
        storage.getAllPunchesForReport({ startDate: periodStart, endDate: periodEnd, employeeId: empId }),
        storage.getCorrectionsInRange({ startDate: periodStart, endDate: periodEnd, employeeId: empId }),
      ]);

      const kioskPunches = allPunches.filter(p => p.source === "kiosk");
      const kioskPunchIds = new Set(kioskPunches.map(p => p.id));
      const kioskCorrections = correctionsData.filter(c => kioskPunchIds.has(c.originalPunchId));

      const generatedAt = new Date();
      const pdfBuffer = await generateAuthoritiesPDF({
        scope: scope as "month" | "year",
        year: yearNum,
        month: monthNum,
        includeAnnexes,
        generatedAt,
        periodStart,
        periodEnd,
        punches: kioskPunches,
        corrections: kioskCorrections,
      });

      await storage.createAuditLog({
        action: "export",
        actorId: req.employee!.id,
        targetType: "report",
        targetId: "authorities",
        details: JSON.stringify({ scope, year: yearNum, month: monthNum, employeeId: empId, includeAnnexes }),
      });

      const monthNames = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
        "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
      const fileLabel = scope === "month"
        ? `${monthNames[(monthNum || 1) - 1]}-${yearNum}`
        : `${yearNum}`;

      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="informe-autoridades-${fileLabel}.pdf"`);
      res.setHeader("Cache-Control", "no-store");
      res.send(pdfBuffer);
    } catch (error) {
      handleRouteError(res, error, "[REPORT-AUTHORITIES]", "Error al generar informe para autoridades");
    }
  });

  return httpServer;
}
