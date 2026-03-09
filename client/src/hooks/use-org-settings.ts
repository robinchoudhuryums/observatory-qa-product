import { useQuery } from "@tanstack/react-query";
import { getQueryFn } from "@/lib/queryClient";
import type { z } from "zod";
import type { orgSettingsSchema, organizationSchema } from "@shared/schema";

type Organization = z.infer<typeof organizationSchema>;
type OrgSettings = z.infer<typeof orgSettingsSchema>;

/**
 * Fetches the current user's organization and its settings.
 * Returns sensible defaults when settings are not configured.
 */
export function useOrgSettings() {
  const { data: org, isLoading } = useQuery<Organization>({
    queryKey: ["/api/organization"],
    queryFn: getQueryFn({ on401: "returnNull" }),
    staleTime: 5 * 60_000, // Cache for 5 minutes
  });

  const settings: OrgSettings = org?.settings ?? { retentionDays: 90 };

  return {
    org,
    settings,
    isLoading,
    /** App name for branding (defaults to "Observatory") */
    appName: settings.branding?.appName || "Observatory",
    /** Logo URL if configured */
    logoUrl: settings.branding?.logoUrl,
    /** Sub-teams map (defaults to DEFAULT_SUBTEAMS if not set) */
    subTeams: settings.subTeams,
    /** Call party types (returns undefined if not set — callers should use DEFAULT_CALL_PARTY_TYPES) */
    callPartyTypes: settings.callPartyTypes,
    /** Departments list */
    departments: settings.departments,
    /** Call categories */
    callCategories: settings.callCategories,
  };
}
