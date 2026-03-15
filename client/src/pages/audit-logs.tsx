import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ScrollText, Filter, ChevronLeft, ChevronRight, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import type { AuditEntry } from "@shared/schema";

interface AuditLogResponse {
  entries: AuditEntry[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

const EVENT_TYPES = [
  "phi_access",
  "call_upload",
  "call_delete",
  "call_export",
  "user_login",
  "user_logout",
  "user_created",
  "user_updated",
  "user_deleted",
  "settings_updated",
  "api_key_created",
  "api_key_revoked",
];

const RESOURCE_TYPES = [
  "call",
  "transcript",
  "analysis",
  "user",
  "employee",
  "coaching_session",
  "prompt_template",
  "organization",
  "api_key",
];

export default function AuditLogsPage() {
  const [page, setPage] = useState(1);
  const [eventFilter, setEventFilter] = useState("");
  const [resourceTypeFilter, setResourceTypeFilter] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const pageSize = 25;

  const queryParams = new URLSearchParams();
  queryParams.set("page", String(page));
  queryParams.set("limit", String(pageSize));
  if (eventFilter) queryParams.set("event", eventFilter);
  if (resourceTypeFilter) queryParams.set("resourceType", resourceTypeFilter);
  if (fromDate) queryParams.set("from", new Date(fromDate).toISOString());
  if (toDate) queryParams.set("to", new Date(toDate + "T23:59:59").toISOString());

  const { data, isLoading } = useQuery<AuditLogResponse>({
    queryKey: ["/api/admin/audit-logs", page, eventFilter, resourceTypeFilter, fromDate, toDate],
    queryFn: async () => {
      const res = await fetch(`/api/admin/audit-logs?${queryParams.toString()}`);
      if (!res.ok) throw new Error("Failed to fetch audit logs");
      return res.json();
    },
  });

  const clearFilters = () => {
    setEventFilter("");
    setResourceTypeFilter("");
    setFromDate("");
    setToDate("");
    setPage(1);
  };

  const hasFilters = eventFilter || resourceTypeFilter || fromDate || toDate;

  const exportCsv = () => {
    if (!data?.entries.length) return;
    const headers = ["Timestamp", "Event", "Username", "Role", "Resource Type", "Resource ID", "IP", "Detail"];
    const rows = data.entries.map(e => [
      e.timestamp || "",
      e.event,
      e.username || "",
      e.role || "",
      e.resourceType,
      e.resourceId || "",
      e.ip || "",
      (e.detail || "").replace(/"/g, '""'),
    ]);
    const csv = [headers.join(","), ...rows.map(r => r.map(c => `"${c}"`).join(","))].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `audit-logs-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const eventBadgeColor = (event: string) => {
    if (event.includes("delete") || event.includes("revoke")) return "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400";
    if (event.includes("create") || event.includes("upload")) return "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400";
    if (event.includes("login") || event.includes("logout")) return "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400";
    if (event.includes("phi")) return "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400";
    return "bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-400";
  };

  return (
    <div className="min-h-screen p-6 space-y-6" data-testid="audit-logs-page">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <ScrollText className="w-6 h-6" />
            Audit Logs
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            HIPAA compliance audit trail — all system events
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={exportCsv} disabled={!data?.entries.length}>
          <Download className="w-4 h-4 mr-1" />
          Export CSV
        </Button>
      </div>

      {/* Filters */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Filter className="w-4 h-4" />
            Filters
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
            <Select value={eventFilter} onValueChange={(v) => { setEventFilter(v === "all" ? "" : v); setPage(1); }}>
              <SelectTrigger className="h-9 text-sm">
                <SelectValue placeholder="Event type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All events</SelectItem>
                {EVENT_TYPES.map(e => (
                  <SelectItem key={e} value={e}>{e.replace(/_/g, " ")}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={resourceTypeFilter} onValueChange={(v) => { setResourceTypeFilter(v === "all" ? "" : v); setPage(1); }}>
              <SelectTrigger className="h-9 text-sm">
                <SelectValue placeholder="Resource type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All resources</SelectItem>
                {RESOURCE_TYPES.map(r => (
                  <SelectItem key={r} value={r}>{r.replace(/_/g, " ")}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Input
              type="date"
              value={fromDate}
              onChange={(e) => { setFromDate(e.target.value); setPage(1); }}
              placeholder="From date"
              className="h-9 text-sm"
            />

            <Input
              type="date"
              value={toDate}
              onChange={(e) => { setToDate(e.target.value); setPage(1); }}
              placeholder="To date"
              className="h-9 text-sm"
            />

            {hasFilters && (
              <Button variant="ghost" size="sm" onClick={clearFilters} className="h-9">
                Clear filters
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Results */}
      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-6 space-y-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : !data?.entries.length ? (
            <div className="p-12 text-center text-muted-foreground">
              <ScrollText className="w-12 h-12 mx-auto mb-3 opacity-30" />
              <p>No audit log entries found</p>
              {hasFilters && <p className="text-sm mt-1">Try adjusting your filters</p>}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="text-left p-3 font-medium">Timestamp</th>
                    <th className="text-left p-3 font-medium">Event</th>
                    <th className="text-left p-3 font-medium">User</th>
                    <th className="text-left p-3 font-medium">Resource</th>
                    <th className="text-left p-3 font-medium">IP</th>
                    <th className="text-left p-3 font-medium">Detail</th>
                  </tr>
                </thead>
                <tbody>
                  {data.entries.map((entry, i) => (
                    <tr key={i} className="border-b last:border-0 hover:bg-muted/30 transition-colors">
                      <td className="p-3 whitespace-nowrap text-muted-foreground text-xs font-mono">
                        {entry.timestamp ? new Date(entry.timestamp).toLocaleString() : "—"}
                      </td>
                      <td className="p-3">
                        <Badge className={eventBadgeColor(entry.event)} variant="secondary">
                          {entry.event.replace(/_/g, " ")}
                        </Badge>
                      </td>
                      <td className="p-3">
                        <div>
                          <span className="font-medium">{entry.username || "—"}</span>
                          {entry.role && (
                            <span className="text-xs text-muted-foreground ml-1">({entry.role})</span>
                          )}
                        </div>
                      </td>
                      <td className="p-3">
                        <span className="text-muted-foreground">{entry.resourceType}</span>
                        {entry.resourceId && (
                          <span className="text-xs text-muted-foreground block font-mono truncate max-w-[120px]" title={entry.resourceId}>
                            {entry.resourceId}
                          </span>
                        )}
                      </td>
                      <td className="p-3 text-xs text-muted-foreground font-mono">
                        {entry.ip || "—"}
                      </td>
                      <td className="p-3 text-xs text-muted-foreground max-w-[200px] truncate" title={entry.detail}>
                        {entry.detail || "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Pagination */}
          {data && data.totalPages > 1 && (
            <div className="flex items-center justify-between p-3 border-t">
              <span className="text-sm text-muted-foreground">
                {data.total} entries — page {data.page} of {data.totalPages}
              </span>
              <div className="flex gap-1">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page <= 1}
                  onClick={() => setPage(p => p - 1)}
                >
                  <ChevronLeft className="w-4 h-4" />
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page >= data.totalPages}
                  onClick={() => setPage(p => p + 1)}
                >
                  <ChevronRight className="w-4 h-4" />
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
