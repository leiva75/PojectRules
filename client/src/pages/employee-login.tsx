import { useState } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/lib/auth";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { Clock, Delete, ArrowLeft, Loader2 } from "lucide-react";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";

export default function EmployeeLoginPage() {
  const [, setLocation] = useLocation();
  const { employeeLogin } = useAuth();
  const { toast } = useToast();
  const [pin, setPin] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const handlePinChange = (value: string) => {
    setPin(value);
    if (value.length === 6) {
      handleSubmit(value);
    }
  };

  const handleSubmit = async (pinValue: string) => {
    if (pinValue.length !== 6) return;
    
    setIsLoading(true);
    try {
      await employeeLogin(pinValue);
      toast({
        title: "Connexion réussie",
        description: "Bienvenue !",
      });
      setLocation("/mobile");
    } catch (error) {
      toast({
        title: "Erreur",
        description: error instanceof Error ? error.message : "PIN invalide",
        variant: "destructive",
      });
      setPin("");
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeypadPress = (digit: string) => {
    if (pin.length < 6) {
      const newPin = pin + digit;
      setPin(newPin);
      if (newPin.length === 6) {
        handleSubmit(newPin);
      }
    }
  };

  const handleDelete = () => {
    setPin(pin.slice(0, -1));
  };

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center p-6">
      <div className="w-full max-w-sm space-y-6">
        <Button 
          variant="ghost" 
          className="mb-4"
          onClick={() => setLocation("/")}
          data-testid="button-back"
        >
          <ArrowLeft className="mr-2 h-4 w-4" />
          Retour
        </Button>

        <div className="text-center space-y-2">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-primary/10 mb-4">
            <Clock className="w-8 h-8 text-primary" />
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">Accès Employé</h1>
          <p className="text-muted-foreground">Entrez votre code PIN à 6 chiffres</p>
        </div>

        <Card className="border-card-border">
          <CardHeader className="text-center pb-2">
            <CardTitle className="text-lg">Code PIN</CardTitle>
            <CardDescription>Saisissez votre code personnel</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col items-center space-y-6">
            <InputOTP 
              value={pin} 
              onChange={handlePinChange}
              maxLength={6}
              disabled={isLoading}
              data-testid="input-pin"
            >
              <InputOTPGroup>
                <InputOTPSlot index={0} />
                <InputOTPSlot index={1} />
                <InputOTPSlot index={2} />
                <InputOTPSlot index={3} />
                <InputOTPSlot index={4} />
                <InputOTPSlot index={5} />
              </InputOTPGroup>
            </InputOTP>

            {isLoading && (
              <div className="flex items-center gap-2 text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                <span>Vérification...</span>
              </div>
            )}

            <div className="grid grid-cols-3 gap-3 w-full max-w-[240px]">
              {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((digit) => (
                <Button
                  key={digit}
                  variant="outline"
                  className="h-14 text-xl font-medium"
                  onClick={() => handleKeypadPress(digit)}
                  disabled={isLoading || pin.length >= 6}
                  data-testid={`button-keypad-${digit}`}
                >
                  {digit}
                </Button>
              ))}
              <div />
              <Button
                variant="outline"
                className="h-14 text-xl font-medium"
                onClick={() => handleKeypadPress("0")}
                disabled={isLoading || pin.length >= 6}
                data-testid="button-keypad-0"
              >
                0
              </Button>
              <Button
                variant="ghost"
                className="h-14"
                onClick={handleDelete}
                disabled={isLoading || pin.length === 0}
                data-testid="button-keypad-delete"
              >
                <Delete className="h-5 w-5" />
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
