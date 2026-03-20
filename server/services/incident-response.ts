/**
 * Incident Response & Breach Reporting Service
 *
 * HIPAA §164.408 requires covered entities to notify affected individuals
 * of breaches of unsecured PHI within 60 days. This service provides:
 *
 * - Incident declaration with severity classification
 * - Phase tracking (detection → containment → eradication → recovery → post-incident)
 * - Timeline logging for each incident
 * - Breach notification status tracking
 * - Action item management
 *
 * Storage: In-memory with persistence via the storage layer.
 * In production, incidents should be stored in PostgreSQL.
 *
 * Multi-tenant: All incidents are org-scoped.
 */
import { randomUUID } from "crypto";
import { logger } from "./logger";

// --- Types ---

export type IncidentSeverity = "critical" | "high" | "medium" | "low";
export type IncidentPhase = "detection" | "containment" | "eradication" | "recovery" | "post_incident" | "closed";
export type BreachNotificationStatus = "not_required" | "pending" | "individuals_notified" | "hhs_notified" | "complete";

export interface TimelineEntry {
  id: string;
  timestamp: string;
  description: string;
  addedBy: string;
}

export interface ActionItem {
  id: string;
  description: string;
  assignedTo?: string;
  status: "open" | "in_progress" | "completed";
  dueDate?: string;
  completedAt?: string;
}

export interface SecurityIncident {
  id: string;
  orgId: string;
  title: string;
  description: string;
  severity: IncidentSeverity;
  phase: IncidentPhase;
  declaredAt: string;
  declaredBy: string;
  closedAt?: string;
  affectedSystems: string[];
  estimatedAffectedRecords: number;
  phiInvolved: boolean;
  timeline: TimelineEntry[];
  actionItems: ActionItem[];
  breachNotification: BreachNotificationStatus;
  breachNotificationDeadline?: string; // 60 days from detection per HIPAA
  containedAt?: string;
  eradicatedAt?: string;
  recoveredAt?: string;
  rootCause?: string;
  lessonsLearned?: string;
}

export interface BreachReport {
  id: string;
  orgId: string;
  incidentId?: string;
  title: string;
  description: string;
  discoveredAt: string;
  reportedBy: string;
  affectedIndividuals: number;
  phiTypes: string[]; // e.g., ["names", "medical_records", "ssn"]
  notificationStatus: BreachNotificationStatus;
  notificationDeadline: string;
  individualsNotifiedAt?: string;
  hhsNotifiedAt?: string;
  mediaNotifiedAt?: string; // Required if >500 individuals affected
  correctiveActions: string[];
  createdAt: string;
  updatedAt: string;
}

// --- In-memory storage (org-scoped) ---
const incidents = new Map<string, SecurityIncident>();    // id → incident
const breachReports = new Map<string, BreachReport>();    // id → report

// --- Incident management ---

export function declareIncident(orgId: string, data: {
  title: string;
  description: string;
  severity: IncidentSeverity;
  declaredBy: string;
  affectedSystems?: string[];
  estimatedAffectedRecords?: number;
  phiInvolved?: boolean;
}): SecurityIncident {
  const id = randomUUID();
  const now = new Date().toISOString();

  // HIPAA: 60-day notification deadline from discovery
  const deadline = new Date();
  deadline.setDate(deadline.getDate() + 60);

  const incident: SecurityIncident = {
    id,
    orgId,
    title: data.title,
    description: data.description,
    severity: data.severity,
    phase: "detection",
    declaredAt: now,
    declaredBy: data.declaredBy,
    affectedSystems: data.affectedSystems || [],
    estimatedAffectedRecords: data.estimatedAffectedRecords || 0,
    phiInvolved: data.phiInvolved || false,
    timeline: [{
      id: randomUUID(),
      timestamp: now,
      description: `Incident declared by ${data.declaredBy}. Severity: ${data.severity}`,
      addedBy: data.declaredBy,
    }],
    actionItems: [],
    breachNotification: data.phiInvolved ? "pending" : "not_required",
    breachNotificationDeadline: data.phiInvolved ? deadline.toISOString() : undefined,
  };

  incidents.set(id, incident);
  logger.warn({ orgId, incidentId: id, severity: data.severity, phiInvolved: data.phiInvolved }, "Security incident declared");
  return incident;
}

export function advanceIncidentPhase(orgId: string, incidentId: string, advancedBy: string): SecurityIncident | null {
  const incident = incidents.get(incidentId);
  if (!incident || incident.orgId !== orgId) return null;

  const phaseOrder: IncidentPhase[] = ["detection", "containment", "eradication", "recovery", "post_incident", "closed"];
  const currentIdx = phaseOrder.indexOf(incident.phase);
  if (currentIdx >= phaseOrder.length - 1) return incident; // Already closed

  const nextPhase = phaseOrder[currentIdx + 1]!;
  const now = new Date().toISOString();

  incident.phase = nextPhase;

  // Track phase timestamps
  if (nextPhase === "containment") incident.containedAt = now;
  else if (nextPhase === "eradication") incident.eradicatedAt = now;
  else if (nextPhase === "recovery") incident.recoveredAt = now;
  else if (nextPhase === "closed") incident.closedAt = now;

  incident.timeline.push({
    id: randomUUID(),
    timestamp: now,
    description: `Phase advanced to ${nextPhase} by ${advancedBy}`,
    addedBy: advancedBy,
  });

  logger.info({ orgId, incidentId, phase: nextPhase }, "Incident phase advanced");
  return incident;
}

