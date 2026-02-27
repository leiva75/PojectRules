import { useMemo, useState, useEffect, useCallback } from "react";
import { useAuth } from "@/lib/auth";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { PunchButton } from "@/components/punch-button";
import { StatusBadge, GeoBadge, TimeBadge } from "@/components/status-badge";
import { LogOut, Clock, History, User, Timer, Coffee, Play } from "lucide-react";
import { useLocation } from "wouter";
import { useToast } from "@/hooks/use-toast";
import type { Punch, PunchRequest } from "@shared/schema";
import { computeDurationMinutes, formatDuration } from "@/lib/duration";
import { useCountdown, formatCountdown } from "@/hooks/use-countdown";

interface PunchWithEmployee extends Punch {
  employee?: {
    firstName: string;
    lastName: string;
  };
}

interface PauseStatus {
  status: "OFF" | "ON" | "BREAK";
  breakStartedAt?: string;
}

export default function MobilePage() {
  const { user, logout } = useAuth();
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const { data: punches, isLoading: punchesLoading } = useQuery<PunchWithEmployee[]>({
    queryKey: ["/api/punches/my"],
    enabled: !!user,
  });

  const { data: pauseStatus } = useQuery<PauseStatus>({
    queryKey: ["/api/pause/status"],
    enabled: !!user,
    refetchInterval: 30_000,
  });

  const employeeStatus = pauseStatus?.status ?? "OFF";
  const nextPunchType: "IN" | "OUT" = employeeStatus === "OFF" ? "IN" : "OUT";

  const countdown = useCountdown(pauseStatus?.breakStartedAt);

  useEffect(() => {
    if (countdown !== null && countdown <= 0) {
      queryClient.invalidateQueries({ queryKey: ["/api/pause/status"] });
      queryClient.invalidateQueries({ queryKey: ["/api/punches/my"] });
    }
  }, [countdown]);

  const invalidatePauseQueries = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["/api/punches/my"] });
    queryClient.invalidateQueries({ queryKey: ["/api/punches/last"] });
    queryClient.invalidateQueries({ queryKey: ["/api/pause/status"] });
  }, []);

  const punchMutation = useMutation({
    mutationFn: async (data: PunchRequest) => {
      const token = localStorage.getItem("employeeToken");
      const res = await fetch("/api/punches", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        credentials: "include",
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.message || "Fallo al fichar");
      }
      return res.json();
    },
    onSuccess: () => {
      invalidatePauseQueries();
    },
  });

  const pauseStartMutation = useMutation({
    mutationFn: async () => {
      const token = localStorage.getItem("employeeToken");
      const res = await fetch("/api/pause/start", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        credentials: "include",
        body: JSON.stringify({ source: "mobile" }),
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.message || "Error al iniciar pausa");
      }
      return res.json();
    },
    onSuccess: () => {
      invalidatePauseQueries();
      toast({ title: "Pausa iniciada", description: "20 minutos de descanso" });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const pauseEndMutation = useMutation({
    mutationFn: async () => {
      const token = localStorage.getItem("employeeToken");
      const res = await fetch("/api/pause/end", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        credentials: "include",
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.message || "Error al finalizar pausa");
      }
      return res.json();
    },
    onSuccess: () => {
      invalidatePauseQueries();
      toast({ title: "Pausa finalizada", description: "Continuando jornada" });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const handleLogout = async () => {
    await logout();
    setLocation("/");
  };

  const initials = user ? `${user.firstName?.[0] || ""}${user.lastName?.[0] || ""}`.toUpperCase() : "?";

  const { punchDurations, totalMinutes, hasCompletedVacations } = useMemo(() => {
    const durationMap = new Map<string, { duration: number | null; isInProgress: boolean }>();
    let totalMins = 0;
    let completedCount = 0;
    
    if (!punches || punches.length === 0) {
      return { punchDurations: durationMap, totalMinutes: 0, hasCompletedVacations: false };
    }
    
    const sorted = [...punches].sort((a, b) => 
      new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );
    
    let currentEntry: typeof sorted[0] | null = null;
    
    for (const punch of sorted) {
      if (punch.type === "IN") {
        if (currentEntry) {
          durationMap.set(currentEntry.id, { duration: null, isInProgress: true });
        }
        currentEntry = punch;
      } else if (punch.type === "OUT") {
        if (currentEntry) {
          const duration = computeDurationMinutes(currentEntry.timestamp, punch.timestamp);
          durationMap.set(punch.id, { duration, isInProgress: false });
          durationMap.set(currentEntry.id, { duration, isInProgress: false });
          if (duration !== null && duration >= 0) {
            totalMins += duration;
            completedCount++;
          }
          currentEntry = null;
        }
      }
    }
    
    if (currentEntry) {
      durationMap.set(currentEntry.id, { duration: null, isInProgress: true });
    }
    
    return { punchDurations: durationMap, totalMinutes: totalMins, hasCompletedVacations: completedCount > 0 };
  }, [punches]);

  return (
    <div className="min-h-screen bg-bg-app flex flex-col">
      <header className="border-b border-border-subtle bg-bg-surface px-4 py-3 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Avatar className="h-10 w-10">
            <AvatarFallback className="bg-primary/10 text-primary font-medium">
              {initials}
            </AvatarFallback>
          </Avatar>
          <div>
            <p className="font-medium text-sm">
              {user?.firstName} {user?.lastName}
            </p>
            <p className="text-xs text-muted-foreground capitalize">{user?.role}</p>
          </div>
        </div>
        <Button variant="ghost" size="icon" onClick={handleLogout} data-testid="button-logout">
          <LogOut className="h-5 w-5" />
        </Button>
      </header>

      <main className="flex-1 p-4 space-y-6">
        <Card className="border-card-border">
          <CardHeader className="pb-2">
            <CardTitle className="text-lg flex items-center gap-2">
              <Clock className="h-5 w-5 text-primary" />
              Estado actual
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Estado</span>
              <Badge
                variant={employeeStatus === "OFF" ? "secondary" : employeeStatus === "BREAK" ? "outline" : "default"}
                className={
                  employeeStatus === "OFF"
                    ? "bg-gray-400 text-white"
                    : employeeStatus === "BREAK"
                    ? "bg-indigo-100 text-indigo-700 border-indigo-300"
                    : "bg-green-600 text-white"
                }
                data-testid="badge-employee-status"
              >
                {employeeStatus === "OFF" ? "Fuera de servicio" : employeeStatus === "BREAK" ? "En pausa" : "En servicio"}
              </Badge>
            </div>
          </CardContent>
        </Card>

        {employeeStatus === "BREAK" ? (
          <div className="flex flex-col items-center py-8 space-y-4" data-testid="pause-active-section">
            <div className="w-40 h-40 rounded-full bg-indigo-100 border-4 border-indigo-300 flex flex-col items-center justify-center shadow-2xl">
              <Coffee className="h-8 w-8 text-indigo-600 mb-1" />
              <span className="text-3xl font-mono font-bold text-indigo-700" data-testid="text-pause-countdown">
                {countdown !== null ? formatCountdown(countdown) : "--:--"}
              </span>
              <span className="text-xs text-indigo-500 mt-1">Pausa en curso</span>
            </div>
            <Button
              onClick={() => pauseEndMutation.mutate()}
              disabled={pauseEndMutation.isPending}
              className="bg-indigo-600 hover:bg-indigo-700 text-white px-8 py-3 text-base"
              data-testid="button-pause-end"
            >
              <Play className="h-4 w-4 mr-2" />
              Reanudar ahora
            </Button>
          </div>
        ) : (
          <div className="flex flex-col items-center py-8 space-y-4">
            <PunchButton
              type={nextPunchType}
              onPunch={punchMutation.mutateAsync}
              source="mobile"
              disabled={punchMutation.isPending}
              size="large"
            />
            {employeeStatus === "ON" && (
              <Button
                onClick={() => pauseStartMutation.mutate()}
                disabled={pauseStartMutation.isPending}
                variant="outline"
                className="border-indigo-300 text-indigo-700 hover:bg-indigo-50 px-6 py-2"
                data-testid="button-pause-start"
              >
                <Coffee className="h-4 w-4 mr-2" />
                Pausa (20 min)
              </Button>
            )}
          </div>
        )}

        <Card className="border-card-border">
          <CardHeader className="pb-2">
            <CardTitle className="text-lg flex items-center gap-2">
              <History className="h-5 w-5 text-primary" />
              Historial reciente
            </CardTitle>
          </CardHeader>
          <CardContent>
            {punchesLoading ? (
              <div className="space-y-3">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="h-12 bg-muted/50 animate-pulse rounded-md" />
                ))}
              </div>
            ) : punches && punches.length > 0 ? (
              <div className="space-y-3">
                {punches.slice(0, 10).map((punch) => {
                  const durationInfo = punchDurations.get(punch.id);
                  const isBreakType = punch.type === "BREAK_START" || punch.type === "BREAK_END";
                  return (
                  <div 
                    key={punch.id} 
                    className={`flex items-center justify-between py-2 border-b last:border-0 ${isBreakType ? "opacity-60" : ""}`}
                    data-testid={`punch-item-${punch.id}`}
                  >
                    <div className="flex items-center gap-3">
                      <StatusBadge status={punch.type as "IN" | "OUT" | "BREAK_START" | "BREAK_END"} />
                      <div className="text-sm">
                        <p className="font-mono">
                          {new Date(punch.timestamp).toLocaleDateString("es-ES", {
                            timeZone: "Europe/Madrid",
                            weekday: "short",
                            day: "numeric",
                            month: "short",
                          })}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {durationInfo && (
                        <Badge 
                          variant={durationInfo.isInProgress ? "outline" : "secondary"} 
                          className={`text-xs font-mono ${durationInfo.isInProgress ? "text-blue-600 border-blue-300" : ""}`}
                          data-testid={`duration-${punch.id}`}
                        >
                          <Timer className="h-3 w-3 mr-1" />
                          {formatDuration(durationInfo.duration, durationInfo.isInProgress)}
                        </Badge>
                      )}
                      {punch.needsReview && (
                        <GeoBadge hasLocation={false} needsReview={true} />
                      )}
                      <TimeBadge time={punch.timestamp} />
                    </div>
                  </div>
                );
                })}
              </div>
            ) : (
              <div className="text-center py-8 text-muted-foreground">
                <History className="h-12 w-12 mx-auto mb-2 opacity-30" />
                <p>Sin fichajes hoy</p>
              </div>
            )}
          </CardContent>
          {punches && punches.length > 0 && hasCompletedVacations && (
            <CardFooter className="border-t bg-bg-surface-2/50 py-3">
              <div className="flex items-center justify-between w-full">
                <span className="text-sm font-medium text-muted-foreground">
                  Total período
                </span>
                <Badge variant="default" className="text-sm font-mono" data-testid="total-duration">
                  <Timer className="h-4 w-4 mr-1" />
                  {formatDuration(totalMinutes)}
                </Badge>
              </div>
            </CardFooter>
          )}
        </Card>
      </main>

      <nav className="border-t bg-card px-4 py-2 flex justify-around">
        <Button variant="ghost" className="flex-col gap-1 h-auto py-2" data-testid="nav-home">
          <Clock className="h-5 w-5" />
          <span className="text-xs">Inicio</span>
        </Button>
        <Button variant="ghost" className="flex-col gap-1 h-auto py-2" data-testid="nav-history">
          <History className="h-5 w-5" />
          <span className="text-xs">Historial</span>
        </Button>
        <Button variant="ghost" className="flex-col gap-1 h-auto py-2" data-testid="nav-profile">
          <User className="h-5 w-5" />
          <span className="text-xs">Perfil</span>
        </Button>
      </nav>
    </div>
  );
}
