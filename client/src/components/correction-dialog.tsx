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
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useToast } from "@/hooks/use-toast";
import { AlertTriangle, Loader2 } from "lucide-react";
import type { Punch } from "@shared/schema";

const correctionFormSchema = z.object({
  reason: z.string().min(10, "La raison doit contenir au moins 10 caractères"),
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
      if (!punch) throw new Error("Aucun pointage sélectionné");
      
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
        title: "Correction enregistrée",
        description: "La correction a été ajoutée avec succès",
      });
      form.reset();
      onOpenChange(false);
    },
    onError: (error) => {
      toast({
        title: "Erreur",
        description: error instanceof Error ? error.message : "Échec de la correction",
        variant: "destructive",
      });
    },
  });

  const onSubmit = (data: CorrectionFormData) => {
    correctionMutation.mutate(data);
  };

  if (!punch) return null;

  const formattedTimestamp = new Date(punch.timestamp).toISOString().slice(0, 16);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Corriger un pointage</DialogTitle>
          <DialogDescription>
            {punch.employee && (
              <span>
                Pointage de {punch.employee.firstName} {punch.employee.lastName}
              </span>
            )}
          </DialogDescription>
        </DialogHeader>

        <Alert className="bg-amber-50 border-amber-200 dark:bg-amber-950 dark:border-amber-800">
          <AlertTriangle className="h-4 w-4 text-amber-600" />
          <AlertDescription className="text-amber-800 dark:text-amber-200">
            Mode append-only : le pointage original reste inchangé. Une nouvelle entrée de correction sera créée.
          </AlertDescription>
        </Alert>

        <div className="space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Type actuel :</span>
            <span className="font-medium">{punch.type === "IN" ? "Entrée" : "Sortie"}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Horodatage actuel :</span>
            <span className="font-mono">{new Date(punch.timestamp).toLocaleString("fr-FR")}</span>
          </div>
          {punch.needsReview && (
            <div className="flex justify-between">
              <span className="text-muted-foreground">Statut :</span>
              <span className="text-red-600 font-medium">À vérifier (sans géolocalisation)</span>
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
                  <FormLabel>Raison de la correction *</FormLabel>
                  <FormControl>
                    <Textarea 
                      placeholder="Décrivez la raison de cette correction (min. 10 caractères)"
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
                  <FormLabel>Nouveau type (optionnel)</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger data-testid="select-new-type">
                        <SelectValue placeholder="Garder le type actuel" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="IN">Entrée</SelectItem>
                      <SelectItem value="OUT">Sortie</SelectItem>
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
                  <FormLabel>Nouvel horodatage (optionnel)</FormLabel>
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
                Annuler
              </Button>
              <Button 
                type="submit" 
                disabled={correctionMutation.isPending}
                data-testid="button-submit-correction"
              >
                {correctionMutation.isPending ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Enregistrement...
                  </>
                ) : (
                  "Enregistrer la correction"
                )}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
