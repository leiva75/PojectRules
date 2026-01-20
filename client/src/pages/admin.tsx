import { useState } from "react";
import { useAuth } from "@/lib/auth";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useLocation } from "wouter";
import { useToast } from "@/hooks/use-toast";
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
} from "lucide-react";
import type { Employee, Punch } from "@shared/schema";
import { EmployeeDialog } from "@/components/employee-dialog";
import { ExportDialog } from "@/components/export-dialog";
import { CorrectionDialog } from "@/components/correction-dialog";

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

export default function AdminPage() {
  const { user, logout } = useAuth();
  const [, setLocation] = useLocation();
  const [activeTab, setActiveTab] = useState<"dashboard" | "employees" | "punches" | "revision" | "exports">("dashboard");
  const [showEmployeeDialog, setShowEmployeeDialog] = useState(false);
  const [showExportDialog, setShowExportDialog] = useState(false);
  const [selectedPunchForCorrection, setSelectedPunchForCorrection] = useState<PunchWithEmployee | null>(null);
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
        title: "Pointage révisé",
        description: "Le pointage a été marqué comme révisé",
      });
    },
    onError: () => {
      toast({
        title: "Erreur",
        description: "Impossible de réviser le pointage",
        variant: "destructive",
      });
    },
  });

  const handleLogout = async () => {
    await logout();
    setLocation("/");
  };

  const initials = user ? `${user.firstName?.[0] || ""}${user.lastName?.[0] || ""}`.toUpperCase() : "A";

  const sidebarStyle = {
    "--sidebar-width": "16rem",
    "--sidebar-width-icon": "3rem",
  } as React.CSSProperties;

  const menuItems = [
    { id: "dashboard", label: "Tableau de bord", icon: LayoutDashboard },
    { id: "employees", label: "Employés", icon: Users },
    { id: "punches", label: "Pointages", icon: Clock },
    { id: "revision", label: "Révision", icon: ClipboardCheck },
    { id: "exports", label: "Exports", icon: FileText },
  ];

  return (
    <SidebarProvider style={sidebarStyle}>
      <div className="flex h-screen w-full">
        <Sidebar>
          <SidebarHeader className="p-4 border-b">
            <div className="flex items-center gap-3">
              <Clock className="h-8 w-8 text-primary" />
              <span className="font-semibold text-lg">Pointeuse</span>
            </div>
          </SidebarHeader>
          <SidebarContent>
            <SidebarGroup>
              <SidebarGroupLabel>Navigation</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {menuItems.map((item) => (
                    <SidebarMenuItem key={item.id}>
                      <SidebarMenuButton 
                        onClick={() => setActiveTab(item.id as typeof activeTab)}
                        isActive={activeTab === item.id}
                        data-testid={`nav-${item.id}`}
                      >
                        <item.icon className="h-4 w-4" />
                        <span>{item.label}</span>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  ))}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          </SidebarContent>
          <SidebarFooter className="p-4 border-t">
            <div className="flex items-center gap-3 mb-3">
              <Avatar className="h-9 w-9">
                <AvatarFallback className="bg-primary/10 text-primary text-sm font-medium">
                  {initials}
                </AvatarFallback>
              </Avatar>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">
                  {user?.firstName} {user?.lastName}
                </p>
                <p className="text-xs text-muted-foreground capitalize">{user?.role}</p>
              </div>
            </div>
            <Button 
              variant="ghost" 
              className="w-full justify-start"
              onClick={handleLogout}
              data-testid="button-admin-logout"
            >
              <LogOut className="h-4 w-4 mr-2" />
              Déconnexion
            </Button>
          </SidebarFooter>
        </Sidebar>

        <div className="flex flex-col flex-1 overflow-hidden">
          <header className="flex items-center justify-between px-6 py-3 border-b bg-card gap-4">
            <div className="flex items-center gap-4">
              <SidebarTrigger data-testid="button-sidebar-toggle" />
              <h1 className="text-xl font-semibold">
                {menuItems.find((m) => m.id === activeTab)?.label}
              </h1>
            </div>
            <div className="flex items-center gap-2">
              {activeTab === "employees" && (
                <Button onClick={() => setShowEmployeeDialog(true)} data-testid="button-add-employee">
                  <Plus className="h-4 w-4 mr-2" />
                  Ajouter
                </Button>
              )}
              {activeTab === "exports" && (
                <Button onClick={() => setShowExportDialog(true)} data-testid="button-export">
                  <Download className="h-4 w-4 mr-2" />
                  Exporter CSV
                </Button>
              )}
            </div>
          </header>

          <main className="flex-1 overflow-auto p-6">
            {activeTab === "dashboard" && (
              <div className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                  <Card className="border-card-border">
                    <CardHeader className="flex flex-row items-center justify-between gap-4 pb-2">
                      <CardTitle className="text-sm font-medium text-muted-foreground">
                        Total Employés
                      </CardTitle>
                      <Users className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                      <div className="text-3xl font-bold">{stats?.totalEmployees || 0}</div>
                    </CardContent>
                  </Card>

                  <Card className="border-card-border">
                    <CardHeader className="flex flex-row items-center justify-between gap-4 pb-2">
                      <CardTitle className="text-sm font-medium text-muted-foreground">
                        Actifs Aujourd'hui
                      </CardTitle>
                      <TrendingUp className="h-4 w-4 text-green-600" />
                    </CardHeader>
                    <CardContent>
                      <div className="text-3xl font-bold text-green-600">{stats?.activeToday || 0}</div>
                    </CardContent>
                  </Card>

                  <Card className="border-card-border">
                    <CardHeader className="flex flex-row items-center justify-between gap-4 pb-2">
                      <CardTitle className="text-sm font-medium text-muted-foreground">
                        Présents Actuellement
                      </CardTitle>
                      <CheckCircle className="h-4 w-4 text-primary" />
                    </CardHeader>
                    <CardContent>
                      <div className="text-3xl font-bold text-primary">{stats?.currentlyIn || 0}</div>
                    </CardContent>
                  </Card>

                  <Card className="border-card-border">
                    <CardHeader className="flex flex-row items-center justify-between gap-4 pb-2">
                      <CardTitle className="text-sm font-medium text-muted-foreground">
                        À Vérifier
                      </CardTitle>
                      <AlertTriangle className="h-4 w-4 text-red-600" />
                    </CardHeader>
                    <CardContent>
                      <div className="text-3xl font-bold text-red-600">{stats?.needsReview || 0}</div>
                    </CardContent>
                  </Card>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  <Card className="border-card-border">
                    <CardHeader>
                      <CardTitle className="text-lg">Pointages Récents</CardTitle>
                      <CardDescription>Les 10 derniers pointages</CardDescription>
                    </CardHeader>
                    <CardContent>
                      {punchesLoading ? (
                        <div className="space-y-3">
                          {[1, 2, 3, 4, 5].map((i) => (
                            <div key={i} className="h-12 bg-muted/50 animate-pulse rounded-md" />
                          ))}
                        </div>
                      ) : recentPunches && recentPunches.length > 0 ? (
                        <div className="space-y-3">
                          {recentPunches.slice(0, 10).map((punch) => (
                            <div 
                              key={punch.id}
                              className="flex items-center justify-between py-2 border-b last:border-0"
                            >
                              <div className="flex items-center gap-3">
                                <Avatar className="h-8 w-8">
                                  <AvatarFallback className="text-xs bg-muted">
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
                          Aucun pointage récent
                        </p>
                      )}
                    </CardContent>
                  </Card>

                  <Card className="border-card-border">
                    <CardHeader>
                      <CardTitle className="text-lg flex items-center gap-2">
                        <AlertTriangle className="h-5 w-5 text-red-600" />
                        À Vérifier
                      </CardTitle>
                      <CardDescription>Pointages nécessitant une vérification</CardDescription>
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
                                Corriger
                              </Button>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="text-center py-8 text-muted-foreground">
                          <CheckCircle className="h-12 w-12 mx-auto mb-2 opacity-30" />
                          Aucun pointage à vérifier
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
                  <CardTitle>Liste des Employés</CardTitle>
                  <CardDescription>Gérez les comptes employés</CardDescription>
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
                          <div className="flex items-center gap-4">
                            <Badge variant="outline" className="capitalize">
                              {emp.role}
                            </Badge>
                            <StatusBadge status={emp.isActive ? "ACTIVE" : "INACTIVE"} />
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-center py-8 text-muted-foreground">
                      <Users className="h-12 w-12 mx-auto mb-2 opacity-30" />
                      Aucun employé
                    </p>
                  )}
                </CardContent>
              </Card>
            )}

            {activeTab === "punches" && (
              <Card className="border-card-border">
                <CardHeader>
                  <CardTitle>Historique des Pointages</CardTitle>
                  <CardDescription>Tous les pointages récents</CardDescription>
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
                            <th className="text-left py-3 px-4 font-medium text-muted-foreground">Employé</th>
                            <th className="text-left py-3 px-4 font-medium text-muted-foreground">Type</th>
                            <th className="text-left py-3 px-4 font-medium text-muted-foreground">Date/Heure</th>
                            <th className="text-left py-3 px-4 font-medium text-muted-foreground">Position</th>
                            <th className="text-left py-3 px-4 font-medium text-muted-foreground">Source</th>
                            <th className="text-right py-3 px-4 font-medium text-muted-foreground">Actions</th>
                          </tr>
                        </thead>
                        <tbody>
                          {recentPunches.map((punch) => (
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
                                {new Date(punch.timestamp).toLocaleString("fr-FR")}
                              </td>
                              <td className="py-3 px-4">
                                <GeoBadge 
                                  hasLocation={!!(punch.latitude && punch.longitude)} 
                                  needsReview={punch.needsReview} 
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
                                  Corriger
                                </Button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <p className="text-center py-8 text-muted-foreground">
                      <Clock className="h-12 w-12 mx-auto mb-2 opacity-30" />
                      Aucun pointage
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
                    Pointages à Réviser
                  </CardTitle>
                  <CardDescription>
                    Pointages nécessitant une vérification manuelle (sans géolocalisation)
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
                            <th className="text-left py-3 px-4 font-medium text-muted-foreground">Employé</th>
                            <th className="text-left py-3 px-4 font-medium text-muted-foreground">Type</th>
                            <th className="text-left py-3 px-4 font-medium text-muted-foreground">Date/Heure</th>
                            <th className="text-left py-3 px-4 font-medium text-muted-foreground">Position</th>
                            <th className="text-left py-3 px-4 font-medium text-muted-foreground">Statut</th>
                            <th className="text-right py-3 px-4 font-medium text-muted-foreground">Actions</th>
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
                                {new Date(punch.timestamp).toLocaleString("fr-FR")}
                              </td>
                              <td className="py-3 px-4">
                                <GeoBadge 
                                  hasLocation={!!(punch.latitude && punch.longitude)} 
                                  needsReview={punch.needsReview} 
                                />
                              </td>
                              <td className="py-3 px-4">
                                <div className="flex gap-1">
                                  {punch.reviewed && (
                                    <Badge className="bg-green-100 text-green-700 text-xs">
                                      <Eye className="h-3 w-3 mr-1" />
                                      Révisé
                                    </Badge>
                                  )}
                                  {punch.corrected && (
                                    <Badge className="bg-blue-100 text-blue-700 text-xs">
                                      Corrigé
                                    </Badge>
                                  )}
                                  {!punch.reviewed && !punch.corrected && (
                                    <Badge variant="outline" className="text-amber-600 border-amber-300 text-xs">
                                      En attente
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
                                      Valider
                                    </Button>
                                  )}
                                  <Button 
                                    variant="ghost" 
                                    size="sm"
                                    onClick={() => setSelectedPunchForCorrection(punch)}
                                    data-testid={`button-correct-review-${punch.id}`}
                                  >
                                    Corriger
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
                        Tous les pointages ont été révisés
                      </p>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            {activeTab === "exports" && (
              <Card className="border-card-border">
                <CardHeader>
                  <CardTitle>Exports CSV</CardTitle>
                  <CardDescription>
                    Exportez les données de pointage par employé et période
                  </CardDescription>
                </CardHeader>
                <CardContent className="text-center py-12">
                  <FileText className="h-16 w-16 mx-auto mb-4 text-muted-foreground opacity-50" />
                  <p className="text-muted-foreground mb-6">
                    Sélectionnez une période et les employés pour générer un export CSV
                  </p>
                  <Button onClick={() => setShowExportDialog(true)} data-testid="button-start-export">
                    <Download className="h-4 w-4 mr-2" />
                    Créer un export
                  </Button>
                </CardContent>
              </Card>
            )}
          </main>
        </div>
      </div>

      <EmployeeDialog 
        open={showEmployeeDialog} 
        onOpenChange={setShowEmployeeDialog} 
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
    </SidebarProvider>
  );
}
