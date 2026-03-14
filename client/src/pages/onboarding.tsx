import { useState, useCallback, useRef } from "react";
import { useQueryClient, useMutation, useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import {
  Building2, Upload, Palette, FileText, Check, ChevronRight, ChevronLeft,
  Image, X, Sparkles, BookOpen, AlertCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { useOrganization } from "@/hooks/use-organization";
import { REFERENCE_DOC_CATEGORIES, type ReferenceDocCategory } from "@shared/schema";

const CATEGORY_LABELS: Record<string, string> = {
  employee_handbook: "Employee Handbook",
  process_manual: "Process / Procedures Manual",
  product_manual: "Product Manual / Catalog",
  compliance_guide: "Compliance Guide",
  training_material: "Training Material",
  script_template: "Script / Call Template",
  faq: "FAQ / Knowledge Base",
  other: "Other",
};

const CATEGORY_SUGGESTIONS: Record<string, string> = {
  employee_handbook: "Company policies, expectations, and procedures for employees",
  process_manual: "Step-by-step workflows for handling orders, returns, complaints",
  product_manual: "Product specifications, features, pricing, and compatibility info",
  compliance_guide: "HIPAA guidelines, Medicare rules, regulatory requirements",
  training_material: "Onboarding docs, best practices, and role-specific training",
  script_template: "Call scripts, greeting templates, and closing procedures",
  faq: "Common questions and answers for quick agent reference",
};

type Step = "welcome" | "branding" | "documents" | "complete";
const STEPS: Step[] = ["welcome", "branding", "documents", "complete"];

interface UploadedDoc {
  id: string;
  name: string;
  category: string;
  fileSize: number;
  fileName: string;
}

export default function OnboardingWizard() {
  const [step, setStep] = useState<Step>("welcome");
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: org } = useOrganization();

  const stepIndex = STEPS.indexOf(step);
  const goNext = () => stepIndex < STEPS.length - 1 && setStep(STEPS[stepIndex + 1]);
  const goBack = () => stepIndex > 0 && setStep(STEPS[stepIndex - 1]);

  const completeMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", "/api/onboarding/complete");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/organization"] });
      navigate("/");
    },
  });

  return (
    <div className="min-h-screen bg-gradient-to-br from-background to-muted/30 flex flex-col">
      {/* Progress bar */}
      <div className="w-full bg-muted/50 border-b border-border">
        <div className="max-w-3xl mx-auto px-6 py-4">
          <div className="flex items-center justify-between mb-3">
            <h1 className="text-lg font-semibold text-foreground">
              Set up {org?.name || "your organization"}
            </h1>
            <Button
              variant="ghost"
              size="sm"
              className="text-muted-foreground"
              onClick={() => {
                completeMutation.mutate();
              }}
            >
              Skip setup
            </Button>
          </div>
          <div className="flex gap-2">
            {STEPS.map((s, i) => (
              <div
                key={s}
                className={`h-1.5 flex-1 rounded-full transition-colors ${
                  i <= stepIndex ? "bg-primary" : "bg-muted"
                }`}
              />
            ))}
          </div>
          <div className="flex justify-between mt-2 text-xs text-muted-foreground">
            <span>Welcome</span>
            <span>Branding</span>
            <span>Documents</span>
            <span>Done</span>
          </div>
        </div>
      </div>

      {/* Step content */}
      <div className="flex-1 flex items-start justify-center pt-8 pb-16 px-6">
        <div className="w-full max-w-2xl">
          {step === "welcome" && <WelcomeStep onNext={goNext} orgName={org?.name} />}
          {step === "branding" && <BrandingStep onNext={goNext} onBack={goBack} />}
          {step === "documents" && <DocumentsStep onNext={goNext} onBack={goBack} />}
          {step === "complete" && (
            <CompleteStep
              onFinish={() => completeMutation.mutate()}
              onBack={goBack}
              isLoading={completeMutation.isPending}
            />
          )}
        </div>
      </div>
    </div>
  );
}

