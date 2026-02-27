import { useState, useEffect, useCallback, useRef } from "react";
import { useLocation, useSearch } from "wouter";
import { useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { PunchButton } from "@/components/punch-button";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import { useToast } from "@/hooks/use-toast";
import { useCountdown, formatCountdown } from "@/hooks/use-countdown";
import { X, Delete, Loader2, AlertTriangle, Coffee, Play } from "lucide-react";
import type { Employee, PunchRequest } from "@shared/schema";
import { LOGO_SRC, APP_NAME } from "@/config/brand";

const IDLE_TIMEOUT = 30000;
const KIOSK_TOKEN_KEY = "kiosk_device_token";

interface PauseStatus {
  status: "OFF" | "ON" | "BREAK";
  breakStartedAt?: string;
  pauseAlreadyTaken?: boolean;
}

export default function KioskPage() {
  const [, setLocation] = useLocation();
  const searchString = useSearch();
  const { toast } = useToast();
  const [currentTime, setCurrentTime] = useState(new Date());
  const [pin, setPin] = useState("");
  const [employee, setEmployee] = useState<Employee | null>(null);
  const [kioskToken, setKioskToken] = useState<string | null>(null);
  const [deviceToken, setDeviceToken] = useState<string | null>(null);
  const [lastPunchType, setLastPunchType] = useState<"IN" | "OUT" | null>(null);
  const [pauseStatus, setPauseStatus] = useState<PauseStatus | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const authenticatedPinRef = useRef<string>("");

  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(new Date());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(searchString);
    const tokenFromUrl = params.get("token");
    
    if (tokenFromUrl) {
      localStorage.setItem(KIOSK_TOKEN_KEY, tokenFromUrl);
      setDeviceToken(tokenFromUrl);
      window.history.replaceState({}, "", "/kiosk");
    } else {
      const stored = localStorage.getItem(KIOSK_TOKEN_KEY);
      if (stored) {
        setDeviceToken(stored);
      }
    }
  }, [searchString]);

  useEffect(() => {
    if (employee) {
      const timeout = setTimeout(() => {
        resetKiosk();
      }, IDLE_TIMEOUT);
      return () => clearTimeout(timeout);
    }
  }, [employee, pauseStatus]);

  const resetKiosk = useCallback(() => {
    setEmployee(null);
    setKioskToken(null);
    setLastPunchType(null);
    setPauseStatus(null);
    setPin("");
    authenticatedPinRef.current = "";
  }, []);

  const fetchPauseStatus = useCallback(async (token: string) => {
    try {
      const res = await fetch("/api/pause/status", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data: PauseStatus = await res.json();
        setPauseStatus(data);
      }
    } catch {
    }
  }, []);

  const handlePinChange = (value: string) => {
    setPin(value);
    if (value.length === 6) {
      authenticateEmployee(value);
    }
  };

  const authenticateEmployee = async (pinValue: string) => {
    setIsLoading(true);
    try {
      const response = await fetch("/api/auth/kiosk-login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin: pinValue }),
      });

      if (!response.ok) {
        if (response.status === 429) {
          throw new Error("Demasiados intentos. Inténtelo de nuevo más tarde.");
        }
        if (response.status === 503) {
          throw new Error("Servicio temporalmente no disponible. Inténtelo de nuevo.");
        }
        const error = await response.json().catch(() => ({}));
        throw new Error(error.message || "PIN inválido");
      }

      const data = await response.json();
      setEmployee(data.user);
      setKioskToken(data.token);
      setLastPunchType(data.lastPunchType);
      authenticatedPinRef.current = pinValue;
      await fetchPauseStatus(data.token);
    } catch (error) {
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "PIN inválido",
        variant: "destructive",
      });
      setPin("");
      authenticatedPinRef.current = "";
    } finally {
      setIsLoading(false);
    }
  };

  const punchMutation = useMutation({
    mutationFn: async (data: PunchRequest) => {
      if (deviceToken) {
        const response = await fetch("/api/kiosk/punch", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-KIOSK-TOKEN": deviceToken,
          },
          body: JSON.stringify({
            pin: authenticatedPinRef.current,
            type: data.type,
            latitude: data.latitude,
            longitude: data.longitude,
            accuracy: data.accuracy,
            signatureData: data.signatureData,
          }),
        });

        if (!response.ok) {
          if (response.status === 429) {
            throw new Error("Demasiados intentos. Inténtelo de nuevo más tarde.");
          }
          if (response.status === 403) {
            throw new Error("Token de dispositivo inválido o deshabilitado. Contacte al administrador.");
          }
          if (response.status === 503) {
            throw new Error("Servicio temporalmente no disponible. Inténtelo de nuevo.");
          }
          const error = await response.json().catch(() => ({}));
          throw new Error(error.error?.message || error.message || "Fallo al fichar");
        }

        return response.json();
      } else {
        if (!kioskToken) throw new Error("No autenticado");
        
        const response = await fetch("/api/punches", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${kioskToken}`,
          },
          body: JSON.stringify(data),
        });

        if (!response.ok) {
          if (response.status === 429) {
            throw new Error("Demasiados intentos. Inténtelo de nuevo más tarde.");
          }
          if (response.status === 503) {
            throw new Error("Servicio temporalmente no disponible. Inténtelo de nuevo.");
          }
          const error = await response.json().catch(() => ({}));
          throw new Error(error.error?.message || error.message || "Fallo al fichar");
        }

        const result = await response.json();
        return { ...result.punch, requiresSignature: false };
      }
    },
    onSuccess: (data) => {
      toast({
        title: data.type === "IN" ? "Entrada registrada" : "Salida registrada",
        description: `Fichaje confirmado con firma`,
      });

      setTimeout(resetKiosk, 3000);
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Fallo al fichar",
        variant: "destructive",
      });
    },
  });

  const pauseStartMutation = useMutation({
    mutationFn: async () => {
      if (!kioskToken) throw new Error("No autenticado");
      const res = await fetch("/api/pause/start", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${kioskToken}`,
        },
        body: JSON.stringify({ source: "kiosk" }),
      });
      if (!res.ok) {
        const error = await res.json().catch(() => ({}));
        throw new Error(error.message || "Error al iniciar pausa");
      }
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Pausa iniciada", description: "Descanso de 20 minutos en curso" });
      setTimeout(resetKiosk, 3000);
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Error al iniciar pausa",
        variant: "destructive",
      });
    },
  });

  const pauseEndMutation = useMutation({
    mutationFn: async () => {
      if (!kioskToken) throw new Error("No autenticado");
      const res = await fetch("/api/pause/end", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${kioskToken}`,
        },
        body: JSON.stringify({ source: "kiosk" }),
      });
      if (!res.ok) {
        const error = await res.json().catch(() => ({}));
        throw new Error(error.message || "Error al finalizar pausa");
      }
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Pausa finalizada", description: "Ha reanudado su actividad" });
      if (kioskToken) fetchPauseStatus(kioskToken);
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Error al finalizar pausa",
        variant: "destructive",
      });
    },
  });

  const handleKeypadPress = (digit: string) => {
    if (pin.length < 6) {
      const newPin = pin + digit;
      setPin(newPin);
      if (newPin.length === 6) {
        authenticateEmployee(newPin);
      }
    }
  };

  const handleDelete = () => {
    setPin(pin.slice(0, -1));
  };

  const employeeStatus = pauseStatus?.status ?? (lastPunchType === "IN" ? "ON" : "OFF");
  const nextPunchType: "IN" | "OUT" = employeeStatus === "OFF" ? "IN" : "OUT";
  const initials = employee ? `${employee.firstName?.[0] || ""}${employee.lastName?.[0] || ""}`.toUpperCase() : "";
  const countdown = useCountdown(pauseStatus?.breakStartedAt);

  useEffect(() => {
    if (countdown !== null && countdown <= 0 && kioskToken) {
      fetchPauseStatus(kioskToken);
    }
  }, [countdown, kioskToken, fetchPauseStatus]);

  return (
    <div className="min-h-screen bg-bg-app flex flex-col">
      <header className="border-b border-border-subtle bg-bg-surface px-4 sm:px-6 py-3 sm:py-4 flex flex-col sm:flex-row items-center sm:justify-between gap-2 sm:gap-0">
        <div className="flex items-center gap-2 sm:gap-3">
          <img 
            src={LOGO_SRC} 
            alt={APP_NAME} 
            className="h-10 sm:h-14 w-auto object-contain"
            data-testid="img-logo-kiosk"
          />
          <span className="text-base sm:text-xl font-semibold">Cronos Gimnasio</span>
        </div>
        <div className="text-center sm:text-right">
          <div className="text-xl sm:text-3xl font-mono font-medium">
            {currentTime.toLocaleTimeString("es-ES", { timeZone: "Europe/Madrid", hour: "2-digit", minute: "2-digit" })}
          </div>
          <div className="text-xs sm:text-sm text-muted-foreground">
            {currentTime.toLocaleDateString("es-ES", { 
              timeZone: "Europe/Madrid",
              weekday: "long", 
              day: "numeric", 
              month: "long", 
              year: "numeric" 
            })}
          </div>
        </div>
      </header>

      <main className="flex-1 flex items-center justify-center p-4 sm:p-8">
        {!employee ? (
          <Card className="w-full max-w-sm sm:max-w-md border-card-border">
            <CardHeader className="text-center pb-3 sm:pb-4">
              <CardTitle className="text-lg sm:text-xl">Ingrese su código PIN</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col items-center space-y-4 sm:space-y-6">
              <InputOTP 
                value={pin} 
                onChange={handlePinChange}
                maxLength={6}
                disabled={isLoading}
                data-testid="input-kiosk-pin"
              >
                <InputOTPGroup>
                  <InputOTPSlot index={0} />
                  <InputOTPSlot index={1} />
                  <InputOTPSlot index={2} />
                  <InputOTPSlot index={3} />
                  <InputOTPSlot index={4} />
                  <InputOTPSlot index={5} />
                </InputOTPGroup>
              </InputOTP>

              {isLoading && (
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span>Verificando...</span>
                </div>
              )}

              <div className="grid grid-cols-3 gap-2 sm:gap-3 w-full max-w-[300px] sm:max-w-[280px]">
                {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((digit) => (
                  <Button
                    key={digit}
                    variant="outline"
                    className="h-14 sm:h-16 text-xl sm:text-2xl font-medium"
                    onClick={() => handleKeypadPress(digit)}
                    disabled={isLoading || pin.length >= 6}
                    data-testid={`button-kiosk-${digit}`}
                  >
                    {digit}
                  </Button>
                ))}
                <div />
                <Button
                  variant="outline"
                  className="h-14 sm:h-16 text-xl sm:text-2xl font-medium"
                  onClick={() => handleKeypadPress("0")}
                  disabled={isLoading || pin.length >= 6}
                  data-testid="button-kiosk-0"
                >
                  0
                </Button>
                <Button
                  variant="ghost"
                  className="h-14 sm:h-16"
                  onClick={handleDelete}
                  disabled={isLoading || pin.length === 0}
                  data-testid="button-kiosk-delete"
                >
                  <Delete className="h-5 w-5 sm:h-6 sm:w-6" />
                </Button>
              </div>
            </CardContent>
          </Card>
        ) : (
          <Card className="w-full max-w-sm sm:max-w-lg border-card-border">
            <CardHeader className="flex flex-row items-center justify-between pb-3 sm:pb-4 gap-3">
              <div className="flex items-center gap-3 sm:gap-4 min-w-0">
                <Avatar className="h-14 w-14 sm:h-20 sm:w-20 shrink-0">
                  <AvatarFallback className="text-xl sm:text-2xl bg-primary/10 text-primary font-semibold">
                    {initials}
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0">
                  <CardTitle className="text-lg sm:text-2xl truncate">
                    {employee.firstName} {employee.lastName}
                  </CardTitle>
                  <p className="text-sm sm:text-base text-muted-foreground capitalize">{employee.role}</p>
                </div>
              </div>
              <Button 
                variant="ghost" 
                size="icon"
                onClick={resetKiosk}
                className="shrink-0"
                data-testid="button-kiosk-cancel"
              >
                <X className="h-5 w-5 sm:h-6 sm:w-6" />
              </Button>
            </CardHeader>
            <CardContent className="flex flex-col items-center py-6 sm:py-8 space-y-4 sm:space-y-6">
              <p className="text-base sm:text-lg text-muted-foreground text-center px-2" data-testid="text-kiosk-status">
                {employeeStatus === "ON"
                  ? "Actualmente está fichado/a como presente"
                  : employeeStatus === "BREAK"
                  ? "En pausa — descanso en curso"
                  : "No está fichado/a como presente"}
              </p>

              {employeeStatus === "BREAK" ? (
                <div className="flex flex-col items-center space-y-4">
                  <div className="w-36 h-36 sm:w-40 sm:h-40 rounded-full bg-indigo-100 border-4 border-indigo-300 flex flex-col items-center justify-center shadow-2xl">
                    <Coffee className="h-7 w-7 sm:h-8 sm:w-8 text-indigo-600 mb-1" />
                    <span className="text-2xl sm:text-3xl font-mono font-bold text-indigo-700" data-testid="text-pause-countdown">
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
                    {pauseEndMutation.isPending ? (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                      <Play className="h-4 w-4 mr-2" />
                    )}
                    Reanudar ahora
                  </Button>
                </div>
              ) : (
                <>
                  <PunchButton
                    type={nextPunchType}
                    onPunch={punchMutation.mutateAsync}
                    source="kiosk"
                    disabled={punchMutation.isPending}
                    size="large"
                  />

                  {employeeStatus === "ON" && !pauseStatus?.pauseAlreadyTaken && (
                    <Button
                      onClick={() => pauseStartMutation.mutate()}
                      disabled={pauseStartMutation.isPending}
                      variant="outline"
                      className="border-indigo-300 text-indigo-700 hover:bg-indigo-50 px-6 py-2"
                      data-testid="button-pause-start"
                    >
                      {pauseStartMutation.isPending ? (
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      ) : (
                        <Coffee className="h-4 w-4 mr-2" />
                      )}
                      Pausa (20 min)
                    </Button>
                  )}
                </>
              )}

              <p className="text-xs sm:text-sm text-muted-foreground">
                Retorno automático en 30 segundos
              </p>
            </CardContent>
          </Card>
        )}
      </main>

      <footer className="border-t bg-card px-4 sm:px-6 py-2 sm:py-3 flex items-center justify-between">
        <div className="text-xs text-muted-foreground">
          {!deviceToken && (
            <span className="flex items-center gap-1">
              <AlertTriangle className="h-3 w-3" />
              <span className="hidden sm:inline">Sin token de dispositivo</span>
              <span className="sm:hidden">Sin token</span>
            </span>
          )}
        </div>
        <Button 
          variant="ghost"
          size="sm"
          onClick={() => setLocation("/")}
          data-testid="button-exit-kiosk"
        >
          <span className="hidden sm:inline">Salir del modo quiosco</span>
          <span className="sm:hidden">Salir</span>
        </Button>
      </footer>

    </div>
  );
}