export function addTimelineEntry(orgId: string, incidentId: string, description: string, addedBy: string): SecurityIncident | null {
  const incident = incidents.get(incidentId);
  if (!incident || incident.orgId !== orgId) return null;

  incident.timeline.push({
    id: randomUUID(),
    timestamp: new Date().toISOString(),
    description,
    addedBy,
  });
  return incident;
}

export function addActionItem(orgId: string, incidentId: string, item: {
  description: string;
  assignedTo?: string;
  dueDate?: string;
}): SecurityIncident | null {
  const incident = incidents.get(incidentId);
  if (!incident || incident.orgId !== orgId) return null;

  incident.actionItems.push({
    id: randomUUID(),
    description: item.description,
    assignedTo: item.assignedTo,
    status: "open",
    dueDate: item.dueDate,
  });
  return incident;
}

export function updateActionItem(orgId: string, incidentId: string, itemId: string, status: "open" | "in_progress" | "completed"): SecurityIncident | null {
  const incident = incidents.get(incidentId);
  if (!incident || incident.orgId !== orgId) return null;

  const item = incident.actionItems.find(a => a.id === itemId);
  if (!item) return null;

  item.status = status;
  if (status === "completed") item.completedAt = new Date().toISOString();
  return incident;
}

export function updateIncident(orgId: string, incidentId: string, updates: Partial<Pick<SecurityIncident, "title" | "description" | "severity" | "rootCause" | "lessonsLearned" | "estimatedAffectedRecords">>): SecurityIncident | null {
  const incident = incidents.get(incidentId);
  if (!incident || incident.orgId !== orgId) return null;

  Object.assign(incident, updates);
  return incident;
}

export function getIncident(orgId: string, incidentId: string): SecurityIncident | null {
  const incident = incidents.get(incidentId);
  if (!incident || incident.orgId !== orgId) return null;
  return incident;
}

export function listIncidents(orgId: string): SecurityIncident[] {
  return Array.from(incidents.values())
    .filter(i => i.orgId === orgId)
    .sort((a, b) => b.declaredAt.localeCompare(a.declaredAt));
}

// --- Breach reporting ---

export function createBreachReport(orgId: string, data: {
  title: string;
  description: string;
  reportedBy: string;
  incidentId?: string;
  affectedIndividuals: number;
  phiTypes: string[];
  correctiveActions?: string[];
}): BreachReport {
  const id = randomUUID();
  const now = new Date().toISOString();

  // HIPAA §164.408: 60-day notification deadline
  const deadline = new Date();
  deadline.setDate(deadline.getDate() + 60);

  const report: BreachReport = {
    id,
    orgId,
    incidentId: data.incidentId,
    title: data.title,
    description: data.description,
    discoveredAt: now,
    reportedBy: data.reportedBy,
    affectedIndividuals: data.affectedIndividuals,
    phiTypes: data.phiTypes,
    notificationStatus: "pending",
    notificationDeadline: deadline.toISOString(),
    correctiveActions: data.correctiveActions || [],
    createdAt: now,
    updatedAt: now,
  };

  breachReports.set(id, report);
  logger.warn({ orgId, breachId: id, affected: data.affectedIndividuals }, "HIPAA breach report filed");
  return report;
}

export function updateBreachReport(orgId: string, reportId: string, updates: Partial<Pick<BreachReport, "notificationStatus" | "individualsNotifiedAt" | "hhsNotifiedAt" | "mediaNotifiedAt" | "correctiveActions">>): BreachReport | null {
  const report = breachReports.get(reportId);
  if (!report || report.orgId !== orgId) return null;

  Object.assign(report, updates, { updatedAt: new Date().toISOString() });

  // Auto-advance notification status
  if (updates.individualsNotifiedAt && updates.hhsNotifiedAt) {
    report.notificationStatus = "complete";
  } else if (updates.hhsNotifiedAt) {
    report.notificationStatus = "hhs_notified";
  } else if (updates.individualsNotifiedAt) {
    report.notificationStatus = "individuals_notified";
  }

  logger.info({ orgId, breachId: reportId, status: report.notificationStatus }, "Breach report updated");
  return report;
}

export function listBreachReports(orgId: string): BreachReport[] {
  return Array.from(breachReports.values())
    .filter(r => r.orgId === orgId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function getBreachReport(orgId: string, reportId: string): BreachReport | null {
  const report = breachReports.get(reportId);
  if (!report || report.orgId !== orgId) return null;
  return report;
}
