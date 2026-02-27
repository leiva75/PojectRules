import { 
  employees, punches, punchCorrections, refreshTokens, punchReviews, auditLog, overtimeRequests, kioskDevices,
  type Employee, type InsertEmployee, 
  type Punch, type InsertPunch,
  type PunchCorrection, type InsertPunchCorrection,
  type RefreshToken, type PunchReview, type InsertPunchReview,
  type AuditLog, type InsertAuditLog,
  type OvertimeRequest, type InsertOvertimeRequest,
  type KioskDevice, type InsertKioskDevice
} from "@shared/schema";
import { db } from "./db";
import { eq, desc, and, gte, lte, sql, isNull } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { startOfDayInSpain, endOfDayInSpain, toSpainDateKey } from "./timezone";

export interface IStorage {
  getEmployee(id: string): Promise<Employee | undefined>;
  getEmployeeByEmail(email: string): Promise<Employee | undefined>;
  getEmployeeByPin(pin: string): Promise<Employee | undefined>;
  getAllEmployees(): Promise<Employee[]>;
  createEmployee(employee: InsertEmployee): Promise<Employee>;
  updateEmployee(id: string, data: Partial<InsertEmployee>): Promise<Employee | undefined>;

  createPunch(punch: InsertPunch): Promise<Punch>;
  getPunchById(id: string): Promise<Punch | undefined>;
  getPunchesByEmployee(employeeId: string, limit?: number): Promise<Punch[]>;
  getLastPunchByEmployee(employeeId: string): Promise<Punch | undefined>;
  getAllPunches(options?: { limit?: number; needsReview?: boolean; startDate?: Date; endDate?: Date; employeeId?: string }): Promise<(Punch & { employee: { id: string; firstName: string; lastName: string } })[]>;
  getAllPunchesForExport(options?: { startDate?: Date; endDate?: Date; employeeId?: string; limit?: number }): Promise<(Punch & { employee: { id: string; firstName: string; lastName: string }; reviewed: boolean; corrected: boolean })[]>;
  getAllPunchesForReport(options: { startDate: Date; endDate: Date; employeeId?: string }): Promise<(Punch & { employee: { id: string; firstName: string; lastName: string } })[]>;

  createCorrection(correction: InsertPunchCorrection): Promise<PunchCorrection>;
  getCorrectionsByPunch(punchId: string): Promise<PunchCorrection[]>;

  createRefreshToken(employeeId: string, token: string, expiresAt: Date): Promise<RefreshToken>;
  getRefreshToken(token: string): Promise<RefreshToken | undefined>;
  deleteRefreshToken(token: string): Promise<void>;
  deleteRefreshTokensByEmployee(employeeId: string): Promise<void>;

  createPunchReview(review: InsertPunchReview): Promise<PunchReview>;
  getPunchReview(punchId: string): Promise<PunchReview | undefined>;
  getPunchesNeedingReview(): Promise<(Punch & { employee: { id: string; firstName: string; lastName: string }; reviewed: boolean; corrected: boolean })[]>;

  createAuditLog(log: InsertAuditLog): Promise<AuditLog>;
  getAuditLogs(options?: { limit?: number; targetType?: string; targetId?: string }): Promise<AuditLog[]>;

  createOvertimeRequest(request: InsertOvertimeRequest): Promise<OvertimeRequest>;
  getOvertimeRequestByDateAndEmployee(employeeId: string, date: Date): Promise<OvertimeRequest | undefined>;
  updateOvertimeRequest(id: string, data: Partial<InsertOvertimeRequest> & { reviewedAt?: Date }): Promise<OvertimeRequest | undefined>;
  getOvertimeRequests(options?: { status?: "pending" | "approved" | "rejected"; employeeId?: string; limit?: number }): Promise<(OvertimeRequest & { employee: { id: string; firstName: string; lastName: string }; reviewer?: { id: string; firstName: string; lastName: string } | null })[]>;
  getPunchesByEmployeeAndDate(employeeId: string, date: Date): Promise<Punch[]>;
  getPunchesByEmployeeAndDateRange(employeeId: string, startDate: Date, endDate: Date): Promise<Punch[]>;