// =============================================================================
// STEP 1: Welcome
// =============================================================================
function WelcomeStep({ onNext, orgName }: { onNext: () => void; orgName?: string }) {
  return (
    <div className="text-center space-y-8">
      <div className="space-y-3">
        <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto">
          <Building2 className="w-8 h-8 text-primary" />
        </div>
        <h2 className="text-2xl font-bold text-foreground">
          Welcome to Observatory{orgName ? `, ${orgName}` : ""}!
        </h2>
        <p className="text-muted-foreground max-w-md mx-auto">
          Let's personalize your workspace. You can upload your company logo for automatic branding
          and add reference documents to enhance AI call analysis.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-left">
        <Card className="border-border">
          <CardContent className="p-4 flex gap-3">
            <Palette className="w-5 h-5 text-primary mt-0.5 shrink-0" />
            <div>
              <p className="font-medium text-foreground text-sm">Company Branding</p>
              <p className="text-xs text-muted-foreground">Upload your logo and we'll auto-extract your brand colors</p>
            </div>
          </CardContent>
        </Card>
        <Card className="border-border">
          <CardContent className="p-4 flex gap-3">
            <BookOpen className="w-5 h-5 text-primary mt-0.5 shrink-0" />
            <div>
              <p className="font-medium text-foreground text-sm">Reference Documents</p>
              <p className="text-xs text-muted-foreground">Add handbooks and guides for smarter AI analysis</p>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="flex justify-center pt-2">
        <Button onClick={onNext} size="lg">
          Get Started
          <ChevronRight className="w-4 h-4 ml-2" />
        </Button>
      </div>

      <p className="text-xs text-muted-foreground">
        These steps are optional — you can always configure them later in Settings.
      </p>
    </div>
  );
}

