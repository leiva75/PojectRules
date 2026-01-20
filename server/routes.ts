import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { 
  hashPassword, 
  verifyPassword, 
  generateAccessToken, 
  generateRefreshToken, 
  generateEmployeeToken,
  verifyToken,
  getRefreshTokenExpiry,
  authenticateAdminManager,
  authenticateEmployee 
} from "./auth";
import { 
  loginSchema, 
  employeeLoginSchema, 
  insertEmployeeSchema,
  punchRequestSchema,
  correctionRequestSchema,
  exportQuerySchema,
  reviewRequestSchema,
  overtimeReviewRequestSchema
} from "@shared/schema";
import { Parser } from "json2csv";
import rateLimit from "express-rate-limit";

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { message: "Trop de tentatives, réessayez plus tard" },
});

const APP_VERSION = "1.0.0";

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {

  app.get("/api/health", async (_req, res) => {
    try {
      await storage.getAllEmployees();
      res.json({ status: "ok", db: "connected", timestamp: new Date().toISOString() });
    } catch {
      res.status(503).json({ status: "error", db: "disconnected" });
    }
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
      console.error("Estado error:", error);
      res.status(500).json({ 
        error: { 
          code: "INTERNAL_ERROR", 
          message: "Error al obtener estado" 
        } 
      });
    }
  });

  app.post("/api/auth/login", authLimiter, async (req, res) => {
    try {
      const result = loginSchema.safeParse(req.body);
      if (!result.success) {
        return res.status(400).json({ message: "Données invalides", errors: result.error.errors });
      }

      const { email, password } = result.data;
      const employee = await storage.getEmployeeByEmail(email);

      if (!employee) {
        return res.status(401).json({ message: "Email ou mot de passe incorrect" });
      }

      const validPassword = await verifyPassword(password, employee.password);
      if (!validPassword) {
        return res.status(401).json({ message: "Email ou mot de passe incorrect" });
      }

      if (!employee.isActive) {
        return res.status(401).json({ message: "Compte désactivé" });
      }

      if (!["admin", "manager"].includes(employee.role)) {
        return res.status(403).json({ message: "Utilisez l'accès employé pour vous connecter" });
      }

      const accessToken = generateAccessToken(employee);
      const refreshToken = generateRefreshToken(employee);

      await storage.createRefreshToken(employee.id, refreshToken, getRefreshTokenExpiry());

      res.cookie("accessToken", accessToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "strict",
        maxAge: 15 * 60 * 1000,
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
      console.error("Login error:", error);
      res.status(500).json({ message: "Erreur serveur" });
    }
  });

  app.post("/api/auth/employee-login", authLimiter, async (req, res) => {
    try {
      const result = employeeLoginSchema.safeParse(req.body);
      if (!result.success) {
        return res.status(400).json({ message: "PIN invalide" });
      }

      const { pin } = result.data;
      const employee = await storage.getEmployeeByPin(pin);

      if (!employee) {
        return res.status(401).json({ message: "PIN incorrect" });
      }

      if (!employee.isActive) {
        return res.status(401).json({ message: "Compte désactivé" });
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
      console.error("Employee login error:", error);
      res.status(500).json({ message: "Erreur serveur" });
    }
  });

  app.post("/api/auth/kiosk-login", authLimiter, async (req, res) => {
    try {
      const result = employeeLoginSchema.safeParse(req.body);
      if (!result.success) {
        return res.status(400).json({ message: "PIN invalide" });
      }

      const { pin } = result.data;
      const employee = await storage.getEmployeeByPin(pin);

      if (!employee) {
        return res.status(401).json({ message: "PIN incorrect" });
      }

      if (!employee.isActive) {
        return res.status(401).json({ message: "Compte désactivé" });
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
      console.error("Kiosk login error:", error);
      res.status(500).json({ message: "Erreur serveur" });
    }
  });

  app.post("/api/auth/refresh", async (req, res) => {
    try {
      const refreshToken = req.cookies?.refreshToken;
      
      if (!refreshToken) {
        return res.status(401).json({ message: "Non authentifié" });
      }

      const payload = verifyToken(refreshToken);
      if (!payload || payload.type !== "refresh") {
        return res.status(401).json({ message: "Token invalide" });
      }

      const storedToken = await storage.getRefreshToken(refreshToken);
      if (!storedToken || new Date() > storedToken.expiresAt) {
        return res.status(401).json({ message: "Token expiré" });
      }

      const employee = await storage.getEmployee(payload.employeeId);
      if (!employee || !employee.isActive) {
        return res.status(401).json({ message: "Compte désactivé" });
      }

      const newAccessToken = generateAccessToken(employee);

      res.cookie("accessToken", newAccessToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "strict",
        maxAge: 15 * 60 * 1000,
      });

      const { password: _, ...userWithoutPassword } = employee;
      res.json({ user: userWithoutPassword });
    } catch (error) {
      console.error("Refresh error:", error);
      res.status(500).json({ message: "Erreur serveur" });
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
        return res.status(401).json({ message: "Non authentifié" });
      }

      const payload = verifyToken(token);
      if (!payload) {
        return res.status(401).json({ message: "Token invalide" });
      }

      const employee = await storage.getEmployee(payload.employeeId);
      if (!employee || !employee.isActive) {
        return res.status(401).json({ message: "Compte désactivé" });
      }

      const { password: _, ...userWithoutPassword } = employee;
      res.json({ user: userWithoutPassword });
    } catch (error) {
      console.error("Me error:", error);
      res.status(500).json({ message: "Erreur serveur" });
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
      res.json({ message: "Déconnecté" });
    } catch (error) {
      console.error("Logout error:", error);
      res.status(500).json({ message: "Erreur serveur" });
    }
  });

  app.get("/api/employees", authenticateAdminManager, async (req, res) => {
    try {
      const employees = await storage.getAllEmployees();
      const sanitized = employees.map(({ password, ...emp }) => emp);
      res.json(sanitized);
    } catch (error) {
      console.error("Get employees error:", error);
      res.status(500).json({ message: "Erreur serveur" });
    }
  });

  app.post("/api/employees", authenticateAdminManager, async (req, res) => {
    try {
      const result = insertEmployeeSchema.safeParse(req.body);
      if (!result.success) {
        return res.status(400).json({ message: "Données invalides", errors: result.error.errors });
      }

      const existingEmail = await storage.getEmployeeByEmail(result.data.email);
      if (existingEmail) {
        return res.status(400).json({ message: "Un compte avec cet email existe déjà" });
      }

      if (result.data.pin) {
        const existingPin = await storage.getEmployeeByPin(result.data.pin);
        if (existingPin) {
          return res.status(400).json({ message: "Ce PIN est déjà utilisé" });
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
      console.error("Create employee error:", error);
      res.status(500).json({ message: "Erreur serveur" });
    }
  });

  app.patch("/api/employees/:id", authenticateAdminManager, async (req, res) => {
    try {
      const id = req.params.id as string;
      const { firstName, lastName, email, pin, role, isActive, password } = req.body;

      const existing = await storage.getEmployee(id);
      if (!existing) {
        return res.status(404).json({ message: "Employé introuvable" });
      }

      if (email && email !== existing.email) {
        const emailExists = await storage.getEmployeeByEmail(email);
        if (emailExists) {
          return res.status(400).json({ message: "Cet email est déjà utilisé" });
        }
      }

      if (pin && pin !== existing.pin) {
        const pinExists = await storage.getEmployeeByPin(pin);
        if (pinExists) {
          return res.status(400).json({ message: "Ce PIN est déjà utilisé" });
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
        return res.status(404).json({ message: "Employé introuvable" });
      }

      const { password: _, ...sanitized } = updated;
      res.json(sanitized);
    } catch (error) {
      console.error("Update employee error:", error);
      res.status(500).json({ message: "Erreur serveur" });
    }
  });

  app.post("/api/punches", authenticateEmployee, async (req, res) => {
    try {
      const result = punchRequestSchema.safeParse(req.body);
      if (!result.success) {
        return res.status(400).json({ message: "Données invalides", errors: result.error.errors });
      }

      const employee = req.employee!;
      const { type, latitude, longitude, accuracy, source } = result.data;

      const lastPunch = await storage.getLastPunchByEmployee(employee.id);
      
      if (type === "IN" && lastPunch?.type === "IN") {
        return res.status(400).json({ message: "Vous êtes déjà pointé comme présent. Effectuez une sortie d'abord." });
      }

      if (type === "OUT" && (!lastPunch || lastPunch.type === "OUT")) {
        return res.status(400).json({ message: "Vous n'êtes pas pointé comme présent. Effectuez une entrée d'abord." });
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
          const punchDay = new Date(punchDate);
          punchDay.setHours(0, 0, 0, 0);
          
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
      console.error("Create punch error:", error);
      res.status(500).json({ message: "Erreur serveur" });
    }
  });

  app.get("/api/punches/my", authenticateEmployee, async (req, res) => {
    try {
      const employee = req.employee!;
      const punches = await storage.getPunchesByEmployee(employee.id);
      res.json(punches);
    } catch (error) {
      console.error("Get my punches error:", error);
      res.status(500).json({ message: "Erreur serveur" });
    }
  });

  app.get("/api/punches/last", authenticateEmployee, async (req, res) => {
    try {
      const employee = req.employee!;
      const punch = await storage.getLastPunchByEmployee(employee.id);
      res.json(punch || null);
    } catch (error) {
      console.error("Get last punch error:", error);
      res.status(500).json({ message: "Erreur serveur" });
    }
  });

  app.get("/api/punches", authenticateAdminManager, async (req, res) => {
    try {
      const limit = req.query.limit ? parseInt(req.query.limit as string) : 50;
      const needsReview = req.query.needsReview === "true" ? true : undefined;
      
      const punches = await storage.getAllPunches({ limit, needsReview });
      res.json(punches);
    } catch (error) {
      console.error("Get all punches error:", error);
      res.status(500).json({ message: "Erreur serveur" });
    }
  });

  app.post("/api/corrections", authenticateAdminManager, async (req, res) => {
    try {
      const result = correctionRequestSchema.safeParse(req.body);
      if (!result.success) {
        return res.status(400).json({ message: "Données invalides", errors: result.error.errors });
      }

      const admin = req.employee!;
      const { originalPunchId, reason, newTimestamp, newType } = result.data;

      const originalPunch = await storage.getPunchById(originalPunchId);
      if (!originalPunch) {
        return res.status(404).json({ message: "Pointage original introuvable" });
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
      console.error("Create correction error:", error);
      res.status(500).json({ message: "Erreur serveur" });
    }
  });

  app.post("/api/punches/:id/correct", authenticateAdminManager, async (req, res) => {
    try {
      const id = req.params.id as string;
      const { reason, newTimestamp, newType } = req.body;

      if (!reason || reason.length < 10) {
        return res.status(400).json({ message: "La raison doit contenir au moins 10 caractères" });
      }

      const admin = req.employee!;
      const originalPunch = await storage.getPunchById(id);
      
      if (!originalPunch) {
        return res.status(404).json({ message: "Pointage introuvable" });
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
      console.error("Correct punch error:", error);
      res.status(500).json({ message: "Erreur serveur" });
    }
  });

  app.get("/api/punches/needs-review", authenticateAdminManager, async (req, res) => {
    try {
      const punches = await storage.getPunchesNeedingReview();
      res.json(punches);
    } catch (error) {
      console.error("Get needs review error:", error);
      res.status(500).json({ message: "Erreur serveur" });
    }
  });

  app.post("/api/punches/:id/review", authenticateAdminManager, async (req, res) => {
    try {
      const id = req.params.id as string;
      const result = reviewRequestSchema.safeParse(req.body);
      
      const admin = req.employee!;
      const punch = await storage.getPunchById(id);
      
      if (!punch) {
        return res.status(404).json({ message: "Pointage introuvable" });
      }

      const existingReview = await storage.getPunchReview(id);
      if (existingReview) {
        return res.status(400).json({ message: "Ce pointage a déjà été révisé" });
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
      console.error("Review punch error:", error);
      res.status(500).json({ message: "Erreur serveur" });
    }
  });

  app.get("/api/admin/stats", authenticateAdminManager, async (req, res) => {
    try {
      const stats = await storage.getStats();
      res.json(stats);
    } catch (error) {
      console.error("Get stats error:", error);
      res.status(500).json({ message: "Erreur serveur" });
    }
  });

  app.get("/api/exports/punches", authenticateAdminManager, async (req, res) => {
    try {
      const result = exportQuerySchema.safeParse(req.query);
      if (!result.success) {
        return res.status(400).json({ message: "Paramètres invalides" });
      }

      const { employeeId, startDate, endDate } = result.data;
      const admin = req.employee!;

      const punches = await storage.getAllPunchesForExport({
        employeeId,
        startDate: new Date(startDate),
        endDate: new Date(endDate + "T23:59:59"),
        limit: 10000,
      });

      const overtimeRequests = await storage.getOvertimeRequests({ 
        employeeId,
        limit: 10000 
      });
      const startDateObj = new Date(startDate);
      const endDateObj = new Date(endDate);
      endDateObj.setHours(23, 59, 59, 999);
      
      const overtimeMap = new Map<string, { minutes: number; status: string }>();
      overtimeRequests.forEach((ot) => {
        const otDate = new Date(ot.date);
        if (otDate >= startDateObj && otDate <= endDateObj) {
          const dateKey = otDate.toISOString().split("T")[0];
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

      const formatDate = (date: Date) => {
        const d = new Date(date);
        const day = d.getDate().toString().padStart(2, '0');
        const month = (d.getMonth() + 1).toString().padStart(2, '0');
        const year = d.getFullYear();
        return `${day}/${month}/${year}`;
      };

      const formatTime = (date: Date) => {
        const d = new Date(date);
        const hours = d.getHours().toString().padStart(2, '0');
        const minutes = d.getMinutes().toString().padStart(2, '0');
        const seconds = d.getSeconds().toString().padStart(2, '0');
        return `${hours}:${minutes}:${seconds}`;
      };

      const data = punches.map((punch) => {
        const punchDate = new Date(punch.timestamp).toISOString().split("T")[0];
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
          "Tipo": punch.type === "IN" ? "Entrada" : "Salida",
          "Fecha": formatDate(punch.timestamp),
          "Hora": formatTime(punch.timestamp),
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
      console.error("Export error:", error);
      res.status(500).json({ message: "Erreur serveur" });
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
      console.error("Get overtime requests error:", error);
      res.status(500).json({ message: "Erreur serveur" });
    }
  });

  app.post("/api/overtime-requests/:id/review", authenticateAdminManager, async (req, res) => {
    try {
      const { id } = req.params;
      const result = overtimeReviewRequestSchema.safeParse(req.body);
      
      if (!result.success) {
        return res.status(400).json({ message: "Données invalides", errors: result.error.errors });
      }

      const { status, comment } = result.data;
      const admin = req.employee!;

      const existingRequests = await storage.getOvertimeRequests({ limit: 1000 });
      const existing = existingRequests.find(r => r.id === id);
      
      if (!existing) {
        return res.status(404).json({ message: "Demande d'heures supplémentaires non trouvée" });
      }

      if (existing.status !== "pending") {
        return res.status(400).json({ message: "Cette demande a déjà été traitée" });
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

      res.json({ message: status === "approved" ? "Heures supplémentaires approuvées" : "Heures supplémentaires rejetées" });
    } catch (error) {
      console.error("Review overtime request error:", error);
      res.status(500).json({ message: "Erreur serveur" });
    }
  });

  return httpServer;
}