  getStats(): Promise<{ totalEmployees: number; activeToday: number; currentlyIn: number; needsReview: number }>;

  createKioskDevice(device: InsertKioskDevice): Promise<KioskDevice>;
  getKioskDeviceByTokenHash(tokenHash: string): Promise<KioskDevice | undefined>;
  getKioskDevice(id: string): Promise<KioskDevice | undefined>;
  getAllKioskDevices(): Promise<KioskDevice[]>;
  updateKioskDevice(id: string, data: Partial<InsertKioskDevice>): Promise<KioskDevice | undefined>;
  updateKioskDeviceLastUsed(id: string): Promise<void>;
  deleteKioskDevice(id: string): Promise<void>;

  updatePunchSignature(punchId: string, data: { signatureUrl: string; signatureSha256: string; kioskDeviceId?: string; kioskUserAgent?: string; kioskIp?: string }): Promise<Punch | undefined>;

  getLastWorkPunch(employeeId: string): Promise<Punch | undefined>;
  getOpenBreaks(): Promise<Punch[]>;

  getCorrectionsInRange(options: { startDate: Date; endDate: Date; employeeId?: string }): Promise<CorrectionRecord[]>;
}

export interface CorrectionRecord {
  originalPunchId: string;
  originalTimestamp: Date;
  originalType: string;
  newTimestamp: Date | null;
  newType: string | null;
  reason: string;
  correctedByName: string;
  correctionDate: Date;
  employeeId: string;
  employeeName: string;
}

export class DatabaseStorage implements IStorage {
  async getEmployee(id: string): Promise<Employee | undefined> {
    const [employee] = await db.select().from(employees).where(eq(employees.id, id));
    return employee || undefined;
  }

  async getEmployeeByEmail(email: string): Promise<Employee | undefined> {
    const [employee] = await db.select().from(employees).where(eq(employees.email, email));
    return employee || undefined;
  }

  async getEmployeeByPin(pin: string): Promise<Employee | undefined> {
    const [employee] = await db.select().from(employees).where(eq(employees.pin, pin));
    return employee || undefined;
  }

  async getAllEmployees(): Promise<Employee[]> {
    return db.select().from(employees).orderBy(employees.lastName, employees.firstName);
  }

  async createEmployee(employee: InsertEmployee): Promise<Employee> {
    const [created] = await db.insert(employees).values(employee).returning();
    return created;
  }

  async updateEmployee(id: string, data: Partial<InsertEmployee>): Promise<Employee | undefined> {
    const [updated] = await db.update(employees).set(data).where(eq(employees.id, id)).returning();
    return updated || undefined;
  }

  async createPunch(punch: InsertPunch): Promise<Punch> {
    const [created] = await db.insert(punches).values(punch).returning();
    return created;
  }

  async getPunchById(id: string): Promise<Punch | undefined> {
    const [punch] = await db.select().from(punches).where(eq(punches.id, id));
    return punch || undefined;
  }

  async getPunchesByEmployee(employeeId: string, limit = 50): Promise<Punch[]> {
    return db.select().from(punches)
      .where(eq(punches.employeeId, employeeId))
      .orderBy(desc(punches.timestamp))
      .limit(limit);
  }

  async getLastPunchByEmployee(employeeId: string): Promise<Punch | undefined> {
    const [punch] = await db.select().from(punches)
      .where(eq(punches.employeeId, employeeId))
      .orderBy(desc(punches.timestamp))
      .limit(1);
    return punch || undefined;
  }

