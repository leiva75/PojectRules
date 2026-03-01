import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "@shared/schema";
import fs from "fs";
import path from "path";

pg.types.setTypeParser(1114, (str: string) => new Date(str + "+00"));

const { Pool } = pg;

const rawUrl = (process.env.EXTERNAL_DATABASE_URL || process.env.DATABASE_URL || "").trim();
const urlSource = process.env.EXTERNAL_DATABASE_URL ? "EXTERNAL_DATABASE_URL" : "DATABASE_URL";

if (!rawUrl) {
  console.error("[PG-URL][FATAL] Neither EXTERNAL_DATABASE_URL nor DATABASE_URL is set. The application cannot start.");
  console.error("[PG-URL][FATAL] Set DATABASE_URL in environment variables (e.g. postgresql://user:pass@host:port/dbname?sslmode=require)");
  process.exit(1);
}

if (!/^postgres(ql)?:\/\//i.test(rawUrl)) {
  console.error(`[PG-URL][FATAL] ${urlSource} does not start with postgresql:// or postgres://`);
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
const isDigitalOcean = /\.db\.ondigitalocean\.com/i.test(rawUrl);

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

const caPaths = [
  path.resolve(process.cwd(), "certs/ca-certificate.crt"),
  path.resolve(process.cwd(), "certs/do-ca-certificate.crt"),
];
const caPath = caPaths.find((p) => fs.existsSync(p));

if (caPath) {
  const ca = fs.readFileSync(caPath, "utf-8");
  ssl = { ca, rejectUnauthorized: true };
  sslMode = "encrypted-ca-verified";
} else if (isProd || hasSslInUrl || isDigitalOcean) {
  ssl = { rejectUnauthorized: false };
  sslMode = "encrypted-no-verify";
} else {
  ssl = undefined;
  sslMode = "disabled";
}

console.log(`[PG-URL] source=${urlSource} masked=${maskUrl(cleanDbUrl)}`);
console.log(`[PG-SSL] env=${process.env.NODE_ENV || "development"} digitalocean=${isDigitalOcean} sslInUrl=${hasSslInUrl} caFile=${caPath ? path.basename(caPath) : "none"} mode=${sslMode}`);

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
