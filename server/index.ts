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

  if (!process.env.SESSION_SECRET) {
    errors.push("SESSION_SECRET es obligatorio");
  } else if (process.env.SESSION_SECRET.length < 32) {
    errors.push("SESSION_SECRET debe tener al menos 32 caracteres");
  }

  if (isProd && !process.env.CORS_ORIGIN) {
    errors.push("CORS_ORIGIN es obligatorio en producción");
  }

  if (!process.env.DATABASE_URL) {
    errors.push("DATABASE_URL es obligatorio");
  }

  if (errors.length > 0) {
    logger.error({ errors }, "Error de configuración - la aplicación no puede iniciar");
    process.exit(1);
  }

  logInfo("Configuración validada correctamente");
}

validateConfig();

const app = express();
const httpServer = createServer(app);

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
