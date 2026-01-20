import { sql, relations } from "drizzle-orm";
import { pgTable, text, varchar, timestamp, boolean, decimal, integer, pgEnum } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const roleEnum = pgEnum("role", ["admin", "manager", "employee"]);
export const punchTypeEnum = pgEnum("punch_type", ["IN", "OUT"]);

export const employees = pgTable("employees", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  email: text("email").notNull().unique(),
  password: text("password").notNull(),
  firstName: text("first_name").notNull(),
  lastName: text("last_name").notNull(),
  role: roleEnum("role").notNull().default("employee"),
  pin: varchar("pin", { length: 6 }),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const punches = pgTable("punches", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  employeeId: varchar("employee_id").notNull().references(() => employees.id),
  type: punchTypeEnum("type").notNull(),
  timestamp: timestamp("timestamp").notNull().defaultNow(),
  latitude: decimal("latitude", { precision: 9, scale: 4 }),
  longitude: decimal("longitude", { precision: 9, scale: 4 }),
  accuracy: decimal("accuracy", { precision: 10, scale: 2 }),
  needsReview: boolean("needs_review").notNull().default(false),
  source: text("source").notNull().default("mobile"),
});

export const punchCorrections = pgTable("punch_corrections", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  originalPunchId: varchar("original_punch_id").notNull().references(() => punches.id),
  correctedById: varchar("corrected_by_id").notNull().references(() => employees.id),
  reason: text("reason").notNull(),
  newTimestamp: timestamp("new_timestamp"),
  newType: punchTypeEnum("new_type"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const refreshTokens = pgTable("refresh_tokens", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  employeeId: varchar("employee_id").notNull().references(() => employees.id),
  token: text("token").notNull().unique(),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const employeesRelations = relations(employees, ({ many }) => ({
  punches: many(punches),
  corrections: many(punchCorrections, { relationName: "correctedBy" }),
  refreshTokens: many(refreshTokens),
}));

export const punchesRelations = relations(punches, ({ one, many }) => ({
  employee: one(employees, {
    fields: [punches.employeeId],
    references: [employees.id],
  }),
  corrections: many(punchCorrections),
}));

export const punchCorrectionsRelations = relations(punchCorrections, ({ one }) => ({
  originalPunch: one(punches, {
    fields: [punchCorrections.originalPunchId],
    references: [punches.id],
  }),
  correctedBy: one(employees, {
    fields: [punchCorrections.correctedById],
    references: [employees.id],
    relationName: "correctedBy",
  }),
}));

export const refreshTokensRelations = relations(refreshTokens, ({ one }) => ({
  employee: one(employees, {
    fields: [refreshTokens.employeeId],
    references: [employees.id],
  }),
}));

export const insertEmployeeSchema = createInsertSchema(employees).omit({
  id: true,
  createdAt: true,
});

export const loginSchema = z.object({
  email: z.string().email("Email invalide"),
  password: z.string().min(6, "Le mot de passe doit contenir au moins 6 caractères"),
});

export const employeeLoginSchema = z.object({
  pin: z.string().length(6, "Le PIN doit contenir 6 chiffres"),
});

export const insertPunchSchema = createInsertSchema(punches).omit({
  id: true,
  timestamp: true,
});

export const insertPunchCorrectionSchema = createInsertSchema(punchCorrections).omit({
  id: true,
  createdAt: true,
});

export const punchRequestSchema = z.object({
  type: z.enum(["IN", "OUT"]),
  latitude: z.number().optional(),
  longitude: z.number().optional(),
  accuracy: z.number().optional(),
  source: z.enum(["mobile", "kiosk"]).default("mobile"),
});

export const correctionRequestSchema = z.object({
  originalPunchId: z.string().uuid(),
  reason: z.string().min(10, "La raison doit contenir au moins 10 caractères"),
  newTimestamp: z.string().datetime().optional(),
  newType: z.enum(["IN", "OUT"]).optional(),
});

export const exportQuerySchema = z.object({
  employeeId: z.string().uuid().optional(),
  startDate: z.string(),
  endDate: z.string(),
});

export type Employee = typeof employees.$inferSelect;
export type InsertEmployee = z.infer<typeof insertEmployeeSchema>;
export type Punch = typeof punches.$inferSelect;
export type InsertPunch = z.infer<typeof insertPunchSchema>;
export type PunchCorrection = typeof punchCorrections.$inferSelect;
export type InsertPunchCorrection = z.infer<typeof insertPunchCorrectionSchema>;
export type RefreshToken = typeof refreshTokens.$inferSelect;
export type LoginInput = z.infer<typeof loginSchema>;
export type EmployeeLoginInput = z.infer<typeof employeeLoginSchema>;
export type PunchRequest = z.infer<typeof punchRequestSchema>;
export type CorrectionRequest = z.infer<typeof correctionRequestSchema>;
export type ExportQuery = z.infer<typeof exportQuerySchema>;
