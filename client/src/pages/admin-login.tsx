import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useAuth } from "@/lib/auth";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { Loader2, ShieldCheck } from "lucide-react";
import { LOGO_SRC, APP_NAME } from "@/config/brand";

const adminLoginSchema = z.object({
  identifier: z.string().min(1, "El nombre de usuario es obligatorio"),
  password: z.string().min(1, "La contraseña es obligatoria"),
});

type AdminLoginFormData = z.infer<typeof adminLoginSchema>;

export default function AdminLoginPage() {
  const { adminLogin } = useAuth();
  const { toast } = useToast();
  const [isLoading, setIsLoading] = useState(false);

  const form = useForm<AdminLoginFormData>({
    resolver: zodResolver(adminLoginSchema),
    defaultValues: {
      identifier: "",
      password: "",
    },
  });

  const onSubmit = async (data: AdminLoginFormData) => {
    setIsLoading(true);
    try {
      await adminLogin(data.identifier, data.password);
      toast({
        title: "Conexión exitosa",
        description: "Bienvenido a su espacio",
      });
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
    <div className="min-h-screen bg-gradient-to-br from-indigo-950 via-indigo-900 to-slate-900 flex items-center justify-center p-6">
      <Card className="w-full max-w-md bg-white/10 backdrop-blur-md border-white/20">
        <CardHeader className="text-center pb-4">
          <img
            src={LOGO_SRC}
            alt={APP_NAME}
            className="h-16 w-auto mx-auto object-contain mb-2"
            data-testid="img-admin-logo"
          />
          <CardTitle className="text-2xl text-white flex items-center justify-center gap-2 flex-wrap">
            <ShieldCheck className="h-6 w-6" />
            Acceso Administración
          </CardTitle>
          <CardDescription className="text-indigo-200/80">
            Ingrese sus credenciales de Gestión
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <FormField
                control={form.control}
                name="identifier"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-indigo-100">Nombre de usuario</FormLabel>
                    <FormControl>
                      <Input
                        type="text"
                        placeholder="usuario"
                        autoComplete="username"
                        className="bg-white/20 border-white/30 text-white placeholder:text-white/50"
                        data-testid="input-admin-username"
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
                    <FormLabel className="text-indigo-100">Contraseña</FormLabel>
                    <FormControl>
                      <Input
                        type="password"
                        placeholder="••••••••"
                        autoComplete="current-password"
                        className="bg-white/20 border-white/30 text-white placeholder:text-white/50"
                        data-testid="input-admin-password"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <Button
                type="submit"
                className="w-full text-base font-medium bg-indigo-600 hover:bg-indigo-700 text-white"
                disabled={isLoading}
                data-testid="button-admin-login"
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
        </CardContent>
      </Card>
    </div>
  );
}
