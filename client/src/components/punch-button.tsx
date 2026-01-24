import { useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Loader2, MapPin, MapPinOff, AlertTriangle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface PunchButtonProps {
  type: "IN" | "OUT";
  onPunch: (data: { type: "IN" | "OUT"; latitude: number; longitude: number; accuracy?: number; source: "mobile" | "kiosk" }) => Promise<void>;
  source?: "mobile" | "kiosk";
  disabled?: boolean;
  size?: "default" | "large";
}

export function PunchButton({ type, onPunch, source = "mobile", disabled = false, size = "default" }: PunchButtonProps) {
  const [isPending, setIsPending] = useState(false);
  const [geoStatus, setGeoStatus] = useState<"idle" | "loading" | "success" | "denied" | "error">("idle");
  const [geoError, setGeoError] = useState<string | null>(null);
  const { toast } = useToast();

  const handlePunch = useCallback(async () => {
    setIsPending(true);
    setGeoStatus("loading");
    setGeoError(null);

    try {
      let latitude: number;
      let longitude: number;
      let accuracy: number | undefined;

      if (!("geolocation" in navigator)) {
        setGeoStatus("error");
        setGeoError("Su navegador no soporta geolocalización");
        toast({
          title: "GPS no disponible",
          description: "Su navegador no soporta geolocalización. El fichaje requiere posición GPS.",
          variant: "destructive",
        });
        setIsPending(false);
        return;
      }

      try {
        const position = await new Promise<GeolocationPosition>((resolve, reject) => {
          const timeoutId = setTimeout(() => {
            reject(new Error("TIMEOUT"));
          }, 8000);
          
          navigator.geolocation.getCurrentPosition(
            (pos) => {
              clearTimeout(timeoutId);
              resolve(pos);
            },
            (err) => {
              clearTimeout(timeoutId);
              reject(err);
            },
            {
              enableHighAccuracy: true,
              timeout: 8000,
              maximumAge: 30000,
            }
          );
        });
        
        latitude = Math.round(position.coords.latitude * 10000) / 10000;
        longitude = Math.round(position.coords.longitude * 10000) / 10000;
        accuracy = Math.round(position.coords.accuracy * 100) / 100;
        setGeoStatus("success");
      } catch (geoErr) {
        setGeoStatus("denied");
        
        let errorMessage = "Geolocalización denegada";
        if (geoErr instanceof GeolocationPositionError) {
          switch (geoErr.code) {
            case geoErr.PERMISSION_DENIED:
              errorMessage = "Permiso de ubicación denegado. Active la geolocalización en su navegador.";
              break;
            case geoErr.POSITION_UNAVAILABLE:
              errorMessage = "Posición no disponible. Verifique que el GPS esté activado.";
              break;
            case geoErr.TIMEOUT:
              errorMessage = "Tiempo de espera agotado. Intente de nuevo en un lugar con mejor señal.";
              break;
          }
        } else if (geoErr instanceof Error && geoErr.message === "TIMEOUT") {
          errorMessage = "Tiempo de espera agotado. Intente de nuevo.";
        }
        
        setGeoError(errorMessage);
        toast({
          title: "Posición GPS requerida",
          description: errorMessage,
          variant: "destructive",
        });
        setIsPending(false);
        return;
      }

      await onPunch({
        type,
        latitude,
        longitude,
        accuracy,
        source,
      });

      toast({
        title: type === "IN" ? "Entrada registrada" : "Salida registrada",
        description: `Posición capturada (precisión: ${accuracy}m)`,
      });
    } catch (error) {
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Fallo al fichar",
        variant: "destructive",
      });
    } finally {
      setIsPending(false);
      setTimeout(() => {
        setGeoStatus("idle");
        setGeoError(null);
      }, 5000);
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
          <span>{type === "IN" ? "ENTRADA" : "SALIDA"}</span>
        )}
      </Button>
      
      {geoStatus !== "idle" && (
        <div className="flex flex-col items-center gap-1 text-sm max-w-xs text-center">
          {geoStatus === "loading" && (
            <div className="flex items-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
              <span className="text-muted-foreground">Obteniendo posición GPS...</span>
            </div>
          )}
          {geoStatus === "success" && (
            <div className="flex items-center gap-2">
              <MapPin className="w-4 h-4 text-green-600" />
              <span className="text-green-600">Posición capturada</span>
            </div>
          )}
          {(geoStatus === "denied" || geoStatus === "error") && (
            <div className="flex flex-col items-center gap-2">
              <div className="flex items-center gap-2 text-red-600">
                <AlertTriangle className="w-4 h-4" />
                <span>GPS requerido</span>
              </div>
              {geoError && (
                <p className="text-xs text-red-500">{geoError}</p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
