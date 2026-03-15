import { useEffect } from "react";
import { useOrganization } from "@/hooks/use-organization";

/**
 * Converts a hex color (e.g., "#3b82f6") to an HSL string for CSS variables.
 * Returns format: "h s% l%" (without the "hsl()" wrapper, matching shadcn format).
 */
function hexToHsl(hex: string): string | null {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!result) return null;

  let r = parseInt(result[1], 16) / 255;
  let g = parseInt(result[2], 16) / 255;
  let b = parseInt(result[3], 16) / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
      case g: h = ((b - r) / d + 2) / 6; break;
      case b: h = ((r - g) / d + 4) / 6; break;
    }
  }

  return `${Math.round(h * 360)}, ${Math.round(s * 100)}%, ${Math.round(l * 100)}%`;
}

/** Converts hex to "r, g, b" string for use in rgba(). */
function hexToRgb(hex: string): string | null {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!result) return null;
  return `${parseInt(result[1], 16)}, ${parseInt(result[2], 16)}, ${parseInt(result[3], 16)}`;
}

/** All brand-related CSS custom properties we inject. */
const BRAND_VARS = [
  "--primary", "--accent", "--ring", "--chart-1",
  "--brand-from", "--brand-to",
  "--brand-from-rgb", "--brand-to-rgb",
] as const;

/**
 * Injects CSS custom properties for org-specific branding.
 *
 * Sets:
 *   --primary / --accent / --ring / --chart-1  → org primaryColor (shadcn theme)
 *   --brand-from / --brand-to                  → gradient endpoints (HSL)
 *   --brand-from-rgb / --brand-to-rgb          → gradient endpoints (RGB, for box-shadow alpha)
 *
 * Defaults (when no branding set):
 *   --brand-from: teal-500 (#14b8a6)
 *   --brand-to:   blue-500 (#3b82f6)
 */
export function BrandingProvider() {
  const { data: org } = useOrganization();
  const primaryColor = org?.settings?.branding?.primaryColor;
  const secondaryColor = org?.settings?.branding?.secondaryColor;

  useEffect(() => {
    const root = document.documentElement;

    // Always set brand gradient vars (use defaults if no branding configured)
    const fromHex = primaryColor || "#14b8a6";   // teal-500 default
    const toHex = secondaryColor || "#3b82f6";   // blue-500 default

    const fromHsl = hexToHsl(fromHex);
    const toHsl = hexToHsl(toHex);
    const fromRgb = hexToRgb(fromHex);
    const toRgb = hexToRgb(toHex);

    if (fromHsl) root.style.setProperty("--brand-from", fromHsl);
    if (toHsl) root.style.setProperty("--brand-to", toHsl);
    if (fromRgb) root.style.setProperty("--brand-from-rgb", fromRgb);
    if (toRgb) root.style.setProperty("--brand-to-rgb", toRgb);

    // Override shadcn theme colors when an explicit primary is set
    if (primaryColor) {
      const hsl = hexToHsl(primaryColor);
      if (hsl) {
        root.style.setProperty("--primary", `hsl(${hsl})`);
        root.style.setProperty("--accent", `hsl(${hsl})`);
        root.style.setProperty("--ring", `hsl(${hsl})`);
        root.style.setProperty("--chart-1", `hsl(${hsl})`);
      }
    }

    return () => {
      for (const v of BRAND_VARS) root.style.removeProperty(v);
    };
  }, [primaryColor, secondaryColor]);

  return null;
}
