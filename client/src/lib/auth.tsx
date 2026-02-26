import { createContext, useContext, useState, useEffect, useCallback } from "react";
import type { Employee } from "@shared/schema";

interface AuthContextType {
  user: Employee | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  login: (email: string, password: string) => Promise<void>;
  employeeLogin: (pin: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshAuth: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<Employee | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const refreshAuth = useCallback(async () => {
    try {
      const response = await fetch("/api/auth/me", {
        credentials: "include",
      });
      if (response.ok) {
        const data = await response.json();
        setUser(data.user);
      } else {
        setUser(null);
      }
    } catch {
      setUser(null);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshAuth();
  }, [refreshAuth]);

  useEffect(() => {
    const handleSessionExpired = async () => {
      try {
        await fetch("/api/auth/logout", {
          method: "POST",
          credentials: "include",
        });
      } catch {
      }
      localStorage.removeItem("employeeToken");
      setUser(null);
      window.location.href = "/";
    };
    window.addEventListener("auth:session-expired", handleSessionExpired);
    return () => window.removeEventListener("auth:session-expired", handleSessionExpired);
  }, []);

  const login = async (email: string, password: string) => {
    const response = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ email, password }),
    });
    
    if (!response.ok) {
      if (response.status === 429) {
        throw new Error("Demasiados intentos. Inténtelo de nuevo más tarde.");
      }
      const error = await response.json().catch(() => ({}));
      throw new Error(error.message || "Error de conexión");
    }
    
    const data = await response.json();
    setUser(data.user);
  };

  const employeeLogin = async (pin: string) => {
    const response = await fetch("/api/auth/employee-login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pin }),
    });
    
    if (!response.ok) {
      if (response.status === 429) {
        throw new Error("Demasiados intentos. Inténtelo de nuevo más tarde.");
      }
      const error = await response.json().catch(() => ({}));
      throw new Error(error.message || "PIN inválido");
    }
    
    const data = await response.json();
    localStorage.setItem("employeeToken", data.token);
    setUser(data.user);
  };

  const logout = async () => {
    try {
      await fetch("/api/auth/logout", {
        method: "POST",
        credentials: "include",
      });
    } catch {
    }
    localStorage.removeItem("employeeToken");
    setUser(null);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        isLoading,
        isAuthenticated: !!user,
        login,
        employeeLogin,
        logout,
        refreshAuth,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
