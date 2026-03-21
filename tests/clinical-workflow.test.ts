import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { MemStorage } from "../server/storage/memory.js";
import { clinicalNoteSchema } from "../shared/schema.js";

describe("Clinical Documentation Workflow", () => {
  let storage: InstanceType<typeof MemStorage>;
  let orgId: string;

  beforeEach(async () => {
    storage = new MemStorage();
    const org = await storage.createOrganization({ name: "Dental Practice", slug: "dental", status: "active" });
    orgId = org.id;
  });

  describe("Clinical note creation", () => {
    it("stores SOAP format clinical note with analysis", async () => {
      const call = await storage.createCall(orgId, {
        orgId,
        status: "completed",
        callCategory: "dental_encounter",
      });

      const analysis = await storage.createCallAnalysis(orgId, {
        orgId,
        callId: call.id,
        performanceScore: "8.0",
        clinicalNote: {
          format: "soap",
          specialty: "dental",
          subjective: "Patient reports persistent pain in lower left molar",
          objective: "Visible decay on tooth #19, periapical radiolucency",
          assessment: "Irreversible pulpitis, tooth #19",
          plan: ["Root canal therapy", "Crown placement", "Follow-up in 2 weeks"],
          icd10Codes: [{ code: "K04.0", description: "Pulpitis" }],
          cdtCodes: [{ code: "D3330", description: "Root canal, molar" }, { code: "D2740", description: "Crown, porcelain" }],
          toothNumbers: ["19"],
          providerAttested: false,
          documentationCompleteness: 9,
          clinicalAccuracy: 8,
        },
      });

      const retrieved = await storage.getCallAnalysis(orgId, call.id);
      assert.ok(retrieved);
      const note = retrieved.clinicalNote as any;
      assert.equal(note.format, "soap");
      assert.equal(note.specialty, "dental");
      assert.deepEqual(note.toothNumbers, ["19"]);
      assert.equal(note.providerAttested, false);
    });

    it("stores DAP format clinical note", async () => {
      const call = await storage.createCall(orgId, {
        orgId,
        status: "completed",
        callCategory: "clinical_encounter",
      });

      await storage.createCallAnalysis(orgId, {
        orgId,
        callId: call.id,
        performanceScore: "7.5",
        clinicalNote: {
          format: "dap",
          specialty: "behavioral_health",
          data: "Client discussed anxiety triggers",
          assessment: "Generalized anxiety disorder, improving",
          plan: ["Continue CBT sessions weekly", "Review medication at next visit"],
          providerAttested: false,
          documentationCompleteness: 7,
          clinicalAccuracy: 8,
        },
      });

      const retrieved = await storage.getCallAnalysis(orgId, call.id);
      const note = retrieved?.clinicalNote as any;
      assert.ok(note);
      assert.equal(note.format, "dap");
    });
  });

  describe("Attestation workflow", () => {
    it("tracks attestation status", async () => {
      const call = await storage.createCall(orgId, { orgId, status: "completed", callCategory: "dental_encounter" });
      await storage.createCallAnalysis(orgId, {
        orgId,
        callId: call.id,
        performanceScore: "7.0",
        clinicalNote: {
          format: "soap",
          specialty: "dental",
          subjective: "Tooth pain",
          objective: "Decay visible",
          assessment: "Caries",
          plan: ["Fill tooth"],
          providerAttested: false,
          documentationCompleteness: 6,
          clinicalAccuracy: 7,
        },
      });

      // Retrieve and verify unattested
      const analysis = await storage.getCallAnalysis(orgId, call.id);
      assert.ok(analysis);
      assert.equal((analysis.clinicalNote as any).providerAttested, false);
    });
  });

  describe("Clinical note schema validation", () => {
    it("validates complete SOAP note", () => {
      const result = clinicalNoteSchema.safeParse({
        format: "soap",
        specialty: "dental",
        subjective: "Patient reports pain",
        objective: "Decay on tooth 19",
        assessment: "Dental caries",
        plan: ["Schedule filling"],
        providerAttested: true,
        attestedBy: "Dr. Smith",
        attestedAt: new Date().toISOString(),
        documentationCompleteness: 9,
        clinicalAccuracy: 8,
      });
      assert.ok(result.success, `Validation failed: ${JSON.stringify(result.error?.flatten())}`);
    });

    it("validates procedure note", () => {
      const result = clinicalNoteSchema.safeParse({
        format: "procedure",
        specialty: "dental",
        assessment: "Completed root canal",
        plan: ["Crown in 2 weeks"],
        cdtCodes: [{ code: "D3330", description: "Root canal, molar" }],
        toothNumbers: ["19"],
        providerAttested: false,
        documentationCompleteness: 7,
        clinicalAccuracy: 9,
      });
      assert.ok(result.success, `Validation failed: ${JSON.stringify(result.error?.flatten())}`);
    });

    it("validates note with ICD-10 and CDT codes", () => {
      const result = clinicalNoteSchema.safeParse({
        format: "soap",
        specialty: "dental",
        icd10Codes: [{ code: "K04.0", description: "Pulpitis" }, { code: "K02.9", description: "Dental caries" }],
        cdtCodes: [{ code: "D3330", description: "Root canal, molar" }, { code: "D2740", description: "Crown, porcelain" }],
        cptCodes: [{ code: "99213", description: "Office visit, established patient" }],
        toothNumbers: ["14", "19"],
        providerAttested: false,
        documentationCompleteness: 8,
        clinicalAccuracy: 8,
      });
      assert.ok(result.success);
    });
  });

  describe("Multi-tenant clinical data isolation", () => {
    it("isolates clinical notes between orgs", async () => {
      const org2 = await storage.createOrganization({ name: "Other Clinic", slug: "other", status: "active" });

      const call1 = await storage.createCall(orgId, { orgId, status: "completed" });
      await storage.createCallAnalysis(orgId, {
        orgId,
        callId: call1.id,
        performanceScore: "7.0",
        clinicalNote: { format: "soap", specialty: "dental", subjective: "Secret PHI data", providerAttested: false, documentationCompleteness: 5, clinicalAccuracy: 5 },
      });

      // Other org should NOT see this clinical note
      const notFound = await storage.getCallAnalysis(org2.id, call1.id);
      assert.equal(notFound, undefined);
    });
  });

  describe("Usage tracking for clinical calls", () => {
    it("tracks usage events for clinical encounters", async () => {
      const call = await storage.createCall(orgId, { orgId, status: "completed", callCategory: "dental_encounter" });

      // Record usage
      await storage.recordUsageEvent(orgId, {
        type: "ai_analysis",
        callId: call.id,
        timestamp: new Date(),
      });

      const summary = await storage.getUsageSummary(orgId);
      assert.ok(summary);
    });
  });
});
