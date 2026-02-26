import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import bcrypt from "bcrypt";
import { storage } from "./storage";
import type { Employee } from "@shared/schema";

const isProd = process.env.NODE_ENV === "production";

// In production, JWT secrets are validated at startup in index.ts
// In development, we use fallback secrets for convenience
const JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET || (isProd ? "" : "dev-access-secret-do-not-use-in-production");
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || (isProd ? "" : "dev-refresh-secret-do-not-use-in-production");

const ACCESS_TOKEN_EXPIRY = "1h";
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
  return jwt.sign(payload, JWT_ACCESS_SECRET, { expiresIn: ACCESS_TOKEN_EXPIRY });
}

export function generateRefreshToken(employee: Employee): string {
  const payload: TokenPayload = {
    employeeId: employee.id,
    role: employee.role,
    type: "refresh",
  };
  return jwt.sign(payload, JWT_REFRESH_SECRET, { expiresIn: `${REFRESH_TOKEN_EXPIRY_DAYS}d` });
}

export function generateEmployeeToken(employee: Employee): string {
  const payload: TokenPayload = {
    employeeId: employee.id,
    role: employee.role,
    type: "employee",
  };
  // Employee tokens use access secret (same trust level as access tokens)
  return jwt.sign(payload, JWT_ACCESS_SECRET, { expiresIn: EMPLOYEE_TOKEN_EXPIRY });
}

export function verifyToken(token: string): TokenPayload | null {
  // Try access secret first (covers access and employee tokens)
  try {
    return jwt.verify(token, JWT_ACCESS_SECRET) as TokenPayload;
  } catch {
    // Try refresh secret for refresh tokens
    try {
      return jwt.verify(token, JWT_REFRESH_SECRET) as TokenPayload;
    } catch {
      return null;
    }
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
    res.status(401).json({ message: "No autenticado" });
    return;
  }

  const payload = verifyToken(accessToken);
  
  if (!payload || (payload.type !== "access" && payload.type !== "refresh")) {
    res.status(401).json({ message: "Token inválido o expirado" });
    return;
  }

  const employee = await storage.getEmployee(payload.employeeId);
  
  if (!employee || !employee.isActive) {
    res.status(401).json({ message: "Cuenta desactivada o no encontrada" });
    return;
  }

  if (!["admin", "manager"].includes(employee.role)) {
    res.status(403).json({ message: "Acceso no autorizado" });
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
    res.status(401).json({ message: "No autenticado" });
    return;
  }

  const payload = verifyToken(token);
  
  if (!payload) {
    res.status(401).json({ message: "Token inválido o expirado" });
    return;
  }

  if (tokenSource === "bearer" && payload.type !== "employee") {
    res.status(401).json({ message: "Token inválido para este endpoint" });
    return;
  }

  const employee = await storage.getEmployee(payload.employeeId);
  
  if (!employee || !employee.isActive) {
    res.status(401).json({ message: "Cuenta desactivada o no encontrada" });
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
