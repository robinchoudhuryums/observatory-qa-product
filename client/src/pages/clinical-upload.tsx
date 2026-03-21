import { useState, useEffect, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearch } from "wouter";
import { Mic, Upload as UploadIcon, Stethoscope, ShieldCheck, Sparkles } from "lucide-react";
import FileUpload from "@/components/upload/file-upload";
import AudioRecorder from "@/components/upload/audio-recorder";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { CLINICAL_SPECIALTIES, CLINICAL_NOTE_FORMATS } from "@shared/schema";
import type { Employee } from "@shared/schema";

type UploadTab = "file" | "record";

// Specialty → recommended note format mapping (mirrors server-side clinical-validation.ts)
const SPECIALTY_FORMAT_MAP: Record<string, string> = {
  primary_care: "soap", internal_medicine: "soap", cardiology: "hpi_focused",
  dermatology: "soap", orthopedics: "soap", psychiatry: "dap",
  pediatrics: "soap", ob_gyn: "soap", emergency: "soap", urgent_care: "soap",
  general_dentistry: "soap", periodontics: "soap", endodontics: "procedure_note",
  oral_surgery: "procedure_note", orthodontics: "soap", prosthodontics: "procedure_note",
  pediatric_dentistry: "soap", behavioral_health: "dap", general: "soap",
};

interface ClinicalTemplate {
  id: string;
  name: string;
  specialty: string;
  format: string;
  category: string;
  description: string;
}

