import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import bcrypt from "bcrypt";
import { storage } from "./storage";
import type { Employee } from "@shared/schema";

const JWT_SECRET = process.env.SESSION_SECRET || "dev-secret-change-in-production";
const ACCESS_TOKEN_EXPIRY = "15m";
const REFRESH_TOKEN_EXPIRY_DAYS = 7;
const EMPLOYEE_TOKEN_EXPIRY = "12h";

export interface TokenPayload {
  employeeId: string;
  role: string;
  type: "access" | "refresh" | "employee";
}

declare global {
  namespace Express {
    interface Request {
      employee?: Employee;
    }
  }
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export function generateAccessToken(employee: Employee): string {
  const payload: TokenPayload = {
    employeeId: employee.id,
    role: employee.role,
    type: "access",
  };
  return jwt.sign(payload, JWT_SECRET, { expiresIn: ACCESS_TOKEN_EXPIRY });
}

export function generateRefreshToken(employee: Employee): string {
  const payload: TokenPayload = {
    employeeId: employee.id,
    role: employee.role,
    type: "refresh",
  };
  return jwt.sign(payload, JWT_SECRET, { expiresIn: `${REFRESH_TOKEN_EXPIRY_DAYS}d` });
}

export function generateEmployeeToken(employee: Employee): string {
  const payload: TokenPayload = {
    employeeId: employee.id,
    role: employee.role,
    type: "employee",
  };
  return jwt.sign(payload, JWT_SECRET, { expiresIn: EMPLOYEE_TOKEN_EXPIRY });
}

export function verifyToken(token: string): TokenPayload | null {
  try {
    return jwt.verify(token, JWT_SECRET) as TokenPayload;
  } catch {
    return null;
  }
}

export function getRefreshTokenExpiry(): Date {
  const expiry = new Date();
  expiry.setDate(expiry.getDate() + REFRESH_TOKEN_EXPIRY_DAYS);
  return expiry;
}

export async function authenticateAdminManager(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const accessToken = req.cookies?.accessToken;
  
  if (!accessToken) {
    res.status(401).json({ message: "Non authentifié" });
    return;
  }

  const payload = verifyToken(accessToken);
  
  if (!payload || (payload.type !== "access" && payload.type !== "refresh")) {
    res.status(401).json({ message: "Token invalide ou expiré" });
    return;
  }

  const employee = await storage.getEmployee(payload.employeeId);
  
  if (!employee || !employee.isActive) {
    res.status(401).json({ message: "Compte désactivé ou introuvable" });
    return;
  }

  if (!["admin", "manager"].includes(employee.role)) {
    res.status(403).json({ message: "Accès non autorisé" });
    return;
  }

  req.employee = employee;
  next();
}

export async function authenticateEmployee(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const authHeader = req.headers.authorization;
  const accessToken = req.cookies?.accessToken;
  
  let token: string | undefined;
  let tokenSource: "bearer" | "cookie" = "cookie";
  
  if (authHeader?.startsWith("Bearer ")) {
    token = authHeader.substring(7);
    tokenSource = "bearer";
  } else if (accessToken) {
    token = accessToken;
    tokenSource = "cookie";
  }

  if (!token) {
    res.status(401).json({ message: "Non authentifié" });
    return;
  }

  const payload = verifyToken(token);
  
  if (!payload) {
    res.status(401).json({ message: "Token invalide ou expiré" });
    return;
  }

  if (tokenSource === "bearer" && payload.type !== "employee") {
    res.status(401).json({ message: "Token invalide pour cet endpoint" });
    return;
  }

  const employee = await storage.getEmployee(payload.employeeId);
  
  if (!employee || !employee.isActive) {
    res.status(401).json({ message: "Compte désactivé ou introuvable" });
    return;
  }

  req.employee = employee;
  next();
}

export async function optionalAuth(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const authHeader = req.headers.authorization;
  const accessToken = req.cookies?.accessToken;
  
  let token: string | undefined;
  
  if (authHeader?.startsWith("Bearer ")) {
    token = authHeader.substring(7);
  } else if (accessToken) {
    token = accessToken;
  }

  if (token) {
    const payload = verifyToken(token);
    if (payload) {
      const employee = await storage.getEmployee(payload.employeeId);
      if (employee?.isActive) {
        req.employee = employee;
      }
    }
  }

  next();
}
