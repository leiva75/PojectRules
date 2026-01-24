import { Request, Response, NextFunction } from "express";
import { createHash, randomBytes } from "crypto";
import { storage } from "./storage";
import { logInfo, logError } from "./logger";
import type { KioskDevice } from "@shared/schema";

declare global {
  namespace Express {
    interface Request {
      kioskDevice?: KioskDevice;
    }
  }
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function generateKioskToken(): string {
  return randomBytes(32).toString("hex");
}

export async function authenticateKiosk(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const token = req.headers["x-kiosk-token"];

  if (!token || typeof token !== "string") {
    logInfo("Kiosk auth failed: missing token", { ip: req.ip });
    res.status(403).json({
      error: {
        code: "KIOSK_REQUIRED",
        message: "Token de quiosco requerido",
      },
    });
    return;
  }

  try {
    const tokenHash = hashToken(token);
    const device = await storage.getKioskDeviceByTokenHash(tokenHash);

    if (!device) {
      logInfo("Kiosk auth failed: invalid token", { ip: req.ip });
      res.status(403).json({
        error: {
          code: "KIOSK_INVALID_TOKEN",
          message: "Token de quiosco inválido",
        },
      });
      return;
    }

    if (!device.enabled) {
      logInfo("Kiosk auth failed: device disabled", { deviceId: device.id, ip: req.ip });
      res.status(403).json({
        error: {
          code: "KIOSK_DISABLED",
          message: "Dispositivo quiosco deshabilitado",
        },
      });
      return;
    }

    await storage.updateKioskDeviceLastUsed(device.id);

    req.kioskDevice = device;
    next();
  } catch (error) {
    logError("Kiosk auth error", error);
    res.status(500).json({
      error: {
        code: "KIOSK_AUTH_ERROR",
        message: "Error de autenticación del quiosco",
      },
    });
  }
}

export function getClientIp(req: Request): string {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string") {
    return forwarded.split(",")[0].trim();
  }
  return req.ip || req.socket.remoteAddress || "unknown";
}
