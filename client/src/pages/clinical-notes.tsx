import { useState, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useRoute } from "wouter";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import {
  Stethoscope, ShieldCheck, CheckCircle, AlertTriangle, FileText, Pill,
  Calendar, ClipboardList, Printer, Pencil, Save, X, Activity, MessageSquare,
  Info, Copy,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import type { ClinicalNote } from "@shared/schema";

interface CallWithClinical {
  id: string;
  fileName?: string;
  status: string;
  duration?: number;
  callCategory?: string;
  uploadedAt?: string;
  analysis?: {
    summary?: string;
    clinicalNote?: ClinicalNote & {
      attestedBy?: string;
      attestedAt?: string;
      consentRecordedBy?: string;
      consentRecordedAt?: string;
      editHistory?: Array<{ editedBy: string; editedAt: string; fieldsChanged: string[] }>;
      validationWarnings?: string[];
    };
  };
  employee?: { name: string };
}

// --- Editable Section Card ---
function SectionCard({
  title, icon, children, empty, editing, editValue, onEditChange, fieldName,
}: {
  title: string; icon: React.ReactNode; children: React.ReactNode; empty?: string;
  editing?: boolean; editValue?: string; onEditChange?: (field: string, value: string) => void; fieldName?: string;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          {icon}
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {editing && fieldName ? (
          <Textarea
            value={editValue || ""}
            onChange={(e) => onEditChange?.(fieldName, e.target.value)}
            className="min-h-[100px] text-sm"
          />
        ) : (
          children || <p className="text-sm text-muted-foreground italic">{empty || "Not documented"}</p>
        )}
      </CardContent>
    </Card>
  );
}

// --- Format label helper ---
function formatLabel(format: string): string {
  const labels: Record<string, string> = {
    soap: "SOAP", dap: "DAP", birp: "BIRP", hpi_focused: "HPI-Focused",
    procedure_note: "Procedure Note", progress_note: "Progress Note",
    dental_exam: "Dental Exam", dental_operative: "Dental Operative",
    dental_perio: "Periodontal", dental_endo: "Endodontic",
    dental_ortho_progress: "Ortho Progress", dental_surgery: "Oral Surgery",
    dental_treatment_plan: "Treatment Plan",
  };
  return labels[format] || format.toUpperCase();
}

export default function ClinicalNotesPage() {
  const [, params] = useRoute("/clinical/notes/:id");
  const callId = params?.id;
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [editFields, setEditFields] = useState<Record<string, unknown>>({});
  const printRef = useRef<HTMLDivElement>(null);

  const { data: call, isLoading } = useQuery<CallWithClinical>({
    queryKey: ["/api/calls", callId],
    enabled: !!callId,
  });

  const attestMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/clinical/notes/${callId}/attest`, {
        method: "POST", credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to attest");
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Note attested", description: "Clinical note has been marked as provider-reviewed." });
      queryClient.invalidateQueries({ queryKey: ["/api/calls", callId] });
    },
    onError: () => {
      toast({ title: "Attestation failed", variant: "destructive" });
    },
  });

  const consentMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/clinical/notes/${callId}/consent`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        credentials: "include", body: JSON.stringify({ consentObtained: true }),
      });
      if (!res.ok) throw new Error("Failed to record consent");
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Consent recorded" });
      queryClient.invalidateQueries({ queryKey: ["/api/calls", callId] });
    },
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("PATCH", `/api/clinical/notes/${callId}`, editFields);
    },
    onSuccess: () => {
      toast({ title: "Note updated", description: "Clinical note saved. Re-attestation required." });
      setEditing(false);
      setEditFields({});
      queryClient.invalidateQueries({ queryKey: ["/api/calls", callId] });
    },
    onError: (err) => {
      toast({ title: "Save failed", description: err.message, variant: "destructive" });
    },
  });

  const startEditing = () => {
    if (!cn) return;
    setEditFields({
      chiefComplaint: cn.chiefComplaint || "",
      subjective: cn.subjective || "",
      objective: cn.objective || "",
      assessment: cn.assessment || "",
      plan: cn.plan || [],
      hpiNarrative: cn.hpiNarrative || "",
      followUp: cn.followUp || "",
      // DAP/BIRP fields
      data: (cn as any).data || "",
      behavior: (cn as any).behavior || "",
      intervention: (cn as any).intervention || "",
      response: (cn as any).response || "",
      // Dental fields
      toothNumbers: cn.toothNumbers || [],
      quadrants: cn.quadrants || [],
    });
    setEditing(true);
  };

  const handleToothNumbersChange = (value: string) => {
    setEditFields(prev => ({
      ...prev,
      toothNumbers: value.split(",").map(s => s.trim()).filter(Boolean),
    }));
  };

  const handleQuadrantsChange = (value: string) => {
    setEditFields(prev => ({
      ...prev,
      quadrants: value.split(",").map(s => s.trim()).filter(Boolean),
    }));
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text).then(() => {
      toast({ title: "Copied", description: text });
    });
  };

  const handleFieldChange = (field: string, value: string) => {
    setEditFields(prev => ({ ...prev, [field]: value }));
  };

  const handlePlanChange = (value: string) => {
    setEditFields(prev => ({ ...prev, plan: value.split("\n").filter(Boolean) }));
  };

  const handlePrint = () => {
    const printContent = printRef.current;
    if (!printContent) return;
    const printWindow = window.open("", "_blank");
    if (!printWindow) return;
    printWindow.document.write(`
      <html><head><title>Clinical Note — ${call?.employee?.name || "Patient"}</title>
      <style>
        body { font-family: system-ui, -apple-system, sans-serif; max-width: 800px; margin: 40px auto; padding: 0 20px; color: #1a1a1a; font-size: 14px; }
        h1 { font-size: 20px; border-bottom: 2px solid #333; padding-bottom: 8px; }
        h2 { font-size: 16px; margin-top: 20px; color: #333; border-bottom: 1px solid #ddd; padding-bottom: 4px; }
        .meta { color: #666; font-size: 12px; margin-bottom: 20px; }
        .draft { background: #fff3cd; border: 1px solid #ffc107; padding: 8px 12px; border-radius: 4px; margin: 10px 0; font-weight: bold; }
        .codes { display: flex; gap: 8px; flex-wrap: wrap; }
        .code { background: #f0f0f0; padding: 2px 8px; border-radius: 4px; font-family: monospace; font-size: 12px; }
        ul { padding-left: 20px; }
        p { line-height: 1.6; }
        @media print { .no-print { display: none; } }
      </style></head><body>
      ${printContent.innerHTML}
      <script>window.print(); window.close();</script>
      </body></html>
    `);
    printWindow.document.close();
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Stethoscope className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!call) {
    return <div className="p-6"><p className="text-muted-foreground">Encounter not found.</p></div>;
  }

  const cn = call.analysis?.clinicalNote;

  if (!cn) {
    return (
      <div className="p-6 max-w-3xl mx-auto">
        <Card>
          <CardContent className="py-12 text-center">
            <Stethoscope className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
            <h2 className="text-lg font-semibold">Clinical note not yet generated</h2>
            <p className="text-muted-foreground mt-2">
              {call.status === "processing" ? "The encounter is still being processed..." : "No clinical note was generated for this encounter."}
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const isDap = cn.format === "dap";
  const isBirp = cn.format === "birp";
  const isDental = cn.format?.startsWith("dental_");

  return (
    <div className="p-4 md:p-6 max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <Stethoscope className="w-6 h-6 text-primary" />
            <h1 className="text-2xl font-bold text-foreground">Clinical Note</h1>
          </div>
          <p className="text-muted-foreground mt-1 text-sm">
            {call.employee?.name && <span className="font-medium">{call.employee.name}</span>}
            {call.uploadedAt && <span> — {new Date(call.uploadedAt).toLocaleDateString()}</span>}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {cn.providerAttested ? (
            <Badge className="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300">
              <CheckCircle className="w-3.5 h-3.5 mr-1" />Attested
            </Badge>
          ) : (
            <Badge variant="outline" className="text-amber-600 border-amber-300">
              <AlertTriangle className="w-3.5 h-3.5 mr-1" />Draft
            </Badge>
          )}
          {cn.patientConsentObtained && (
            <Badge className="bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300">
              <ShieldCheck className="w-3.5 h-3.5 mr-1" />Consent
            </Badge>
          )}
          {/* Action buttons */}
          {editing ? (
            <>
              <Button size="sm" onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
                <Save className="w-4 h-4 mr-1" />{saveMutation.isPending ? "Saving..." : "Save"}
              </Button>
              <Button size="sm" variant="outline" onClick={() => { setEditing(false); setEditFields({}); }}>
                <X className="w-4 h-4 mr-1" />Cancel
              </Button>
            </>
          ) : (
            <>
              <Button size="sm" variant="outline" onClick={startEditing}>
                <Pencil className="w-4 h-4 mr-1" />Edit
              </Button>
              <Button size="sm" variant="outline" onClick={handlePrint}>
                <Printer className="w-4 h-4 mr-1" />Print / Export
              </Button>
            </>
          )}
        </div>
      </div>

      {/* AI Draft Warning */}
      {!cn.providerAttested && !editing && (
        <Card className="border-amber-200 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-800">
          <CardContent className="pt-4 pb-3">
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-amber-600 mt-0.5 shrink-0" />
              <div className="text-sm flex-1">
                <p className="font-medium text-amber-800 dark:text-amber-200">AI-Generated Draft</p>
                <p className="text-amber-700 dark:text-amber-300 mt-1">
                  This clinical note was automatically generated from the encounter recording.
                  Review for accuracy, edit if needed, then attest before use.
                </p>
                <div className="flex gap-2 mt-3">
                  <Button size="sm" onClick={() => attestMutation.mutate()} disabled={attestMutation.isPending}>
                    <CheckCircle className="w-4 h-4 mr-1" />Attest Note
                  </Button>
                  {!cn.patientConsentObtained && (
                    <Button size="sm" variant="outline" onClick={() => consentMutation.mutate()} disabled={consentMutation.isPending}>
                      <ShieldCheck className="w-4 h-4 mr-1" />Record Consent
                    </Button>
                  )}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Printable content wrapper */}
      <div ref={printRef}>
        {/* Print-only header */}
        <div className="hidden print:block">
          <h1>Clinical Note — {cn.format ? formatLabel(cn.format) : "SOAP"}</h1>
          <div className="meta">
            {call.employee?.name && <span>Provider: {call.employee.name} | </span>}
            {call.uploadedAt && <span>Date: {new Date(call.uploadedAt).toLocaleDateString()} | </span>}
            {cn.providerAttested ? <span>Status: Attested</span> : <span className="draft">DRAFT — Requires Provider Attestation</span>}
          </div>
        </div>

        {/* Chief Complaint */}
        {(cn.chiefComplaint || editing) && (
          <SectionCard
            title="Chief Complaint"
            icon={<FileText className="w-4 h-4 text-red-500" />}
            editing={editing}
            editValue={editFields.chiefComplaint as string}
            onEditChange={handleFieldChange}
            fieldName="chiefComplaint"
          >
            {cn.chiefComplaint && <p className="font-medium">{cn.chiefComplaint}</p>}
          </SectionCard>
        )}

        {/* Quality Scores */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 print:hidden">
          {cn.documentationCompleteness != null && (
            <Card>
              <CardContent className="pt-4 text-center">
                <p className="text-xs text-muted-foreground">Completeness</p>
                <p className="text-2xl font-bold">{cn.documentationCompleteness.toFixed(1)}</p>
                <p className="text-xs text-muted-foreground">/10</p>
              </CardContent>
            </Card>
          )}
          {cn.clinicalAccuracy != null && (
            <Card>
              <CardContent className="pt-4 text-center">
                <p className="text-xs text-muted-foreground">Clinical Accuracy</p>
                <p className="text-2xl font-bold">{cn.clinicalAccuracy.toFixed(1)}</p>
                <p className="text-xs text-muted-foreground">/10</p>
              </CardContent>
            </Card>
          )}
          {cn.format && (
            <Card>
              <CardContent className="pt-4 text-center">
                <p className="text-xs text-muted-foreground">Format</p>
                <p className="text-lg font-semibold">{formatLabel(cn.format)}</p>
              </CardContent>
            </Card>
          )}
          {cn.specialty && (
            <Card>
              <CardContent className="pt-4 text-center">
                <p className="text-xs text-muted-foreground">Specialty</p>
                <p className="text-sm font-medium capitalize">{cn.specialty.replace(/_/g, " ")}</p>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Format-specific sections */}
        <div className="space-y-4">
          {isBirp ? (
            /* --- BIRP Format --- */
            <>
              <SectionCard title="Behavior" icon={<Activity className="w-4 h-4 text-blue-500" />} empty="No behavior observations documented" editing={editing} editValue={editFields.behavior as string} onEditChange={handleFieldChange} fieldName="behavior">
                {(cn as any).behavior && <p className="text-sm whitespace-pre-wrap">{(cn as any).behavior}</p>}
              </SectionCard>
              <SectionCard title="Intervention" icon={<MessageSquare className="w-4 h-4 text-green-500" />} empty="No interventions documented" editing={editing} editValue={editFields.intervention as string} onEditChange={handleFieldChange} fieldName="intervention">
                {(cn as any).intervention && <p className="text-sm whitespace-pre-wrap">{(cn as any).intervention}</p>}
              </SectionCard>
              <SectionCard title="Response" icon={<ClipboardList className="w-4 h-4 text-purple-500" />} empty="No response documented" editing={editing} editValue={editFields.response as string} onEditChange={handleFieldChange} fieldName="response">
                {(cn as any).response && <p className="text-sm whitespace-pre-wrap">{(cn as any).response}</p>}
              </SectionCard>
              <SectionCard title="Plan" icon={<Calendar className="w-4 h-4 text-orange-500" />} empty="No plan documented" editing={editing} editValue={(editFields.plan as string[] || []).join("\n")} onEditChange={(_, v) => handlePlanChange(v)} fieldName="plan">
                {cn.plan && cn.plan.length > 0 && (
                  <ul className="text-sm space-y-1 list-disc list-inside">
                    {cn.plan.map((item, i) => <li key={i}>{item}</li>)}
                  </ul>
                )}
              </SectionCard>
            </>
          ) : isDap ? (
            /* --- DAP Format --- */
            <>
              <SectionCard title="Data" icon={<FileText className="w-4 h-4 text-blue-500" />} empty="No data documented" editing={editing} editValue={editFields.data as string} onEditChange={handleFieldChange} fieldName="data">
                {(cn as any).data && <p className="text-sm whitespace-pre-wrap">{(cn as any).data}</p>}
              </SectionCard>
              <SectionCard title="Assessment" icon={<Stethoscope className="w-4 h-4 text-purple-500" />} empty="No assessment documented" editing={editing} editValue={editFields.assessment as string} onEditChange={handleFieldChange} fieldName="assessment">
                {cn.assessment && <p className="text-sm whitespace-pre-wrap">{cn.assessment}</p>}
              </SectionCard>
              <SectionCard title="Plan" icon={<Calendar className="w-4 h-4 text-orange-500" />} empty="No plan documented" editing={editing} editValue={(editFields.plan as string[] || []).join("\n")} onEditChange={(_, v) => handlePlanChange(v)} fieldName="plan">
                {cn.plan && cn.plan.length > 0 && (
                  <ul className="text-sm space-y-1 list-disc list-inside">
                    {cn.plan.map((item, i) => <li key={i}>{item}</li>)}
                  </ul>
                )}
              </SectionCard>
            </>
          ) : (
            /* --- SOAP Format (default, including dental) --- */
            <>
              <SectionCard title="Subjective" icon={<FileText className="w-4 h-4 text-blue-500" />} empty="No subjective findings documented" editing={editing} editValue={editFields.subjective as string} onEditChange={handleFieldChange} fieldName="subjective">
                {cn.subjective && <p className="text-sm whitespace-pre-wrap">{cn.subjective}</p>}
              </SectionCard>
              <SectionCard title="Objective" icon={<ClipboardList className="w-4 h-4 text-green-500" />} empty="No objective findings documented" editing={editing} editValue={editFields.objective as string} onEditChange={handleFieldChange} fieldName="objective">
                {cn.objective && <p className="text-sm whitespace-pre-wrap">{cn.objective}</p>}
              </SectionCard>
              <SectionCard title="Assessment" icon={<Stethoscope className="w-4 h-4 text-purple-500" />} empty="No assessment documented" editing={editing} editValue={editFields.assessment as string} onEditChange={handleFieldChange} fieldName="assessment">
                {cn.assessment && <p className="text-sm whitespace-pre-wrap">{cn.assessment}</p>}
              </SectionCard>
              <SectionCard title="Plan" icon={<Calendar className="w-4 h-4 text-orange-500" />} empty="No plan documented" editing={editing} editValue={(editFields.plan as string[] || []).join("\n")} onEditChange={(_, v) => handlePlanChange(v)} fieldName="plan">
                {cn.plan && cn.plan.length > 0 && (
                  <ul className="text-sm space-y-1 list-disc list-inside">
                    {cn.plan.map((item, i) => <li key={i}>{item}</li>)}
                  </ul>
                )}
              </SectionCard>
            </>
          )}
        </div>

        {/* HPI Narrative (SOAP/HPI-focused) */}
        {(cn.hpiNarrative || editing) && !isDap && !isBirp && (
          <SectionCard title="History of Present Illness" icon={<FileText className="w-4 h-4 text-indigo-500" />} editing={editing} editValue={editFields.hpiNarrative as string} onEditChange={handleFieldChange} fieldName="hpiNarrative">
            {cn.hpiNarrative && <p className="text-sm whitespace-pre-wrap">{cn.hpiNarrative}</p>}
          </SectionCard>
        )}

        {/* Review of Systems */}
        {cn.reviewOfSystems && Object.keys(cn.reviewOfSystems).length > 0 && (
          <SectionCard title="Review of Systems" icon={<ClipboardList className="w-4 h-4 text-teal-500" />}>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {Object.entries(cn.reviewOfSystems).map(([system, finding]) => (
                <div key={system} className="text-sm">
                  <span className="font-medium capitalize">{system.replace(/_/g, " ")}:</span>{" "}
                  <span className="text-muted-foreground">{finding}</span>
                </div>
              ))}
            </div>
          </SectionCard>
        )}

        {/* Dental-specific sections */}
        {isDental && ((cn.toothNumbers && cn.toothNumbers.length > 0) || editing) && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Teeth Involved</CardTitle>
              {editing && (
                <CardDescription className="text-xs">Comma-separated tooth numbers (1-32 permanent, A-T primary)</CardDescription>
              )}
            </CardHeader>
            <CardContent>
              {editing ? (
                <Input
                  value={(editFields.toothNumbers as string[] || []).join(", ")}
                  onChange={(e) => handleToothNumbersChange(e.target.value)}
                  placeholder="e.g. 3, 14, 19, 30"
                  className="font-mono text-sm"
                />
              ) : (
                <div className="flex flex-wrap gap-2">
                  {cn.toothNumbers?.map((tooth, i) => (
                    <Badge key={i} variant="outline" className="font-mono">#{tooth}</Badge>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {isDental && ((cn.quadrants && cn.quadrants.length > 0) || editing) && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Quadrants</CardTitle>
              {editing && (
                <CardDescription className="text-xs">Comma-separated quadrants (UR, UL, LR, LL)</CardDescription>
              )}
            </CardHeader>
            <CardContent>
              {editing ? (
                <Input
                  value={(editFields.quadrants as string[] || []).join(", ")}
                  onChange={(e) => handleQuadrantsChange(e.target.value)}
                  placeholder="e.g. UR, LL"
                  className="font-mono text-sm"
                />
              ) : (
                <div className="flex flex-wrap gap-2">
                  {cn.quadrants?.map((q, i) => (
                    <Badge key={i} variant="outline">{q}</Badge>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {isDental && cn.periodontalFindings && Object.keys(cn.periodontalFindings).length > 0 && (
          <SectionCard title="Periodontal Findings" icon={<Activity className="w-4 h-4 text-red-500" />}>
            <div className="space-y-2">
              {Object.entries(cn.periodontalFindings).map(([key, value]) => (
                <div key={key} className="text-sm">
                  <span className="font-medium capitalize">{key.replace(/_/g, " ")}:</span>{" "}
                  <span className="text-muted-foreground">{value}</span>
                </div>
              ))}
            </div>
          </SectionCard>
        )}

        {/* Codes */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {cn.icd10Codes && cn.icd10Codes.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">ICD-10 Codes (Suggested)</CardTitle>
                <CardDescription className="text-xs">Requires provider verification</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-1">
                  {cn.icd10Codes.map((code, i) => (
                    <div key={i} className="flex items-center gap-2 group">
                      <Badge variant="outline" className="font-mono text-xs cursor-pointer hover:bg-muted" onClick={() => copyToClipboard(code.code)} title="Click to copy">
                        {code.code}
                        <Copy className="w-3 h-3 ml-1 opacity-0 group-hover:opacity-50" />
                      </Badge>
                      <span className="text-sm text-muted-foreground">{code.description}</span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
          {cn.cptCodes && cn.cptCodes.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">CPT Codes (Suggested)</CardTitle>
                <CardDescription className="text-xs">Requires provider verification</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-1">
                  {cn.cptCodes.map((code, i) => (
                    <div key={i} className="flex items-center gap-2 group">
                      <Badge variant="outline" className="font-mono text-xs cursor-pointer hover:bg-muted" onClick={() => copyToClipboard(code.code)} title="Click to copy">
                        {code.code}
                        <Copy className="w-3 h-3 ml-1 opacity-0 group-hover:opacity-50" />
                      </Badge>
                      <span className="text-sm text-muted-foreground">{code.description}</span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
          {cn.cdtCodes && cn.cdtCodes.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">CDT Codes (Suggested)</CardTitle>
                <CardDescription className="text-xs">Requires dentist verification</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-1">
                  {cn.cdtCodes.map((code, i) => (
                    <div key={i} className="flex items-center gap-2 group">
                      <Badge variant="outline" className="font-mono text-xs cursor-pointer hover:bg-muted" onClick={() => copyToClipboard(code.code)} title="Click to copy">
                        {code.code}
                        <Copy className="w-3 h-3 ml-1 opacity-0 group-hover:opacity-50" />
                      </Badge>
                      <span className="text-sm text-muted-foreground">{code.description}</span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Prescriptions */}
        {cn.prescriptions && cn.prescriptions.length > 0 && (
          <SectionCard title="Prescriptions" icon={<Pill className="w-4 h-4 text-red-500" />}>
            <div className="space-y-2">
              {cn.prescriptions.map((rx, i) => (
                <div key={i} className="text-sm border-b last:border-0 pb-2 last:pb-0">
                  <span className="font-medium">{rx.medication}</span>
                  {rx.dosage && <span className="text-muted-foreground ml-2">{rx.dosage}</span>}
                  {rx.instructions && <p className="text-muted-foreground text-xs mt-0.5">{rx.instructions}</p>}
                </div>
              ))}
            </div>
          </SectionCard>
        )}

        {/* Follow-up */}
        {(cn.followUp || editing) && (
          <SectionCard title="Follow-up" icon={<Calendar className="w-4 h-4 text-cyan-500" />} editing={editing} editValue={editFields.followUp as string} onEditChange={handleFieldChange} fieldName="followUp">
            {cn.followUp && <p className="font-medium">{cn.followUp}</p>}
          </SectionCard>
        )}
      </div>

      {/* Missing Sections */}
      {cn.missingSections && cn.missingSections.length > 0 && (
        <Card className="border-amber-200">
          <CardHeader className="pb-2">
            <CardTitle className="text-base text-amber-700 dark:text-amber-300">Missing Documentation</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {cn.missingSections.map((section, i) => (
                <Badge key={i} variant="outline" className="text-amber-600 border-amber-300">{section}</Badge>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Validation Warnings (from server-side code/format validation) */}
      {(cn as any).validationWarnings?.length > 0 && (
        <Card className="border-blue-200 print:hidden">
          <CardHeader className="pb-2">
            <CardTitle className="text-base text-blue-700 dark:text-blue-300 flex items-center gap-2">
              <Info className="w-4 h-4" />
              Validation Notes
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="text-sm space-y-1 text-blue-700 dark:text-blue-300">
              {((cn as any).validationWarnings as string[]).map((warning, i) => (
                <li key={i} className="flex items-start gap-2">
                  <span className="text-blue-400 mt-0.5">&#8226;</span>
                  {warning}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {/* Differential Diagnoses */}
      {cn.differentialDiagnoses && cn.differentialDiagnoses.length > 0 && (
        <SectionCard title="Differential Diagnoses" icon={<Stethoscope className="w-4 h-4 text-rose-500" />}>
          <ul className="text-sm space-y-1 list-disc list-inside">
            {cn.differentialDiagnoses.map((dx, i) => <li key={i}>{dx}</li>)}
          </ul>
        </SectionCard>
      )}

      {/* Edit History */}
      {(call.analysis?.clinicalNote as any)?.editHistory?.length > 0 && (
        <Card className="print:hidden">
          <CardHeader className="pb-2">
            <CardTitle className="text-base text-muted-foreground">Edit History</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-1">
              {((call.analysis?.clinicalNote as any).editHistory as Array<{ editedBy: string; editedAt: string; fieldsChanged: string[] }>).map((edit, i) => (
                <div key={i} className="text-xs text-muted-foreground flex gap-2">
                  <span>{new Date(edit.editedAt).toLocaleString()}</span>
                  <span>—</span>
                  <span>{edit.editedBy} edited {edit.fieldsChanged.join(", ")}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
