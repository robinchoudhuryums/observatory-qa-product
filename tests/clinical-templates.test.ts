/**
 * Tests for clinical note templates library.
 * Validates template integrity, lookup functions, and search.
 *
 * Run with: npx tsx --test tests/clinical-templates.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  CLINICAL_NOTE_TEMPLATES,
  getTemplatesBySpecialty,
  getTemplatesByFormat,
  getTemplatesByCategory,
  getTemplateById,
  searchTemplates,
  type ClinicalNoteTemplate,
} from "../server/services/clinical-templates.js";

describe("Clinical Note Templates", () => {
  describe("template data integrity", () => {
    it("has at least 10 templates", () => {
      assert.ok(CLINICAL_NOTE_TEMPLATES.length >= 10, `Expected >=10 templates, got ${CLINICAL_NOTE_TEMPLATES.length}`);
    });

    it("all templates have unique IDs", () => {
      const ids = CLINICAL_NOTE_TEMPLATES.map(t => t.id);
      const uniqueIds = new Set(ids);
      assert.equal(ids.length, uniqueIds.size, "Template IDs must be unique");
    });

    it("all templates have required fields", () => {
      for (const t of CLINICAL_NOTE_TEMPLATES) {
        assert.ok(t.id, `Template missing id`);
        assert.ok(t.name, `Template ${t.id} missing name`);
        assert.ok(t.specialty, `Template ${t.id} missing specialty`);
        assert.ok(t.format, `Template ${t.id} missing format`);
        assert.ok(t.category, `Template ${t.id} missing category`);
        assert.ok(t.description, `Template ${t.id} missing description`);
        assert.ok(typeof t.sections === "object" && Object.keys(t.sections).length > 0, `Template ${t.id} missing sections`);
        assert.ok(Array.isArray(t.tags) && t.tags.length > 0, `Template ${t.id} missing tags`);
      }
    });

    it("SOAP templates have standard sections", () => {
      const soapTemplates = CLINICAL_NOTE_TEMPLATES.filter(t => t.format === "soap");
      assert.ok(soapTemplates.length > 0, "Should have at least one SOAP template");

      for (const t of soapTemplates) {
        assert.ok("subjective" in t.sections, `SOAP template ${t.id} missing subjective`);
        assert.ok("objective" in t.sections, `SOAP template ${t.id} missing objective`);
        assert.ok("assessment" in t.sections, `SOAP template ${t.id} missing assessment`);
        assert.ok("plan" in t.sections, `SOAP template ${t.id} missing plan`);
      }
    });

    it("DAP templates have standard sections", () => {
      const dapTemplates = CLINICAL_NOTE_TEMPLATES.filter(t => t.format === "dap");
      assert.ok(dapTemplates.length > 0, "Should have at least one DAP template");

      for (const t of dapTemplates) {
        assert.ok("data" in t.sections, `DAP template ${t.id} missing data`);
        assert.ok("assessment" in t.sections, `DAP template ${t.id} missing assessment`);
        assert.ok("plan" in t.sections, `DAP template ${t.id} missing plan`);
      }
    });

    it("dental templates have CDT codes", () => {
      const dentalTemplates = CLINICAL_NOTE_TEMPLATES.filter(t => t.category === "dental");
      assert.ok(dentalTemplates.length > 0, "Should have dental templates");

      for (const t of dentalTemplates) {
        assert.ok(t.defaultCodes && t.defaultCodes.length > 0, `Dental template ${t.id} should have default CDT codes`);
        for (const code of t.defaultCodes!) {
          assert.ok(code.code.startsWith("D"), `Dental code ${code.code} in ${t.id} should start with D`);
          assert.ok(code.description, `Code ${code.code} in ${t.id} missing description`);
        }
      }
    });
  });

  describe("getTemplatesBySpecialty", () => {
    it("returns primary care templates", () => {
      const templates = getTemplatesBySpecialty("primary_care");
      assert.ok(templates.length >= 2, "Should have multiple primary care templates");
      assert.ok(templates.every(t => t.specialty === "primary_care"));
    });

    it("returns general dentistry templates", () => {
      const templates = getTemplatesBySpecialty("general_dentistry");
      assert.ok(templates.length >= 2, "Should have multiple general dentistry templates");
      assert.ok(templates.every(t => t.specialty === "general_dentistry"));
    });

    it("is case-insensitive", () => {
      const lower = getTemplatesBySpecialty("primary_care");
      const upper = getTemplatesBySpecialty("PRIMARY_CARE");
      assert.equal(lower.length, upper.length);
    });

    it("returns empty array for unknown specialty", () => {
      assert.deepEqual(getTemplatesBySpecialty("nonexistent"), []);
    });
  });

  describe("getTemplatesByFormat", () => {
    it("returns SOAP format templates", () => {
      const templates = getTemplatesByFormat("soap");
      assert.ok(templates.length >= 3, "Should have multiple SOAP templates");
      assert.ok(templates.every(t => t.format === "soap"));
    });

    it("returns DAP format templates", () => {
      const templates = getTemplatesByFormat("dap");
      assert.ok(templates.length >= 1);
      assert.ok(templates.every(t => t.format === "dap"));
    });

    it("returns procedure note templates", () => {
      const templates = getTemplatesByFormat("procedure_note");
      assert.ok(templates.length >= 1);
    });
  });

  describe("getTemplatesByCategory", () => {
    it("returns dental category templates", () => {
      const templates = getTemplatesByCategory("dental");
      assert.ok(templates.length >= 3, "Should have multiple dental templates");
    });

    it("returns preventive category templates", () => {
      const templates = getTemplatesByCategory("preventive");
      assert.ok(templates.length >= 1);
    });

    it("returns behavioral health templates", () => {
      const templates = getTemplatesByCategory("behavioral_health");
      assert.ok(templates.length >= 1);
    });
  });

  describe("getTemplateById", () => {
    it("returns a specific template by ID", () => {
      const template = getTemplateById("annual-physical");
      assert.ok(template);
      assert.equal(template.id, "annual-physical");
      assert.equal(template.specialty, "primary_care");
    });

    it("returns undefined for unknown ID", () => {
      assert.equal(getTemplateById("nonexistent-id"), undefined);
    });

    it("can find every template by its ID", () => {
      for (const t of CLINICAL_NOTE_TEMPLATES) {
        const found = getTemplateById(t.id);
        assert.ok(found, `Should find template ${t.id}`);
        assert.equal(found.name, t.name);
      }
    });
  });

  describe("searchTemplates", () => {
    it("finds templates by name keyword", () => {
      const results = searchTemplates("emergency");
      assert.ok(results.length >= 1);
      assert.ok(results.some(t => t.id === "emergency-dental"));
    });

    it("finds templates by tag", () => {
      const results = searchTemplates("periodontal");
      assert.ok(results.length >= 1);
    });

    it("supports multi-word search (all terms must match)", () => {
      const results = searchTemplates("dental exam");
      assert.ok(results.length >= 1);
      // Each result should contain both "dental" and "exam" somewhere
      for (const t of results) {
        const searchable = [t.name, t.description, t.specialty, t.format, t.category, ...t.tags].join(" ").toLowerCase();
        assert.ok(searchable.includes("dental"), `Result ${t.id} should match "dental"`);
        assert.ok(searchable.includes("exam"), `Result ${t.id} should match "exam"`);
      }
    });

    it("returns empty for no-match query", () => {
      assert.deepEqual(searchTemplates("xyznonexistent123"), []);
    });

    it("is case-insensitive", () => {
      const lower = searchTemplates("cardiology");
      const upper = searchTemplates("CARDIOLOGY");
      assert.equal(lower.length, upper.length);
    });
  });
});