// =============================================================================
// STEP 2: Branding (Logo Upload + Color Extraction)
// =============================================================================
function BrandingStep({ onNext, onBack }: { onNext: () => void; onBack: () => void }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: org } = useOrganization();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [extractedColors, setExtractedColors] = useState<{ primary: string; secondary: string } | null>(null);
  const [primaryColor, setPrimaryColor] = useState(org?.settings?.branding?.primaryColor || "");
  const [secondaryColor, setSecondaryColor] = useState((org?.settings?.branding as any)?.secondaryColor || "");

  const handleLogoSelect = useCallback(async (file: File) => {
    // Show preview immediately
    const reader = new FileReader();
    reader.onload = (e) => setLogoPreview(e.target?.result as string);
    reader.readAsDataURL(file);

    // Upload to server
    setIsUploading(true);
    try {
      const formData = new FormData();
      formData.append("logo", file);

      const res = await fetch("/api/onboarding/logo", {
        method: "POST",
        body: formData,
        credentials: "include",
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ message: "Upload failed" }));
        throw new Error(err.message);
      }

      const data = await res.json();
      if (data.extractedColors) {
        setExtractedColors(data.extractedColors);
        setPrimaryColor(data.extractedColors.primary);
        setSecondaryColor(data.extractedColors.secondary);
      }

      queryClient.invalidateQueries({ queryKey: ["/api/organization"] });
      toast({ title: "Logo uploaded successfully" });
    } catch (error) {
      toast({ title: "Upload failed", description: (error as Error).message, variant: "destructive" });
      setLogoPreview(null);
    } finally {
      setIsUploading(false);
    }
  }, [queryClient, toast]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith("image/")) {
      handleLogoSelect(file);
    }
  }, [handleLogoSelect]);

  const saveBranding = useMutation({
    mutationFn: async () => {
      await apiRequest("PATCH", "/api/organization/settings", {
        branding: {
          ...(org?.settings?.branding || {}),
          primaryColor: primaryColor || undefined,
          secondaryColor: secondaryColor || undefined,
        },
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/organization"] });
      onNext();
    },
    onError: (err) => {
      toast({ title: "Failed to save", description: err.message, variant: "destructive" });
    },
  });

  const existingLogo = org?.settings?.branding?.logoUrl;

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h2 className="text-xl font-bold text-foreground flex items-center gap-2">
          <Image className="w-5 h-5 text-primary" />
          Company Branding
        </h2>
        <p className="text-sm text-muted-foreground">
          Upload your company logo and we'll automatically extract your brand colors.
          You can adjust the colors manually afterward.
        </p>
      </div>

      {/* Logo drop zone */}
      <div
        className={`relative rounded-xl border-2 border-dashed p-8 text-center transition-colors cursor-pointer ${
          isUploading ? "border-primary/50 bg-primary/5" : "border-border hover:border-primary/50 hover:bg-muted/50"
        }`}
        onDrop={handleDrop}
        onDragOver={(e) => e.preventDefault()}
        onClick={() => fileInputRef.current?.click()}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept="image/png,image/jpeg,image/svg+xml,image/webp,image/gif"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleLogoSelect(file);
          }}
        />

        {isUploading ? (
          <div className="space-y-2">
            <Skeleton className="w-20 h-20 rounded-xl mx-auto" />
            <p className="text-sm text-muted-foreground">Uploading and extracting colors...</p>
          </div>
        ) : logoPreview || existingLogo ? (
          <div className="space-y-3">
            <img
              src={logoPreview || existingLogo}
              alt="Company logo"
              className="w-24 h-24 object-contain mx-auto rounded-lg bg-white p-2"
            />
            <p className="text-sm text-muted-foreground">Click or drop a new file to replace</p>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="w-16 h-16 rounded-xl bg-muted flex items-center justify-center mx-auto">
              <Upload className="w-8 h-8 text-muted-foreground" />
            </div>
            <div>
              <p className="text-sm font-medium text-foreground">Drop your logo here or click to browse</p>
              <p className="text-xs text-muted-foreground mt-1">PNG, JPEG, SVG, WebP, or GIF (max 5 MB)</p>
            </div>
          </div>
        )}
      </div>

      {/* Extracted / editable colors */}
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-primary" />
          <span className="text-sm font-medium text-foreground">
            {extractedColors ? "Colors extracted from logo" : "Brand Colors"}
          </span>
          {extractedColors && (
            <Badge variant="outline" className="text-xs">Auto-detected</Badge>
          )}
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">Primary Color</label>
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={primaryColor || "#10b981"}
                onChange={(e) => setPrimaryColor(e.target.value)}
                className="w-10 h-10 rounded cursor-pointer border border-border"
              />
              <Input
                value={primaryColor}
                onChange={(e) => setPrimaryColor(e.target.value)}
                placeholder="#10b981"
                className="flex-1"
              />
            </div>
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">Secondary Color</label>
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={secondaryColor || "#374151"}
                onChange={(e) => setSecondaryColor(e.target.value)}
                className="w-10 h-10 rounded cursor-pointer border border-border"
              />
              <Input
                value={secondaryColor}
                onChange={(e) => setSecondaryColor(e.target.value)}
                placeholder="#374151"
                className="flex-1"
              />
            </div>
          </div>
        </div>

        {/* Color preview */}
        {(primaryColor || secondaryColor) && (
          <div className="flex gap-3 items-center">
            <span className="text-xs text-muted-foreground">Preview:</span>
            <div className="flex gap-1">
              {primaryColor && (
                <div className="w-8 h-8 rounded-md border border-border" style={{ backgroundColor: primaryColor }} title="Primary" />
              )}
              {secondaryColor && (
                <div className="w-8 h-8 rounded-md border border-border" style={{ backgroundColor: secondaryColor }} title="Secondary" />
              )}
            </div>
          </div>
        )}
      </div>

      {/* Navigation */}
      <div className="flex justify-between pt-4">
        <Button variant="outline" onClick={onBack}>
          <ChevronLeft className="w-4 h-4 mr-2" />Back
        </Button>
        <Button onClick={() => saveBranding.mutate()} disabled={saveBranding.isPending}>
          {saveBranding.isPending ? "Saving..." : "Continue"}
          <ChevronRight className="w-4 h-4 ml-2" />
        </Button>
      </div>
    </div>
  );
}

