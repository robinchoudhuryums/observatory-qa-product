import { useQuery } from "@tanstack/react-query";
import type { Organization } from "@shared/schema";

/**
 * Hook to fetch the current user's organization data.
 * Provides branding info (appName, logoUrl) and org settings.
 */
export function useOrganization() {
  return useQuery<Organization>({
    queryKey: ["/api/organization"],
    staleTime: 5 * 60 * 1000, // 5 minutes — branding rarely changes
  });
}

/**
 * Extract the app name from org data, with fallback.
 */
export function useAppName(): string {
  const { data: org } = useOrganization();
  return org?.settings?.branding?.appName || "Observatory";
}
