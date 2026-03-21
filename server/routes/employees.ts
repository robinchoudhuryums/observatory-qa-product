import type { Express } from "express";
import path from "path";
import fs from "fs";
import csv from "csv-parser";
import { storage } from "../storage";
import { requireAuth, requireRole, injectOrgContext } from "../auth";
import { insertEmployeeSchema } from "@shared/schema";
import { z } from "zod";
import { logger } from "../services/logger";

export function registerEmployeeRoutes(app: Express): void {
  // Get all employees
  app.get("/api/employees", requireAuth, injectOrgContext, async (req, res) => {
    try {
      const employees = await storage.getAllEmployees(req.orgId!);
      res.json(employees);
    } catch (error) {
      res.status(500).json({ message: "Failed to get employees" });
    }
  });

  // HIPAA: Only managers and admins can create employees
  app.post("/api/employees", requireAuth, injectOrgContext, requireRole("manager", "admin"), async (req, res) => {
    try {
      const validatedData = insertEmployeeSchema.parse(req.body);
      const employee = await storage.createEmployee(req.orgId!, validatedData);
      res.status(201).json(employee);
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ message: "Invalid employee data", errors: error.errors });
      } else {
        res.status(500).json({ message: "Failed to create employee" });
      }
    }
  });

  // HIPAA: Only managers and admins can update employees
  const updateEmployeeSchema = z.object({
    name: z.string().min(1).optional(),
    email: z.string().email().optional(),
    role: z.string().optional(),
    status: z.string().optional(),
    initials: z.string().max(2).optional(),
    subTeam: z.string().optional(),
  }).strict();

  app.patch("/api/employees/:id", requireAuth, injectOrgContext, requireRole("manager", "admin"), async (req, res) => {
    try {
      const parsed = updateEmployeeSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ message: "Invalid update data", errors: parsed.error.flatten() });
        return;
      }
      const employee = await storage.getEmployee(req.orgId!, req.params.id);
      if (!employee) {
        res.status(404).json({ message: "Employee not found" });
        return;
      }
      const updated = await storage.updateEmployee(req.orgId!, req.params.id, parsed.data);
      res.json(updated);
    } catch (error) {
      res.status(500).json({ message: "Failed to update employee" });
    }
  });

  // HIPAA: Only admins can bulk import employees
  app.post("/api/employees/import-csv", requireAuth, injectOrgContext, requireRole("admin"), async (req, res) => {
    try {
      const csvFilePath = path.resolve("employees.csv");

      // Use org email domain from settings (falls back to "company.com")
      const org = await storage.getOrganization(req.orgId!);
      const emailDomain = org?.settings?.emailDomain || "company.com";

      const results: Array<{ name: string; action: string }> = [];
      const rows: any[] = [];
      const MAX_CSV_ROWS = 10000;

      // Stream CSV — handle ENOENT via error event (avoids TOCTOU race with existsSync)
      await new Promise<void>((resolve, reject) => {
        const stream = fs.createReadStream(csvFilePath)
          .on("error", (err: NodeJS.ErrnoException) => {
            if (err.code === "ENOENT") {
              reject(new Error("FILE_NOT_FOUND"));
            } else {
              reject(err);
            }
          })
          .pipe(csv())
          .on("data", (row: any) => {
            if (rows.length >= MAX_CSV_ROWS) {
              stream.destroy();
              reject(new Error(`CSV exceeds maximum of ${MAX_CSV_ROWS} rows`));
              return;
            }
            rows.push(row);
          })
          .on("end", resolve)
          .on("error", reject);
      }).catch((err: Error) => {
        if (err.message === "FILE_NOT_FOUND") {
          res.status(404).json({ message: "employees.csv not found on server" });
          return;
        }
        throw err;
      });
      if (res.headersSent) return;

      for (const row of rows) {
        const name = (row["Agent Name"] || "").trim();
        const department = (row["Department"] || "").trim();
        const extension = (row["Extension"] || "").trim();
        const status = (row["Status"] || "Active").trim();

        if (!name) continue;

        const isValidExtension = extension && extension !== "NA" && extension !== "N/A" && extension !== "a"
          && /^[a-zA-Z0-9._-]+$/.test(extension);
        const email = isValidExtension
          ? `${extension}@${emailDomain}`
          : `${name.toLowerCase().replace(/\s+/g, ".")}@${emailDomain}`;

        const nameParts = name.split(/\s+/);
        const initials = nameParts.length >= 2
          ? (nameParts[0][0] + nameParts[nameParts.length - 1][0]).toUpperCase()
          : name.slice(0, 2).toUpperCase();

        try {
          const existing = await storage.getEmployeeByEmail(req.orgId!, email);
          if (existing) {
            results.push({ name, action: "skipped (exists)" });
          } else {
            await storage.createEmployee(req.orgId!, { orgId: req.orgId!, name, email, role: department, initials, status });
            results.push({ name, action: "created" });
          }
        } catch (err) {
          results.push({ name, action: `error: ${(err as Error).message}` });
        }
      }

      const created = results.filter(r => r.action === "created").length;
      const skipped = results.filter(r => r.action.startsWith("skipped")).length;
      res.json({ message: `Import complete: ${created} created, ${skipped} skipped`, details: results });
    } catch (error) {
      logger.error({ err: error }, "CSV import failed");
      res.status(500).json({ message: "Failed to import employees from CSV" });
    }
  });
}
