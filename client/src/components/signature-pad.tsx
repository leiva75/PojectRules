import { useRef, useState, useEffect } from "react";
import SignatureCanvas from "react-signature-canvas";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, RotateCcw, Check, X } from "lucide-react";

interface SignaturePadProps {
  punchId: string;
  employeeName: string;
  punchType: "IN" | "OUT";
  kioskToken: string;
  onComplete: () => void;
  onCancel: () => void;
}

export function SignaturePad({ 
  punchId, 
  employeeName, 
  punchType, 
  kioskToken,
  onComplete, 
  onCancel 
}: SignaturePadProps) {
  const sigCanvas = useRef<SignatureCanvas>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [canvasSize, setCanvasSize] = useState({ width: 600, height: 200 });

  useEffect(() => {
    const updateSize = () => {
      if (containerRef.current) {
        const containerWidth = containerRef.current.offsetWidth - 32;
        setCanvasSize({
          width: Math.min(containerWidth, 700),
          height: Math.min(250, Math.max(150, containerWidth * 0.35)),
        });
      }
    };

    updateSize();
    window.addEventListener("resize", updateSize);
    return () => window.removeEventListener("resize", updateSize);
  }, []);

  const handleClear = () => {
    sigCanvas.current?.clear();
    setError(null);
  };

  const handleSubmit = async () => {
    if (!sigCanvas.current) return;

    if (sigCanvas.current.isEmpty()) {
      setError("Por favor firme antes de continuar");
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      const dataUrl = sigCanvas.current.getTrimmedCanvas().toDataURL("image/png");
      const blob = await fetch(dataUrl).then(r => r.blob());

      const formData = new FormData();
      formData.append("signature", blob, "signature.png");

      const response = await fetch(`/api/kiosk/punches/${punchId}/signature`, {
        method: "POST",
        headers: {
          "X-KIOSK-TOKEN": kioskToken,
        },
        body: formData,
      });

      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.error?.message || "Error al guardar la firma");
      }

      onComplete();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al guardar la firma");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-background/95 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <Card className="w-full max-w-2xl border-card-border">
        <CardHeader className="text-center pb-4 relative">
          <Button
            variant="ghost"
            size="icon"
            className="absolute right-4 top-4"
            onClick={onCancel}
            disabled={isSubmitting}
            data-testid="button-signature-cancel"
          >
            <X className="h-5 w-5" />
          </Button>
          <CardTitle className="text-xl">Firme para confirmar</CardTitle>
          <p className="text-muted-foreground">
            {employeeName} - {punchType === "IN" ? "Entrada" : "Salida"}
          </p>
        </CardHeader>
        <CardContent className="space-y-4" ref={containerRef}>
          <div className="border rounded-lg bg-white overflow-hidden" data-testid="canvas-signature">
            <SignatureCanvas
              ref={sigCanvas}
              canvasProps={{
                width: canvasSize.width,
                height: canvasSize.height,
                className: "signature-canvas w-full touch-none",
              }}
              penColor="black"
              minWidth={1}
              maxWidth={2.5}
              velocityFilterWeight={0.7}
            />
          </div>

          {error && (
            <p className="text-destructive text-sm text-center" data-testid="text-signature-error">
              {error}
            </p>
          )}

          <div className="flex gap-3 justify-center">
            <Button
              variant="outline"
              onClick={handleClear}
              disabled={isSubmitting}
              data-testid="button-signature-clear"
            >
              <RotateCcw className="h-4 w-4 mr-2" />
              Borrar
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={isSubmitting}
              data-testid="button-signature-submit"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Guardando...
                </>
              ) : (
                <>
                  <Check className="h-4 w-4 mr-2" />
                  Confirmar firma
                </>
              )}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
