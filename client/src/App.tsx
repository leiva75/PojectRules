import { Switch, Route, useLocation, Redirect } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "@/lib/auth";
import NotFound from "@/pages/not-found";
import LoginPage from "@/pages/login";
import EmployeeLoginPage from "@/pages/employee-login";
import MobilePage from "@/pages/mobile";
import KioskPage from "@/pages/kiosk";
import AdminPage from "@/pages/admin";
import EmployeePortalLoginPage from "@/pages/employee-portal-login";
import EmployeeShiftsPage from "@/pages/employee-shifts";
import { Loader2 } from "lucide-react";

function ProtectedRoute({ 
  children, 
  allowedRoles 
}: { 
  children: React.ReactNode; 
  allowedRoles?: string[];
}) {
  const { user, isLoading, isAuthenticated } = useAuth();
  const [, setLocation] = useLocation();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Redirect to="/" />;
  }

  if (allowedRoles && user && !allowedRoles.includes(user.role)) {
    if (user.role === "employee") {
      return <Redirect to="/mobile" />;
    }
    return <Redirect to="/admin" />;
  }

  return <>{children}</>;
}

function Router() {
  return (
    <Switch>
      <Route path="/" component={LoginPage} />
      <Route path="/employee" component={EmployeeLoginPage} />
      <Route path="/kiosk" component={KioskPage} />
      <Route path="/empleado" component={EmployeePortalLoginPage} />
      <Route path="/empleado/mis-fichajes" component={EmployeeShiftsPage} />
      <Route path="/mobile">
        <ProtectedRoute allowedRoles={["employee", "manager", "admin"]}>
          <MobilePage />
        </ProtectedRoute>
      </Route>
      <Route path="/admin">
        <ProtectedRoute allowedRoles={["admin", "manager"]}>
          <AdminPage />
        </ProtectedRoute>
      </Route>
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <AuthProvider>
          <Router />
          <Toaster />
        </AuthProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
