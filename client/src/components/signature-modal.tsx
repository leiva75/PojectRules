import { useRef, useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { RotateCcw, Check, X } from "lucide-react";

interface SignatureModalProps {
  open: boolean;
  punchType: "IN" | "OUT";
  onCancel: () => void;
  onConfirm: (signatureData: string) => void;
}

export function SignatureModal({ open, punchType, onCancel, onConfirm }: SignatureModalProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [hasSignature, setHasSignature] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [canvasSize, setCanvasSize] = useState({ width: 600, height: 200 });

  useEffect(() => {
    const updateSize = () => {
      if (containerRef.current) {
        const containerWidth = containerRef.current.offsetWidth - 24;
        const isMobile = window.innerWidth < 640;
        const newWidth = Math.min(containerWidth, 700);
        const newHeight = isMobile
          ? Math.min(280, Math.max(180, containerWidth * 0.5))
          : Math.min(250, Math.max(150, containerWidth * 0.35));
        setCanvasSize({ width: newWidth, height: newHeight });
      }
    };

    if (open) {
      updateSize();
      window.addEventListener("resize", updateSize);
      document.body.style.overflow = "hidden";
      document.body.style.touchAction = "none";
    }

    return () => {
      window.removeEventListener("resize", updateSize);
      document.body.style.overflow = "";
      document.body.style.touchAction = "";
    };
  }, [open]);

  useEffect(() => {
    if (open && canvasRef.current) {
      const canvas = canvasRef.current;
      const ctx = canvas.getContext("2d");
      if (ctx) {
        const dpr = window.devicePixelRatio || 1;
        canvas.width = canvasSize.width * dpr;
        canvas.height = canvasSize.height * dpr;
        canvas.style.width = `${canvasSize.width}px`;
        canvas.style.height = `${canvasSize.height}px`;
        ctx.scale(dpr, dpr);
        ctx.fillStyle = "white";
        ctx.fillRect(0, 0, canvasSize.width, canvasSize.height);
        ctx.strokeStyle = "black";
        ctx.lineWidth = 2.5;
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
      }
      setHasSignature(false);
      setError(null);
    }
  }, [open, canvasSize]);

  const getEventPosition = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    
    const rect = canvas.getBoundingClientRect();
    let clientX: number, clientY: number;
    
    if ("touches" in e) {
      if (e.touches.length === 0) return { x: 0, y: 0 };
      clientX = e.touches[0].clientX;
      clientY = e.touches[0].clientY;
    } else {
      clientX = e.clientX;
      clientY = e.clientY;
    }
    
    return {
      x: clientX - rect.left,
      y: clientY - rect.top,
    };
  }, []);

  const startDrawing = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!ctx) return;

    setIsDrawing(true);
    setError(null);
    const pos = getEventPosition(e);
    ctx.beginPath();
    ctx.moveTo(pos.x, pos.y);
  }, [getEventPosition]);

  const draw = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    if (!isDrawing) return;
    e.preventDefault();
    
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!ctx) return;

    const pos = getEventPosition(e);
    ctx.lineTo(pos.x, pos.y);
    ctx.stroke();
    setHasSignature(true);
  }, [isDrawing, getEventPosition]);

  const stopDrawing = useCallback(() => {
    setIsDrawing(false);
  }, []);

  const handleClear = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!ctx || !canvas) return;

    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = "white";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.scale(dpr, dpr);
    ctx.strokeStyle = "black";
    ctx.lineWidth = 2.5;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    setHasSignature(false);
    setError(null);
  }, []);

  const handleConfirm = useCallback(() => {
    if (!hasSignature) {
      setError("Por favor firme antes de continuar");
      return;
    }

    const canvas = canvasRef.current;
    if (!canvas) return;

    const dataUrl = canvas.toDataURL("image/jpeg", 0.5);
    onConfirm(dataUrl);
  }, [hasSignature, onConfirm]);

  if (!open) return null;

  return (
    <div 
      className="fixed inset-0 bg-background/95 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-0 sm:p-4"
      onTouchMove={(e) => e.preventDefault()}
      data-testid="modal-signature"
    >
      <Card className="w-full sm:max-w-2xl border-card-border rounded-b-none sm:rounded-b-xl max-h-[100dvh] sm:max-h-[90vh] overflow-auto">
        <CardHeader className="text-center pb-2 sm:pb-4 relative px-4 sm:px-6 pt-4 sm:pt-6">
          <Button
            variant="ghost"
            size="icon"
            className="absolute right-2 top-2 sm:right-4 sm:top-4"
            onClick={onCancel}
            data-testid="button-signature-cancel"
          >
            <X className="h-5 w-5" />
          </Button>
          <CardTitle className="text-lg sm:text-xl">Firme para confirmar</CardTitle>
          <p className="text-sm sm:text-base text-muted-foreground">
            {punchType === "IN" ? "Entrada" : "Salida"} - Firma obligatoria
          </p>
        </CardHeader>
        <CardContent className="space-y-3 sm:space-y-4 px-3 sm:px-6 pb-4 sm:pb-6" ref={containerRef}>
          <div className="border-2 border-dashed border-border-subtle rounded-lg bg-white overflow-hidden">
            <canvas
              ref={canvasRef}
              className="w-full touch-none cursor-crosshair"
              style={{ 
                width: canvasSize.width, 
                height: canvasSize.height,
                touchAction: "none",
              }}
              onMouseDown={startDrawing}
              onMouseMove={draw}
              onMouseUp={stopDrawing}
              onMouseLeave={stopDrawing}
              onTouchStart={startDrawing}
              onTouchMove={draw}
              onTouchEnd={stopDrawing}
              onTouchCancel={stopDrawing}
              data-testid="canvas-signature"
            />
          </div>

          <p className="text-xs text-muted-foreground text-center">
            Dibuje su firma con el dedo o el ratón
          </p>

          {error && (
            <p className="text-destructive text-sm text-center" data-testid="text-signature-error">
              {error}
            </p>
          )}

          <div className="flex gap-3 justify-center pt-1">
            <Button
              variant="outline"
              size="lg"
              className="flex-1 sm:flex-none h-12 sm:h-10 text-base sm:text-sm"
              onClick={handleClear}
              data-testid="button-signature-clear"
            >
              <RotateCcw className="h-4 w-4 mr-2" />
              Borrar
            </Button>
            <Button
              size="lg"
              onClick={handleConfirm}
              className={`flex-1 sm:flex-none h-12 sm:h-10 text-base sm:text-sm ${punchType === "IN" ? "bg-green-600 hover:bg-green-700" : "bg-orange-500 hover:bg-orange-600"}`}
              data-testid="button-signature-submit"
            >
              <Check className="h-4 w-4 mr-2" />
              Confirmar {punchType === "IN" ? "entrada" : "salida"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
