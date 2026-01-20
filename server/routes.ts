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
  exportQuerySchema
} from "@shared/schema";
import { Parser } from "json2csv";
import rateLimit from "express-rate-limit";

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { message: "Trop de tentatives, réessayez plus tard" },
});

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {

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
      const { id } = req.params;
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

      res.status(201).json(correction);
    } catch (error) {
      console.error("Create correction error:", error);
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

      const punches = await storage.getAllPunches({
        employeeId,
        startDate: new Date(startDate),
        endDate: new Date(endDate + "T23:59:59"),
        limit: 10000,
      });

      const data = punches.map((punch) => ({
        "ID Pointage": punch.id,
        "Employé": `${punch.employee.firstName} ${punch.employee.lastName}`,
        "Type": punch.type === "IN" ? "Entrée" : "Sortie",
        "Date": new Date(punch.timestamp).toLocaleDateString("fr-FR"),
        "Heure": new Date(punch.timestamp).toLocaleTimeString("fr-FR"),
        "Latitude": punch.latitude || "",
        "Longitude": punch.longitude || "",
        "Précision (m)": punch.accuracy || "",
        "À vérifier": punch.needsReview ? "Oui" : "Non",
        "Source": punch.source,
      }));

      const parser = new Parser({
        fields: [
          "ID Pointage",
          "Employé",
          "Type",
          "Date",
          "Heure",
          "Latitude",
          "Longitude",
          "Précision (m)",
          "À vérifier",
          "Source",
        ],
      });

      const csv = parser.parse(data);

      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename=pointages_${startDate}_${endDate}.csv`);
      res.send("\ufeff" + csv);
    } catch (error) {
      console.error("Export error:", error);
      res.status(500).json({ message: "Erreur serveur" });
    }
  });

  return httpServer;
}
