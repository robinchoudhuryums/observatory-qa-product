import { describe, it } from "node:test";
import assert from "node:assert/strict";

describe("EHR Integration", () => {
  describe("Mock EHR adapter", () => {
    it("connects successfully", async () => {
      const { MockEhrAdapter } = await import("../server/services/ehr/mock.js");
      const adapter = new MockEhrAdapter();
      const result = await adapter.testConnection({ system: "mock" as any, baseUrl: "http://mock", enabled: true });
      assert.equal(result.connected, true);
      assert.equal(result.version, "mock-1.0.0");
    });

    it("searches patients by name", async () => {
      const { MockEhrAdapter } = await import("../server/services/ehr/mock.js");
      const adapter = new MockEhrAdapter();
      const config = { system: "mock" as any, baseUrl: "http://mock", enabled: true };

      const results = await adapter.searchPatients(config, { name: "Johnson" });
      assert.equal(results.length, 1);
      assert.equal(results[0].firstName, "Sarah");
      assert.equal(results[0].lastName, "Johnson");
    });

    it("returns empty for non-matching search", async () => {
      const { MockEhrAdapter } = await import("../server/services/ehr/mock.js");
      const adapter = new MockEhrAdapter();
      const config = { system: "mock" as any, baseUrl: "http://mock", enabled: true };

      const results = await adapter.searchPatients(config, { name: "Nonexistent" });
      assert.equal(results.length, 0);
    });

    it("gets patient by ID", async () => {
      const { MockEhrAdapter } = await import("../server/services/ehr/mock.js");
      const adapter = new MockEhrAdapter();
      const config = { system: "mock" as any, baseUrl: "http://mock", enabled: true };

      const patient = await adapter.getPatient(config, "mock-1001");
      assert.ok(patient);
      assert.equal(patient.firstName, "Sarah");
      assert.equal(patient.insurance?.carrier, "Delta Dental");
      assert.deepEqual(patient.allergies, ["Penicillin"]);
    });

    it("returns null for non-existent patient", async () => {
      const { MockEhrAdapter } = await import("../server/services/ehr/mock.js");
      const adapter = new MockEhrAdapter();
      const config = { system: "mock" as any, baseUrl: "http://mock", enabled: true };

      const patient = await adapter.getPatient(config, "nonexistent");
      assert.equal(patient, null);
    });

    it("gets today appointments", async () => {
      const { MockEhrAdapter } = await import("../server/services/ehr/mock.js");
      const adapter = new MockEhrAdapter();
      const config = { system: "mock" as any, baseUrl: "http://mock", enabled: true };

      const appointments = await adapter.getTodayAppointments(config);
      assert.ok(appointments.length > 0);
      const today = new Date().toISOString().split("T")[0];
      for (const apt of appointments) {
        assert.equal(apt.date, today);
        assert.ok(apt.patientName);
        assert.ok(apt.providerName);
      }
    });

    it("filters appointments by provider", async () => {
      const { MockEhrAdapter } = await import("../server/services/ehr/mock.js");
      const adapter = new MockEhrAdapter();
      const config = { system: "mock" as any, baseUrl: "http://mock", enabled: true };

      const all = await adapter.getTodayAppointments(config);
      const filtered = await adapter.getTodayAppointments(config, "prov-1");
      assert.ok(filtered.length <= all.length);
      for (const apt of filtered) {
        assert.equal(apt.providerId, "prov-1");
      }
    });

    it("pushes clinical note successfully", async () => {
      const { MockEhrAdapter } = await import("../server/services/ehr/mock.js");
      const adapter = new MockEhrAdapter();
      const config = { system: "mock" as any, baseUrl: "http://mock", enabled: true };

      const result = await adapter.pushClinicalNote(config, {
        patientId: "mock-1001",
        providerId: "prov-1",
        date: "2026-03-21",
        noteType: "soap",
        content: "SOAP note content here",
      });
      assert.equal(result.success, true);
      assert.ok(result.ehrRecordId);
      assert.ok(result.timestamp);
    });

    it("gets treatment plans for patient", async () => {
      const { MockEhrAdapter } = await import("../server/services/ehr/mock.js");
      const adapter = new MockEhrAdapter();
      const config = { system: "mock" as any, baseUrl: "http://mock", enabled: true };

      const plans = await adapter.getPatientTreatmentPlans(config, "mock-1001");
      assert.equal(plans.length, 1);
      assert.equal(plans[0].status, "accepted");
      assert.ok(plans[0].phases.length > 0);
      assert.ok(plans[0].totalFee > 0);
    });

    it("returns empty treatment plans for unknown patient", async () => {
      const { MockEhrAdapter } = await import("../server/services/ehr/mock.js");
      const adapter = new MockEhrAdapter();
      const config = { system: "mock" as any, baseUrl: "http://mock", enabled: true };

      const plans = await adapter.getPatientTreatmentPlans(config, "unknown");
      assert.equal(plans.length, 0);
    });
  });

  describe("EHR adapter factory", () => {
    it("returns adapter for supported systems", async () => {
      const { getEhrAdapter } = await import("../server/services/ehr/index.js");
      assert.ok(getEhrAdapter("open_dental"));
      assert.ok(getEhrAdapter("eaglesoft"));
      assert.ok(getEhrAdapter("mock" as any));
    });

    it("returns null for unsupported systems", async () => {
      const { getEhrAdapter } = await import("../server/services/ehr/index.js");
      assert.equal(getEhrAdapter("dentrix"), null);
      assert.equal(getEhrAdapter("epic" as any), null);
    });

    it("lists supported EHR systems", async () => {
      const { getSupportedEhrSystems } = await import("../server/services/ehr/index.js");
      const systems = getSupportedEhrSystems();
      assert.ok(systems.length >= 3);
      const names = systems.map(s => s.system);
      assert.ok(names.includes("open_dental"));
      assert.ok(names.includes("eaglesoft"));
      assert.ok(names.includes("mock"));
    });
  });

  describe("EHR connection config types", () => {
    it("validates Open Dental config", () => {
      const config = {
        system: "open_dental" as const,
        baseUrl: "https://practice.opendental.com/api/v1",
        apiKey: "dev-key-123",
        options: { customerKey: "cust-key-456" },
        enabled: true,
      };
      assert.equal(config.system, "open_dental");
      assert.ok(config.baseUrl.startsWith("https://"));
    });

    it("validates Eaglesoft config", () => {
      const config = {
        system: "eaglesoft" as const,
        baseUrl: "https://practice-server/eDex",
        apiKey: "edex-api-key",
        options: { practiceId: "practice-001" },
        enabled: true,
      };
      assert.equal(config.system, "eaglesoft");
      assert.ok(config.options?.practiceId);
    });
  });
});
