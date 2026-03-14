/**
 * Data export endpoints — CSV downloads for calls, employees, and report data.
 *
 * HIPAA: Exports are audit-logged. Call transcripts are NOT included in bulk exports
 * (only metadata, scores, and summaries). Individual transcript export is available
 * via the transcript-viewer on the frontend.
 */
import type { Express } from "express";
import { storage } from "../storage";
import { requireAuth, requireRole, injectOrgContext } from "../auth";
import { logger } from "../services/logger";
import { logPhiAccess } from "../services/audit-log";

function escapeCsvField(value: unknown): string {
  if (value == null) return "";
  const str = String(value);
  if (str.includes(",") || str.includes('"') || str.includes("\n")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function toCsvRow(fields: unknown[]): string {
  return fields.map(escapeCsvField).join(",");
}

export function registerExportRoutes(app: Express): void {

  /**
   * Export calls data as CSV.
   * Includes: call metadata, performance scores, sentiment, flags.
   * Excludes: full transcript text (HIPAA — too much PHI in bulk export).
   */
  app.get("/api/export/calls", requireAuth, requireRole("manager"), injectOrgContext, async (req, res) => {
    try {
      const { from, to, employeeId, status } = req.query;

      const filters: { status?: string; employee?: string } = {};
      if (status && typeof status === "string") filters.status = status;
      if (employeeId && typeof employeeId === "string") filters.employee = employeeId;

      const calls = await storage.getCallSummaries(req.orgId!, filters);
      const employees = await storage.getAllEmployees(req.orgId!);
      const empMap = new Map(employees.map(e => [e.id, e]));

      // Apply date filters
      let filtered = calls;
      if (from) {
        const fromDate = new Date(from as string);
        filtered = filtered.filter(c => new Date(c.uploadedAt || 0) >= fromDate);
      }
      if (to) {
        const toDate = new Date(to as string);
        toDate.setHours(23, 59, 59, 999);
        filtered = filtered.filter(c => new Date(c.uploadedAt || 0) <= toDate);
      }

      const headers = [
        "Call ID", "File Name", "Status", "Category", "Employee", "Employee Email",
        "Duration (s)", "Upload Date", "Performance Score",
        "Compliance", "Customer Experience", "Communication", "Resolution",
        "Sentiment", "Sentiment Score", "Summary", "Flags", "Tags",
      ];

      const rows = filtered.map(call => {
        const emp = call.employeeId ? empMap.get(call.employeeId) : undefined;
        const analysis = call.analysis as any;
        const subScores = analysis?.subScores || {};
        const flags = Array.isArray(analysis?.flags) ? analysis.flags.join("; ") : "";
        const tags = Array.isArray(call.tags) ? (call.tags as string[]).join("; ") : "";

        return toCsvRow([
          call.id,
          call.fileName,
          call.status,
          call.callCategory || "",
          emp?.name || "",
          emp?.email || "",
          call.duration || "",
          call.uploadedAt || "",
          analysis?.performanceScore ?? "",
          subScores.compliance ?? "",
          subScores.customerExperience ?? "",
          subScores.communication ?? "",
          subScores.resolution ?? "",
          call.sentiment?.overallSentiment || "",
          call.sentiment?.overallScore ?? "",
          analysis?.summary || "",
          flags,
          tags,
        ]);
      });

      const csv = [toCsvRow(headers), ...rows].join("\n");

      logPhiAccess({
        event: "export_calls_csv",
        userId: req.user!.id,
        orgId: req.orgId!,
        resourceType: "call",
        detail: `Exported ${filtered.length} calls`,
      });

      const filename = `calls-export-${new Date().toISOString().slice(0, 10)}.csv`;
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.send(csv);
    } catch (error) {
      logger.error({ err: error }, "Failed to export calls CSV");
      res.status(500).json({ message: "Failed to export calls" });
    }
  });

  /**
   * Export employees data as CSV.
   */
  app.get("/api/export/employees", requireAuth, requireRole("manager"), injectOrgContext, async (req, res) => {
    try {
      const employees = await storage.getAllEmployees(req.orgId!);

      const headers = ["ID", "Name", "Email", "Role", "Status", "Sub-Team", "Initials"];
      const rows = employees.map(emp => toCsvRow([
        emp.id, emp.name, emp.email, emp.role || "", emp.status || "",
        emp.subTeam || "", emp.initials || "",
      ]));

      const csv = [toCsvRow(headers), ...rows].join("\n");

      logPhiAccess({
        event: "export_employees_csv",
        userId: req.user!.id,
        orgId: req.orgId!,
        resourceType: "employee",
        detail: `Exported ${employees.length} employees`,
      });

      const filename = `employees-export-${new Date().toISOString().slice(0, 10)}.csv`;
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.send(csv);
    } catch (error) {
      logger.error({ err: error }, "Failed to export employees CSV");
      res.status(500).json({ message: "Failed to export employees" });
    }
  });

  /**
   * Export coaching sessions as CSV.
   */
  app.get("/api/export/coaching", requireAuth, requireRole("manager"), injectOrgContext, async (req, res) => {
    try {
      const sessions = await storage.getAllCoachingSessions(req.orgId!);
      const employees = await storage.getAllEmployees(req.orgId!);
      const empMap = new Map(employees.map(e => [e.id, e]));

      const headers = [
        "Session ID", "Employee", "Category", "Title", "Status",
        "Assigned By", "Due Date", "Created", "Completed", "Notes",
      ];
      const rows = sessions.map(s => {
        const emp = empMap.get(s.employeeId);
        return toCsvRow([
          s.id, emp?.name || s.employeeId, s.category, s.title, s.status,
          s.assignedBy, s.dueDate || "", s.createdAt || "", s.completedAt || "",
          s.notes || "",
        ]);
      });

      const csv = [toCsvRow(headers), ...rows].join("\n");

      const filename = `coaching-export-${new Date().toISOString().slice(0, 10)}.csv`;
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.send(csv);
    } catch (error) {
      logger.error({ err: error }, "Failed to export coaching CSV");
      res.status(500).json({ message: "Failed to export coaching sessions" });
    }
  });
}
