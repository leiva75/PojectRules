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
  type: "access" | "refresh" | "employee" | "employee-portal" | "ep-refresh";
  source?: "gestion_users" | "employees";
  gestionUserId?: number;
}

declare global {
  namespace Express {
    interface Request {
      employee?: Employee;
      gestionUserId?: number;
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

export function generateEmployeePortalAccessToken(employee: Employee): string {
  const payload: TokenPayload = {
    employeeId: employee.id,
    role: employee.role,
    type: "employee-portal",
  };
  return jwt.sign(payload, JWT_ACCESS_SECRET, { expiresIn: ACCESS_TOKEN_EXPIRY });
}

export function generateEmployeePortalRefreshToken(employee: Employee): string {
  const payload: TokenPayload = {
    employeeId: employee.id,
    role: employee.role,
    type: "ep-refresh",
  };
  return jwt.sign(payload, JWT_REFRESH_SECRET, { expiresIn: `${REFRESH_TOKEN_EXPIRY_DAYS}d` });
}

export function generateGestionAccessToken(proxyEmployeeId: string, gestionUserId: number, role: string): string {
  const payload: TokenPayload = {
    employeeId: proxyEmployeeId,
    role,
    type: "access",
    source: "gestion_users",
    gestionUserId,
  };
  return jwt.sign(payload, JWT_ACCESS_SECRET, { expiresIn: ACCESS_TOKEN_EXPIRY });
}

export function generateGestionRefreshToken(proxyEmployeeId: string, gestionUserId: number, role: string): string {
  const payload: TokenPayload = {
    employeeId: proxyEmployeeId,
    role,
    type: "refresh",
    source: "gestion_users",
    gestionUserId,
  };
  return jwt.sign(payload, JWT_REFRESH_SECRET, { expiresIn: `${REFRESH_TOKEN_EXPIRY_DAYS}d` });
}

export function verifyToken(token: string): TokenPayload | null {
  try {
    return jwt.verify(token, JWT_ACCESS_SECRET) as TokenPayload;
  } catch {
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

export const EP_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: isProd,
  sameSite: "lax" as const,
  path: "/",
};

export async function authenticateEmployeePortal(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const token = req.cookies?.epAccessToken;

  if (!token) {
    res.status(401).json({ message: "No autenticado" });
    return;
  }

  const payload = verifyToken(token);

  if (!payload || payload.type !== "employee-portal") {
    res.status(401).json({ message: "Token inválido o expirado" });
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

export const ADMIN_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: isProd,
  sameSite: "lax" as const,
  path: "/",
};

export interface GestionUser {
  id: number;
  username: string;
  display_name: string | null;
  role: string;
  is_active: boolean;
}

export interface AdminSessionResult {
  proxyEmployee: Employee;
  fichajesRole: string;
  accessToken: string;
  refreshToken: string;
}

export async function createAdminSession(
  res: import("express").Response,
  gestionUser: GestionUser,
  ipAddress: string,
  auditAction: string = "login",
  auditMethod: string = "gestion_users",
): Promise<AdminSessionResult> {
  const { db } = await import("./db");
  const { eq } = await import("drizzle-orm");
  const { employees: employeesTable, gestionAdminLinks } = await import("@shared/schema");
  const { randomBytes } = await import("crypto");

  const allowedRoles = ["admin", "rrhh"];
  if (!allowedRoles.includes(gestionUser.role)) {
    throw new Error("ROLE_NOT_ALLOWED");
  }

  const fichajesRole = gestionUser.role === "admin" ? "admin" : "manager";

  let proxyEmployee = await storage.getEmployeeByGestionUserId(gestionUser.id);

  if (!proxyEmployee) {
    const placeholderPassword = await hashPassword(randomBytes(32).toString("hex"));
    const proxyEmail = `gestion-admin-${gestionUser.id}@fichajes.internal`;
    const displayName = gestionUser.display_name || gestionUser.username;

    proxyEmployee = await db.insert(employeesTable).values({
      email: proxyEmail,
      password: placeholderPassword,
      firstName: displayName,
      lastName: "(Gestión)",
      role: fichajesRole,
      isActive: true,
      gestionUserId: gestionUser.id,
    }).returning().then(rows => rows[0]);
  } else {
    if (proxyEmployee.role !== fichajesRole || !proxyEmployee.isActive) {
      const updateData: Record<string, any> = {};
      if (proxyEmployee.role !== fichajesRole) updateData.role = fichajesRole;
      if (!proxyEmployee.isActive) updateData.isActive = true;
      const displayName = gestionUser.display_name || gestionUser.username;
      updateData.firstName = displayName;

      proxyEmployee = (await db.update(employeesTable)
        .set(updateData)
        .where(eq(employeesTable.id, proxyEmployee.id))
        .returning()
        .then(rows => rows[0])) || proxyEmployee;
    }
  }

  await db.insert(gestionAdminLinks).values({
    gestionUserId: gestionUser.id,
    gestionUsername: gestionUser.username,
    gestionRole: gestionUser.role,
    fichajesRole,
    employeeId: proxyEmployee.id,
    lastLoginAt: new Date(),
  }).onConflictDoUpdate({
    target: gestionAdminLinks.gestionUserId,
    set: {
      gestionUsername: gestionUser.username,
      gestionRole: gestionUser.role,
      fichajesRole,
      lastLoginAt: new Date(),
    },
  });

  const linkResult = await db.select({ disabled: gestionAdminLinks.disabled })
    .from(gestionAdminLinks)
    .where(eq(gestionAdminLinks.gestionUserId, gestionUser.id));

  if (linkResult.length > 0 && linkResult[0].disabled) {
    throw new Error("ACCESS_DISABLED");
  }

  const accessToken = generateGestionAccessToken(proxyEmployee.id, gestionUser.id, fichajesRole);
  const refreshToken = generateGestionRefreshToken(proxyEmployee.id, gestionUser.id, fichajesRole);

  await storage.createRefreshToken(proxyEmployee.id, refreshToken, getRefreshTokenExpiry());

  res.cookie("accessToken", accessToken, {
    ...ADMIN_COOKIE_OPTIONS,
    maxAge: 60 * 60 * 1000,
  });

  res.cookie("refreshToken", refreshToken, {
    ...ADMIN_COOKIE_OPTIONS,
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });

  await storage.createAuditLog({
    action: auditAction as any,
    actorId: proxyEmployee.id,
    targetType: "session",
    targetId: proxyEmployee.id,
    details: JSON.stringify({ role: fichajesRole, method: auditMethod, gestionUserId: gestionUser.id, gestionUsername: gestionUser.username }),
    ipAddress,
  });

  return { proxyEmployee, fichajesRole, accessToken, refreshToken };
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
  if (payload.source === "gestion_users" && payload.gestionUserId) {
    req.gestionUserId = payload.gestionUserId;
  }
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
