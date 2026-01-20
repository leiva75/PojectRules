import { describe, it, expect } from "vitest";
import { calculateDailyMinutes, calculateOvertime } from "./overtime";
import type { Punch } from "@shared/schema";

function createPunch(type: "IN" | "OUT", timestamp: Date): Punch {
  return {
    id: crypto.randomUUID(),
    employeeId: "test-employee",
    type,
    timestamp,
    latitude: null,
    longitude: null,
    accuracy: null,
    needsReview: false,
    source: "mobile",
  };
}

describe("calculateDailyMinutes", () => {
  it("calcule correctement les minutes pour une session IN-OUT simple", () => {
    const punches: Punch[] = [
      createPunch("IN", new Date("2026-01-20T09:00:00")),
      createPunch("OUT", new Date("2026-01-20T17:00:00")),
    ];
    
    const result = calculateDailyMinutes(punches);
    expect(result).toBe(480);
  });

  it("calcule correctement plusieurs sessions IN-OUT", () => {
    const punches: Punch[] = [
      createPunch("IN", new Date("2026-01-20T09:00:00")),
      createPunch("OUT", new Date("2026-01-20T12:00:00")),
      createPunch("IN", new Date("2026-01-20T13:00:00")),
      createPunch("OUT", new Date("2026-01-20T17:00:00")),
    ];
    
    const result = calculateDailyMinutes(punches);
    expect(result).toBe(420);
  });

  it("retourne 0 pour une liste vide", () => {
    const result = calculateDailyMinutes([]);
    expect(result).toBe(0);
  });

  it("ignore les IN non appariés", () => {
    const punches: Punch[] = [
      createPunch("IN", new Date("2026-01-20T09:00:00")),
    ];
    
    const result = calculateDailyMinutes(punches);
    expect(result).toBe(0);
  });
});

describe("calculateOvertime", () => {
  it("ne crée pas de demande si pas d'overtime", () => {
    const punches: Punch[] = [
      createPunch("IN", new Date("2026-01-20T09:00:00")),
      createPunch("OUT", new Date("2026-01-20T17:00:00")),
    ];
    
    const result = calculateOvertime(punches, 480, 15);
    
    expect(result.dailyMinutes).toBe(480);
    expect(result.overtimeMinutes).toBe(0);
    expect(result.shouldCreateRequest).toBe(false);
  });

  it("ne crée pas de demande si overtime < seuil", () => {
    const punches: Punch[] = [
      createPunch("IN", new Date("2026-01-20T09:00:00")),
      createPunch("OUT", new Date("2026-01-20T17:10:00")),
    ];
    
    const result = calculateOvertime(punches, 480, 15);
    
    expect(result.dailyMinutes).toBe(490);
    expect(result.overtimeMinutes).toBe(10);
    expect(result.shouldCreateRequest).toBe(false);
  });

  it("crée une demande si overtime >= seuil", () => {
    const punches: Punch[] = [
      createPunch("IN", new Date("2026-01-20T09:00:00")),
      createPunch("OUT", new Date("2026-01-20T17:30:00")),
    ];
    
    const result = calculateOvertime(punches, 480, 15);
    
    expect(result.dailyMinutes).toBe(510);
    expect(result.overtimeMinutes).toBe(30);
    expect(result.shouldCreateRequest).toBe(true);
  });

  it("crée une demande si overtime exactement = seuil", () => {
    const punches: Punch[] = [
      createPunch("IN", new Date("2026-01-20T09:00:00")),
      createPunch("OUT", new Date("2026-01-20T17:15:00")),
    ];
    
    const result = calculateOvertime(punches, 480, 15);
    
    expect(result.dailyMinutes).toBe(495);
    expect(result.overtimeMinutes).toBe(15);
    expect(result.shouldCreateRequest).toBe(true);
  });

  it("gère un cas de journée longue avec multiple sessions", () => {
    const punches: Punch[] = [
      createPunch("IN", new Date("2026-01-20T08:00:00")),
      createPunch("OUT", new Date("2026-01-20T12:00:00")),
      createPunch("IN", new Date("2026-01-20T13:00:00")),
      createPunch("OUT", new Date("2026-01-20T19:00:00")),
    ];
    
    const result = calculateOvertime(punches, 480, 15);
    
    expect(result.dailyMinutes).toBe(600);
    expect(result.overtimeMinutes).toBe(120);
    expect(result.shouldCreateRequest).toBe(true);
  });
});
