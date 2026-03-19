import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useRoute } from "wouter";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Stethoscope, ShieldCheck, CheckCircle, AlertTriangle, FileText, Pill, Calendar, ClipboardList } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
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
    };
  };
  employee?: { name: string };
}

function SectionCard({ title, icon, children, empty }: { title: string; icon: React.ReactNode; children: React.ReactNode; empty?: string }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          {icon}
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {children || <p className="text-sm text-muted-foreground italic">{empty || "Not documented"}</p>}
      </CardContent>
    </Card>
  );
}

export default function ClinicalNotesPage() {
  const [, params] = useRoute("/clinical/notes/:id");
  const callId = params?.id;
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: call, isLoading } = useQuery<CallWithClinical>({
    queryKey: ["/api/calls", callId],
    enabled: !!callId,
  });

  const attestMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/clinical/notes/${callId}/attest`, {
        method: "POST",
        credentials: "include",
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
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ consentObtained: true }),
      });
      if (!res.ok) throw new Error("Failed to record consent");
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Consent recorded" });
      queryClient.invalidateQueries({ queryKey: ["/api/calls", callId] });
    },
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Stethoscope className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!call) {
    return (
      <div className="p-6">
        <p className="text-muted-foreground">Encounter not found.</p>
      </div>
    );
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
        <div className="flex items-center gap-2">
          {cn.providerAttested ? (
            <Badge className="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300">
              <CheckCircle className="w-3.5 h-3.5 mr-1" />
              Attested
            </Badge>
          ) : (
            <Badge variant="outline" className="text-amber-600 border-amber-300">
              <AlertTriangle className="w-3.5 h-3.5 mr-1" />
              Draft — Requires Attestation
            </Badge>
          )}
          {cn.patientConsentObtained && (
            <Badge className="bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300">
              <ShieldCheck className="w-3.5 h-3.5 mr-1" />
              Consent
            </Badge>
          )}
        </div>
      </div>

      {/* AI Draft Warning */}
      {!cn.providerAttested && (
        <Card className="border-amber-200 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-800">
          <CardContent className="pt-4 pb-3">
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-amber-600 mt-0.5 shrink-0" />
              <div className="text-sm flex-1">
                <p className="font-medium text-amber-800 dark:text-amber-200">AI-Generated Draft</p>
                <p className="text-amber-700 dark:text-amber-300 mt-1">
                  This clinical note was automatically generated from the encounter recording.
                  It must be reviewed for accuracy and attested by a licensed provider before use in the patient record.
                </p>
                <div className="flex gap-2 mt-3">
                  <Button size="sm" onClick={() => attestMutation.mutate()} disabled={attestMutation.isPending}>
                    <CheckCircle className="w-4 h-4 mr-1" />
                    Attest Note
                  </Button>
                  {!cn.patientConsentObtained && (
                    <Button size="sm" variant="outline" onClick={() => consentMutation.mutate()} disabled={consentMutation.isPending}>
                      <ShieldCheck className="w-4 h-4 mr-1" />
                      Record Consent
                    </Button>
                  )}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Chief Complaint */}
      {cn.chiefComplaint && (
        <Card>
          <CardContent className="pt-4">
            <p className="text-sm text-muted-foreground">Chief Complaint</p>
            <p className="font-medium mt-1">{cn.chiefComplaint}</p>
          </CardContent>
        </Card>
      )}

      {/* Quality Scores */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
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
              <p className="text-lg font-semibold uppercase">{cn.format}</p>
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

      {/* SOAP Sections */}
      <div className="space-y-4">
        <SectionCard title="Subjective" icon={<FileText className="w-4 h-4 text-blue-500" />} empty="No subjective findings documented">
          {cn.subjective && <p className="text-sm whitespace-pre-wrap">{cn.subjective}</p>}
        </SectionCard>

        <SectionCard title="Objective" icon={<ClipboardList className="w-4 h-4 text-green-500" />} empty="No objective findings documented">
          {cn.objective && <p className="text-sm whitespace-pre-wrap">{cn.objective}</p>}
        </SectionCard>

        <SectionCard title="Assessment" icon={<Stethoscope className="w-4 h-4 text-purple-500" />} empty="No assessment documented">
          {cn.assessment && <p className="text-sm whitespace-pre-wrap">{cn.assessment}</p>}
        </SectionCard>

        <SectionCard title="Plan" icon={<Calendar className="w-4 h-4 text-orange-500" />} empty="No plan documented">
          {cn.plan && cn.plan.length > 0 && (
            <ul className="text-sm space-y-1 list-disc list-inside">
              {cn.plan.map((item, i) => <li key={i}>{item}</li>)}
            </ul>
          )}
        </SectionCard>
      </div>

      {/* HPI Narrative */}
      {cn.hpiNarrative && (
        <SectionCard title="History of Present Illness" icon={<FileText className="w-4 h-4 text-indigo-500" />}>
          <p className="text-sm whitespace-pre-wrap">{cn.hpiNarrative}</p>
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

      {/* Codes & Prescriptions */}
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
                  <div key={i} className="flex items-center gap-2">
                    <Badge variant="outline" className="font-mono text-xs">{code.code}</Badge>
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
                  <div key={i} className="flex items-center gap-2">
                    <Badge variant="outline" className="font-mono text-xs">{code.code}</Badge>
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
      {cn.followUp && (
        <Card>
          <CardContent className="pt-4">
            <p className="text-sm text-muted-foreground">Follow-up</p>
            <p className="font-medium mt-1">{cn.followUp}</p>
          </CardContent>
        </Card>
      )}

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

      {/* Differential Diagnoses */}
      {cn.differentialDiagnoses && cn.differentialDiagnoses.length > 0 && (
        <SectionCard title="Differential Diagnoses" icon={<Stethoscope className="w-4 h-4 text-rose-500" />}>
          <ul className="text-sm space-y-1 list-disc list-inside">
            {cn.differentialDiagnoses.map((dx, i) => <li key={i}>{dx}</li>)}
          </ul>
        </SectionCard>
      )}
    </div>
  );
}
