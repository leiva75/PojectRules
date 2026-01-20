import { useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Loader2, MapPin, MapPinOff } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface PunchButtonProps {
  type: "IN" | "OUT";
  onPunch: (data: { type: "IN" | "OUT"; latitude?: number; longitude?: number; accuracy?: number; source: "mobile" | "kiosk" }) => Promise<void>;
  source?: "mobile" | "kiosk";
  disabled?: boolean;
  size?: "default" | "large";
}

export function PunchButton({ type, onPunch, source = "mobile", disabled = false, size = "default" }: PunchButtonProps) {
  const [isPending, setIsPending] = useState(false);
  const [geoStatus, setGeoStatus] = useState<"idle" | "loading" | "success" | "denied">("idle");
  const { toast } = useToast();

  const handlePunch = useCallback(async () => {
    setIsPending(true);
    setGeoStatus("loading");

    try {
      let latitude: number | undefined;
      let longitude: number | undefined;
      let accuracy: number | undefined;

      if ("geolocation" in navigator) {
        try {
          const position = await new Promise<GeolocationPosition>((resolve, reject) => {
            navigator.geolocation.getCurrentPosition(resolve, reject, {
              enableHighAccuracy: true,
              timeout: 10000,
              maximumAge: 0,
            });
          });
          
          latitude = Math.round(position.coords.latitude * 10000) / 10000;
          longitude = Math.round(position.coords.longitude * 10000) / 10000;
          accuracy = Math.round(position.coords.accuracy * 100) / 100;
          setGeoStatus("success");
        } catch {
          setGeoStatus("denied");
          toast({
            title: "Géolocalisation refusée",
            description: "Le pointage sera marqué pour vérification",
            variant: "destructive",
          });
        }
      } else {
        setGeoStatus("denied");
      }

      await onPunch({
        type,
        latitude,
        longitude,
        accuracy,
        source,
      });

      toast({
        title: type === "IN" ? "Entrée enregistrée" : "Sortie enregistrée",
        description: latitude ? "Position capturée avec succès" : "Sans position GPS",
      });
    } catch (error) {
      toast({
        title: "Erreur",
        description: error instanceof Error ? error.message : "Échec du pointage",
        variant: "destructive",
      });
    } finally {
      setIsPending(false);
      setTimeout(() => setGeoStatus("idle"), 2000);
    }
  }, [type, onPunch, source, toast]);

  const isLarge = size === "large";
  const baseClasses = isLarge 
    ? "w-40 h-40 rounded-full text-xl font-semibold shadow-2xl transition-all duration-200"
    : "h-16 px-8 text-lg font-medium rounded-lg";
  
  const typeClasses = type === "IN"
    ? "bg-green-600 hover:bg-green-700 text-white border-green-700"
    : "bg-orange-500 hover:bg-orange-600 text-white border-orange-600";

  return (
    <div className="flex flex-col items-center gap-3">
      <Button
        onClick={handlePunch}
        disabled={disabled || isPending}
        className={`${baseClasses} ${typeClasses}`}
        data-testid={`button-punch-${type.toLowerCase()}`}
      >
        {isPending ? (
          <Loader2 className={`animate-spin ${isLarge ? "w-10 h-10" : "w-6 h-6"}`} />
        ) : (
          <span>{type === "IN" ? "ENTRÉE" : "SORTIE"}</span>
        )}
      </Button>
      
      {geoStatus !== "idle" && (
        <div className="flex items-center gap-2 text-sm">
          {geoStatus === "loading" && (
            <>
              <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
              <span className="text-muted-foreground">Localisation...</span>
            </>
          )}
          {geoStatus === "success" && (
            <>
              <MapPin className="w-4 h-4 text-green-600" />
              <span className="text-green-600">Position capturée</span>
            </>
          )}
          {geoStatus === "denied" && (
            <>
              <MapPinOff className="w-4 h-4 text-red-600" />
              <span className="text-red-600">Sans position</span>
            </>
          )}
        </div>
      )}
    </div>
  );
}
