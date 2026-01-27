import type { Express } from "express";
import { createServer, type Server } from "http";
import { createHash } from "crypto";
import multer from "multer";
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
  kioskPunchRequestSchema
} from "@shared/schema";
import { Parser } from "json2csv";
import rateLimit from "express-rate-limit";
import { generateReportPDF, type PunchRecord } from "./pdf-generator";

const upload = multer({ 
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 }
});

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
      const id = req.params.id as string;
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

  // ==================== KIOSK DEVICE MANAGEMENT (Admin) ====================

  app.get("/api/admin/kiosk-devices", authenticateAdminManager, async (_req, res) => {
    try {
      const devices = await storage.getAllKioskDevices();
      res.json(devices.map(d => ({ ...d, tokenHash: undefined })));
    } catch (error) {
      logError("Get kiosk devices error", error);
      res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Error al obtener dispositivos" } });
    }
  });

  app.post("/api/admin/kiosk-devices", authenticateAdminManager, async (req, res) => {
    try {
      const { name } = req.body;
      if (!name || typeof name !== "string") {
        return res.status(400).json({ error: { code: "INVALID_NAME", message: "Nombre requerido" } });
      }

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
      logError("Create kiosk device error", error);
      res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Error al crear dispositivo" } });
    }
  });

  app.patch("/api/admin/kiosk-devices/:id", authenticateAdminManager, async (req, res) => {
    try {
      const id = req.params.id as string;
      const { name, enabled } = req.body;

      const updates: { name?: string; enabled?: boolean } = {};
      if (typeof name === "string") updates.name = name;
      if (typeof enabled === "boolean") updates.enabled = enabled;

      const device = await storage.updateKioskDevice(id, updates);
      if (!device) {
        return res.status(404).json({ error: { code: "NOT_FOUND", message: "Dispositivo no encontrado" } });
      }

      logInfo("Kiosk device updated", { deviceId: id, updates });
      res.json({ ...device, tokenHash: undefined });
    } catch (error) {
      logError("Update kiosk device error", error);
      res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Error al actualizar dispositivo" } });
    }
  });

  app.delete("/api/admin/kiosk-devices/:id", authenticateAdminManager, async (req, res) => {
    try {
      const id = req.params.id as string;
      await storage.deleteKioskDevice(id);
      logInfo("Kiosk device deleted", { deviceId: id });
      res.json({ message: "Dispositivo eliminado" });
    } catch (error) {
      logError("Delete kiosk device error", error);
      res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Error al eliminar dispositivo" } });
    }
  });

  // ==================== KIOSK PUNCH ROUTES ====================

  app.post("/api/kiosk/punch", authenticateKiosk, async (req, res) => {
    try {
      const parseResult = kioskPunchRequestSchema.safeParse(req.body);
      if (!parseResult.success) {
        return res.status(400).json({ error: { code: "INVALID_REQUEST", message: "Datos inválidos" } });
      }

      const { pin } = req.body;
      if (!pin || typeof pin !== "string" || pin.length !== 6) {
        return res.status(400).json({ error: { code: "INVALID_PIN", message: "PIN inválido" } });
      }

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

      const lastPunch = await storage.getLastPunchByEmployee(employee.id);
      
      if (type === "IN" && lastPunch?.type === "IN") {
        return res.status(400).json({ error: { code: "ALREADY_IN", message: "Ya está fichado como presente. Realice una salida primero." } });
      }

      if (type === "OUT" && (!lastPunch || lastPunch.type === "OUT")) {
        return res.status(400).json({ error: { code: "NOT_IN", message: "No está fichado como presente. Realice una entrada primero." } });
      }

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

      logInfo("Kiosk punch created with signature", { 
        punchId: punch.id, 
        employeeId: employee.id, 
        type, 
        status: punch.status,
        kioskDeviceId: req.kioskDevice?.id,
        hasSignature: !!signatureData,
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
      logError("Kiosk punch error", error);
      res.status(500).json({ error: { code: "PUNCH_ERROR", message: "Error al registrar pointage" } });
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
        return res.status(404).json({ error: { code: "PUNCH_NOT_FOUND", message: "Pointage no encontrado" } });
      }

      if (punch.status === "SIGNED") {
        return res.status(400).json({ error: { code: "ALREADY_SIGNED", message: "Pointage ya firmado" } });
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
      logError("Signature upload error", error);
      res.status(500).json({ error: { code: "SIGNATURE_ERROR", message: "Error al guardar firma" } });
    }
  });

  app.get("/api/admin/punches/:id/signature-url", authenticateAdminManager, async (req, res) => {
    try {
      const id = req.params.id as string;
      const punch = await storage.getPunchById(id);

      if (!punch) {
        return res.status(404).json({ error: { code: "PUNCH_NOT_FOUND", message: "Pointage no encontrado" } });
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
      logError("Get signature URL error", error);
      res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Error al obtener firma" } });
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
        const jan4 = new Date(yearNum, 0, 4);
        const dayOfWeek = jan4.getDay() || 7;
        startDate = new Date(jan4);
        startDate.setDate(jan4.getDate() - dayOfWeek + 1 + (weekNum - 1) * 7);
        endDate = new Date(startDate);
        endDate.setDate(startDate.getDate() + 6);
        endDate.setHours(23, 59, 59, 999);
        subtitle = `Semana ${weekNum} - ${yearNum}`;
      } else {
        const monthNum = parseInt(month as string) || 1;
        startDate = new Date(yearNum, monthNum - 1, 1);
        endDate = new Date(yearNum, monthNum, 0, 23, 59, 59, 999);
        const monthNames = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", 
                          "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
        subtitle = `${monthNames[monthNum - 1]} ${yearNum}`;
      }

      const punchesData = await storage.getAllPunchesForReport({ startDate, endDate });

      const punchPairs = new Map<string, { in: typeof punchesData[0] | null; out: typeof punchesData[0] | null; employee: typeof punchesData[0]["employee"] }[]>();

      for (const punch of punchesData) {
        const dateKey = punch.timestamp.toISOString().split("T")[0];
        const key = `${punch.employeeId}-${dateKey}`;
        
        if (!punchPairs.has(key)) {
          punchPairs.set(key, []);
        }
        
        const pairs = punchPairs.get(key)!;
        
        if (punch.type === "IN") {
          pairs.push({ in: punch, out: null, employee: punch.employee });
        } else {
          const lastPair = pairs[pairs.length - 1];
          if (lastPair && lastPair.in && !lastPair.out) {
            lastPair.out = punch;
          } else {
            pairs.push({ in: null, out: punch, employee: punch.employee });
          }
        }
      }

      const records: PunchRecord[] = [];
      for (const pairs of punchPairs.values()) {
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

      records.sort((a, b) => {
        const nameCompare = (a.lastName + a.firstName).localeCompare(b.lastName + b.firstName);
        if (nameCompare !== 0) return nameCompare;
        const aTime = a.inTimestamp?.getTime() ?? a.outTimestamp?.getTime() ?? 0;
        const bTime = b.inTimestamp?.getTime() ?? b.outTimestamp?.getTime() ?? 0;
        return aTime - bTime;
      });

      const pdfBuffer = await generateReportPDF({
        title: "Informe General de Fichajes",
        subtitle,
        records,
        generatedAt: new Date(),
      });

      await storage.createAuditLog({
        action: "export",
        actorId: req.employee!.id,
        targetType: "report",
        targetId: "general",
        details: { period, year: yearNum, month: month ? parseInt(month as string) : undefined, week: week ? parseInt(week as string) : undefined },
      });

      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="informe-general-${subtitle.replace(/\s+/g, "-")}.pdf"`);
      res.send(pdfBuffer);
    } catch (error) {
      logError("Report generation error", error);
      res.status(500).json({ error: { code: "REPORT_ERROR", message: "Error al generar informe" } });
    }
  });

  app.get("/api/reports/employee/:id", authenticateAdminManager, async (req, res) => {
    try {
      const employeeId = req.params.id;
      const { startDate: startStr, endDate: endStr } = req.query;
      
      if (!startStr || !endStr) {
        return res.status(400).json({ error: { code: "INVALID_DATES", message: "Fechas inicio y fin requeridas" } });
      }

      const startDate = new Date(startStr as string);
      const endDate = new Date(endStr as string);
      endDate.setHours(23, 59, 59, 999);

      const diffDays = (endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24);
      if (diffDays > 366) {
        return res.status(400).json({ error: { code: "RANGE_TOO_LARGE", message: "El rango máximo es de 1 año" } });
      }

      const employee = await storage.getEmployee(employeeId);
      if (!employee) {
        return res.status(404).json({ error: { code: "EMPLOYEE_NOT_FOUND", message: "Empleado no encontrado" } });
      }

      const punchesData = await storage.getAllPunchesForReport({ startDate, endDate, employeeId });

      const punchPairs: { in: typeof punchesData[0] | null; out: typeof punchesData[0] | null }[] = [];

      for (const punch of punchesData) {
        if (punch.type === "IN") {
          punchPairs.push({ in: punch, out: null });
        } else {
          const lastPair = punchPairs[punchPairs.length - 1];
          if (lastPair && lastPair.in && !lastPair.out) {
            lastPair.out = punch;
          } else {
            punchPairs.push({ in: null, out: punch });
          }
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

      const formatDate = (d: Date) => d.toLocaleDateString("es-ES", { day: "2-digit", month: "2-digit", year: "numeric" });
      const subtitle = `${employee.lastName} ${employee.firstName} - Del ${formatDate(startDate)} al ${formatDate(endDate)}`;

      const pdfBuffer = await generateReportPDF({
        title: "Informe de Fichajes por Empleado",
        subtitle,
        records,
        generatedAt: new Date(),
      });

      await storage.createAuditLog({
        action: "export",
        actorId: req.employee!.id,
        targetType: "report",
        targetId: employeeId,
        details: { startDate: startStr, endDate: endStr, employeeName: `${employee.firstName} ${employee.lastName}` },
      });

      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="informe-${employee.lastName}-${employee.firstName}.pdf"`);
      res.send(pdfBuffer);
    } catch (error) {
      logError("Employee report generation error", error);
      res.status(500).json({ error: { code: "REPORT_ERROR", message: "Error al generar informe" } });
    }
  });

  return httpServer;
}
