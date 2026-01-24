import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { serveStatic } from "./static";
import { createServer } from "http";
import helmet from "helmet";
import cors from "cors";
import cookieParser from "cookie-parser";
import { logger, logInfo, logError } from "./logger";
import { ApiError } from "./errors";

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

  logInfo("Configuración validada correctamente", { env: isProd ? "production" : "development" });
}

validateConfig();

const app = express();
const httpServer = createServer(app);

// Trust proxy for PaaS deployments (Render, Heroku, etc.)
// Required for correct client IP detection behind load balancers
if (isProd) {
  app.set("trust proxy", 1);
}

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
  })
);

app.use(cookieParser());

app.use(
  express.json({
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  })
);

app.use(express.urlencoded({ extended: false }));

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