  async getAllPunches(options?: { limit?: number; needsReview?: boolean; startDate?: Date; endDate?: Date; employeeId?: string }) {
    const conditions = [];
    
    if (options?.needsReview !== undefined) {
      conditions.push(eq(punches.needsReview, options.needsReview));
    }
    if (options?.startDate) {
      conditions.push(gte(punches.timestamp, options.startDate));
    }
    if (options?.endDate) {
      conditions.push(lte(punches.timestamp, options.endDate));
    }
    if (options?.employeeId) {
      conditions.push(eq(punches.employeeId, options.employeeId));
    }

    const query = db
      .select({
        id: punches.id,
        employeeId: punches.employeeId,
        type: punches.type,
        timestamp: punches.timestamp,
        latitude: punches.latitude,
        longitude: punches.longitude,
        accuracy: punches.accuracy,
        needsReview: punches.needsReview,
        source: punches.source,
        status: punches.status,
        signatureUrl: punches.signatureUrl,
        signatureSha256: punches.signatureSha256,
        signatureSignedAt: punches.signatureSignedAt,
        signatureData: punches.signatureData,
        kioskDeviceId: punches.kioskDeviceId,
        kioskUserAgent: punches.kioskUserAgent,
        kioskIp: punches.kioskIp,
        isAuto: punches.isAuto,
        employee: {
          id: employees.id,
          firstName: employees.firstName,
          lastName: employees.lastName,
        },
      })
      .from(punches)
      .innerJoin(employees, eq(punches.employeeId, employees.id))
      .orderBy(desc(punches.timestamp));

    if (conditions.length > 0) {
      return query.where(and(...conditions)).limit(options?.limit || 100);
    }
    
    return query.limit(options?.limit || 100);
  }

  async getAllPunchesForExport(options?: { startDate?: Date; endDate?: Date; employeeId?: string; limit?: number }) {
    const conditions = [];
    
    if (options?.startDate) {
      conditions.push(gte(punches.timestamp, options.startDate));
    }
    if (options?.endDate) {
      conditions.push(lte(punches.timestamp, options.endDate));
    }
    if (options?.employeeId) {
      conditions.push(eq(punches.employeeId, options.employeeId));
    }

    const results = await db
      .select({
        id: punches.id,
        employeeId: punches.employeeId,
        type: punches.type,
        timestamp: punches.timestamp,
        latitude: punches.latitude,
        longitude: punches.longitude,
        accuracy: punches.accuracy,
        needsReview: punches.needsReview,
        source: punches.source,
        status: punches.status,
        signatureUrl: punches.signatureUrl,
        signatureSha256: punches.signatureSha256,
        signatureSignedAt: punches.signatureSignedAt,
        signatureData: punches.signatureData,
        kioskDeviceId: punches.kioskDeviceId,
        kioskUserAgent: punches.kioskUserAgent,
        kioskIp: punches.kioskIp,
        isAuto: punches.isAuto,
        employee: {
          id: employees.id,
          firstName: employees.firstName,
          lastName: employees.lastName,
        },
        reviewId: punchReviews.id,
        correctionId: punchCorrections.id,
      })
      .from(punches)
      .innerJoin(employees, eq(punches.employeeId, employees.id))
      .leftJoin(punchReviews, eq(punches.id, punchReviews.punchId))
      .leftJoin(punchCorrections, eq(punches.id, punchCorrections.originalPunchId))
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(punches.timestamp))
      .limit(options?.limit || 10000);

