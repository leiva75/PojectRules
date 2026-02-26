import type { Punch } from "@shared/schema";

export interface OvertimeCalculationResult {
  dailyMinutes: number;
  overtimeMinutes: number;
  shouldCreateRequest: boolean;
}

export function calculateDailyMinutes(punches: Punch[]): number {
  let dailyMinutes = 0;
  let lastInTime: Date | null = null;
  
  const sortedPunches = [...punches].sort((a, b) => 
    new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  );
  
  for (const punch of sortedPunches) {
    if (punch.type === "IN") {
      lastInTime = new Date(punch.timestamp);
    } else if (punch.type === "OUT" && lastInTime) {
      dailyMinutes += Math.floor((new Date(punch.timestamp).getTime() - lastInTime.getTime()) / 60000);
      lastInTime = null;
    }
  }
  
  return dailyMinutes;
}

export function calculateOvertime(
  punches: Punch[],
  expectedDailyMinutes: number = 480,
  overtimeThreshold: number = 15
): OvertimeCalculationResult {
  const dailyMinutes = calculateDailyMinutes(punches);
  const overtimeMinutes = Math.max(0, dailyMinutes - expectedDailyMinutes);
  const shouldCreateRequest = overtimeMinutes >= overtimeThreshold;
  
  return {
    dailyMinutes,
    overtimeMinutes,
    shouldCreateRequest,
  };
}
