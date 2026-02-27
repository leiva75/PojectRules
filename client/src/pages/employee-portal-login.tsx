import { useLocation } from "wouter";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { LOGO_SRC, APP_NAME } from "@/config/brand";
import { LogIn, ArrowLeft, Loader2, AlertCircle } from "lucide-react";
import { employeePortalLoginSchema, type EmployeePortalLoginInput } from "@shared/schema";

export default function EmployeePortalLoginPage() {
  const [, setLocation] = useLocation();

  const form = useForm<EmployeePortalLoginInput>({
    resolver: zodResolver(employeePortalLoginSchema),
    defaultValues: { email: "", password: "" },
  });

  const loginMutation = useMutation({
    mutationFn: async (data: EmployeePortalLoginInput) => {
      const res = await fetch("/api/auth/employee/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(data),
      });

      if (!res.ok) {
        if (res.status === 429) {
          throw new Error("Demasiados intentos. Inténtelo de nuevo más tarde.");
        }
        if (res.status === 503) {
          throw new Error("Servicio temporalmente no disponible. Inténtelo de nuevo.");
        }
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message || "Email o contraseña incorrectos");
      }
      return res.json();
    },
    onSuccess: () => {
      setLocation("/empleado/mis-fichajes");
    },
  });

  const onSubmit = (data: EmployeePortalLoginInput) => {
    loginMutation.mutate(data);
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gradient-to-br from-slate-900 via-blue-950 to-indigo-950 px-4 pb-safe">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center space-y-2">
          <img
            src={LOGO_SRC}
            alt={APP_NAME}
            className="h-20 w-auto mx-auto object-contain"
            data-testid="img-logo-employee-portal"
          />
          <h1 className="text-2xl font-semibold tracking-tight text-white" data-testid="text-title">
            Acceso Empleado
          </h1>
          <p className="text-blue-200/70 text-sm" data-testid="text-subtitle">
            Consulte sus fichajes y descargue informes
          </p>
        </div>

        <Card className="border-white/10 bg-white/5 backdrop-blur-sm">
          <CardHeader className="pb-4">
            <CardTitle className="text-lg text-white/90">Iniciar sesión</CardTitle>
          </CardHeader>
          <CardContent>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                {loginMutation.error && (
                  <div className="flex items-center gap-2 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-300 text-sm" data-testid="text-error">
                    <AlertCircle className="h-4 w-4 flex-shrink-0" />
                    {loginMutation.error.message}
                  </div>
                )}

                <FormField
                  control={form.control}
                  name="email"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-blue-200/80">Email</FormLabel>
                      <FormControl>
                        <Input
                          type="email"
                          inputMode="email"
                          autoComplete="username"
                          placeholder="tu.email@empresa.es"
                          disabled={loginMutation.isPending}
                          className="h-12 bg-white/10 border-white/20 text-white placeholder:text-white/30 focus:border-blue-400 focus:ring-blue-400/30"
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
                      <FormLabel className="text-blue-200/80">Contraseña</FormLabel>
                      <FormControl>
                        <Input
                          type="password"
                          autoComplete="current-password"
                          placeholder="••••••••"
                          disabled={loginMutation.isPending}
                          className="h-12 bg-white/10 border-white/20 text-white placeholder:text-white/30 focus:border-blue-400 focus:ring-blue-400/30"
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
                  disabled={loginMutation.isPending}
                  className="w-full h-12 bg-blue-600 hover:bg-blue-500 text-white font-medium"
                  data-testid="button-login"
                >
                  {loginMutation.isPending ? (
                    <Loader2 className="h-5 w-5 animate-spin" />
                  ) : (
                    <>
                      <LogIn className="mr-2 h-5 w-5" />
                      Entrar
                    </>
                  )}
                </Button>
              </form>
            </Form>
          </CardContent>
        </Card>

        <Button
          variant="ghost"
          onClick={() => setLocation("/")}
          className="w-full text-blue-200/60 hover:text-white hover:bg-white/10"
          data-testid="button-back-kiosk"
        >
          <ArrowLeft className="mr-2 h-4 w-4" />
          Volver al kiosko
        </Button>
      </div>
    </div>
  );
}
