import { useState, useEffect, useMemo } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { LOGO_SRC, APP_NAME } from "@/config/brand";
import { LogOut, FileDown, FileSpreadsheet, Clock, Calendar, Timer, AlertCircle } from "lucide-react";

interface ShiftEntry {
  date: string;
  clockIn: string | null;
  clockInTime: string | null;
  clockOut: string | null;
  clockOutTime: string | null;
  durationMin: number | null;
  status: "OK" | "INCOMPLETE";
}

interface ShiftsResponse {
  shifts: ShiftEntry[];
  period: { from: string; to: string };
}

interface PortalUser {
  firstName: string;
  lastName: string;
  email: string;
  role: string;
}

function formatDurationFromMin(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}h ${m.toString().padStart(2, "0")}m`;
}

function getMonthOptions(): { value: string; label: string }[] {
  const options: { value: string; label: string }[] = [];
  const now = new Date();
  const months = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];

  for (let i = 0; i < 12; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const val = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const label = `${months[d.getMonth()]} ${d.getFullYear()}`;
    options.push({ value: val, label });
  }
  return options;
}

function getMonthRange(monthStr: string): { from: string; to: string } {
  const [year, month] = monthStr.split("-").map(Number);
  const firstDay = `${year}-${String(month).padStart(2, "0")}-01`;
  const lastDay = new Date(year, month, 0).getDate();
  const lastDayStr = `${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
  return { from: firstDay, to: lastDayStr };
}

