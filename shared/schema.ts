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

export const punchStatusEnum = pgEnum("punch_status", ["PENDING_SIGNATURE", "SIGNED"]);

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
  signatureUrl: text("signature_url"),
  signatureSha256: text("signature_sha256"),
  signatureSignedAt: timestamp("signature_signed_at"),
  signatureData: text("signature_data"),
  kioskDeviceId: text("kiosk_device_id"),
  kioskUserAgent: text("kiosk_user_agent"),
  kioskIp: text("kiosk_ip"),
  status: punchStatusEnum("status").notNull().default("SIGNED"),
});

export const kioskDevices = pgTable("kiosk_devices", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  tokenHash: text("token_hash").notNull(),
  enabled: boolean("enabled").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  lastUsedAt: timestamp("last_used_at"),
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

export const punchReviews = pgTable("punch_reviews", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  punchId: varchar("punch_id").notNull().references(() => punches.id),
  reviewedById: varchar("reviewed_by_id").notNull().references(() => employees.id),
  reviewedAt: timestamp("reviewed_at").notNull().defaultNow(),
  note: text("note"),
});

export const auditActionEnum = pgEnum("audit_action", ["correction", "review", "create", "login", "export", "overtime_create", "overtime_review"]);

export const overtimeStatusEnum = pgEnum("overtime_status", ["pending", "approved", "rejected"]);

export const overtimeRequests = pgTable("overtime_requests", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  employeeId: varchar("employee_id").notNull().references(() => employees.id),
  date: timestamp("date").notNull(),
  minutes: integer("minutes").notNull(),
  reason: text("reason").notNull().default("AUTO"),
  status: overtimeStatusEnum("status").notNull().default("pending"),
  reviewerId: varchar("reviewer_id").references(() => employees.id),
  reviewerComment: text("reviewer_comment"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  reviewedAt: timestamp("reviewed_at"),
});

