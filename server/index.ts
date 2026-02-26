process.env.TZ = "UTC";

import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { serveStatic } from "./static";
import { createServer } from "http";
import helmet from "helmet";
import cors from "cors";
import cookieParser from "cookie-parser";
import { logger, logInfo, logError } from "./logger";
import { ApiError } from "./errors";
import { initSpaces, isSpacesConfigured } from "./spaces";
import { verifyTimezoneSupport } from "./timezone";

const tzCheck = verifyTimezoneSupport();
if (tzCheck.ok) {
  console.log(`[TZ-CHECK][OK] ${tzCheck.details}`);
} else {
  console.error(`[TZ-CHECK][FAIL] ${tzCheck.details}`);
}

const buildTime = process.env.BUILD_TIME || new Date().toISOString();
const gitSha = process.env.GIT_SHA || process.env.COMMIT_SHA || process.env.VERCEL_GIT_COMMIT_SHA || "unknown";
console.log(`[PDF-BUILD] buildTime=${buildTime} gitSha=${gitSha} node=${process.version} env=${process.env.NODE_ENV || "development"}`);

const isProd = process.env.NODE_ENV === "production";

function validateConfig() {
  const errors: string[] = [];

  if (!process.env.DATABASE_URL) {
    errors.push("DATABASE_URL es obligatorio");
  }

  if (isProd) {
    if (!process.env.JWT_ACCESS_SECRET) {
      errors.push("JWT_ACCESS_SECRET es obligatorio en producción");
    } else if (process.env.JWT_ACCESS_SECRET.length < 32) {
      errors.push("JWT_ACCESS_SECRET debe tener al menos 32 caracteres");
    }

    if (!process.env.JWT_REFRESH_SECRET) {
      errors.push("JWT_REFRESH_SECRET es obligatorio en producción");
    } else if (process.env.JWT_REFRESH_SECRET.length < 32) {
      errors.push("JWT_REFRESH_SECRET debe tener al menos 32 caracteres");
    }

    if (!process.env.CORS_ORIGIN) {
      errors.push("CORS_ORIGIN es obligatorio en producción");
    } else if (process.env.CORS_ORIGIN === "*") {
      errors.push("CORS_ORIGIN no puede ser '*' en producción");
    }

    if (!process.env.KIOSK_KEY) {
      errors.push("KIOSK_KEY es obligatorio en producción");
    } else if (process.env.KIOSK_KEY.length < 16) {
      errors.push("KIOSK_KEY debe tener al menos 16 caracteres");
    }
  }

  if (errors.length > 0) {
    logger.error({ errors }, "Error de configuración - la aplicación no puede iniciar");
    process.exit(1);
  }

  const envStatus = {
    DATABASE_URL: !!process.env.DATABASE_URL,
    JWT_ACCESS_SECRET: !!process.env.JWT_ACCESS_SECRET,
    JWT_REFRESH_SECRET: !!process.env.JWT_REFRESH_SECRET,
    CORS_ORIGIN: process.env.CORS_ORIGIN || "(not set — defaults to allow all)",
    KIOSK_KEY: !!process.env.KIOSK_KEY,
    DO_SPACES_KEY: !!process.env.DO_SPACES_KEY,
    NODE_ENV: process.env.NODE_ENV || "development",
  };
  logInfo("Configuración validada correctamente", { env: isProd ? "production" : "development", vars: envStatus });
}

validateConfig();

if (isSpacesConfigured()) {
  initSpaces();
}

const app = express();
const httpServer = createServer(app);

// Trust proxy for PaaS deployments (Render, Heroku, DigitalOcean, Replit, etc.)
// Required for correct client IP detection behind load balancers
// Also enabled in dev for Replit which proxies requests
app.set("trust proxy", 1);

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

app.use(
  helmet({
    contentSecurityPolicy: isProd ? undefined : false,
  })
);

// Health check endpoint for PaaS platforms
app.get("/health", (_req, res) => {
  res.status(200).json({ 
    status: "ok", 
    timestamp: new Date().toISOString(),
    version: process.env.npm_package_version || "1.0.0"
  });
});

const corsOrigin = process.env.CORS_ORIGIN || true;
app.use(
  cors({
    origin: corsOrigin,
    credentials: true,
    allowedHeaders: ["Content-Type", "Authorization", "X-KIOSK-TOKEN"],
    exposedHeaders: ["Content-Disposition"],
  })
);

app.use(cookieParser());

// Payload limits: 10MB to accommodate base64 signatures and PDF data
app.use(
  express.json({
    limit: "10mb",
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  })
);

app.use(express.urlencoded({ extended: false, limit: "10mb" }));

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      logInfo(`${req.method} ${path} ${res.statusCode} in ${duration}ms`);
    }
  });

  next();
});

export const cookieOptions = {
  httpOnly: true,
  secure: isProd,
  sameSite: (isProd ? "strict" : "lax") as "strict" | "lax",
};

(async () => {
  await registerRoutes(httpServer, app);

  app.use((err: unknown, _req: Request, res: Response, next: NextFunction) => {
    if (err instanceof ApiError) {
      return res.status(err.statusCode).json(err.toResponse());
    }

    const status = (err as { status?: number; statusCode?: number }).status ||
      (err as { status?: number; statusCode?: number }).statusCode || 500;
    const message = (err as Error).message || "Error interno del servidor";

    logError("Error interno del servidor", err);

    if (res.headersSent) {
      return next(err);
    }

    return res.status(status).json({
      error: {
        code: "INTERNAL_ERROR",
        message: isProd ? "Error interno del servidor" : message,
      },
    });
  });

  if (isProd) {
    serveStatic(app);
  } else {
    const { setupVite } = await import("./vite");
    await setupVite(httpServer, app);
  }

  const port = parseInt(process.env.PORT || "5000", 10);
  httpServer.listen(
    {
      port,
      host: "0.0.0.0",
      reusePort: true,
    },
    () => {
      logInfo(`Servidor iniciado en puerto ${port}`, {
        env: process.env.NODE_ENV || "development",
        port,
      });
    }
  );
})();
