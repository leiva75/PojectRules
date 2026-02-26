import { useState, useMemo } from "react";
import { useAuth } from "@/lib/auth";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useLocation } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { computeDurationMinutes, formatDuration } from "@/lib/duration";
import {
  SidebarProvider,
  SidebarTrigger,
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarHeader,
  SidebarFooter,
} from "@/components/ui/sidebar";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { StatusBadge, GeoBadge, TimeBadge } from "@/components/status-badge";
import {
  LayoutDashboard,
  Users,
  Clock,
  FileText,
  Settings,
  LogOut,
  Plus,
  Download,
  AlertTriangle,
  CheckCircle,
  TrendingUp,
  ClipboardCheck,
  Eye,
  Timer,
  ThumbsUp,
  ThumbsDown,
  Activity,
  Monitor,
  Copy,
  Trash2,
  Power,
  Pencil,
} from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { Employee, Punch } from "@shared/schema";
import { EmployeeDialog } from "@/components/employee-dialog";
import { ExportDialog } from "@/components/export-dialog";
import { CorrectionDialog } from "@/components/correction-dialog";
import { LOGO_SRC, APP_NAME } from "@/config/brand";

interface DashboardStats {
  totalEmployees: number;
  activeToday: number;
  currentlyIn: number;
  needsReview: number;
}

interface PunchWithEmployee extends Punch {
  employee: {
    id: string;
    firstName: string;
    lastName: string;
  };
}

interface OvertimeRequestWithDetails {
  id: string;
  employeeId: string;
  date: string;
  minutes: number;
  reason: string;
  status: "pending" | "approved" | "rejected";
  reviewerId: string | null;
  reviewerComment: string | null;
  createdAt: string;
  reviewedAt: string | null;
  employee: {
    id: string;
    firstName: string;
    lastName: string;
  };
  reviewer?: {
    id: string;
    firstName: string;
    lastName: string;
  } | null;
}

interface EstadoData {
  version: string;
  environment: string;
  database: {
    status: string;
    connection: string;
  };
  stats: {
    employees: number;
    sites: number;
  };
  uptime: number;
  timestamp: string;
}