    return results.map(r => ({
      id: r.id,
      employeeId: r.employeeId,
      type: r.type,
      timestamp: r.timestamp,
      latitude: r.latitude,
      longitude: r.longitude,
      accuracy: r.accuracy,
      needsReview: r.needsReview,
      source: r.source,
      status: r.status,
      signatureUrl: r.signatureUrl,
      signatureSha256: r.signatureSha256,
      signatureSignedAt: r.signatureSignedAt,
      signatureData: r.signatureData,
      kioskDeviceId: r.kioskDeviceId,
      kioskUserAgent: r.kioskUserAgent,
      kioskIp: r.kioskIp,
      isAuto: r.isAuto,
      employee: r.employee,
      reviewed: r.reviewId !== null,
      corrected: r.correctionId !== null,
    }));
  }

  async getAllPunchesForReport(options: { startDate: Date; endDate: Date; employeeId?: string }) {
    const conditions = [
      gte(punches.timestamp, options.startDate),
      lte(punches.timestamp, options.endDate),
    ];
    
    if (options.employeeId) {
      conditions.push(eq(punches.employeeId, options.employeeId));
    }

    const results = await db
      .select({
        id: punches.id,
        employeeId: punches.employeeId,
        type: punches.type,
        timestamp: punches.timestamp,
        latitude: punches.latitude,
        longitude: punches.longitude,
        accuracy: punches.accuracy,
        needsReview: punches.needsReview,
        source: punches.source,
        signatureUrl: punches.signatureUrl,
        signatureData: punches.signatureData,
        signatureSignedAt: punches.signatureSignedAt,
        signatureSha256: punches.signatureSha256,
        kioskDeviceId: punches.kioskDeviceId,
        kioskUserAgent: punches.kioskUserAgent,
        kioskIp: punches.kioskIp,
        status: punches.status,
        isAuto: punches.isAuto,
        employee: {
          id: employees.id,
          firstName: employees.firstName,
          lastName: employees.lastName,
        },
      })
      .from(punches)
      .innerJoin(employees, eq(punches.employeeId, employees.id))
      .where(and(...conditions))
      .orderBy(employees.lastName, employees.firstName, punches.timestamp);

    return results;
  }

  async createCorrection(correction: InsertPunchCorrection): Promise<PunchCorrection> {
    const [created] = await db.insert(punchCorrections).values(correction).returning();
    return created;
  }

  async getCorrectionsByPunch(punchId: string): Promise<PunchCorrection[]> {
    return db.select().from(punchCorrections)
      .where(eq(punchCorrections.originalPunchId, punchId))
      .orderBy(desc(punchCorrections.createdAt));
  }

  async createRefreshToken(employeeId: string, token: string, expiresAt: Date): Promise<RefreshToken> {
    const [created] = await db.insert(refreshTokens).values({
      employeeId,
      token,
      expiresAt,
    }).returning();
    return created;
  }

  async getRefreshToken(token: string): Promise<RefreshToken | undefined> {
    const [refreshToken] = await db.select().from(refreshTokens).where(eq(refreshTokens.token, token));
    return refreshToken || undefined;
  }

  async deleteRefreshToken(token: string): Promise<void> {
    await db.delete(refreshTokens).where(eq(refreshTokens.token, token));
  }

  async deleteRefreshTokensByEmployee(employeeId: string): Promise<void> {
    await db.delete(refreshTokens).where(eq(refreshTokens.employeeId, employeeId));
  }

  async createPunchReview(review: InsertPunchReview): Promise<PunchReview> {
    const [created] = await db.insert(punchReviews).values(review).returning();
    return created;
  }

  async getPunchReview(punchId: string): Promise<PunchReview | undefined> {
    const [review] = await db.select().from(punchReviews).where(eq(punchReviews.punchId, punchId));
    return review || undefined;
  }

  async getPunchesNeedingReview() {
    const results = await db
      .select({
        id: punches.id,
        employeeId: punches.employeeId,
        type: punches.type,
        timestamp: punches.timestamp,
        latitude: punches.latitude,
        longitude: punches.longitude,
        accuracy: punches.accuracy,
        needsReview: punches.needsReview,
        source: punches.source,
        status: punches.status,
        signatureUrl: punches.signatureUrl,
        signatureSha256: punches.signatureSha256,
        signatureSignedAt: punches.signatureSignedAt,
        signatureData: punches.signatureData,
        kioskDeviceId: punches.kioskDeviceId,
        kioskUserAgent: punches.kioskUserAgent,
        kioskIp: punches.kioskIp,
        isAuto: punches.isAuto,
        employee: {
          id: employees.id,
          firstName: employees.firstName,
          lastName: employees.lastName,
        },
        reviewId: punchReviews.id,
        correctionId: punchCorrections.id,
      })
      .from(punches)
      .innerJoin(employees, eq(punches.employeeId, employees.id))
      .leftJoin(punchReviews, eq(punches.id, punchReviews.punchId))
      .leftJoin(punchCorrections, eq(punches.id, punchCorrections.originalPunchId))
      .where(eq(punches.needsReview, true))
      .orderBy(desc(punches.timestamp));

    return results.map(r => ({
      id: r.id,
      employeeId: r.employeeId,
      type: r.type,
      timestamp: r.timestamp,
      latitude: r.latitude,
      longitude: r.longitude,
      accuracy: r.accuracy,
      needsReview: r.needsReview,
      source: r.source,
      status: r.status,
      signatureUrl: r.signatureUrl,
      signatureSha256: r.signatureSha256,
      signatureSignedAt: r.signatureSignedAt,
      signatureData: r.signatureData,
      kioskDeviceId: r.kioskDeviceId,
      kioskUserAgent: r.kioskUserAgent,
      kioskIp: r.kioskIp,
      isAuto: r.isAuto,
      employee: r.employee,
      reviewed: r.reviewId !== null,
      corrected: r.correctionId !== null,
    }));
  }

  async createAuditLog(log: InsertAuditLog): Promise<AuditLog> {
    const [created] = await db.insert(auditLog).values(log).returning();
    return created;
  }

  async getAuditLogs(options?: { limit?: number; targetType?: string; targetId?: string }): Promise<AuditLog[]> {
    const conditions = [];
    if (options?.targetType) {
      conditions.push(eq(auditLog.targetType, options.targetType));
    }
    if (options?.targetId) {
      conditions.push(eq(auditLog.targetId, options.targetId));
    }

    const query = db.select().from(auditLog).orderBy(desc(auditLog.createdAt));
    
    if (conditions.length > 0) {
      return query.where(and(...conditions)).limit(options?.limit || 100);
    }
    return query.limit(options?.limit || 100);
  }

  async createOvertimeRequest(request: InsertOvertimeRequest): Promise<OvertimeRequest> {
    const [created] = await db.insert(overtimeRequests).values(request).returning();
    return created;
  }

  async getOvertimeRequestByDateAndEmployee(employeeId: string, date: Date): Promise<OvertimeRequest | undefined> {
    const startOfDay = startOfDayInSpain(date);
    const endOfDay = endOfDayInSpain(date);

    const [request] = await db.select().from(overtimeRequests)
      .where(and(
        eq(overtimeRequests.employeeId, employeeId),
        gte(overtimeRequests.date, startOfDay),
        lte(overtimeRequests.date, endOfDay)
      ));
    return request || undefined;
  }

  async updateOvertimeRequest(id: string, data: Partial<InsertOvertimeRequest> & { reviewedAt?: Date }): Promise<OvertimeRequest | undefined> {
    const [updated] = await db.update(overtimeRequests).set(data).where(eq(overtimeRequests.id, id)).returning();
    return updated || undefined;
  }

  async getOvertimeRequests(options?: { status?: "pending" | "approved" | "rejected"; employeeId?: string; limit?: number }) {
    const conditions = [];
    if (options?.status) {
      conditions.push(eq(overtimeRequests.status, options.status));
    }
    if (options?.employeeId) {
      conditions.push(eq(overtimeRequests.employeeId, options.employeeId));
    }

    const reviewerAlias = db.select({
      id: employees.id,
      firstName: employees.firstName,
      lastName: employees.lastName,
    }).from(employees).as("reviewer");

    const results = await db
      .select({
        id: overtimeRequests.id,
        employeeId: overtimeRequests.employeeId,
        date: overtimeRequests.date,
        minutes: overtimeRequests.minutes,
        reason: overtimeRequests.reason,
        status: overtimeRequests.status,
        reviewerId: overtimeRequests.reviewerId,
        reviewerComment: overtimeRequests.reviewerComment,
        createdAt: overtimeRequests.createdAt,
        reviewedAt: overtimeRequests.reviewedAt,
        employee: {
          id: employees.id,
          firstName: employees.firstName,
          lastName: employees.lastName,
        },
      })
      .from(overtimeRequests)
      .innerJoin(employees, eq(overtimeRequests.employeeId, employees.id))
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(overtimeRequests.date))
      .limit(options?.limit || 100);

    const resultWithReviewer = await Promise.all(results.map(async (r) => {
      let reviewer = null;
      if (r.reviewerId) {
        const [rev] = await db.select({
          id: employees.id,
          firstName: employees.firstName,
          lastName: employees.lastName,
        }).from(employees).where(eq(employees.id, r.reviewerId));
        reviewer = rev || null;
      }
      return { ...r, reviewer };
    }));

    return resultWithReviewer;
  }

  async getPunchesByEmployeeAndDate(employeeId: string, date: Date): Promise<Punch[]> {
    const startOfDay = startOfDayInSpain(date);
    const endOfDay = endOfDayInSpain(date);

    return db.select().from(punches)
      .where(and(
        eq(punches.employeeId, employeeId),
        gte(punches.timestamp, startOfDay),
        lte(punches.timestamp, endOfDay)
      ))
      .orderBy(punches.timestamp);
  }

  async getPunchesByEmployeeAndDateRange(employeeId: string, startDate: Date, endDate: Date): Promise<Punch[]> {
    return db.select().from(punches)
      .where(and(
        eq(punches.employeeId, employeeId),
        gte(punches.timestamp, startDate),
        lte(punches.timestamp, endDate)
      ))
      .orderBy(punches.timestamp);
  }

  async getStats() {
    const today = startOfDayInSpain(new Date());

    const [totalResult] = await db.select({ count: sql<number>`count(*)` }).from(employees).where(eq(employees.isActive, true));
    
    const todayPunches = await db.selectDistinct({ employeeId: punches.employeeId })
      .from(punches)
      .where(gte(punches.timestamp, today));

    const lastPunchesSubquery = db
      .selectDistinctOn([punches.employeeId], {
        employeeId: punches.employeeId,
        type: punches.type,
      })
      .from(punches)
      .orderBy(punches.employeeId, desc(punches.timestamp))
      .as("last_punches");

    const currentlyInResult = await db
      .select({ count: sql<number>`count(*)` })
      .from(lastPunchesSubquery)
      .where(eq(lastPunchesSubquery.type, "IN"));

    const [needsReviewResult] = await db
      .select({ count: sql<number>`count(*)` })
      .from(punches)
      .where(eq(punches.needsReview, true));

    return {
      totalEmployees: Number(totalResult?.count || 0),
      activeToday: todayPunches.length,
      currentlyIn: Number(currentlyInResult[0]?.count || 0),
      needsReview: Number(needsReviewResult?.count || 0),
    };
  }

  async createKioskDevice(device: InsertKioskDevice): Promise<KioskDevice> {
    const [created] = await db.insert(kioskDevices).values(device).returning();
    return created;
  }

  async getKioskDeviceByTokenHash(tokenHash: string): Promise<KioskDevice | undefined> {
    const [device] = await db.select().from(kioskDevices).where(eq(kioskDevices.tokenHash, tokenHash));
    return device || undefined;
  }

  async getKioskDevice(id: string): Promise<KioskDevice | undefined> {
    const [device] = await db.select().from(kioskDevices).where(eq(kioskDevices.id, id));
    return device || undefined;
  }

  async getAllKioskDevices(): Promise<KioskDevice[]> {
    return db.select().from(kioskDevices).orderBy(desc(kioskDevices.createdAt));
  }

  async updateKioskDevice(id: string, data: Partial<InsertKioskDevice>): Promise<KioskDevice | undefined> {
    const [updated] = await db.update(kioskDevices).set(data).where(eq(kioskDevices.id, id)).returning();
    return updated || undefined;
  }

  async updateKioskDeviceLastUsed(id: string): Promise<void> {
    await db.update(kioskDevices).set({ lastUsedAt: new Date() }).where(eq(kioskDevices.id, id));
  }

  async deleteKioskDevice(id: string): Promise<void> {
    await db.delete(kioskDevices).where(eq(kioskDevices.id, id));
  }

  async updatePunchSignature(punchId: string, data: { signatureUrl: string; signatureSha256: string; kioskDeviceId?: string; kioskUserAgent?: string; kioskIp?: string }): Promise<Punch | undefined> {
    const [updated] = await db.update(punches).set({
      signatureUrl: data.signatureUrl,
      signatureSha256: data.signatureSha256,
      signatureSignedAt: new Date(),
      kioskDeviceId: data.kioskDeviceId,
      kioskUserAgent: data.kioskUserAgent,
      kioskIp: data.kioskIp,
      status: "SIGNED",
    }).where(eq(punches.id, punchId)).returning();
    return updated || undefined;
  }
  async getLastWorkPunch(employeeId: string): Promise<Punch | undefined> {
    const [punch] = await db.select().from(punches)
      .where(and(
        eq(punches.employeeId, employeeId),
        sql`${punches.type} IN ('IN', 'OUT')`
      ))
      .orderBy(desc(punches.timestamp))
      .limit(1);
    return punch || undefined;
  }

  async getOpenBreaks(): Promise<Punch[]> {
    const result = await db.select().from(punches)
      .where(and(
        eq(punches.type, "BREAK_START"),
        sql`NOT EXISTS (
          SELECT 1 FROM punches p2
          WHERE p2.employee_id = ${punches.employeeId}
            AND p2.type = 'BREAK_END'
            AND p2.timestamp > ${punches.timestamp}
        )`
      ));
    return result;
  }

  async getCorrectionsInRange(options: { startDate: Date; endDate: Date; employeeId?: string }): Promise<CorrectionRecord[]> {
    const correctedByEmployee = alias(employees, "corrected_by_employee");

    const conditions = [
      gte(punches.timestamp, options.startDate),
      lte(punches.timestamp, options.endDate),
    ];

    if (options.employeeId) {
      conditions.push(eq(punches.employeeId, options.employeeId));
    }

    const results = await db
      .select({
        originalPunchId: punchCorrections.originalPunchId,
        originalTimestamp: punches.timestamp,
        originalType: punches.type,
        newTimestamp: punchCorrections.newTimestamp,
        newType: punchCorrections.newType,
        reason: punchCorrections.reason,
        correctionDate: punchCorrections.createdAt,
        correctedByFirstName: correctedByEmployee.firstName,
        correctedByLastName: correctedByEmployee.lastName,
        employeeId: punches.employeeId,
        employeeFirstName: employees.firstName,
        employeeLastName: employees.lastName,
      })
      .from(punchCorrections)
      .innerJoin(punches, eq(punchCorrections.originalPunchId, punches.id))
      .innerJoin(employees, eq(punches.employeeId, employees.id))
      .innerJoin(correctedByEmployee, eq(punchCorrections.correctedById, correctedByEmployee.id))
      .where(and(...conditions))
      .orderBy(punches.timestamp, punchCorrections.createdAt);

    return results.map(r => ({
      originalPunchId: r.originalPunchId,
      originalTimestamp: r.originalTimestamp,
      originalType: r.originalType,
      newTimestamp: r.newTimestamp,
      newType: r.newType,
      reason: r.reason,
      correctedByName: `${r.correctedByLastName}, ${r.correctedByFirstName}`,
      correctionDate: r.correctionDate,
      employeeId: r.employeeId,
      employeeName: `${r.employeeLastName}, ${r.employeeFirstName}`,
    }));
  }
}

export const storage = new DatabaseStorage();