export default function EmployeeShiftsPage() {
  const [, setLocation] = useLocation();
  const [portalUser, setPortalUser] = useState<PortalUser | null>(null);
  const [isCheckingAuth, setIsCheckingAuth] = useState(true);

  const now = new Date();
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const [selectedMonth, setSelectedMonth] = useState(currentMonth);
  const monthRange = useMemo(() => getMonthRange(selectedMonth), [selectedMonth]);

  useEffect(() => {
    const checkAuth = async () => {
      try {
        const res = await fetch("/api/auth/employee/me", { credentials: "include" });
        if (!res.ok) {
          setLocation("/empleado");
          return;
        }
        const data = await res.json();
        setPortalUser(data.user);
      } catch {
        setLocation("/empleado");
      } finally {
        setIsCheckingAuth(false);
      }
    };
    checkAuth();
  }, [setLocation]);

  const { data, isLoading, error } = useQuery<ShiftsResponse>({
    queryKey: ["meShifts", monthRange.from, monthRange.to],
    queryFn: async () => {
      const res = await fetch(`/api/me/shifts?from=${monthRange.from}&to=${monthRange.to}`, {
        credentials: "include",
      });
      if (res.status === 401) {
        setLocation("/empleado");
        throw new Error("Sesión expirada");
      }
      if (!res.ok) {
        throw new Error("Error al cargar fichajes");
      }
      return res.json();
    },
    enabled: !isCheckingAuth && !!portalUser,
    staleTime: 60000,
    refetchOnWindowFocus: false,
  });

  const logoutMutation = useMutation({
    mutationFn: async () => {
      try {
        await apiRequest("POST", "/api/auth/employee/logout");
      } catch {}
    },
    onSettled: () => {
      setLocation("/empleado");
    },
  });

  const handleLogout = () => {
    logoutMutation.mutate();
  };

  const totalMinutes = useMemo(() => {
    if (!data?.shifts) return 0;
    return data.shifts.reduce((sum, s) => sum + (s.durationMin || 0), 0);
  }, [data?.shifts]);

  const monthOptions = useMemo(() => getMonthOptions(), []);

  if (isCheckingAuth) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[var(--bg-app)]">
        <Clock className="h-8 w-8 animate-spin text-blue-500" />
      </div>
    );
  }

  const pdfUrl = `/api/me/shifts/export.pdf?from=${monthRange.from}&to=${monthRange.to}`;
  const csvUrl = `/api/me/shifts/export.csv?from=${monthRange.from}&to=${monthRange.to}`;

  return (
    <div className="min-h-screen bg-[var(--bg-app)] flex flex-col">
      <header className="bg-[#0f172a] text-white px-4 py-3 flex items-center justify-between sticky top-0 z-10">
        <div className="flex items-center gap-3">
          <img src={LOGO_SRC} alt={APP_NAME} className="h-8 w-auto" data-testid="img-logo-shifts" />
          <div>
            <h1 className="text-lg font-semibold leading-tight" data-testid="text-title">Mis Fichajes</h1>
            {portalUser && (
              <p className="text-xs text-blue-200/70" data-testid="text-user-name">
                {portalUser.firstName} {portalUser.lastName}
              </p>
            )}
          </div>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={handleLogout}
          className="text-blue-200/70 hover:text-white hover:bg-white/10"
          data-testid="button-logout"
        >
          <LogOut className="h-4 w-4 sm:mr-2" />
          <span className="hidden sm:inline">Cerrar sesión</span>
        </Button>
      </header>

      <main className="flex-1 p-4 max-w-4xl mx-auto w-full space-y-4 pb-24 sm:pb-4">
        <div className="flex flex-col sm:flex-row sm:items-end gap-3">
          <div className="flex-1">
            <label className="text-sm font-medium text-slate-600 mb-1 block">Período</label>
            <Select value={selectedMonth} onValueChange={setSelectedMonth}>
              <SelectTrigger className="h-11 bg-white" data-testid="select-month">
                <Calendar className="h-4 w-4 mr-2 text-slate-400" />
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {monthOptions.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value} data-testid={`option-month-${opt.value}`}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="hidden sm:flex gap-2">
            <a href={pdfUrl} target="_blank" rel="noreferrer" data-testid="link-download-pdf">
              <Button variant="outline" size="sm" className="gap-2">
                <FileDown className="h-4 w-4" />
                PDF
              </Button>
            </a>
            <a href={csvUrl} target="_blank" rel="noreferrer" data-testid="link-download-csv">
              <Button variant="outline" size="sm" className="gap-2">
                <FileSpreadsheet className="h-4 w-4" />
                CSV
              </Button>
            </a>
          </div>
        </div>

        {error && (
          <div className="flex items-center gap-2 p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm" data-testid="text-error">
            <AlertCircle className="h-4 w-4 flex-shrink-0" />
            Error al cargar los fichajes. Inténtelo de nuevo.
          </div>
        )}

        {isLoading ? (
          <div className="space-y-3">
            {[...Array(5)].map((_, i) => (
              <Card key={i} className="sm:hidden">
                <CardContent className="p-4 space-y-2">
                  <Skeleton className="h-5 w-32" />
                  <Skeleton className="h-4 w-48" />
                  <Skeleton className="h-4 w-24" />
                </CardContent>
              </Card>
            ))}
            <div className="hidden sm:block">
              <Skeleton className="h-10 w-full mb-2" />
              {[...Array(5)].map((_, i) => (
                <Skeleton key={i} className="h-12 w-full mb-1" />
              ))}
            </div>
          </div>
        ) : data?.shifts && data.shifts.length > 0 ? (
          <>
            <div className="sm:hidden space-y-3">
              {data.shifts.map((shift, idx) => (
                <Card key={idx} className="border-[var(--border-subtle)]" data-testid={`card-shift-${idx}`}>
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between mb-2">
                      <span className="font-semibold text-slate-800 text-base" data-testid={`text-date-${idx}`}>
                        {shift.date}
                      </span>
                      {shift.status === "INCOMPLETE" && (
                        <Badge variant="outline" className="text-amber-600 border-amber-300 bg-amber-50 text-xs">
                          Incompleto
                        </Badge>
                      )}
                    </div>
                    <div className="grid grid-cols-3 gap-2 text-sm">
                      <div>
                        <span className="text-slate-500 block text-xs">Entrada</span>
                        <span className="font-medium text-slate-700" data-testid={`text-clockin-${idx}`}>
                          {shift.clockInTime || "—"}
                        </span>
                      </div>
                      <div>
                        <span className="text-slate-500 block text-xs">Salida</span>
                        <span className="font-medium text-slate-700" data-testid={`text-clockout-${idx}`}>
                          {shift.clockOutTime || "—"}
                        </span>
                      </div>
                      <div>
                        <span className="text-slate-500 block text-xs">Duración</span>
                        <span className="font-medium text-slate-700" data-testid={`text-duration-${idx}`}>
                          {shift.durationMin !== null ? formatDurationFromMin(shift.durationMin) : "—"}
                        </span>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>

            <div className="hidden sm:block">
              <Card className="border-[var(--border-subtle)]">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Fecha</TableHead>
                      <TableHead>Entrada</TableHead>
                      <TableHead>Salida</TableHead>
                      <TableHead>Duración</TableHead>
                      <TableHead>Estado</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.shifts.map((shift, idx) => (
                      <TableRow key={idx} data-testid={`row-shift-${idx}`}>
                        <TableCell className="font-medium" data-testid={`text-table-date-${idx}`}>{shift.date}</TableCell>
                        <TableCell data-testid={`text-table-clockin-${idx}`}>{shift.clockInTime || "—"}</TableCell>
                        <TableCell data-testid={`text-table-clockout-${idx}`}>{shift.clockOutTime || "—"}</TableCell>
                        <TableCell data-testid={`text-table-duration-${idx}`}>
                          {shift.durationMin !== null ? formatDurationFromMin(shift.durationMin) : "—"}
                        </TableCell>
                        <TableCell>
                          {shift.status === "INCOMPLETE" ? (
                            <Badge variant="outline" className="text-amber-600 border-amber-300 bg-amber-50">
                              Incompleto
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="text-green-600 border-green-300 bg-green-50">
                              OK
                            </Badge>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </Card>
            </div>

            <Card className="border-blue-200 bg-blue-50/50">
              <CardContent className="p-4 flex items-center justify-between">
                <div className="flex items-center gap-2 text-blue-700">
                  <Timer className="h-5 w-5" />
                  <span className="font-medium">Total del período</span>
                </div>
                <span className="text-lg font-bold text-blue-800" data-testid="text-total-hours">
                  {formatDurationFromMin(totalMinutes)}
                </span>
              </CardContent>
            </Card>
          </>
        ) : (
          <Card className="border-[var(--border-subtle)]">
            <CardContent className="p-8 text-center text-slate-500">
              <Clock className="h-12 w-12 mx-auto mb-3 text-slate-300" />
              <p className="font-medium">Sin fichajes</p>
              <p className="text-sm mt-1">No hay registros para el período seleccionado</p>
            </CardContent>
          </Card>
        )}
      </main>

      <div className="sm:hidden fixed bottom-0 left-0 right-0 bg-white border-t border-slate-200 px-4 py-3 flex gap-2 z-20" style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}>
        <a href={pdfUrl} target="_blank" rel="noreferrer" className="flex-1" data-testid="link-mobile-pdf">
          <Button className="w-full bg-blue-600 hover:bg-blue-500 text-white gap-2">
            <FileDown className="h-4 w-4" />
            Descargar PDF
          </Button>
        </a>
        <a href={csvUrl} target="_blank" rel="noreferrer" data-testid="link-mobile-csv">
          <Button variant="outline" className="gap-2">
            <FileSpreadsheet className="h-4 w-4" />
            CSV
          </Button>
        </a>
      </div>
    </div>
  );
}