function EstadoTab() {
  const { data: estado, isLoading, error } = useQuery<EstadoData>({
    queryKey: ["/api/estado"],
    refetchInterval: 30000,
  });

  const formatUptime = (seconds: number) => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    return `${hours}h ${minutes}m`;
  };

  if (isLoading) {
    return (
      <Card className="border-card-border">
        <CardContent className="py-12 text-center">
          <Activity className="h-8 w-8 mx-auto animate-pulse text-muted-foreground" />
          <p className="mt-4 text-muted-foreground">Cargando...</p>
        </CardContent>
      </Card>
    );
  }

  if (error || !estado) {
    return (
      <Card className="border-card-border">
        <CardContent className="py-12 text-center">
          <AlertTriangle className="h-8 w-8 mx-auto text-destructive" />
          <p className="mt-4 text-destructive">Error de conexión</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <Card className="border-card-border">
        <CardHeader>
          <CardTitle data-testid="text-estado-title">Estado del Sistema</CardTitle>
          <CardDescription>Información de diagnóstico para debug</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            <div className="p-4 rounded-lg bg-muted/50">
              <div className="text-sm text-muted-foreground mb-1">Version</div>
              <div className="text-lg font-semibold" data-testid="text-estado-version">{estado.version}</div>
            </div>
            <div className="p-4 rounded-lg bg-muted/50">
              <div className="text-sm text-muted-foreground mb-1">Entorno</div>
              <Badge variant={estado.environment === "production" ? "default" : "secondary"} data-testid="badge-estado-env">
                {estado.environment}
              </Badge>
            </div>
            <div className="p-4 rounded-lg bg-muted/50">
              <div className="text-sm text-muted-foreground mb-1">Base de datos</div>
              <Badge variant={estado.database.status === "ok" ? "default" : "destructive"} data-testid="badge-estado-db">
                {estado.database.connection}
              </Badge>
            </div>
            <div className="p-4 rounded-lg bg-muted/50">
              <div className="text-sm text-muted-foreground mb-1">Empleados</div>
              <div className="text-lg font-semibold" data-testid="text-estado-employees">{estado.stats.employees}</div>
            </div>
            <div className="p-4 rounded-lg bg-muted/50">
              <div className="text-sm text-muted-foreground mb-1">Empleados activos</div>
              <div className="text-lg font-semibold" data-testid="text-estado-sites">{estado.stats.sites}</div>
            </div>
            <div className="p-4 rounded-lg bg-muted/50">
              <div className="text-sm text-muted-foreground mb-1">Uptime</div>
              <div className="text-lg font-semibold" data-testid="text-estado-uptime">{formatUptime(estado.uptime)}</div>
            </div>
          </div>
          <div className="mt-4 text-xs text-muted-foreground">
            Última actualización: {new Date(estado.timestamp).toLocaleString("es-ES", { timeZone: "Europe/Madrid" })}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

interface KioskDevice {
  id: string;
  name: string;
  enabled: boolean;
  createdAt: string;
  lastUsedAt: string | null;
  token?: string;
}

function ReportsTab({ employees }: { employees: Employee[] }) {
  const { toast } = useToast();
  const [reportType, setReportType] = useState<"general" | "employee">("general");
  const [period, setPeriod] = useState<"month" | "week">("month");
  const [year, setYear] = useState(new Date().getFullYear());
  const [month, setMonth] = useState(new Date().getMonth() + 1);
  const [week, setWeek] = useState(1);
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string>("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);

  const currentYear = new Date().getFullYear();
  const years = Array.from({ length: 5 }, (_, i) => currentYear - i);
  const months = [
    { value: 1, label: "Enero" },
    { value: 2, label: "Febrero" },
    { value: 3, label: "Marzo" },
    { value: 4, label: "Abril" },
    { value: 5, label: "Mayo" },
    { value: 6, label: "Junio" },
    { value: 7, label: "Julio" },
    { value: 8, label: "Agosto" },
    { value: 9, label: "Septiembre" },
    { value: 10, label: "Octubre" },
    { value: 11, label: "Noviembre" },
    { value: 12, label: "Diciembre" },
  ];
  const weeks = Array.from({ length: 53 }, (_, i) => i + 1);

  const handleGenerateGeneral = async () => {
    setIsGenerating(true);
    try {
      const params = new URLSearchParams({
        period,
        year: year.toString(),
        ...(period === "month" ? { month: month.toString() } : { week: week.toString() }),
      });

      const response = await fetch(`/api/reports/general?${params}`, {
        credentials: "include",
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error?.message || "Error al generar informe");
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `informe-general-${period === "month" ? `${year}-${month}` : `semana-${week}-${year}`}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);

      toast({
        title: "Informe generado",
        description: "El PDF se ha descargado correctamente",
      });
    } catch (error) {
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Error al generar informe",
        variant: "destructive",
      });
    } finally {
      setIsGenerating(false);
    }
  };

  const handleGenerateEmployee = async () => {
    if (!selectedEmployeeId || !startDate || !endDate) {
      toast({
        title: "Datos incompletos",
        description: "Seleccione un empleado y el rango de fechas",
        variant: "destructive",
      });
      return;
    }

    setIsGenerating(true);
    try {
      const params = new URLSearchParams({
        startDate,
        endDate,
      });

      const response = await fetch(`/api/reports/employee/${selectedEmployeeId}?${params}`, {
        credentials: "include",
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error?.message || "Error al generar informe");
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const emp = employees.find(e => e.id === selectedEmployeeId);
      a.download = `informe-${emp?.lastName || "empleado"}-${emp?.firstName || ""}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);

      toast({
        title: "Informe generado",
        description: "El PDF se ha descargado correctamente",
      });
    } catch (error) {
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Error al generar informe",
        variant: "destructive",
      });
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div className="space-y-6">
      <Card className="shadow-sm border border-border/50">
        <CardHeader className="border-b bg-section-accent-reports/5">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-section-accent-reports/10 flex items-center justify-center">
              <FileText className="h-5 w-5 text-section-accent-reports" />
            </div>
            <div>
              <CardTitle className="text-lg">Informes y Exportaciones</CardTitle>
              <CardDescription>
                Genere informes PDF oficiales o exporte datos en CSV
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-6 pt-6">
          <div className="flex gap-3">
            <Button
              variant={reportType === "general" ? "default" : "outline"}
              onClick={() => setReportType("general")}
              data-testid="button-report-general"
              className="flex-1 sm:flex-none"
            >
              <FileText className="h-4 w-4 mr-2" />
              Informe General
            </Button>
            <Button
              variant={reportType === "employee" ? "default" : "outline"}
              onClick={() => setReportType("employee")}
              data-testid="button-report-employee"
              className="flex-1 sm:flex-none"
            >
              <Users className="h-4 w-4 mr-2" />
              Por Empleado
            </Button>
          </div>

          {reportType === "general" && (
            <div className="space-y-4 p-5 bg-muted/30 rounded-lg border border-border/50">
              <h3 className="font-semibold text-foreground">Informe General - Todos los Empleados</h3>
              
              <div className="flex gap-4 flex-wrap">
                <div className="space-y-2">
                  <Label>Período</Label>
                  <Select value={period} onValueChange={(v) => setPeriod(v as "month" | "week")}>
                    <SelectTrigger className="w-32" data-testid="select-period">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="month">Mes</SelectItem>
                      <SelectItem value="week">Semana</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>Año</Label>
                  <Select value={year.toString()} onValueChange={(v) => setYear(parseInt(v))}>
                    <SelectTrigger className="w-24" data-testid="select-year">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {years.map((y) => (
                        <SelectItem key={y} value={y.toString()}>{y}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {period === "month" && (
                  <div className="space-y-2">
                    <Label>Mes</Label>
                    <Select value={month.toString()} onValueChange={(v) => setMonth(parseInt(v))}>
                      <SelectTrigger className="w-36" data-testid="select-month">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {months.map((m) => (
                          <SelectItem key={m.value} value={m.value.toString()}>{m.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}

                {period === "week" && (
                  <div className="space-y-2">
                    <Label>Semana ISO</Label>
                    <Select value={week.toString()} onValueChange={(v) => setWeek(parseInt(v))}>
                      <SelectTrigger className="w-24" data-testid="select-week">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {weeks.map((w) => (
                          <SelectItem key={w} value={w.toString()}>S{w}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </div>

              <Button 
                onClick={handleGenerateGeneral} 
                disabled={isGenerating}
                data-testid="button-generate-general"
              >
                {isGenerating ? (
                  <>
                    <Activity className="h-4 w-4 mr-2 animate-spin" />
                    Generando...
                  </>
                ) : (
                  <>
                    <Download className="h-4 w-4 mr-2" />
                    Descargar PDF
                  </>
                )}
              </Button>
            </div>
          )}

          {reportType === "employee" && (
            <div className="space-y-4 p-5 bg-muted/30 rounded-lg border border-border/50">
              <h3 className="font-semibold text-foreground">Informe por Empleado</h3>
              
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label>Empleado</Label>
                  <Select value={selectedEmployeeId} onValueChange={setSelectedEmployeeId}>
                    <SelectTrigger className="w-64" data-testid="select-employee">
                      <SelectValue placeholder="Seleccionar empleado" />
                    </SelectTrigger>
                    <SelectContent>
                      {employees.map((emp) => (
                        <SelectItem key={emp.id} value={emp.id}>
                          {emp.lastName} {emp.firstName}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex gap-4 flex-wrap">
                  <div className="space-y-2">
                    <Label>Fecha inicio</Label>
                    <Input
                      type="date"
                      value={startDate}
                      onChange={(e) => setStartDate(e.target.value)}
                      className="w-40"
                      data-testid="input-start-date"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label>Fecha fin</Label>
                    <Input
                      type="date"
                      value={endDate}
                      onChange={(e) => setEndDate(e.target.value)}
                      className="w-40"
                      data-testid="input-end-date"
                    />
                  </div>
                </div>

                <p className="text-sm text-muted-foreground">
                  El rango máximo permitido es de 1 año
                </p>
              </div>

              <Button 
                onClick={handleGenerateEmployee} 
                disabled={isGenerating || !selectedEmployeeId || !startDate || !endDate}
                data-testid="button-generate-employee"
              >
                {isGenerating ? (
                  <>
                    <Activity className="h-4 w-4 mr-2 animate-spin" />
                    Generando...
                  </>
                ) : (
                  <>
                    <Download className="h-4 w-4 mr-2" />
                    Descargar PDF
                  </>
                )}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="border-card-border">
        <CardHeader>
          <CardTitle>Contenido del Informe</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-sm space-y-2">
            <p>Los informes PDF incluyen las siguientes columnas:</p>
            <ol className="list-decimal list-inside space-y-1 text-muted-foreground">
              <li>Apellido</li>
              <li>Nombre</li>
              <li>Prise de service (Entrada) - Fecha y hora</li>
              <li>Firma entrada - Imagen de la firma digital</li>
              <li>Fin de service (Salida) - Fecha y hora</li>
              <li>Firma salida - Imagen de la firma digital</li>
              <li>Ubicación entrada - Enlace clicable a Google Maps</li>
              <li>Ubicación salida - Enlace clicable a Google Maps</li>
            </ol>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default function AdminPage() {
  const { user, logout } = useAuth();
  const [, setLocation] = useLocation();
  const [activeTab, setActiveTab] = useState<"dashboard" | "employees" | "punches" | "revision" | "overtime" | "estado" | "kiosks" | "reports">("dashboard");
  const [showEmployeeDialog, setShowEmployeeDialog] = useState(false);
  const [editingEmployee, setEditingEmployee] = useState<any>(null);
  const [showExportDialog, setShowExportDialog] = useState(false);
  const [selectedPunchForCorrection, setSelectedPunchForCorrection] = useState<PunchWithEmployee | null>(null);
  const [selectedOvertime, setSelectedOvertime] = useState<OvertimeRequestWithDetails | null>(null);
  const [overtimeComment, setOvertimeComment] = useState("");
  const [overtimeFilter, setOvertimeFilter] = useState<"all" | "pending" | "approved" | "rejected">("pending");
  const [showAddKioskDialog, setShowAddKioskDialog] = useState(false);
  const [newKioskName, setNewKioskName] = useState("");
  const [newKioskToken, setNewKioskToken] = useState<string | null>(null);
  const { toast } = useToast();

  const { data: stats } = useQuery<DashboardStats>({
    queryKey: ["/api/admin/stats"],
  });

  const { data: employees, isLoading: employeesLoading } = useQuery<Employee[]>({
    queryKey: ["/api/employees"],
  });

  const { data: recentPunches, isLoading: punchesLoading } = useQuery<PunchWithEmployee[]>({
    queryKey: ["/api/punches", { limit: 20 }],
  });

  const { data: flaggedPunches } = useQuery<PunchWithEmployee[]>({
    queryKey: ["/api/punches", { needsReview: true }],
  });

  interface ReviewablePunch extends PunchWithEmployee {
    reviewed: boolean;
    corrected: boolean;
  }

  const { data: reviewPunches, isLoading: reviewLoading } = useQuery<ReviewablePunch[]>({
    queryKey: ["/api/punches/needs-review"],
  });

  const reviewMutation = useMutation({
    mutationFn: async ({ punchId, note }: { punchId: string; note?: string }) => {
      return apiRequest("POST", `/api/punches/${punchId}/review`, { note });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/punches/needs-review"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/stats"] });
      toast({
        title: "Fichaje revisado",
        description: "El fichaje ha sido marcado como revisado",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "No se pudo revisar el fichaje",
        variant: "destructive",
      });
    },
  });

  const { data: overtimeRequests, isLoading: overtimeLoading } = useQuery<OvertimeRequestWithDetails[]>({
    queryKey: ["/api/overtime-requests", { status: overtimeFilter === "all" ? undefined : overtimeFilter }],
  });

  const overtimeReviewMutation = useMutation({
    mutationFn: async ({ id, status, comment }: { id: string; status: "approved" | "rejected"; comment: string }) => {
      return apiRequest("POST", `/api/overtime-requests/${id}/review`, { status, comment });
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["/api/overtime-requests"] });
      setSelectedOvertime(null);
      setOvertimeComment("");
      toast({
        title: variables.status === "approved" ? "Aprobado" : "Rechazado",
        description: variables.status === "approved" 
          ? "Las horas extra han sido aprobadas" 
          : "Las horas extra han sido rechazadas",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "No se pudo procesar la solicitud",
        variant: "destructive",
      });
    },
  });

  const { data: kioskDevices, isLoading: kiosksLoading } = useQuery<KioskDevice[]>({
    queryKey: ["/api/admin/kiosk-devices"],
    enabled: activeTab === "kiosks",
  });

  const createKioskMutation = useMutation({
    mutationFn: async (name: string) => {
      const response = await apiRequest("POST", "/api/admin/kiosk-devices", { name });
      return response.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/kiosk-devices"] });
      setNewKioskToken(data.token);
      setNewKioskName("");
    },
    onError: () => {
      toast({
        title: "Error",
        description: "No se pudo crear el dispositivo",
        variant: "destructive",
      });
    },
  });

  const toggleKioskMutation = useMutation({
    mutationFn: async ({ id, enabled }: { id: string; enabled: boolean }) => {
      return apiRequest("PATCH", `/api/admin/kiosk-devices/${id}`, { enabled });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/kiosk-devices"] });
      toast({
        title: "Estado actualizado",
        description: "El dispositivo ha sido actualizado",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "No se pudo actualizar el dispositivo",
        variant: "destructive",
      });
    },
  });

  const deleteKioskMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiRequest("DELETE", `/api/admin/kiosk-devices/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/kiosk-devices"] });
      toast({
        title: "Dispositivo eliminado",
        description: "El dispositivo ha sido eliminado",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "No se pudo eliminar el dispositivo",
        variant: "destructive",
      });
    },
  });

  const toggleEmployeeMutation = useMutation({
    mutationFn: async ({ id, isActive }: { id: string; isActive: boolean }) => {
      return apiRequest("PATCH", `/api/employees/${id}`, { isActive });
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["/api/employees"] });
      toast({
        title: variables.isActive ? "Empleado activado" : "Empleado desactivado",
        description: variables.isActive 
          ? "El empleado puede volver a fichar" 
          : "El empleado ya no puede fichar",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "No se pudo actualizar el estado del empleado",
        variant: "destructive",
      });
    },
  });

  const copyKioskUrl = (deviceId: string) => {
    if (newKioskToken) {
      const url = `${window.location.origin}/kiosk?token=${newKioskToken}`;
      navigator.clipboard.writeText(url);
      toast({
        title: "URL copiada",
        description: "La URL del quiosco se ha copiado al portapapeles",
      });
    }
  };

  // Compute vacation durations by pairing IN→OUT punches per employee
  const punchDurations = useMemo(() => {
    if (!recentPunches) return new Map<string, { duration: number | null; isInProgress: boolean }>();
    
    const durationMap = new Map<string, { duration: number | null; isInProgress: boolean }>();
    
    // Group punches by employee
    const punchesByEmployee = new Map<string, typeof recentPunches>();
    for (const punch of recentPunches) {
      const empPunches = punchesByEmployee.get(punch.employeeId) || [];
      empPunches.push(punch);
      punchesByEmployee.set(punch.employeeId, empPunches);
    }
    
    // For each employee, pair punches chronologically
    for (const [, empPunches] of Array.from(punchesByEmployee)) {
      // Sort by timestamp ascending
      const sorted = [...empPunches].sort((a, b) => 
        new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
      );
      
      let currentEntry: typeof sorted[0] | null = null;
      
      for (const punch of sorted) {
        if (punch.type === "IN") {
          // If there's already an open entry, mark it as orphaned/in-progress
          if (currentEntry) {
            durationMap.set(currentEntry.id, { duration: null, isInProgress: true });
          }
          currentEntry = punch;
        } else if (punch.type === "OUT") {
          if (currentEntry) {
            // Calculate duration for this vacation pair
            const duration = computeDurationMinutes(currentEntry.timestamp, punch.timestamp);
            durationMap.set(punch.id, { duration, isInProgress: false });
            durationMap.set(currentEntry.id, { duration, isInProgress: false });
            currentEntry = null;
          }
          // Orphan OUT (no matching IN) - don't show duration
        }
      }
      
      // If there's an open entry (no matching OUT), mark as in progress
      if (currentEntry) {
        durationMap.set(currentEntry.id, { duration: null, isInProgress: true });
      }
    }
    
    return durationMap;
  }, [recentPunches]);

  const handleLogout = async () => {
    await logout();
    setLocation("/");
  };

  const initials = user ? `${user.firstName?.[0] || ""}${user.lastName?.[0] || ""}`.toUpperCase() : "A";

  const sidebarStyle = {
    "--sidebar-width": "16rem",
    "--sidebar-width-icon": "3rem",
  } as React.CSSProperties;

  const allMenuItems = [
    { id: "dashboard", label: "Panel de control", icon: LayoutDashboard, accent: "section-accent-dashboard", description: "Vista general del sistema", adminOnly: false },
    { id: "employees", label: "Empleados", icon: Users, accent: "section-accent-employees", description: "Gestionar personal", adminOnly: false },
    { id: "punches", label: "Fichajes", icon: Clock, accent: "section-accent-punches", description: "Historial de fichajes", adminOnly: false },
    { id: "revision", label: "Revisión", icon: ClipboardCheck, accent: "section-accent-revision", description: "Puntos pendientes de revisión", adminOnly: false },
    { id: "overtime", label: "Horas Extra", icon: Timer, accent: "section-accent-overtime", description: "Solicitudes de horas extra", adminOnly: false },
    { id: "reports", label: "Informes", icon: FileText, accent: "section-accent-reports", description: "PDF y exportaciones", adminOnly: false },
    { id: "kiosks", label: "Quioscos", icon: Monitor, accent: "section-accent-dashboard", description: "Dispositivos de fichaje", adminOnly: true },
    { id: "estado", label: "Estado", icon: Activity, accent: "section-accent-dashboard", description: "Estado del sistema", adminOnly: true },
  ];

  const menuItems = allMenuItems.filter(item => !item.adminOnly || user?.role === "admin");

  const currentMenuItem = menuItems.find((m) => m.id === activeTab);

  return (
    <SidebarProvider style={sidebarStyle}>
      <div className="flex h-screen w-full bg-background">
        <Sidebar className="bg-sidebar border-r border-sidebar-border">
          <SidebarHeader className="p-4 border-b border-sidebar-border">
            <div className="flex items-center gap-3">
              <img 
                src={LOGO_SRC} 
                alt={APP_NAME} 
                className="h-12 w-auto object-contain"
                data-testid="img-logo-admin"
              />
              <div>
                <span className="font-bold text-lg text-sidebar-foreground">Cronos</span>
                <p className="text-xs text-sidebar-foreground/60">Fichajes</p>
              </div>
            </div>
          </SidebarHeader>
          <SidebarContent className="px-2">
            <SidebarGroup>
              <SidebarGroupLabel className="text-sidebar-foreground/50 text-xs uppercase tracking-wider px-3 py-2">
                Navegación
              </SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {menuItems.map((item) => {
                    const isActive = activeTab === item.id;
                    return (
                      <SidebarMenuItem key={item.id}>
                        <SidebarMenuButton 
                          onClick={() => setActiveTab(item.id as typeof activeTab)}
                          isActive={isActive}
                          data-testid={`nav-${item.id}`}
                          className={`relative transition-all ${isActive ? 'bg-sidebar-accent text-sidebar-foreground' : 'text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent/50'}`}
                        >
                          {isActive && (
                            <span className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-6 bg-sidebar-primary rounded-r-full" />
                          )}
                          <item.icon className={`h-4 w-4 ml-1 ${isActive ? 'text-sidebar-primary' : ''}`} />
                          <span className="font-medium">{item.label}</span>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    );
                  })}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          </SidebarContent>
          <SidebarFooter className="p-4 border-t border-sidebar-border">
            <div className="flex items-center gap-3 mb-3">
              <Avatar className="h-9 w-9 ring-2 ring-sidebar-primary/30">
                <AvatarFallback className="bg-sidebar-primary text-sidebar-primary-foreground text-sm font-bold">
                  {initials}
                </AvatarFallback>
              </Avatar>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate text-sidebar-foreground">
                  {user?.firstName} {user?.lastName}
                </p>
                <p className="text-xs text-sidebar-foreground/60 capitalize">{user?.role}</p>
              </div>
            </div>
            <Button 
              variant="ghost" 
              className="w-full justify-start text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent"
              onClick={handleLogout}
              data-testid="button-admin-logout"
            >
              <LogOut className="h-4 w-4 mr-2" />
              Cerrar sesión
            </Button>
          </SidebarFooter>
        </Sidebar>

        <div className="flex flex-col flex-1 overflow-hidden">
          <header className="flex items-center justify-between px-6 py-4 border-b bg-card shadow-sm gap-4">
            <div className="flex items-center gap-4">
              <SidebarTrigger data-testid="button-sidebar-toggle" className="text-muted-foreground hover:text-foreground" />
              <div className="h-6 w-px bg-border" />
              <div>
                <h1 className="text-xl font-bold text-foreground">
                  {currentMenuItem?.label}
                </h1>
                <p className="text-sm text-muted-foreground">
                  {currentMenuItem?.description}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {activeTab === "employees" && (
                <Button onClick={() => { setEditingEmployee(null); setShowEmployeeDialog(true); }} data-testid="button-add-employee">
                  <Plus className="h-4 w-4 mr-2" />
                  Añadir
                </Button>
              )}
              {activeTab === "reports" && (
                <Button variant="outline" onClick={() => setShowExportDialog(true)} data-testid="button-export-csv">
                  <Download className="h-4 w-4 mr-2" />
                  Exportar CSV
                </Button>
              )}
              {activeTab === "kiosks" && (
                <Button onClick={() => setShowAddKioskDialog(true)} data-testid="button-add-kiosk">
                  <Plus className="h-4 w-4 mr-2" />
                  Añadir quiosco
                </Button>
              )}
            </div>
          </header>

          <main className="flex-1 overflow-auto p-6 bg-bg-app bg-gradient-to-b from-bg-app to-bg-surface-2/30">
            {activeTab === "dashboard" && (
              <div className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                  <Card className="shadow-sm hover:shadow-md transition-shadow border border-border/50">
                    <CardHeader className="flex flex-row items-center justify-between gap-4 pb-2">
                      <CardTitle className="text-sm font-medium text-muted-foreground">
                        Total Empleados
                      </CardTitle>
                      <div className="h-9 w-9 rounded-lg bg-section-accent-employees/10 flex items-center justify-center">
                        <Users className="h-5 w-5 text-section-accent-employees" />
                      </div>
                    </CardHeader>
                    <CardContent>
                      <div className="text-3xl font-bold tracking-tight">{stats?.totalEmployees || 0}</div>
                      <p className="text-xs text-muted-foreground mt-1">empleados registrados</p>
                    </CardContent>
                  </Card>

                  <Card className="shadow-sm hover:shadow-md transition-shadow border border-border/50">
                    <CardHeader className="flex flex-row items-center justify-between gap-4 pb-2">
                      <CardTitle className="text-sm font-medium text-muted-foreground">
                        Activos Hoy
                      </CardTitle>
                      <div className="h-9 w-9 rounded-lg bg-success/10 flex items-center justify-center">
                        <TrendingUp className="h-5 w-5 text-success" />
                      </div>
                    </CardHeader>
                    <CardContent>
                      <div className="text-3xl font-bold tracking-tight text-success">{stats?.activeToday || 0}</div>
                      <p className="text-xs text-muted-foreground mt-1">han fichado hoy</p>
                    </CardContent>
                  </Card>

                  <Card className="shadow-sm hover:shadow-md transition-shadow border border-border/50">
                    <CardHeader className="flex flex-row items-center justify-between gap-4 pb-2">
                      <CardTitle className="text-sm font-medium text-muted-foreground">
                        Presentes Ahora
                      </CardTitle>
                      <div className="h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center">
                        <CheckCircle className="h-5 w-5 text-primary" />
                      </div>
                    </CardHeader>
                    <CardContent>
                      <div className="text-3xl font-bold tracking-tight text-primary">{stats?.currentlyIn || 0}</div>
                      <p className="text-xs text-muted-foreground mt-1">en el centro</p>
                    </CardContent>
                  </Card>

                  <Card className="shadow-sm hover:shadow-md transition-shadow border border-border/50">
                    <CardHeader className="flex flex-row items-center justify-between gap-4 pb-2">
                      <CardTitle className="text-sm font-medium text-muted-foreground">
                        Por Verificar
                      </CardTitle>
                      <div className="h-9 w-9 rounded-lg bg-warning/10 flex items-center justify-center">
                        <AlertTriangle className="h-5 w-5 text-warning" />
                      </div>
                    </CardHeader>
                    <CardContent>
                      <div className="text-3xl font-bold tracking-tight text-warning">{stats?.needsReview || 0}</div>
                      <p className="text-xs text-muted-foreground mt-1">fichajes pendientes</p>
                    </CardContent>
                  </Card>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  <Card className="shadow-sm border border-border/50">
                    <CardHeader className="border-b">
                      <div className="flex items-center gap-3">
                        <div className="h-9 w-9 rounded-lg bg-section-accent-punches/10 flex items-center justify-center">
                          <Clock className="h-5 w-5 text-section-accent-punches" />
                        </div>
                        <div>
                          <CardTitle className="text-lg">Fichajes Recientes</CardTitle>
                          <CardDescription>Los 10 últimos fichajes</CardDescription>
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent className="pt-4">
                      {punchesLoading ? (
                        <div className="space-y-3">
                          {[1, 2, 3, 4, 5].map((i) => (
                            <div key={i} className="h-12 bg-muted/50 animate-pulse rounded-md" />
                          ))}
                        </div>
                      ) : recentPunches && recentPunches.length > 0 ? (
                        <div className="space-y-1">
                          {recentPunches.slice(0, 10).map((punch, index) => (
                            <div 
                              key={punch.id}
                              className={`flex items-center justify-between py-3 px-3 rounded-lg ${index % 2 === 0 ? 'bg-muted/30' : ''}`}
                            >
                              <div className="flex items-center gap-3">
                                <Avatar className="h-8 w-8">
                                  <AvatarFallback className="text-xs bg-primary/10 text-primary font-medium">
                                    {punch.employee.firstName[0]}{punch.employee.lastName[0]}
                                  </AvatarFallback>
                                </Avatar>
                                <div>
                                  <p className="text-sm font-medium">
                                    {punch.employee.firstName} {punch.employee.lastName}
                                  </p>
                                  <TimeBadge time={punch.timestamp} showRelative />
                                </div>
                              </div>
                              <StatusBadge status={punch.type as "IN" | "OUT"} />
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="text-center py-8 text-muted-foreground">
                          Ningún fichaje reciente
                        </p>
                      )}
                    </CardContent>
                  </Card>

                  <Card className="shadow-sm border border-border/50">
                    <CardHeader className="border-b">
                      <div className="flex items-center gap-3">
                        <div className="h-9 w-9 rounded-lg bg-warning/10 flex items-center justify-center">
                          <AlertTriangle className="h-5 w-5 text-warning" />
                        </div>
                        <div>
                          <CardTitle className="text-lg">Por Verificar</CardTitle>
                          <CardDescription>Fichajes que requieren verificación</CardDescription>
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent>
                      {flaggedPunches && flaggedPunches.length > 0 ? (
                        <div className="space-y-3">
                          {flaggedPunches.slice(0, 5).map((punch) => (
                            <div 
                              key={punch.id}
                              className="flex items-center justify-between py-2 border-b last:border-0"
                            >
                              <div className="flex items-center gap-3">
                                <Avatar className="h-8 w-8">
                                  <AvatarFallback className="text-xs bg-red-100 text-red-600">
                                    {punch.employee.firstName[0]}{punch.employee.lastName[0]}
                                  </AvatarFallback>
                                </Avatar>
                                <div>
                                  <p className="text-sm font-medium">
                                    {punch.employee.firstName} {punch.employee.lastName}
                                  </p>
                                  <TimeBadge time={punch.timestamp} />
                                </div>
                              </div>
                              <Button 
                                variant="outline" 
                                size="sm"
                                onClick={() => setSelectedPunchForCorrection(punch)}
                                data-testid={`button-review-${punch.id}`}
                              >
                                Corregir
                              </Button>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="text-center py-8 text-muted-foreground">
                          <CheckCircle className="h-12 w-12 mx-auto mb-2 opacity-30" />
                          Ningún fichaje por verificar
                        </p>
                      )}
                    </CardContent>
                  </Card>
                </div>
              </div>
            )}

            {activeTab === "employees" && (
              <Card className="border-card-border">
                <CardHeader>
                  <CardTitle>Lista de Empleados</CardTitle>
                  <CardDescription>Gestione las cuentas de empleados</CardDescription>
                </CardHeader>
                <CardContent>
                  {employeesLoading ? (
                    <div className="space-y-3">
                      {[1, 2, 3, 4, 5].map((i) => (
                        <div key={i} className="h-16 bg-muted/50 animate-pulse rounded-md" />
                      ))}
                    </div>
                  ) : employees && employees.length > 0 ? (
                    <div className="space-y-2">
                      {employees.map((emp) => (
                        <div 
                          key={emp.id}
                          className="flex items-center justify-between p-4 rounded-lg border bg-card hover-elevate"
                          data-testid={`employee-row-${emp.id}`}
                        >
                          <div className="flex items-center gap-4">
                            <Avatar className="h-12 w-12">
                              <AvatarFallback className="bg-primary/10 text-primary font-medium">
                                {emp.firstName[0]}{emp.lastName[0]}
                              </AvatarFallback>
                            </Avatar>
                            <div>
                              <p className="font-medium">
                                {emp.firstName} {emp.lastName}
                              </p>
                              <p className="text-sm text-muted-foreground">{emp.email}</p>
                            </div>
                          </div>
                          <div className="flex items-center gap-3">
                            <Badge variant="outline" className="capitalize">
                              {emp.role}
                            </Badge>
                            <Badge variant={emp.isActive ? "default" : "secondary"}>
                              {emp.isActive ? "Activo" : "Inactivo"}
                            </Badge>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => { setEditingEmployee(emp); setShowEmployeeDialog(true); }}
                              title="Editar empleado"
                              data-testid={`button-edit-employee-${emp.id}`}
                            >
                              <Pencil className="h-4 w-4 text-muted-foreground" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => toggleEmployeeMutation.mutate({ id: emp.id, isActive: !emp.isActive })}
                              disabled={toggleEmployeeMutation.isPending}
                              title={emp.isActive ? "Desactivar empleado" : "Activar empleado"}
                              data-testid={`button-toggle-employee-${emp.id}`}
                            >
                              <Power className={`h-4 w-4 ${emp.isActive ? "text-muted-foreground" : "text-green-600"}`} />
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-center py-8 text-muted-foreground">
                      <Users className="h-12 w-12 mx-auto mb-2 opacity-30" />
                      Ningún empleado
                    </p>
                  )}
                </CardContent>
              </Card>
            )}

            {activeTab === "punches" && (
              <Card className="border-card-border">
                <CardHeader>
                  <CardTitle>Historial de Fichajes</CardTitle>
                  <CardDescription>Todos los fichajes recientes</CardDescription>
                </CardHeader>
                <CardContent>
                  {punchesLoading ? (
                    <div className="space-y-3">
                      {[1, 2, 3, 4, 5].map((i) => (
                        <div key={i} className="h-12 bg-muted/50 animate-pulse rounded-md" />
                      ))}
                    </div>
                  ) : recentPunches && recentPunches.length > 0 ? (
                    <div className="overflow-x-auto">
                      <table className="w-full">
                        <thead>
                          <tr className="border-b">
                            <th className="text-left py-3 px-4 font-medium text-muted-foreground">Empleado</th>
                            <th className="text-left py-3 px-4 font-medium text-muted-foreground">Tipo</th>
                            <th className="text-left py-3 px-4 font-medium text-muted-foreground">Fecha/Hora</th>
                            <th className="text-left py-3 px-4 font-medium text-muted-foreground">Duración</th>
                            <th className="text-left py-3 px-4 font-medium text-muted-foreground">Posición</th>
                            <th className="text-left py-3 px-4 font-medium text-muted-foreground">Fuente</th>
                            <th className="text-right py-3 px-4 font-medium text-muted-foreground">Acciones</th>
                          </tr>
                        </thead>
                        <tbody>
                          {recentPunches.map((punch) => {
                            const durationInfo = punchDurations.get(punch.id);
                            return (
                            <tr key={punch.id} className="border-b last:border-0">
                              <td className="py-3 px-4">
                                <div className="flex items-center gap-2">
                                  <Avatar className="h-8 w-8">
                                    <AvatarFallback className="text-xs">
                                      {punch.employee.firstName[0]}{punch.employee.lastName[0]}
                                    </AvatarFallback>
                                  </Avatar>
                                  <span className="font-medium">
                                    {punch.employee.firstName} {punch.employee.lastName}
                                  </span>
                                </div>
                              </td>
                              <td className="py-3 px-4">
                                <StatusBadge status={punch.type as "IN" | "OUT"} />
                              </td>
                              <td className="py-3 px-4 font-mono text-sm">
                                {new Date(punch.timestamp).toLocaleString("es-ES", { timeZone: "Europe/Madrid" })}
                              </td>
                              <td className="py-3 px-4">
                                {durationInfo ? (
                                  <Badge 
                                    variant={durationInfo.isInProgress ? "outline" : "secondary"} 
                                    className={`text-xs font-mono ${durationInfo.isInProgress ? "text-blue-600 border-blue-300" : ""}`}
                                    data-testid={`duration-${punch.id}`}
                                  >
                                    <Timer className="h-3 w-3 mr-1" />
                                    {formatDuration(durationInfo.duration, durationInfo.isInProgress)}
                                  </Badge>
                                ) : (
                                  <span className="text-muted-foreground text-sm">—</span>
                                )}
                              </td>
                              <td className="py-3 px-4">
                                <GeoBadge 
                                  hasLocation={!!(punch.latitude && punch.longitude)} 
                                  needsReview={punch.needsReview}
                                  latitude={punch.latitude}
                                  longitude={punch.longitude}
                                />
                              </td>
                              <td className="py-3 px-4">
                                <Badge variant="outline" className="text-xs capitalize">
                                  {punch.source}
                                </Badge>
                              </td>
                              <td className="py-3 px-4 text-right">
                                <Button 
                                  variant="ghost" 
                                  size="sm"
                                  onClick={() => setSelectedPunchForCorrection(punch)}
                                  data-testid={`button-correct-${punch.id}`}
                                >
                                  Corregir
                                </Button>
                              </td>
                            </tr>
                          );
                          })}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <p className="text-center py-8 text-muted-foreground">
                      <Clock className="h-12 w-12 mx-auto mb-2 opacity-30" />
                      Ningún fichaje
                    </p>
                  )}
                </CardContent>
              </Card>
            )}

            {activeTab === "revision" && (
              <Card className="border-card-border">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <ClipboardCheck className="h-5 w-5" />
                    Fichajes por Revisar
                  </CardTitle>
                  <CardDescription>
                    Fichajes que requieren verificación manual (sin geolocalización)
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {reviewLoading ? (
                    <div className="space-y-3">
                      {[1, 2, 3, 4, 5].map((i) => (
                        <div key={i} className="h-16 bg-muted/50 animate-pulse rounded-md" />
                      ))}
                    </div>
                  ) : reviewPunches && reviewPunches.length > 0 ? (
                    <div className="overflow-x-auto">
                      <table className="w-full">
                        <thead>
                          <tr className="border-b">
                            <th className="text-left py-3 px-4 font-medium text-muted-foreground">Empleado</th>
                            <th className="text-left py-3 px-4 font-medium text-muted-foreground">Tipo</th>
                            <th className="text-left py-3 px-4 font-medium text-muted-foreground">Fecha/Hora</th>
                            <th className="text-left py-3 px-4 font-medium text-muted-foreground">Posición</th>
                            <th className="text-left py-3 px-4 font-medium text-muted-foreground">Estado</th>
                            <th className="text-right py-3 px-4 font-medium text-muted-foreground">Acciones</th>
                          </tr>
                        </thead>
                        <tbody>
                          {reviewPunches.map((punch) => (
                            <tr key={punch.id} className="border-b last:border-0">
                              <td className="py-3 px-4">
                                <div className="flex items-center gap-2">
                                  <Avatar className="h-8 w-8">
                                    <AvatarFallback className="text-xs bg-amber-100 text-amber-700">
                                      {punch.employee.firstName[0]}{punch.employee.lastName[0]}
                                    </AvatarFallback>
                                  </Avatar>
                                  <span className="font-medium">
                                    {punch.employee.firstName} {punch.employee.lastName}
                                  </span>
                                </div>
                              </td>
                              <td className="py-3 px-4">
                                <StatusBadge status={punch.type as "IN" | "OUT"} />
                              </td>
                              <td className="py-3 px-4 font-mono text-sm">
                                {new Date(punch.timestamp).toLocaleString("es-ES", { timeZone: "Europe/Madrid" })}
                              </td>
                              <td className="py-3 px-4">
                                <GeoBadge 
                                  hasLocation={!!(punch.latitude && punch.longitude)} 
                                  needsReview={punch.needsReview}
                                  latitude={punch.latitude}
                                  longitude={punch.longitude}
                                />
                              </td>
                              <td className="py-3 px-4">
                                <div className="flex gap-1">
                                  {punch.reviewed && (
                                    <Badge className="bg-green-100 text-green-700 text-xs">
                                      <Eye className="h-3 w-3 mr-1" />
                                      Revisado
                                    </Badge>
                                  )}
                                  {punch.corrected && (
                                    <Badge className="bg-blue-100 text-blue-700 text-xs">
                                      Corregido
                                    </Badge>
                                  )}
                                  {!punch.reviewed && !punch.corrected && (
                                    <Badge variant="outline" className="text-amber-600 border-amber-300 text-xs">
                                      Pendiente
                                    </Badge>
                                  )}
                                </div>
                              </td>
                              <td className="py-3 px-4 text-right">
                                <div className="flex gap-2 justify-end">
                                  {!punch.reviewed && (
                                    <Button 
                                      variant="outline" 
                                      size="sm"
                                      onClick={() => reviewMutation.mutate({ punchId: punch.id })}
                                      disabled={reviewMutation.isPending}
                                      data-testid={`button-mark-reviewed-${punch.id}`}
                                    >
                                      <CheckCircle className="h-4 w-4 mr-1" />
                                      Validar
                                    </Button>
                                  )}
                                  <Button 
                                    variant="ghost" 
                                    size="sm"
                                    onClick={() => setSelectedPunchForCorrection(punch)}
                                    data-testid={`button-correct-review-${punch.id}`}
                                  >
                                    Corregir
                                  </Button>
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <div className="text-center py-12">
                      <CheckCircle className="h-16 w-16 mx-auto mb-4 text-green-500 opacity-50" />
                      <p className="text-muted-foreground">
                        Todos los fichajes han sido revisados
                      </p>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            {activeTab === "overtime" && (
              <Card className="border-card-border">
                <CardHeader>
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <CardTitle className="flex items-center gap-2">
                        <Timer className="h-5 w-5" />
                        Solicitudes de Horas Extra
                      </CardTitle>
                      <CardDescription>
                        Valide o rechace las solicitudes de horas extra
                      </CardDescription>
                    </div>
                    <Select value={overtimeFilter} onValueChange={(v) => setOvertimeFilter(v as typeof overtimeFilter)}>
                      <SelectTrigger className="w-40" data-testid="select-overtime-filter">
                        <SelectValue placeholder="Filtrar por estado" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">Todas</SelectItem>
                        <SelectItem value="pending">Pendientes</SelectItem>
                        <SelectItem value="approved">Aprobadas</SelectItem>
                        <SelectItem value="rejected">Rechazadas</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </CardHeader>
                <CardContent>
                  {overtimeLoading ? (
                    <div className="space-y-3">
                      {[1, 2, 3, 4, 5].map((i) => (
                        <div key={i} className="h-16 bg-muted/50 animate-pulse rounded-md" />
                      ))}
                    </div>
                  ) : overtimeRequests && overtimeRequests.length > 0 ? (
                    <div className="overflow-x-auto">
                      <table className="w-full">
                        <thead>
                          <tr className="border-b">
                            <th className="text-left py-3 px-4 font-medium text-muted-foreground">Empleado</th>
                            <th className="text-left py-3 px-4 font-medium text-muted-foreground">Fecha</th>
                            <th className="text-left py-3 px-4 font-medium text-muted-foreground">Minutos</th>
                            <th className="text-left py-3 px-4 font-medium text-muted-foreground">Motivo</th>
                            <th className="text-left py-3 px-4 font-medium text-muted-foreground">Estado</th>
                            <th className="text-right py-3 px-4 font-medium text-muted-foreground">Acciones</th>
                          </tr>
                        </thead>
                        <tbody>
                          {overtimeRequests.map((request) => (
                            <tr key={request.id} className="border-b last:border-0">
                              <td className="py-3 px-4">
                                <div className="flex items-center gap-2">
                                  <Avatar className="h-8 w-8">
                                    <AvatarFallback className="text-xs bg-orange-100 text-orange-700">
                                      {request.employee.firstName[0]}{request.employee.lastName[0]}
                                    </AvatarFallback>
                                  </Avatar>
                                  <span className="font-medium">
                                    {request.employee.firstName} {request.employee.lastName}
                                  </span>
                                </div>
                              </td>
                              <td className="py-3 px-4 font-mono text-sm">
                                {new Date(request.date).toLocaleDateString("es-ES", { timeZone: "Europe/Madrid" })}
                              </td>
                              <td className="py-3 px-4">
                                <Badge variant="outline" className="font-mono">
                                  {request.minutes} min
                                </Badge>
                              </td>
                              <td className="py-3 px-4 text-sm text-muted-foreground">
                                {request.reason}
                              </td>
                              <td className="py-3 px-4">
                                {request.status === "pending" && (
                                  <Badge variant="outline" className="text-amber-600 border-amber-300">
                                    Pendiente
                                  </Badge>
                                )}
                                {request.status === "approved" && (
                                  <Badge className="bg-green-100 text-green-700">
                                    <ThumbsUp className="h-3 w-3 mr-1" />
                                    Aprobado
                                  </Badge>
                                )}
                                {request.status === "rejected" && (
                                  <Badge className="bg-red-100 text-red-700">
                                    <ThumbsDown className="h-3 w-3 mr-1" />
                                    Rechazado
                                  </Badge>
                                )}
                              </td>
                              <td className="py-3 px-4 text-right">
                                {request.status === "pending" ? (
                                  <div className="flex gap-2 justify-end">
                                    <Button 
                                      size="sm"
                                      onClick={() => setSelectedOvertime(request)}
                                      data-testid={`button-review-overtime-${request.id}`}
                                    >
                                      Procesar
                                    </Button>
                                  </div>
                                ) : (
                                  <span className="text-xs text-muted-foreground">
                                    {request.reviewer && `Por ${request.reviewer.firstName} ${request.reviewer.lastName}`}
                                  </span>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <div className="text-center py-12 text-muted-foreground">
                      <Timer className="h-12 w-12 mx-auto mb-4 opacity-30" />
                      <p>Ninguna solicitud de horas extra</p>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}


            {activeTab === "kiosks" && (
              <div className="space-y-6">
                <Card>
                  <CardHeader>
                    <CardTitle>Dispositivos quiosco</CardTitle>
                    <CardDescription>
                      Gestione los dispositivos autorizados para fichar
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    {kiosksLoading ? (
                      <p className="text-muted-foreground">Cargando...</p>
                    ) : kioskDevices && kioskDevices.length > 0 ? (
                      <div className="space-y-4">
                        {kioskDevices.map((device) => (
                          <div
                            key={device.id}
                            className="flex items-center justify-between p-4 border rounded-lg"
                            data-testid={`kiosk-device-${device.id}`}
                          >
                            <div className="flex items-center gap-4">
                              <Monitor className="h-8 w-8 text-muted-foreground" />
                              <div>
                                <p className="font-medium">{device.name}</p>
                                <p className="text-sm text-muted-foreground">
                                  Creado: {new Date(device.createdAt).toLocaleDateString("es-ES", { timeZone: "Europe/Madrid" })}
                                  {device.lastUsedAt && (
                                    <> | Último uso: {new Date(device.lastUsedAt).toLocaleString("es-ES", { timeZone: "Europe/Madrid" })}</>
                                  )}
                                </p>
                              </div>
                            </div>
                            <div className="flex items-center gap-2">
                              <Badge variant={device.enabled ? "default" : "secondary"}>
                                {device.enabled ? "Activo" : "Inactivo"}
                              </Badge>
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => toggleKioskMutation.mutate({ id: device.id, enabled: !device.enabled })}
                                disabled={toggleKioskMutation.isPending}
                                data-testid={`button-toggle-kiosk-${device.id}`}
                              >
                                <Power className="h-4 w-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => deleteKioskMutation.mutate(device.id)}
                                disabled={deleteKioskMutation.isPending}
                                data-testid={`button-delete-kiosk-${device.id}`}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-muted-foreground text-center py-8">
                        No hay dispositivos quiosco registrados
                      </p>
                    )}
                  </CardContent>
                </Card>
              </div>
            )}

            {activeTab === "estado" && <EstadoTab />}

            {activeTab === "reports" && <ReportsTab employees={employees || []} />}
          </main>
        </div>
      </div>

      <EmployeeDialog 
        open={showEmployeeDialog} 
        onOpenChange={(open) => { setShowEmployeeDialog(open); if (!open) setEditingEmployee(null); }}
        employee={editingEmployee}
      />
      
      <ExportDialog 
        open={showExportDialog} 
        onOpenChange={setShowExportDialog}
        employees={employees || []}
      />

      <CorrectionDialog
        open={!!selectedPunchForCorrection}
        onOpenChange={(open) => !open && setSelectedPunchForCorrection(null)}
        punch={selectedPunchForCorrection}
      />

      <Dialog open={!!selectedOvertime} onOpenChange={(open) => !open && setSelectedOvertime(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Procesar solicitud de horas extra</DialogTitle>
            <DialogDescription>
              {selectedOvertime && (
                <>
                  Solicitud de <strong>{selectedOvertime.employee.firstName} {selectedOvertime.employee.lastName}</strong> por{" "}
                  <strong>{selectedOvertime.minutes} minutos</strong> el{" "}
                  {new Date(selectedOvertime.date).toLocaleDateString("es-ES", { timeZone: "Europe/Madrid" })}
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div>
              <Label htmlFor="overtime-comment">Comentario (obligatorio)</Label>
              <Textarea
                id="overtime-comment"
                placeholder="Justificación de la decisión..."
                value={overtimeComment}
                onChange={(e) => setOvertimeComment(e.target.value)}
                className="mt-2"
                data-testid="input-overtime-comment"
              />
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => {
                if (selectedOvertime && overtimeComment.length >= 5) {
                  overtimeReviewMutation.mutate({
                    id: selectedOvertime.id,
                    status: "rejected",
                    comment: overtimeComment,
                  });
                }
              }}
              disabled={overtimeComment.length < 5 || overtimeReviewMutation.isPending}
              data-testid="button-reject-overtime"
            >
              <ThumbsDown className="h-4 w-4 mr-2" />
              Rechazar
            </Button>
            <Button
              onClick={() => {
                if (selectedOvertime && overtimeComment.length >= 5) {
                  overtimeReviewMutation.mutate({
                    id: selectedOvertime.id,
                    status: "approved",
                    comment: overtimeComment,
                  });
                }
              }}
              disabled={overtimeComment.length < 5 || overtimeReviewMutation.isPending}
              data-testid="button-approve-overtime"
            >
              <ThumbsUp className="h-4 w-4 mr-2" />
              Aprobar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog 
        open={showAddKioskDialog} 
        onOpenChange={(open) => {
          setShowAddKioskDialog(open);
          if (!open) {
            setNewKioskName("");
            setNewKioskToken(null);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {newKioskToken ? "Quiosco creado" : "Añadir dispositivo quiosco"}
            </DialogTitle>
            <DialogDescription>
              {newKioskToken 
                ? "Guarde esta URL - no se mostrará de nuevo"
                : "Registre un nuevo terminal para fichar"
              }
            </DialogDescription>
          </DialogHeader>
          {!newKioskToken ? (
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="kiosk-name">Nombre del dispositivo</Label>
                <Input
                  id="kiosk-name"
                  value={newKioskName}
                  onChange={(e) => setNewKioskName(e.target.value)}
                  placeholder="Ej: Recepción principal"
                  data-testid="input-kiosk-name"
                />
              </div>
            </div>
          ) : (
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label>URL del quiosco</Label>
                <div className="flex gap-2">
                  <Input
                    readOnly
                    value={`${window.location.origin}/kiosk?token=${newKioskToken}`}
                    className="font-mono text-xs"
                    data-testid="input-kiosk-url"
                  />
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={() => copyKioskUrl("")}
                    data-testid="button-copy-kiosk-url"
                  >
                    <Copy className="h-4 w-4" />
                  </Button>
                </div>
              </div>
              <p className="text-sm text-muted-foreground">
                Abra esta URL en el navegador del dispositivo quiosco. El token será guardado automáticamente.
              </p>
            </div>
          )}
          <DialogFooter>
            {!newKioskToken ? (
              <>
                <Button variant="outline" onClick={() => setShowAddKioskDialog(false)}>
                  Cancelar
                </Button>
                <Button
                  onClick={() => createKioskMutation.mutate(newKioskName)}
                  disabled={!newKioskName.trim() || createKioskMutation.isPending}
                  data-testid="button-create-kiosk"
                >
                  <Plus className="h-4 w-4 mr-2" />
                  Crear quiosco
                </Button>
              </>
            ) : (
              <Button onClick={() => setShowAddKioskDialog(false)} data-testid="button-close-kiosk-dialog">
                Cerrar
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SidebarProvider>
  );
}