// =============================================================================
// STEP 3: Reference Documents
// =============================================================================
function DocumentsStep({ onNext, onBack }: { onNext: () => void; onBack: () => void }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selectedCategory, setSelectedCategory] = useState<ReferenceDocCategory>("employee_handbook");
  const [docName, setDocName] = useState("");
  const [isUploading, setIsUploading] = useState(false);

  const { data: uploadedDocs = [], isLoading } = useQuery<UploadedDoc[]>({
    queryKey: ["/api/reference-documents"],
  });

  const handleDocUpload = useCallback(async (file: File) => {
    setIsUploading(true);
    try {
      const formData = new FormData();
      formData.append("document", file);
      formData.append("name", docName || file.name.replace(/\.[^.]+$/, ""));
      formData.append("category", selectedCategory);

      const res = await fetch("/api/reference-documents", {
        method: "POST",
        body: formData,
        credentials: "include",
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ message: "Upload failed" }));
        throw new Error(err.message);
      }

      queryClient.invalidateQueries({ queryKey: ["/api/reference-documents"] });
      setDocName("");
      toast({ title: "Document uploaded", description: `${file.name} is now available for AI analysis` });
    } catch (error) {
      toast({ title: "Upload failed", description: (error as Error).message, variant: "destructive" });
    } finally {
      setIsUploading(false);
    }
  }, [docName, selectedCategory, queryClient, toast]);

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/reference-documents/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/reference-documents"] });
    },
  });

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h2 className="text-xl font-bold text-foreground flex items-center gap-2">
          <FileText className="w-5 h-5 text-primary" />
          Company Reference Documents
        </h2>
        <p className="text-sm text-muted-foreground">
          Upload documents that contain your company's guidelines, procedures, and product information.
          These will be used to provide context during AI call analysis for more accurate scoring and feedback.
        </p>
      </div>

      {/* Suggestion cards */}
      <div className="grid grid-cols-2 gap-2">
        {Object.entries(CATEGORY_SUGGESTIONS).map(([cat, desc]) => (
          <button
            key={cat}
            type="button"
            className={`text-left p-3 rounded-lg border transition-colors ${
              selectedCategory === cat
                ? "border-primary bg-primary/5"
                : "border-border hover:border-primary/30 hover:bg-muted/50"
            }`}
            onClick={() => setSelectedCategory(cat as ReferenceDocCategory)}
          >
            <p className="text-sm font-medium text-foreground">{CATEGORY_LABELS[cat]}</p>
            <p className="text-xs text-muted-foreground mt-0.5">{desc}</p>
          </button>
        ))}
      </div>

      {/* Upload area */}
      <div className="space-y-3 rounded-lg border border-border p-4">
        <div className="flex items-center gap-2 text-sm font-medium text-foreground">
          <Upload className="w-4 h-4" />
          Upload a {CATEGORY_LABELS[selectedCategory]}
        </div>

        <Input
          value={docName}
          onChange={(e) => setDocName(e.target.value)}
          placeholder={`Document name (e.g., "${CATEGORY_LABELS[selectedCategory]} 2026")`}
          className="text-sm"
        />

        <div className="flex gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,.txt,.md,.doc,.docx,.csv"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleDocUpload(file);
            }}
          />
          <Button
            variant="outline"
            size="sm"
            onClick={() => fileInputRef.current?.click()}
            disabled={isUploading}
          >
            {isUploading ? "Uploading..." : "Choose File"}
          </Button>
          <span className="text-xs text-muted-foreground self-center">
            PDF, TXT, Markdown, Word, or CSV (max 25 MB)
          </span>
        </div>
      </div>

      {/* Uploaded documents list */}
      {uploadedDocs.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-medium text-foreground">Uploaded Documents</h3>
          {uploadedDocs.map((doc) => (
            <div key={doc.id} className="flex items-center justify-between p-3 rounded-lg border border-border bg-card">
              <div className="flex items-center gap-3 min-w-0">
                <FileText className="w-4 h-4 text-primary shrink-0" />
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground truncate">{doc.name}</p>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Badge variant="outline" className="text-xs">{CATEGORY_LABELS[doc.category] || doc.category}</Badge>
                    <span>{(doc.fileSize / 1024).toFixed(0)} KB</span>
                  </div>
                </div>
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="text-muted-foreground hover:text-red-600 shrink-0"
                onClick={() => deleteMutation.mutate(doc.id)}
              >
                <X className="w-4 h-4" />
              </Button>
            </div>
          ))}
        </div>
      )}

      {uploadedDocs.length === 0 && (
        <div className="flex items-start gap-2 p-3 rounded-lg bg-muted/50 border border-border">
          <AlertCircle className="w-4 h-4 text-muted-foreground mt-0.5 shrink-0" />
          <p className="text-xs text-muted-foreground">
            No documents uploaded yet. This step is optional — the AI will still analyze calls,
            but having company-specific context leads to more accurate scoring and relevant feedback.
          </p>
        </div>
      )}

      {/* Navigation */}
      <div className="flex justify-between pt-4">
        <Button variant="outline" onClick={onBack}>
          <ChevronLeft className="w-4 h-4 mr-2" />Back
        </Button>
        <Button onClick={onNext}>
          {uploadedDocs.length > 0 ? "Continue" : "Skip for Now"}
          <ChevronRight className="w-4 h-4 ml-2" />
        </Button>
      </div>
    </div>
  );
}

