import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AlertCircle, ArrowLeft } from "lucide-react";
import { useLocation } from "wouter";

export default function NotFound() {
  const [, setLocation] = useLocation();

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-bg-app p-6">
      <Card className="w-full max-w-md border-card-border">
        <CardContent className="pt-6">
          <div className="flex mb-4 gap-3 items-center">
            <AlertCircle className="h-8 w-8 text-destructive" />
            <h1 className="text-2xl font-semibold">Página no encontrada</h1>
          </div>

          <p className="mt-4 text-sm text-muted-foreground">
            La página que busca no existe o ha sido movida.
          </p>

          <Button 
            className="mt-6 w-full"
            onClick={() => setLocation("/")}
            data-testid="button-go-home"
          >
            <ArrowLeft className="h-4 w-4 mr-2" />
            Volver al inicio
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