export default function ClinicalUploadPage() {
  const [tab, setTab] = useState<UploadTab>("record");
  const [specialty, setSpecialty] = useState("");
  const [noteFormat, setNoteFormat] = useState("soap");
  const [encounterType, setEncounterType] = useState<"clinical_encounter" | "telemedicine">("clinical_encounter");
  const [providerId, setProviderId] = useState("");
  const [consentConfirmed, setConsentConfirmed] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [formatAutoSet, setFormatAutoSet] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const searchString = useSearch();
  const searchParams = useMemo(() => new URLSearchParams(searchString), [searchString]);
  const templateId = searchParams.get("template");

  // Fetch template if query param is present
  const { data: selectedTemplate } = useQuery<ClinicalTemplate>({
    queryKey: ["/api/clinical/templates", templateId],
    enabled: !!templateId,
  });

  // Pre-fill form from template
  useEffect(() => {
    if (selectedTemplate) {
      if (selectedTemplate.specialty) setSpecialty(selectedTemplate.specialty);
      if (selectedTemplate.format) setNoteFormat(selectedTemplate.format);
    }
  }, [selectedTemplate]);

  // Auto-map specialty → format (only when user changes specialty, not when template sets it)
  const handleSpecialtyChange = (value: string) => {
    setSpecialty(value);
    const recommended = SPECIALTY_FORMAT_MAP[value];
    if (recommended) {
      setNoteFormat(recommended);
      setFormatAutoSet(true);
    }
  };

  const handleFormatChange = (value: string) => {
    setNoteFormat(value);
    setFormatAutoSet(false);
  };

  const { data: employees } = useQuery<Employee[]>({
    queryKey: ["/api/employees"],
  });

  const handleUpload = async (file: File) => {
    if (!consentConfirmed) {
      toast({ title: "Patient consent required", description: "Please confirm patient consent before uploading.", variant: "destructive" });
      return;
    }

    setIsUploading(true);
    try {
      const formData = new FormData();
      formData.append("audioFile", file);
      formData.append("callCategory", encounterType);
      if (providerId && providerId !== "__unassigned__") formData.append("employeeId", providerId);
      if (specialty) formData.append("clinicalSpecialty", specialty);
      if (noteFormat) formData.append("noteFormat", noteFormat);

      const response = await fetch("/api/calls/upload", {
        method: "POST",
        body: formData,
        credentials: "include",
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({ message: "Upload failed" }));
        throw new Error(err.message || "Upload failed");
      }

      toast({ title: "Encounter uploaded", description: "Recording is being transcribed and clinical notes will be generated shortly." });
      queryClient.invalidateQueries({ queryKey: ["/api/calls"] });
    } catch (error: any) {
      toast({ title: "Upload failed", description: error.message, variant: "destructive" });
    } finally {
      setIsUploading(false);
    }
  };

  const handleRecordingComplete = async (file: File) => {
    await handleUpload(file);
  };

  return (
    <div className="p-4 md:p-6 max-w-2xl mx-auto space-y-6">
      <div>
        <div className="flex items-center gap-3">
          <Stethoscope className="w-6 h-6 text-primary" />
          <h1 className="text-2xl font-bold text-foreground">Clinical Documentation</h1>
        </div>
        <p className="text-muted-foreground mt-1">Record or upload a patient encounter to generate clinical notes.</p>
      </div>

      {/* HIPAA Notice */}
      <Card className="border-amber-200 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-800">
        <CardContent className="pt-4 pb-3">
          <div className="flex items-start gap-3">
            <ShieldCheck className="w-5 h-5 text-amber-600 mt-0.5 shrink-0" />
            <div className="text-sm">
              <p className="font-medium text-amber-800 dark:text-amber-200">HIPAA Compliance Notice</p>
              <p className="text-amber-700 dark:text-amber-300 mt-1">
                All recordings are encrypted in transit and at rest. Clinical notes are AI-generated drafts
                that require provider review and attestation before use. Patient consent must be obtained
                before recording.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Template indicator */}
      {selectedTemplate && (
        <Card className="border-blue-200 bg-blue-50 dark:bg-blue-950/20 dark:border-blue-800">
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-3">
              <Sparkles className="w-5 h-5 text-blue-600 shrink-0" />
              <div className="text-sm">
                <p className="font-medium text-blue-800 dark:text-blue-200">
                  Using template: {selectedTemplate.name}
                </p>
                <p className="text-blue-700 dark:text-blue-300 text-xs mt-0.5">
                  Specialty and format have been pre-filled. You can adjust them below.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Encounter Settings */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg">Encounter Details</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Encounter Type</Label>
              <Select value={encounterType} onValueChange={(v) => setEncounterType(v as any)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="clinical_encounter">In-Person Visit</SelectItem>
                  <SelectItem value="telemedicine">Telemedicine</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Specialty</Label>
              <Select value={specialty} onValueChange={handleSpecialtyChange}>
                <SelectTrigger>
                  <SelectValue placeholder="Select specialty..." />
                </SelectTrigger>
                <SelectContent>
                  {CLINICAL_SPECIALTIES.map(s => (
                    <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Label>Note Format</Label>
                {formatAutoSet && (
                  <Badge variant="outline" className="text-xs text-blue-600 border-blue-300 gap-1">
                    <Sparkles className="w-3 h-3" />Auto
                  </Badge>
                )}
              </div>
              <Select value={noteFormat} onValueChange={handleFormatChange}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CLINICAL_NOTE_FORMATS.map(f => (
                    <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Provider</Label>
              <Select value={providerId} onValueChange={setProviderId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select provider..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__unassigned__">Auto-detect from recording</SelectItem>
                  {employees?.map(emp => (
                    <SelectItem key={emp.id} value={emp.id}>{emp.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Patient Consent */}
          <div className="flex items-start gap-3 pt-2 border-t">
            <Checkbox
              id="consent"
              checked={consentConfirmed}
              onCheckedChange={(checked) => setConsentConfirmed(checked === true)}
            />
            <div>
              <Label htmlFor="consent" className="text-sm font-medium cursor-pointer">
                Patient consent obtained
              </Label>
              <p className="text-xs text-muted-foreground mt-0.5">
                I confirm that the patient has been informed about and consented to this recording being used for clinical documentation.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Upload / Record */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <CardTitle className="text-lg">
              {tab === "record" ? "Record Encounter" : "Upload Recording"}
            </CardTitle>
            {!consentConfirmed && (
              <Badge variant="outline" className="text-amber-600 border-amber-300">
                Consent required
              </Badge>
            )}
          </div>
          <CardDescription>
            {tab === "record"
              ? "Use your device microphone to record the encounter in real-time."
              : "Upload a previously recorded audio file."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {/* Tab toggle */}
          <div className="flex gap-2 mb-4">
            <button
              onClick={() => setTab("record")}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                tab === "record"
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted hover:bg-muted/80 text-muted-foreground"
              }`}
            >
              <Mic className="w-4 h-4" />
              Record
            </button>
            <button
              onClick={() => setTab("file")}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                tab === "file"
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted hover:bg-muted/80 text-muted-foreground"
              }`}
            >
              <UploadIcon className="w-4 h-4" />
              Upload File
            </button>
          </div>

          {!consentConfirmed ? (
            <div className="py-8 text-center text-muted-foreground text-sm">
              Please confirm patient consent above before recording or uploading.
            </div>
          ) : tab === "record" ? (
            <AudioRecorder onRecordingComplete={handleRecordingComplete} />
          ) : (
            <FileUpload />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
