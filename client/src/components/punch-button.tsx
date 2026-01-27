import { useState, useCallback, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Loader2, MapPin, AlertTriangle, Settings } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { SignatureModal } from "@/components/signature-modal";

interface PunchButtonProps {
  type: "IN" | "OUT";
  onPunch: (data: { type: "IN" | "OUT"; latitude: number; longitude: number; accuracy?: number; source: "mobile" | "kiosk"; signatureData: string }) => Promise<void>;
  source?: "mobile" | "kiosk";
  disabled?: boolean;
  size?: "default" | "large";
}

type PermissionState = "prompt" | "granted" | "denied" | "unsupported" | "checking";

export function PunchButton({ type, onPunch, source = "mobile", disabled = false, size = "default" }: PunchButtonProps) {
  const [isPending, setIsPending] = useState(false);
  const [geoStatus, setGeoStatus] = useState<"idle" | "loading" | "success" | "denied" | "error">("idle");
  const [geoError, setGeoError] = useState<string | null>(null);
  const [permissionState, setPermissionState] = useState<PermissionState>("checking");
  const [showSignature, setShowSignature] = useState(false);
  const [pendingGeoData, setPendingGeoData] = useState<{ latitude: number; longitude: number; accuracy?: number } | null>(null);
  const { toast } = useToast();

  useEffect(() => {
    const checkPermission = async () => {
      if (!("geolocation" in navigator)) {
        setPermissionState("unsupported");
        return;
      }

      if ("permissions" in navigator) {
        try {
          const result = await navigator.permissions.query({ name: "geolocation" });
          setPermissionState(result.state as PermissionState);
          
          result.addEventListener("change", () => {
            setPermissionState(result.state as PermissionState);
          });
        } catch {
          setPermissionState("prompt");
        }
      } else {
        setPermissionState("prompt");
      }
    };

    checkPermission();
  }, []);

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
          }, 5000);
          
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
              enableHighAccuracy: false,
              timeout: 5000,
              maximumAge: 60000,
            }
          );
        });
        
        latitude = Math.round(position.coords.latitude * 10000) / 10000;
        longitude = Math.round(position.coords.longitude * 10000) / 10000;
        accuracy = Math.round(position.coords.accuracy * 100) / 100;
        setGeoStatus("success");
        setPermissionState("granted");
      } catch (geoErr) {
        setGeoStatus("denied");
        
        let errorMessage = "Geolocalización denegada";
        if (geoErr instanceof GeolocationPositionError) {
          switch (geoErr.code) {
            case geoErr.PERMISSION_DENIED:
              errorMessage = "Permiso de ubicación denegado. Siga las instrucciones abajo para activarlo.";
              setPermissionState("denied");
              break;
            case geoErr.POSITION_UNAVAILABLE:
              errorMessage = "Posición no disponible. Verifique que el GPS/WiFi esté activado en su dispositivo.";
              break;
            case geoErr.TIMEOUT:
              errorMessage = "Tiempo de espera agotado (5s). Intente de nuevo o active el GPS de su dispositivo.";
              break;
          }
        } else if (geoErr instanceof Error && geoErr.message === "TIMEOUT") {
          errorMessage = "Tiempo de espera agotado. Active el GPS y vuelva a intentar.";
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

      setPendingGeoData({ latitude, longitude, accuracy });
      setShowSignature(true);
      setIsPending(false);
    } catch (error) {
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Fallo al fichar",
        variant: "destructive",
      });
      setIsPending(false);
    }
  }, [toast]);

  const handleSignatureConfirm = useCallback(async (signatureData: string) => {
    if (!pendingGeoData) return;
    
    setShowSignature(false);
    setIsPending(true);
    
    try {
      await onPunch({
        type,
        latitude: pendingGeoData.latitude,
        longitude: pendingGeoData.longitude,
        accuracy: pendingGeoData.accuracy,
        source,
        signatureData,
      });

      toast({
        title: type === "IN" ? "Entrada registrada" : "Salida registrada",
        description: `Fichaje confirmado con firma`,
      });
    } catch (error) {
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Fallo al fichar",
        variant: "destructive",
      });
    } finally {
      setIsPending(false);
      setPendingGeoData(null);
      setTimeout(() => {
        setGeoStatus("idle");
        setGeoError(null);
      }, 3000);
    }
  }, [pendingGeoData, type, onPunch, source, toast]);

  const handleSignatureCancel = useCallback(() => {
    setShowSignature(false);
    setPendingGeoData(null);
    setGeoStatus("idle");
    setGeoError(null);
  }, []);

  const isLarge = size === "large";
  const baseClasses = isLarge 
    ? "w-40 h-40 rounded-full text-xl font-semibold shadow-2xl transition-all duration-200"
    : "h-16 px-8 text-lg font-medium rounded-lg";
  
  const typeClasses = type === "IN"
    ? "bg-green-600 hover:bg-green-700 text-white border-green-700"
    : "bg-orange-500 hover:bg-orange-600 text-white border-orange-600";

  const getPermissionHelpMessage = () => {
    if (permissionState === "denied") {
      return {
        title: "Ubicación bloqueada",
        description: (
          <div className="space-y-2">
            <p>La geolocalización está bloqueada. Para activarla:</p>
            <ul className="list-disc list-inside text-xs space-y-1">
              <li><strong>iPhone/Safari:</strong> Ajustes → Safari → Ubicación → Permitir</li>
              <li><strong>Android/Chrome:</strong> Toque el candado 🔒 en la barra de direcciones → Permisos → Ubicación → Permitir</li>
              <li><strong>PC/Mac:</strong> Haga clic en el icono de candado junto a la URL y active la ubicación</li>
            </ul>
            <p className="text-xs mt-2">Luego recargue la página.</p>
          </div>
        ),
      };
    }
    if (permissionState === "prompt") {
      return {
        title: "Permiso de ubicación requerido",
        description: (
          <div className="space-y-2">
            <p>Al pulsar el botón, su navegador le pedirá permiso para acceder a su ubicación.</p>
            <p className="text-xs"><strong>Debe aceptar</strong> para poder fichar.</p>
          </div>
        ),
      };
    }
    if (permissionState === "unsupported") {
      return {
        title: "Navegador no compatible",
        description: "Su navegador no soporta geolocalización. Use Chrome, Safari o Firefox.",
      };
    }
    return null;
  };

  const helpMessage = getPermissionHelpMessage();

  return (
    <div className="flex flex-col items-center gap-4">
      {helpMessage && (
        <Alert variant={permissionState === "denied" ? "destructive" : "default"} className="max-w-sm">
          <Settings className="h-4 w-4" />
          <AlertTitle>{helpMessage.title}</AlertTitle>
          <AlertDescription>{helpMessage.description}</AlertDescription>
        </Alert>
      )}

      <Button
        onClick={handlePunch}
        disabled={disabled || isPending || permissionState === "unsupported"}
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
              <span className="text-muted-foreground">Obteniendo posición GPS... (hasta 5s)</span>
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

      <SignatureModal
        open={showSignature}
        punchType={type}
        onCancel={handleSignatureCancel}
        onConfirm={handleSignatureConfirm}
      />
    </div>
  );
}