export const auditLog = pgTable("audit_log", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  action: auditActionEnum("action").notNull(),
  actorId: varchar("actor_id").notNull().references(() => employees.id),
  targetType: text("target_type").notNull(),
  targetId: varchar("target_id").notNull(),
  details: text("details"),
  ipAddress: text("ip_address"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const employeesRelations = relations(employees, ({ many }) => ({
  punches: many(punches),
  corrections: many(punchCorrections, { relationName: "correctedBy" }),
  refreshTokens: many(refreshTokens),
  reviews: many(punchReviews, { relationName: "reviewedBy" }),
  auditLogs: many(auditLog, { relationName: "actor" }),
  overtimeRequests: many(overtimeRequests, { relationName: "employeeOvertime" }),
  overtimeReviews: many(overtimeRequests, { relationName: "overtimeReviewer" }),
}));

export const overtimeRequestsRelations = relations(overtimeRequests, ({ one }) => ({
  employee: one(employees, {
    fields: [overtimeRequests.employeeId],
    references: [employees.id],
    relationName: "employeeOvertime",
  }),
  reviewer: one(employees, {
    fields: [overtimeRequests.reviewerId],
    references: [employees.id],
    relationName: "overtimeReviewer",
  }),
}));

export const punchesRelations = relations(punches, ({ one, many }) => ({
  employee: one(employees, {
    fields: [punches.employeeId],
    references: [employees.id],
  }),
  corrections: many(punchCorrections),
  reviews: many(punchReviews),
}));

export const punchReviewsRelations = relations(punchReviews, ({ one }) => ({
  punch: one(punches, {
    fields: [punchReviews.punchId],
    references: [punches.id],
  }),
  reviewedBy: one(employees, {
    fields: [punchReviews.reviewedById],
    references: [employees.id],
    relationName: "reviewedBy",
  }),
}));

export const auditLogRelations = relations(auditLog, ({ one }) => ({
  actor: one(employees, {
    fields: [auditLog.actorId],
    references: [employees.id],
    relationName: "actor",
  }),
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
}).extend({
  pin: z.string().length(6, "El PIN debe tener exactamente 6 dígitos").regex(/^\d{6}$/, "El PIN debe contener solo números"),
});

export const loginSchema = z.object({
  email: z.string().email("Email inválido"),
  password: z.string().min(6, "La contraseña debe tener al menos 6 caracteres"),
});

export const employeeLoginSchema = z.object({
  pin: z.string().length(6, "El PIN debe contener 6 dígitos"),
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
  signatureData: z.string().min(1, "La firma es obligatoria"),
});

export const correctionRequestSchema = z.object({
  originalPunchId: z.string().uuid(),
  reason: z.string().min(10, "El motivo debe contener al menos 10 caracteres"),
  newTimestamp: z.string().datetime().optional(),
  newType: z.enum(["IN", "OUT"]).optional(),
});

export const exportQuerySchema = z.object({
  employeeId: z.string().uuid().optional(),
  startDate: z.string(),
  endDate: z.string(),
});

export const insertPunchReviewSchema = createInsertSchema(punchReviews).omit({
  id: true,
  reviewedAt: true,
});

export const insertAuditLogSchema = createInsertSchema(auditLog).omit({
  id: true,
  createdAt: true,
});

export const reviewRequestSchema = z.object({
  note: z.string().optional(),
});

export const insertOvertimeRequestSchema = createInsertSchema(overtimeRequests).omit({
  id: true,
  createdAt: true,
  reviewedAt: true,
});

export const overtimeReviewRequestSchema = z.object({
  status: z.enum(["approved", "rejected"]),
  comment: z.string().min(5, "El comentario debe contener al menos 5 caracteres"),
});

export const insertKioskDeviceSchema = createInsertSchema(kioskDevices).omit({
  id: true,
  createdAt: true,
  lastUsedAt: true,
});

export const kioskPunchRequestSchema = z.object({
  type: z.enum(["IN", "OUT"]),
  latitude: z.number().optional(),
  longitude: z.number().optional(),
  accuracy: z.number().optional(),
  signatureData: z.string().min(1, "La firma es obligatoria"),
});

export const signatureUploadSchema = z.object({
  punchId: z.string().uuid(),
});

export const updateEmployeeSchema = z.object({
  firstName: z.string().min(1, "El nombre es obligatorio").optional(),
  lastName: z.string().min(1, "El apellido es obligatorio").optional(),
  email: z.string().email("Email inválido").optional(),
  pin: z.string().length(6, "El PIN debe tener 6 dígitos").regex(/^\d{6}$/, "El PIN debe contener solo números").optional().nullable(),
  role: z.enum(["admin", "manager", "employee"]).optional(),
  isActive: z.boolean().optional(),
  password: z.string().min(6, "La contraseña debe tener al menos 6 caracteres").optional(),
});

export const correctPunchSchema = z.object({
  reason: z.string().min(10, "El motivo debe tener al menos 10 caracteres"),
  newTimestamp: z.string().datetime({ message: "Formato de fecha/hora inválido" }).optional(),
  newType: z.enum(["IN", "OUT"]).optional(),
});

export const kioskDeviceSchema = z.object({
  name: z.string().min(1, "El nombre es obligatorio").max(100, "El nombre es demasiado largo"),
});

export const updateKioskDeviceSchema = z.object({
  name: z.string().min(1, "El nombre es obligatorio").max(100).optional(),
  enabled: z.boolean().optional(),
});

export type Employee = typeof employees.$inferSelect;
export type InsertEmployee = z.infer<typeof insertEmployeeSchema>;
export type Punch = typeof punches.$inferSelect;
export type InsertPunch = z.infer<typeof insertPunchSchema>;
export type PunchCorrection = typeof punchCorrections.$inferSelect;
export type InsertPunchCorrection = z.infer<typeof insertPunchCorrectionSchema>;
export type RefreshToken = typeof refreshTokens.$inferSelect;
export type PunchReview = typeof punchReviews.$inferSelect;
export type InsertPunchReview = z.infer<typeof insertPunchReviewSchema>;
export type AuditLog = typeof auditLog.$inferSelect;
export type InsertAuditLog = z.infer<typeof insertAuditLogSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type EmployeeLoginInput = z.infer<typeof employeeLoginSchema>;
export type PunchRequest = z.infer<typeof punchRequestSchema>;
export type CorrectionRequest = z.infer<typeof correctionRequestSchema>;
export type ExportQuery = z.infer<typeof exportQuerySchema>;
export type ReviewRequest = z.infer<typeof reviewRequestSchema>;
export type OvertimeRequest = typeof overtimeRequests.$inferSelect;
export type InsertOvertimeRequest = z.infer<typeof insertOvertimeRequestSchema>;
export type OvertimeReviewRequest = z.infer<typeof overtimeReviewRequestSchema>;
export type KioskDevice = typeof kioskDevices.$inferSelect;
export type InsertKioskDevice = z.infer<typeof insertKioskDeviceSchema>;
export type KioskPunchRequest = z.infer<typeof kioskPunchRequestSchema>;
