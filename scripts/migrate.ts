import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

if (!process.env.DATABASE_URL) {
  console.error("[MIGRATE] DATABASE_URL no está definido");
  process.exit(1);
}

const dbUrl = process.env.DATABASE_URL;
const hasSslInUrl = /[?&](sslmode=require|ssl=true)/i.test(dbUrl);
const isProd = process.env.NODE_ENV === "production";

const cleanDbUrl = dbUrl
  .replace(/[?&]sslmode=require/gi, (match) => match.startsWith("?") ? "?" : "")
  .replace(/[?&]ssl=true/gi, (match) => match.startsWith("?") ? "?" : "")
  .replace(/\?&/, "?")
  .replace(/\?$/, "");

let ssl: pg.PoolConfig["ssl"];
if (isProd || hasSslInUrl) {
  ssl = { rejectUnauthorized: false };
} else {
  ssl = undefined;
}

async function runMigrations() {
  console.log(`[MIGRATE] Conectando a la base de datos...`);
  console.log(`[MIGRATE] env=${process.env.NODE_ENV || "development"} ssl=${!!ssl}`);

  const pool = new pg.Pool({
    connectionString: cleanDbUrl,
    ssl,
    options: "-c timezone=UTC",
    max: 1,
  });

  const db = drizzle(pool);
  const migrationsFolder = path.resolve(__dirname, "..", "migrations");

  console.log(`[MIGRATE] Carpeta de migraciones: ${migrationsFolder}`);

  try {
    await migrate(db, { migrationsFolder });
    console.log("[MIGRATE] Migraciones aplicadas correctamente ✓");
  } catch (error) {
    console.error("[MIGRATE] Error al aplicar migraciones:", error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

runMigrations();
