import { useState, useEffect, useCallback } from "react";
import { useLocation } from "wouter";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useAuth } from "@/lib/auth";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Delete, ShieldCheck, Users } from "lucide-react";
import { LOGO_SRC, APP_NAME } from "@/config/brand";
import { useMutation, useQuery } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { PunchButton } from "@/components/punch-button";

const loginSchema = z.object({
  email: z.string().email("Email inválido"),
  password: z.string().min(6, "La contraseña debe tener al menos 6 caracteres"),
});

type LoginFormData = z.infer<typeof loginSchema>;

interface KioskEmployee {
  id: string;
  firstName: string;
  lastName: string;
}

export default function LoginPage() {
  const [, setLocation] = useLocation();
  const { login } = useAuth();
  const { toast } = useToast();
  const [isLoading, setIsLoading] = useState(false);
  
  // Kiosk state
  const [pin, setPin] = useState("");
  const [isPinLoading, setIsPinLoading] = useState(false);
  const [employee, setEmployee] = useState<KioskEmployee | null>(null);
  const [kioskToken, setKioskToken] = useState<string | null>(null);
  const [lastPunchType, setLastPunchType] = useState<"IN" | "OUT" | null>(null);
  const [currentTime, setCurrentTime] = useState(new Date());
  
  // Admin login dialog state
  const [showAdminDialog, setShowAdminDialog] = useState(false);

  const form = useForm<LoginFormData>({
    resolver: zodResolver(loginSchema),
    defaultValues: {
      email: "",
      password: "",
    },
  });

  // Update clock
  useEffect(() => {
    const interval = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(interval);
  }, []);

  // Reset kiosk after inactivity
  const resetKiosk = useCallback(() => {
    setPin("");
    setEmployee(null);
    setKioskToken(null);
    setLastPunchType(null);
  }, []);

  // Auto-reset after 30 seconds of employee view
  useEffect(() => {
    if (employee) {
      const timeout = setTimeout(resetKiosk, 30000);
      return () => clearTimeout(timeout);
    }
  }, [employee, resetKiosk]);

  // Handle PIN submission
  const handlePinComplete = async (pinValue: string) => {
    if (pinValue.length !== 6) return;
    
    setIsPinLoading(true);
    try {
      const response = await fetch("/api/auth/kiosk-login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin: pinValue }),
      });
      
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || "PIN inválido");
      }
      
      const data = await response.json();
      setEmployee(data.user);
      setKioskToken(data.token);
      setLastPunchType(data.lastPunchType);
    } catch (error) {
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "PIN inválido",
        variant: "destructive",
      });
      setPin("");
    } finally {
      setIsPinLoading(false);
    }
  };

  // Punch mutation
  const punchMutation = useMutation({
    mutationFn: async (data: { type: "IN" | "OUT"; latitude?: number; longitude?: number; accuracy?: number; source: "mobile" | "kiosk"; signatureData: string }) => {
      if (!kioskToken) throw new Error("No autorizado");
      
      const response = await fetch("/api/punches", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${kioskToken}`,
        },
        body: JSON.stringify(data),
      });
      
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || "Fallo al fichar");
      }

      return response.json();
    },
    onSuccess: (data) => {
      toast({
        title: data.punch.type === "IN" ? "Entrada registrada" : "Salida registrada",
        description: `A las ${new Date(data.punch.timestamp).toLocaleTimeString("es-ES", { timeZone: "Europe/Madrid" })}`,
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

  const handleKeypadPress = (digit: string) => {
    if (pin.length < 6) {
      const newPin = pin + digit;
      setPin(newPin);
      if (newPin.length === 6) {
        handlePinComplete(newPin);
      }
    }
  };

  const handleBackspace = () => {
    setPin(prev => prev.slice(0, -1));
  };

  const nextPunchType = lastPunchType === "IN" ? "OUT" : "IN";

  // Admin login handler
  const onSubmit = async (data: LoginFormData) => {
    setIsLoading(true);
    try {
      await login(data.email, data.password);
      setShowAdminDialog(false);
      toast({
        title: "Conexión exitosa",
        description: "Bienvenido a su espacio",
      });
      // Use setTimeout to ensure state updates complete before navigation
      setTimeout(() => {
        window.location.href = "/admin";
      }, 100);
    } catch (error) {
      toast({
        title: "Error de conexión",
        description: error instanceof Error ? error.message : "Credenciales incorrectas",
        variant: "destructive",
      });
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-kiosk-radial flex flex-col text-white">
      {/* Header with logo and time */}
      <header className="flex items-center justify-between px-6 py-4">
        <div className="flex items-center gap-3">
          <img 
            src={LOGO_SRC} 
            alt={APP_NAME} 
            className="h-12 w-auto object-contain"
            data-testid="img-logo-header"
          />
          <span className="text-xl font-semibold">Cronos Gimnasio</span>
        </div>
        <div className="text-right">
          <div className="text-3xl font-mono font-medium">
            {currentTime.toLocaleTimeString("es-ES", { timeZone: "Europe/Madrid", hour: "2-digit", minute: "2-digit" })}
          </div>
          <div className="text-sm text-blue-200/70">
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

      {/* Main content - PIN keypad or punch screen */}
      <main className="flex-1 flex items-center justify-center p-6">
        {!employee ? (
          <Card className="w-full max-w-md bg-white/10 backdrop-blur-md border-white/20">
            <CardHeader className="text-center pb-4">
              <img 
                src={LOGO_SRC} 
                alt={APP_NAME} 
                className="h-20 w-auto mx-auto object-contain mb-2"
                data-testid="img-logo-main"
              />
              <CardTitle className="text-2xl text-white">Control de Asistencia</CardTitle>
              <CardDescription className="text-blue-100/80">
                Ingrese su código PIN de 6 dígitos
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col items-center space-y-6">
              <InputOTP 
                value={pin} 
                onChange={setPin}
                maxLength={6}
                disabled={isPinLoading}
                className="gap-3"
              >
                <InputOTPGroup className="gap-2">
                  <InputOTPSlot index={0} className="w-12 h-14 text-2xl bg-white/20 border-white/30 text-white" />
                  <InputOTPSlot index={1} className="w-12 h-14 text-2xl bg-white/20 border-white/30 text-white" />
                  <InputOTPSlot index={2} className="w-12 h-14 text-2xl bg-white/20 border-white/30 text-white" />
                  <InputOTPSlot index={3} className="w-12 h-14 text-2xl bg-white/20 border-white/30 text-white" />
                  <InputOTPSlot index={4} className="w-12 h-14 text-2xl bg-white/20 border-white/30 text-white" />
                  <InputOTPSlot index={5} className="w-12 h-14 text-2xl bg-white/20 border-white/30 text-white" />
                </InputOTPGroup>
              </InputOTP>

              {isPinLoading && (
                <div className="flex items-center gap-2 text-blue-200">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span>Verificando...</span>
                </div>
              )}

              <div className="grid grid-cols-3 gap-3 w-full max-w-[280px]">
                {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((digit) => (
                  <Button
                    key={digit}
                    variant="outline"
                    className="h-16 text-2xl font-medium bg-white/10 border-white/30 text-white hover:bg-white/20"
                    onClick={() => handleKeypadPress(digit)}
                    disabled={isPinLoading}
                    data-testid={`button-keypad-${digit}`}
                  >
                    {digit}
                  </Button>
                ))}
                <div />
                <Button
                  variant="outline"
                  className="h-16 text-2xl font-medium bg-white/10 border-white/30 text-white hover:bg-white/20"
                  onClick={() => handleKeypadPress("0")}
                  disabled={isPinLoading}
                  data-testid="button-keypad-0"
                >
                  0
                </Button>
                <Button
                  variant="outline"
                  className="h-16 bg-white/10 border-white/30 text-white hover:bg-white/20"
                  onClick={handleBackspace}
                  disabled={isPinLoading || pin.length === 0}
                  data-testid="button-keypad-backspace"
                >
                  <Delete className="h-6 w-6" />
                </Button>
              </div>
            </CardContent>
          </Card>
        ) : (
          <Card className="w-full max-w-md bg-white/10 backdrop-blur-md border-white/20">
            <CardHeader className="text-center pb-4 relative">
              <Button
                variant="ghost"
                size="icon"
                className="absolute right-4 top-4 text-white/70 hover:text-white hover:bg-white/10"
                onClick={resetKiosk}
                data-testid="button-close-punch"
              >
                ×
              </Button>
              <CardTitle className="text-2xl text-white">
                {employee.firstName} {employee.lastName}
              </CardTitle>
              <CardDescription className="text-blue-100/80">
                {lastPunchType === "IN" 
                  ? "Actualmente está fichado/a como presente" 
                  : "No está fichado/a como presente"}
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col items-center py-8 space-y-6">
              <PunchButton
                type={nextPunchType}
                onPunch={punchMutation.mutateAsync}
                source="kiosk"
                disabled={punchMutation.isPending}
                size="large"
              />

              <p className="text-sm text-blue-200/70">
                Retorno automático en 30 segundos
              </p>
            </CardContent>
          </Card>
        )}
      </main>

      {/* Footer with secondary access links */}
      <footer className="px-6 py-4 flex justify-center gap-6">
        <Button 
          variant="ghost"
          className="text-blue-200/70 hover:text-white hover:bg-white/10"
          onClick={() => setShowAdminDialog(true)}
          data-testid="button-admin-access"
        >
          <ShieldCheck className="mr-2 h-4 w-4" />
          Acceso Admin / Gerente
        </Button>
        <Button 
          variant="ghost"
          className="text-blue-200/70 hover:text-white hover:bg-white/10"
          onClick={() => setLocation("/empleado")}
          data-testid="button-employee-access"
        >
          <Users className="mr-2 h-4 w-4" />
          Acceso Empleado
        </Button>
      </footer>

      {/* Admin login dialog */}
      <Dialog open={showAdminDialog} onOpenChange={setShowAdminDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Acceso Admin / Gerente</DialogTitle>
            <DialogDescription>
              Ingrese sus credenciales para continuar
            </DialogDescription>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Correo electrónico</FormLabel>
                    <FormControl>
                      <Input 
                        type="email" 
                        placeholder="admin@example.com" 
                        className="h-12"
                        data-testid="input-email"
                        {...field} 
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="password"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Contraseña</FormLabel>
                    <FormControl>
                      <Input 
                        type="password" 
                        placeholder="••••••••" 
                        className="h-12"
                        data-testid="input-password"
                        {...field} 
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <Button 
                type="submit" 
                className="w-full h-12 text-base font-medium"
                disabled={isLoading}
                data-testid="button-login"
              >
                {isLoading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Conectando...
                  </>
                ) : (
                  "Iniciar sesión"
                )}
              </Button>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
