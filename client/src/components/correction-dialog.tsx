import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { TIMEZONE } from "@/lib/timezone";
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
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useToast } from "@/hooks/use-toast";
import { AlertTriangle, Loader2 } from "lucide-react";
import type { Punch } from "@shared/schema";

const correctionFormSchema = z.object({
  reason: z.string().min(10, "El motivo debe tener al menos 10 caracteres"),
  newTimestamp: z.string().optional(),
  newType: z.enum(["IN", "OUT"]).optional(),
});

type CorrectionFormData = z.infer<typeof correctionFormSchema>;

interface PunchWithEmployee extends Punch {
  employee?: {
    id: string;
    firstName: string;
    lastName: string;
  };
}

interface CorrectionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  punch: PunchWithEmployee | null;
}

export function CorrectionDialog({ open, onOpenChange, punch }: CorrectionDialogProps) {
  const { toast } = useToast();

  const form = useForm<CorrectionFormData>({
    resolver: zodResolver(correctionFormSchema),
    defaultValues: {
      reason: "",
      newTimestamp: "",
      newType: undefined,
    },
  });

  const correctionMutation = useMutation({
    mutationFn: async (data: CorrectionFormData) => {
      if (!punch) throw new Error("Ningún fichaje seleccionado");
      
      return apiRequest("POST", "/api/corrections", {
        originalPunchId: punch.id,
        reason: data.reason,
        newTimestamp: data.newTimestamp || undefined,
        newType: data.newType || undefined,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/punches"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/stats"] });
      toast({
        title: "Corrección registrada",
        description: "La corrección se ha añadido con éxito",
      });
      form.reset();
      onOpenChange(false);
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Fallo en la corrección",
        variant: "destructive",
      });
    },
  });

  const onSubmit = (data: CorrectionFormData) => {
    correctionMutation.mutate(data);
  };

  if (!punch) return null;

  const punchDate = new Date(punch.timestamp);
  const madridParts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(punchDate);
  const get = (t: string) => madridParts.find(p => p.type === t)?.value || "00";
  const formattedTimestamp = `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Corregir un fichaje</DialogTitle>
          <DialogDescription>
            {punch.employee && (
              <span>
                Fichaje de {punch.employee.firstName} {punch.employee.lastName}
              </span>
            )}
          </DialogDescription>
        </DialogHeader>

        <Alert className="bg-amber-50 border-amber-200 dark:bg-amber-950 dark:border-amber-800">
          <AlertTriangle className="h-4 w-4 text-amber-600" />
          <AlertDescription className="text-amber-800 dark:text-amber-200">
            Modo append-only: el fichaje original permanece sin cambios. Se creará una nueva entrada de corrección.
          </AlertDescription>
        </Alert>

        <div className="space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Tipo actual:</span>
            <span className="font-medium">{punch.type === "IN" ? "Entrada" : "Salida"}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Fecha/hora actual:</span>
            <span className="font-mono">{new Date(punch.timestamp).toLocaleString("es-ES", { timeZone: "Europe/Madrid" })}</span>
          </div>
          {punch.needsReview && (
            <div className="flex justify-between">
              <span className="text-muted-foreground">Estado:</span>
              <span className="text-red-600 font-medium">Por verificar (sin geolocalización)</span>
            </div>
          )}
        </div>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="reason"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Motivo de la corrección *</FormLabel>
                  <FormControl>
                    <Textarea 
                      placeholder="Describa el motivo de esta corrección (mín. 10 caracteres)"
                      className="resize-none"
                      rows={3}
                      data-testid="input-correction-reason"
                      {...field} 
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="newType"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Nuevo tipo (opcional)</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger data-testid="select-new-type">
                        <SelectValue placeholder="Mantener tipo actual" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="IN">Entrada</SelectItem>
                      <SelectItem value="OUT">Salida</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="newTimestamp"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Nueva fecha/hora (opcional)</FormLabel>
                  <FormControl>
                    <Input 
                      type="datetime-local" 
                      defaultValue={formattedTimestamp}
                      data-testid="input-new-timestamp"
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
                data-testid="button-cancel-correction"
              >
                Cancelar
              </Button>
              <Button 
                type="submit" 
                disabled={correctionMutation.isPending}
                data-testid="button-submit-correction"
              >
                {correctionMutation.isPending ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Guardando...
                  </>
                ) : (
                  "Guardar corrección"
                )}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
