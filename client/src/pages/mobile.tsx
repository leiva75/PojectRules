import { useMemo } from "react";
import { useAuth } from "@/lib/auth";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { PunchButton } from "@/components/punch-button";
import { StatusBadge, GeoBadge, TimeBadge } from "@/components/status-badge";
import { LogOut, Clock, History, User, Timer } from "lucide-react";
import { useLocation } from "wouter";
import type { Punch, PunchRequest } from "@shared/schema";
import { computeDurationMinutes, formatDuration } from "@/lib/duration";

interface PunchWithEmployee extends Punch {
  employee?: {
    firstName: string;
    lastName: string;
  };
}

export default function MobilePage() {
  const { user, logout } = useAuth();
  const [, setLocation] = useLocation();

  const { data: punches, isLoading: punchesLoading } = useQuery<PunchWithEmployee[]>({
    queryKey: ["/api/punches/my"],
    enabled: !!user,
  });

  const { data: lastPunch } = useQuery<Punch | null>({
    queryKey: ["/api/punches/last"],
    enabled: !!user,
  });

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
      queryClient.invalidateQueries({ queryKey: ["/api/punches/my"] });
      queryClient.invalidateQueries({ queryKey: ["/api/punches/last"] });
    },
  });

  const handleLogout = async () => {
    await logout();
    setLocation("/");
  };

  const nextPunchType = lastPunch?.type === "IN" ? "OUT" : "IN";
  const initials = user ? `${user.firstName?.[0] || ""}${user.lastName?.[0] || ""}`.toUpperCase() : "?";

  // Compute vacation durations and total for employee's punches
  const { punchDurations, totalMinutes, hasCompletedVacations } = useMemo(() => {
    const durationMap = new Map<string, { duration: number | null; isInProgress: boolean }>();
    let totalMins = 0;
    let completedCount = 0;
    
    if (!punches || punches.length === 0) {
      return { punchDurations: durationMap, totalMinutes: 0, hasCompletedVacations: false };
    }
    
    // Sort punches chronologically (oldest first)
    const sorted = [...punches].sort((a, b) => 
      new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );
    
    let currentEntry: typeof sorted[0] | null = null;
    
    for (const punch of sorted) {
      if (punch.type === "IN") {
        // If there's already an open entry, mark it as orphaned/in-progress
        if (currentEntry) {
          durationMap.set(currentEntry.id, { duration: null, isInProgress: true });
        }
        currentEntry = punch;
      } else if (punch.type === "OUT") {
        if (currentEntry) {
          // Calculate duration for this vacation pair
          const duration = computeDurationMinutes(currentEntry.timestamp, punch.timestamp);
          durationMap.set(punch.id, { duration, isInProgress: false });
          durationMap.set(currentEntry.id, { duration, isInProgress: false });
          if (duration !== null && duration >= 0) {
            totalMins += duration;
            completedCount++;
          }
          currentEntry = null;
        }
        // Orphan OUT (no matching IN) - don't show duration
      }
    }
    
    // If there's an open entry (no matching OUT), mark as in progress
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
              <span className="text-muted-foreground">Último fichaje</span>
              {lastPunch ? (
                <div className="flex items-center gap-2">
                  <StatusBadge status={lastPunch.type as "IN" | "OUT"} />
                  <TimeBadge time={lastPunch.timestamp} showRelative />
                </div>
              ) : (
                <span className="text-sm text-muted-foreground">Sin fichajes</span>
              )}
            </div>
            
            {lastPunch && (
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Posición</span>
                <GeoBadge 
                  hasLocation={!!(lastPunch.latitude && lastPunch.longitude)} 
                  needsReview={lastPunch.needsReview}
                  latitude={lastPunch.latitude}
                  longitude={lastPunch.longitude}
                />
              </div>
            )}
          </CardContent>
        </Card>

        <div className="flex justify-center py-8">
          <PunchButton
            type={nextPunchType}
            onPunch={punchMutation.mutateAsync}
            source="mobile"
            disabled={punchMutation.isPending}
            size="large"
          />
        </div>

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
                  return (
                  <div 
                    key={punch.id} 
                    className="flex items-center justify-between py-2 border-b last:border-0"
                    data-testid={`punch-item-${punch.id}`}
                  >
                    <div className="flex items-center gap-3">
                      <StatusBadge status={punch.type as "IN" | "OUT"} />
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
