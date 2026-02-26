#!/usr/bin/env tsx
/**
 * Production startup script with optional database migrations.
 * 
 * Usage:
 *   RUN_DB_MIGRATIONS=true npm run start:prod  # Run migrations then start
 *   npm run start:prod                          # Start without migrations
 * 
 * For DigitalOcean App Platform:
 *   - Set RUN_DB_MIGRATIONS=true only for the first deployment
 *   - After initial deployment, remove the variable or set to false
 */

import { spawn, execSync } from "child_process";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, "..");

const shouldRunMigrations = process.env.RUN_DB_MIGRATIONS === "true";

async function runMigrations(): Promise<void> {
  console.log("🔄 Running database migrations (drizzle-kit push)...");
  
  try {
    execSync("npx drizzle-kit push --force", {
      cwd: rootDir,
      stdio: "inherit",
      env: process.env,
    });
    console.log("✅ Database migrations completed successfully");
  } catch (error) {
    console.error("❌ Database migrations failed:", error);
    process.exit(1);
  }
}

async function startServer(): Promise<void> {
  console.log("🚀 Starting production server...");
  
  const serverProcess = spawn("node", ["dist/index.cjs"], {
    cwd: rootDir,
    stdio: "inherit",
    env: {
      ...process.env,
      NODE_ENV: "production",
    },
  });

  serverProcess.on("error", (error) => {
    console.error("❌ Server failed to start:", error);
    process.exit(1);
  });

  serverProcess.on("exit", (code) => {
    process.exit(code ?? 0);
  });

  // Handle graceful shutdown
  const shutdown = () => {
    console.log("\n🛑 Shutting down gracefully...");
    serverProcess.kill("SIGTERM");
  };

  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

async function main(): Promise<void> {
  console.log("═══════════════════════════════════════════");
  console.log("  Cronos Fichajes - Production Startup");
  console.log("═══════════════════════════════════════════");
  console.log(`  Environment: ${process.env.NODE_ENV || "production"}`);
  console.log(`  Migrations: ${shouldRunMigrations ? "ENABLED" : "disabled"}`);
  console.log("═══════════════════════════════════════════\n");

  if (shouldRunMigrations) {
    await runMigrations();
  }

  await startServer();
}

main().catch((error) => {
  console.error("❌ Startup failed:", error);
  process.exit(1);
});