// =============================================================================
// STEP 4: Complete
// =============================================================================
function CompleteStep({ onFinish, onBack, isLoading }: { onFinish: () => void; onBack: () => void; isLoading: boolean }) {
  const { data: org } = useOrganization();
  const { data: docs = [] } = useQuery<UploadedDoc[]>({ queryKey: ["/api/reference-documents"] });

  const branding = org?.settings?.branding;
  const hasLogo = !!branding?.logoUrl;
  const hasColors = !!branding?.primaryColor;
  const hasDocs = docs.length > 0;

  return (
    <div className="text-center space-y-6">
      <div className="space-y-3">
        <div className="w-16 h-16 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center mx-auto">
          <Check className="w-8 h-8 text-green-600 dark:text-green-400" />
        </div>
        <h2 className="text-2xl font-bold text-foreground">You're all set!</h2>
        <p className="text-muted-foreground max-w-md mx-auto">
          Your workspace is configured. Here's a summary of what was set up:
        </p>
      </div>

      <div className="grid grid-cols-1 gap-3 text-left max-w-sm mx-auto">
        <SummaryItem icon={<Building2 className="w-4 h-4" />} label="Organization" value={org?.name || "Created"} done />
        <SummaryItem icon={<Image className="w-4 h-4" />} label="Company Logo" value={hasLogo ? "Uploaded" : "Not uploaded"} done={hasLogo} />
        <SummaryItem icon={<Palette className="w-4 h-4" />} label="Brand Colors" value={hasColors ? "Configured" : "Using defaults"} done={hasColors} />
        <SummaryItem icon={<FileText className="w-4 h-4" />} label="Reference Documents" value={hasDocs ? `${docs.length} uploaded` : "None uploaded"} done={hasDocs} />
      </div>

      <p className="text-xs text-muted-foreground">
        You can always update these in Settings later.
      </p>

      <div className="flex justify-between pt-4">
        <Button variant="outline" onClick={onBack}>
          <ChevronLeft className="w-4 h-4 mr-2" />Back
        </Button>
        <Button onClick={onFinish} disabled={isLoading} size="lg">
          {isLoading ? "Finishing..." : "Go to Dashboard"}
          <ChevronRight className="w-4 h-4 ml-2" />
        </Button>
      </div>
    </div>
  );
}

function SummaryItem({ icon, label, value, done }: { icon: React.ReactNode; label: string; value: string; done: boolean }) {
  return (
    <div className="flex items-center gap-3 p-3 rounded-lg border border-border">
      <div className={`shrink-0 ${done ? "text-green-600 dark:text-green-400" : "text-muted-foreground"}`}>
        {done ? <Check className="w-4 h-4" /> : icon}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-foreground">{label}</p>
        <p className="text-xs text-muted-foreground">{value}</p>
      </div>
    </div>
  );
}
