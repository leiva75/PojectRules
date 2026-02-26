import { Badge } from "@/components/ui/badge";
import { Clock, MapPin, AlertTriangle, CheckCircle, LogOut } from "lucide-react";

type StatusType = "IN" | "OUT" | "NEEDS_REVIEW" | "ACTIVE" | "INACTIVE";

interface StatusBadgeProps {
  status: StatusType;
  className?: string;
}

const statusConfig: Record<StatusType, { label: string; variant: "default" | "secondary" | "destructive" | "outline"; icon: React.ReactNode; className: string }> = {
  IN: {
    label: "Entrada",
    variant: "default",
    icon: <CheckCircle className="w-3 h-3" />,
    className: "bg-green-600 hover:bg-green-700 text-white border-green-700",
  },
  OUT: {
    label: "Salida",
    variant: "secondary",
    icon: <LogOut className="w-3 h-3" />,
    className: "bg-orange-500 hover:bg-orange-600 text-white border-orange-600",
  },
  NEEDS_REVIEW: {
    label: "Por verificar",
    variant: "destructive",
    icon: <AlertTriangle className="w-3 h-3" />,
    className: "bg-red-600 hover:bg-red-700 text-white border-red-700",
  },
  ACTIVE: {
    label: "Activo",
    variant: "default",
    icon: <CheckCircle className="w-3 h-3" />,
    className: "bg-green-600 hover:bg-green-700 text-white border-green-700",
  },
  INACTIVE: {
    label: "Inactivo",
    variant: "secondary",
    icon: null,
    className: "bg-gray-400 hover:bg-gray-500 text-white border-gray-500",
  },
};

export function StatusBadge({ status, className = "" }: StatusBadgeProps) {
  const config = statusConfig[status];
  
  return (
    <Badge 
      variant={config.variant}
      className={`${config.className} ${className} gap-1 text-xs font-medium`}
      data-testid={`badge-status-${status.toLowerCase()}`}
    >
      {config.icon}
      {config.label}
    </Badge>
  );
}

interface GeoBadgeProps {
  hasLocation: boolean;
  needsReview?: boolean;
  latitude?: number | string | null;
  longitude?: number | string | null;
}

export function GeoBadge({ hasLocation, needsReview, latitude, longitude }: GeoBadgeProps) {
  if (needsReview) {
    return (
      <Badge variant="destructive" className="gap-1 text-xs bg-red-600 text-white">
        <AlertTriangle className="w-3 h-3" />
        Sin posición
      </Badge>
    );
  }
  
  if (hasLocation && latitude && longitude) {
    const lat = typeof latitude === "string" ? parseFloat(latitude) : latitude;
    const lon = typeof longitude === "string" ? parseFloat(longitude) : longitude;
    const mapsUrl = `https://www.google.com/maps?q=${lat},${lon}`;
    
    return (
      <a 
        href={mapsUrl} 
        target="_blank" 
        rel="noopener noreferrer"
        className="inline-flex"
        data-testid="link-geo-location"
      >
        <Badge 
          variant="outline" 
          className="gap-1 text-xs text-green-700 border-green-600 cursor-pointer hover:bg-green-50"
        >
          <MapPin className="w-3 h-3" />
          {lat.toFixed(4)}, {lon.toFixed(4)}
        </Badge>
      </a>
    );
  }
  
  if (hasLocation) {
    return (
      <Badge variant="outline" className="gap-1 text-xs text-green-700 border-green-600">
        <MapPin className="w-3 h-3" />
        Geolocalizado
      </Badge>
    );
  }
  
  return null;
}

interface TimeBadgeProps {
  time: Date | string;
  showRelative?: boolean;
}

export function TimeBadge({ time, showRelative = false }: TimeBadgeProps) {
  const date = typeof time === "string" ? new Date(time) : time;
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  
  let displayText: string;
  
  if (showRelative && diffMins < 60) {
    displayText = diffMins <= 1 ? "Ahora mismo" : `Hace ${diffMins} min`;
  } else if (showRelative && diffHours < 24) {
    displayText = `Hace ${diffHours}h`;
  } else {
    displayText = date.toLocaleTimeString("es-ES", { 
      timeZone: "Europe/Madrid",
      hour: "2-digit", 
      minute: "2-digit" 
    });
  }
  
  return (
    <span className="font-mono text-sm text-muted-foreground flex items-center gap-1">
      <Clock className="w-3 h-3" />
      {displayText}
    </span>
  );
}
