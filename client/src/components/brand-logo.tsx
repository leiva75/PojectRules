import { LOGO_SRC, APP_NAME, type LogoSize, LOGO_SIZES } from "@/config/brand";
import { cn } from "@/lib/utils";

interface BrandLogoProps {
  size?: LogoSize;
  className?: string;
  showFallback?: boolean;
}

export function BrandLogo({ size = "md", className, showFallback = true }: BrandLogoProps) {
  const sizeConfig = LOGO_SIZES[size];
  
  return (
    <img
      src={LOGO_SRC}
      alt={APP_NAME}
      className={cn(
        sizeConfig.className,
        "object-contain",
        className
      )}
      onError={(e) => {
        if (showFallback) {
          e.currentTarget.style.display = "none";
        }
      }}
      data-testid="img-brand-logo"
    />
  );
}
