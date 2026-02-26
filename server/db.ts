import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "@shared/schema";

pg.types.setTypeParser(1114, (str: string) => new Date(str + "+00"));

const { Pool } = pg;

const rawUrl = (process.env.DATABASE_URL || "").trim();

if (!rawUrl) {
  console.error("[PG-URL][FATAL] DATABASE_URL is missing or empty. The application cannot start.");
  console.error("[PG-URL][FATAL] Set DATABASE_URL in environment variables (e.g. postgresql://user:pass@host:port/dbname?sslmode=require)");
  process.exit(1);
}

if (!/^postgres(ql)?:\/\//i.test(rawUrl)) {
  console.error(`[PG-URL][FATAL] DATABASE_URL does not start with postgresql:// or postgres://`);
  console.error(`[PG-URL][FATAL] Received value starts with: "${rawUrl.substring(0, 12).replace(/:.*/, ":***")}..."`);
  process.exit(1);
}

function maskUrl(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.password) {
      parsed.password = "***";
    }
    return parsed.toString();
  } catch {
    return url.replace(/:([^@/]+)@/, ":***@");
  }
}

const isProd = process.env.NODE_ENV === "production";
const hasSslInUrl = /[?&](sslmode=require|ssl=true)/i.test(rawUrl);

let cleanDbUrl: string;
try {
  const parsed = new URL(rawUrl);
  parsed.searchParams.delete("sslmode");
  parsed.searchParams.delete("ssl");
  cleanDbUrl = parsed.toString();
} catch {
  cleanDbUrl = rawUrl
    .replace(/[?&]sslmode=require/gi, (match) => match.startsWith("?") ? "?" : "")
    .replace(/[?&]ssl=true/gi, (match) => match.startsWith("?") ? "?" : "")
    .replace(/\?&/, "?")
    .replace(/\?$/, "");
}

if (!cleanDbUrl || !/^postgres(ql)?:\/\//i.test(cleanDbUrl)) {
  console.error("[PG-URL][FATAL] DATABASE_URL became invalid after SSL parameter cleanup.");
  console.error(`[PG-URL][FATAL] Original (masked): ${maskUrl(rawUrl)}`);
  console.error(`[PG-URL][FATAL] Cleaned result: empty or malformed`);
  process.exit(1);
}

let ssl: pg.PoolConfig["ssl"];
let sslMode: string;

if (isProd || hasSslInUrl) {
  ssl = { rejectUnauthorized: false };
  sslMode = "encrypted-no-verify";
} else {
  ssl = undefined;
  sslMode = "disabled";
}

console.log(`[PG-URL] masked=${maskUrl(cleanDbUrl)}`);
console.log(`[PG-SSL] env=${process.env.NODE_ENV || "development"} sslmode=${hasSslInUrl} urlCleaned=${rawUrl !== cleanDbUrl} mode=${sslMode}`);

export const pool = new Pool({
  connectionString: cleanDbUrl,
  ssl,
  options: "-c timezone=UTC",
  max: 10,
  connectionTimeoutMillis: 5000,
  idleTimeoutMillis: 30000,
});

pool.on("error", (err) => {
  console.error("[PG-POOL] unexpected pool error:", err.message);
});

export const db = drizzle(pool, { schema });
