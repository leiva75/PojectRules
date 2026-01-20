import { 
  employees, punches, punchCorrections, refreshTokens,
  type Employee, type InsertEmployee, 
  type Punch, type InsertPunch,
  type PunchCorrection, type InsertPunchCorrection,
  type RefreshToken
} from "@shared/schema";
import { db } from "./db";
import { eq, desc, and, gte, lte, sql } from "drizzle-orm";

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

  createCorrection(correction: InsertPunchCorrection): Promise<PunchCorrection>;
  getCorrectionsByPunch(punchId: string): Promise<PunchCorrection[]>;

  createRefreshToken(employeeId: string, token: string, expiresAt: Date): Promise<RefreshToken>;
  getRefreshToken(token: string): Promise<RefreshToken | undefined>;
  deleteRefreshToken(token: string): Promise<void>;
  deleteRefreshTokensByEmployee(employeeId: string): Promise<void>;

  getStats(): Promise<{ totalEmployees: number; activeToday: number; currentlyIn: number; needsReview: number }>;
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

  async getStats() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

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
}

export const storage = new DatabaseStorage();
