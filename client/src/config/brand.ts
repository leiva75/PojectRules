import logoPath from "@/assets/logo-cronos.png";

export const LOGO_SRC = logoPath;
export const APP_NAME = "CronosFichajes";
export const APP_DOMAIN = "cronosfichajes.es";

export type LogoSize = "sm" | "md" | "lg" | "xl";

export const LOGO_SIZES: Record<LogoSize, { height: number; className: string }> = {
  sm: { height: 32, className: "h-8 w-auto" },
  md: { height: 40, className: "h-10 w-auto" },
  lg: { height: 48, className: "h-12 w-auto" },
  xl: { height: 64, className: "h-16 w-auto" },
};
