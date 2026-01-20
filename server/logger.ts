import pino from "pino";

const sensitiveKeys = [
  "password",
  "token",
  "secret",
  "authorization",
  "cookie",
  "session",
  "jwt",
  "api_key",
  "apikey",
  "pin",
];

function maskSensitive(obj: unknown): unknown {
  if (obj === null || obj === undefined) {
    return obj;
  }

  if (typeof obj === "string") {
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map(maskSensitive);
  }

  if (typeof obj === "object") {
    const masked: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      const lowerKey = key.toLowerCase();
      const isSensitive = sensitiveKeys.some((sk) => lowerKey.includes(sk));
      masked[key] = isSensitive ? "[REDACTED]" : maskSensitive(value);
    }
    return masked;
  }

  return obj;
}

const transport =
  process.env.NODE_ENV === "production"
    ? undefined
    : {
        target: "pino-pretty",
        options: {
          colorize: true,
          translateTime: "HH:MM:ss",
          ignore: "pid,hostname",
        },
      };

export const logger = pino({
  level: process.env.LOG_LEVEL || "info",
  transport,
  formatters: {
    log(obj) {
      return maskSensitive(obj) as Record<string, unknown>;
    },
  },
});

export function logInfo(message: string, data?: Record<string, unknown>) {
  if (data) {
    logger.info(maskSensitive(data), message);
  } else {
    logger.info(message);
  }
}

export function logError(message: string, error?: unknown, data?: Record<string, unknown>) {
  const errorData = {
    ...data,
    error: error instanceof Error ? { message: error.message, stack: error.stack } : error,
  };
  logger.error(maskSensitive(errorData), message);
}

export function logWarn(message: string, data?: Record<string, unknown>) {
  if (data) {
    logger.warn(maskSensitive(data), message);
  } else {
    logger.warn(message);
  }
}

export function logDebug(message: string, data?: Record<string, unknown>) {
  if (data) {
    logger.debug(maskSensitive(data), message);
  } else {
    logger.debug(message);
  }
}
