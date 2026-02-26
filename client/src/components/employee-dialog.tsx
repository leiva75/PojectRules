import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { Loader2 } from "lucide-react";

const baseFields = {
  email: z.string().email("Email inválido"),
  firstName: z.string().min(1, "El nombre es obligatorio"),
  lastName: z.string().min(1, "El apellido es obligatorio"),
  role: z.enum(["admin", "manager", "employee"]),
};

const createSchema = z.object({
  ...baseFields,
  password: z.string().min(6, "La contraseña debe tener al menos 6 caracteres"),
  pin: z.string().length(6, "El PIN debe tener exactamente 6 dígitos").regex(/^\d{6}$/, "El PIN debe contener solo números"),
});

const editSchema = z.object({
  ...baseFields,
  password: z.string().min(6, "Mínimo 6 caracteres").or(z.literal("")),
  pin: z.string().length(6, "El PIN debe tener exactamente 6 dígitos").regex(/^\d{6}$/, "Solo números").or(z.literal("")),
});

type FormData = z.infer<typeof editSchema>;

interface EmployeeData {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: "admin" | "manager" | "employee";
  pin?: string | null;
  isActive: boolean;
}

interface EmployeeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  employee?: EmployeeData | null;
}

function EmployeeForm({ employee, onOpenChange }: { employee: EmployeeData | null | undefined; onOpenChange: (open: boolean) => void }) {
  const { toast } = useToast();
  const isEdit = !!employee;

  const form = useForm<FormData>({
    resolver: zodResolver(isEdit ? editSchema : createSchema),
    defaultValues: {
      email: employee?.email || "",
      password: "",
      firstName: employee?.firstName || "",
      lastName: employee?.lastName || "",
      role: employee?.role || "employee",
      pin: employee?.pin || "",
    },
  });

  const createMutation = useMutation({
    mutationFn: async (data: FormData) => {
      return apiRequest("POST", "/api/employees", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/employees"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/stats"] });
      toast({ title: "Empleado creado", description: "La cuenta se ha creado con éxito" });
      onOpenChange(false);
    },
    onError: (error) => {
      toast({ title: "Error", description: error instanceof Error ? error.message : "Fallo en la creación", variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async (data: FormData) => {
      const payload: Record<string, string> = {
        firstName: data.firstName,
        lastName: data.lastName,
        email: data.email,
        role: data.role,
      };
      if (data.password) payload.password = data.password;
      if (data.pin) payload.pin = data.pin;
      return apiRequest("PATCH", `/api/employees/${employee!.id}`, payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/employees"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/stats"] });
      toast({ title: "Empleado actualizado", description: "Los datos se han guardado correctamente" });
      onOpenChange(false);
    },
    onError: (error) => {
      toast({ title: "Error", description: error instanceof Error ? error.message : "Fallo en la actualización", variant: "destructive" });
    },
  });

  const onSubmit = (data: FormData) => {
    if (isEdit) {
      updateMutation.mutate(data);
    } else {
      createMutation.mutate(data);
    }
  };

  const isPending = createMutation.isPending || updateMutation.isPending;

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <FormField
            control={form.control}
            name="firstName"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Nombre</FormLabel>
                <FormControl>
                  <Input placeholder="Juan" data-testid="input-first-name" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="lastName"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Apellido</FormLabel>
                <FormControl>
                  <Input placeholder="García" data-testid="input-last-name" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <FormField
          control={form.control}
          name="email"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Correo electrónico</FormLabel>
              <FormControl>
                <Input 
                  type="email" 
                  placeholder="juan.garcia@ejemplo.com" 
                  data-testid="input-employee-email"
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
              <FormLabel>{isEdit ? "Nueva contraseña" : "Contraseña"}</FormLabel>
              <FormControl>
                <Input 
                  type="password" 
                  placeholder={isEdit ? "Dejar vacío para no cambiar" : "••••••••"}
                  data-testid="input-employee-password"
                  {...field} 
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="role"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Rol</FormLabel>
              <Select onValueChange={field.onChange} value={field.value}>
                <FormControl>
                  <SelectTrigger data-testid="select-role">
                    <SelectValue placeholder="Seleccione un rol" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  <SelectItem value="employee">Empleado</SelectItem>
                  <SelectItem value="manager">Gerente</SelectItem>
                  <SelectItem value="admin">Administrador</SelectItem>
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="pin"
          render={({ field }) => (
            <FormItem>
              <FormLabel>
                {isEdit ? "Código PIN" : "Código PIN (obligatorio para quiosco)"}
              </FormLabel>
              <FormControl>
                <Input 
                  type="text" 
                  maxLength={6}
                  placeholder={isEdit ? "Dejar vacío para no cambiar" : "123456"}
                  data-testid="input-employee-pin"
                  {...field} 
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <DialogFooter className="gap-2">
          <Button 
            type="button" 
            variant="outline" 
            onClick={() => onOpenChange(false)}
            data-testid="button-cancel-employee"
          >
            Cancelar
          </Button>
          <Button 
            type="submit" 
            disabled={isPending}
            data-testid={isEdit ? "button-save-employee" : "button-create-employee"}
          >
            {isPending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                {isEdit ? "Guardando..." : "Creando..."}
              </>
            ) : (
              isEdit ? "Guardar" : "Crear"
            )}
          </Button>
        </DialogFooter>
      </form>
    </Form>
  );
}

export function EmployeeDialog({ open, onOpenChange, employee }: EmployeeDialogProps) {
  const isEdit = !!employee;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Editar empleado" : "Añadir un empleado"}</DialogTitle>
          <DialogDescription>
            {isEdit
              ? "Modifique los datos del empleado. Deje la contraseña y PIN vacíos para no cambiarlos."
              : "Cree una nueva cuenta de empleado con acceso al sistema de fichaje"}
          </DialogDescription>
        </DialogHeader>
        {open && <EmployeeForm key={employee?.id || "create"} employee={employee} onOpenChange={onOpenChange} />}
      </DialogContent>
    </Dialog>
  );
}
