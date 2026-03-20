import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import { Input } from "@/components/ui/input";
import {
  Stethoscope, FileText, CheckCircle, AlertTriangle, Clock, Plus, Activity,
  Brain, BookTemplate, TrendingUp, BarChart3, Timer, Search, Sparkles,
  ChevronRight, PieChart,
} from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart as RechartsPie, Pie, Cell, LineChart, Line,
} from "recharts";

// ─── Types ────────────────────────────────────────────────────────────

interface ClinicalMetrics {
  totalEncounters: number;
  completedEncounters: number;
  notesGenerated: number;
  notesAttested: number;
  pendingAttestation: number;
  avgDocumentationCompleteness: number;
  avgClinicalAccuracy: number;
  attestationRate: number;
  avgAttestationTimeMinutes: number | null;
  formatDistribution: Record<string, number>;
  specialtyDistribution: Record<string, number>;
  attestationTrend: Array<{ date: string; attested: number; total: number }>;
  completenessDistribution: Array<{ range: string; count: number }>;
}

interface CallItem {
  id: string;
  fileName?: string;
  status: string;
  duration?: number;
  callCategory?: string;
  uploadedAt?: string;
  employee?: { name: string };
  analysis?: {
    summary?: string;
    clinicalNote?: {
      chiefComplaint?: string;
      providerAttested?: boolean;
      format?: string;
      documentationCompleteness?: number;
    };
  };
}

interface ClinicalTemplate {
  id: string;
  name: string;
  specialty: string;
  format: string;
  category: string;
  description: string;
  sections: Record<string, string>;
  defaultCodes?: Array<{ code: string; description: string }>;
  tags: string[];
}

interface StyleAnalysisResult {
  success: boolean;
  message?: string;
  noteCount: number;
  analysis?: {
    noteFormat: { value: string; confidence: number };
    abbreviationLevel: { value: string; confidence: number };
    includeNegativePertinents: { value: boolean; confidence: number };
    sectionEmphasis: { value: string; confidence: number };
    commonPhrases: { value: string[]; confidence: number };
    avgNoteLength: number;
    preferredSpecialty: { value: string; confidence: number } | null;
    suggestedPreferences: Record<string, unknown>;
  };
}

// ─── Chart colors ─────────────────────────────────────────────────────

const CHART_COLORS = ["#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899", "#06b6d4"];
const FORMAT_LABELS: Record<string, string> = {
  soap: "SOAP", dap: "DAP", birp: "BIRP",
  hpi_focused: "HPI-Focused", procedure_note: "Procedure",
};

// ─── Helper: fetch wrapper for mutations ──────────────────────────────

async function apiPost(url: string, body?: unknown) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

// ─── Component ────────────────────────────────────────────────────────

export default function ClinicalDashboardPage() {
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const [templateSearch, setTemplateSearch] = useState("");

  // Data queries
  const { data: metrics, isLoading: metricsLoading } = useQuery<ClinicalMetrics>({
    queryKey: ["/api/clinical/metrics"],
    staleTime: 30000,
  });

  const { data: callsData } = useQuery<CallItem[] | { data: CallItem[]; total: number }>({
    queryKey: ["/api/calls"],
    staleTime: 30000,
  });

  const { data: templates } = useQuery<ClinicalTemplate[]>({
    queryKey: ["/api/clinical/templates", templateSearch],
    queryFn: async () => {
      const params = templateSearch ? `?search=${encodeURIComponent(templateSearch)}` : "";
      const res = await fetch(`/api/clinical/templates${params}`, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    staleTime: 60000,
  });

  const { data: styleResult, isLoading: styleLoading } = useQuery<StyleAnalysisResult>({
    queryKey: ["/api/clinical/style-learning"],
    queryFn: async () => {
      const res = await fetch("/api/clinical/style-learning/analyze", {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
      });
      if (!res.ok) return { success: false, noteCount: 0 };
      return res.json();
    },
    staleTime: 120000,
  });

  const applyStyleMutation = useMutation({
    mutationFn: (prefs: Record<string, unknown>) => apiPost("/api/clinical/style-learning/apply", { preferences: prefs }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/clinical/provider-preferences"] }),
  });

  // Filter clinical calls
  const clinicalCategories = ["clinical_encounter", "telemedicine", "dental_encounter", "dental_consultation"];
  const calls = (Array.isArray(callsData) ? callsData : callsData?.data || [])
    .filter(c => c.callCategory && clinicalCategories.includes(c.callCategory))
    .slice(0, 20);

  if (metricsLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Activity className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  // Chart data
  const formatPieData = Object.entries(metrics?.formatDistribution || {}).map(([name, value]) => ({
    name: FORMAT_LABELS[name] || name, value,
  }));

  const specialtyPieData = Object.entries(metrics?.specialtyDistribution || {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, 7)
    .map(([name, value]) => ({ name: name.replace(/_/g, " "), value }));

  const trendData = (metrics?.attestationTrend || []).map(d => ({
    ...d,
    date: d.date.slice(5), // MM-DD
  }));

  return (
    <div className="p-4 md:p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <Stethoscope className="w-6 h-6 text-primary" />
            <h1 className="text-2xl font-bold text-foreground">Clinical Dashboard</h1>
          </div>
          <p className="text-muted-foreground mt-1">Documentation quality, attestation tracking, and AI style learning.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => navigate("/clinical/templates")}>
            <BookTemplate className="w-4 h-4 mr-2" />
            Templates
          </Button>
          <Button onClick={() => navigate("/clinical/upload")}>
            <Plus className="w-4 h-4 mr-2" />
            New Encounter
          </Button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-blue-100 dark:bg-blue-900/30">
                <Stethoscope className="w-5 h-5 text-blue-600 dark:text-blue-400" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Encounters</p>
                <p className="text-2xl font-bold">{metrics?.totalEncounters || 0}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-green-100 dark:bg-green-900/30">
                <FileText className="w-5 h-5 text-green-600 dark:text-green-400" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Notes</p>
                <p className="text-2xl font-bold">{metrics?.notesGenerated || 0}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-amber-100 dark:bg-amber-900/30">
                <AlertTriangle className="w-5 h-5 text-amber-600 dark:text-amber-400" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Pending</p>
                <p className="text-2xl font-bold">{metrics?.pendingAttestation || 0}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-purple-100 dark:bg-purple-900/30">
                <CheckCircle className="w-5 h-5 text-purple-600 dark:text-purple-400" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Attestation Rate</p>
                <p className="text-2xl font-bold">{metrics?.attestationRate || 0}%</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-cyan-100 dark:bg-cyan-900/30">
                <Timer className="w-5 h-5 text-cyan-600 dark:text-cyan-400" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Avg Attest Time</p>
                <p className="text-2xl font-bold">
                  {metrics?.avgAttestationTimeMinutes != null ? `${metrics.avgAttestationTimeMinutes}m` : "—"}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Quality Scores */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <BarChart3 className="w-4 h-4" />
              Documentation Completeness
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-4 mb-4">
              <span className="text-3xl font-bold">{metrics?.avgDocumentationCompleteness?.toFixed(1) || "—"}</span>
              <span className="text-muted-foreground">/10</span>
            </div>
            <Progress
              value={(metrics?.avgDocumentationCompleteness || 0) * 10}
              className="h-2"
            />
            {metrics?.completenessDistribution && (
              <div className="mt-4 h-32">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={metrics.completenessDistribution}>
                    <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                    <XAxis dataKey="range" tick={{ fontSize: 11 }} />
                    <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                    <Tooltip />
                    <Bar dataKey="count" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <TrendingUp className="w-4 h-4" />
              Clinical Accuracy
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-4 mb-4">
              <span className="text-3xl font-bold">{metrics?.avgClinicalAccuracy?.toFixed(1) || "—"}</span>
              <span className="text-muted-foreground">/10</span>
            </div>
            <Progress
              value={(metrics?.avgClinicalAccuracy || 0) * 10}
              className="h-2"
            />
            {trendData.length > 0 && (
              <div className="mt-4 h-32">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={trendData}>
                    <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                    <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                    <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                    <Tooltip />
                    <Line type="monotone" dataKey="total" stroke="#94a3b8" strokeWidth={1.5} dot={false} name="Total" />
                    <Line type="monotone" dataKey="attested" stroke="#10b981" strokeWidth={2} dot={false} name="Attested" />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Distribution Charts */}
      {(formatPieData.length > 0 || specialtyPieData.length > 0) && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {formatPieData.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <PieChart className="w-4 h-4" />
                  Note Format Distribution
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-48">
                  <ResponsiveContainer width="100%" height="100%">
                    <RechartsPie>
                      <Pie
                        data={formatPieData}
                        cx="50%" cy="50%"
                        innerRadius={40} outerRadius={70}
                        paddingAngle={2}
                        dataKey="value"
                        label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                      >
                        {formatPieData.map((_, i) => (
                          <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip />
                    </RechartsPie>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          )}

          {specialtyPieData.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <PieChart className="w-4 h-4" />
                  Specialty Distribution
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-48">
                  <ResponsiveContainer width="100%" height="100%">
                    <RechartsPie>
                      <Pie
                        data={specialtyPieData}
                        cx="50%" cy="50%"
                        innerRadius={40} outerRadius={70}
                        paddingAngle={2}
                        dataKey="value"
                        label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                      >
                        {specialtyPieData.map((_, i) => (
                          <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip />
                    </RechartsPie>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* Tabbed section: Style Learning + Templates + Recent Encounters */}
      <Tabs defaultValue="encounters" className="w-full">
        <TabsList>
          <TabsTrigger value="encounters" className="gap-1.5">
            <FileText className="w-3.5 h-3.5" />
            Recent Encounters
          </TabsTrigger>
          <TabsTrigger value="style" className="gap-1.5">
            <Brain className="w-3.5 h-3.5" />
            Style Learning
          </TabsTrigger>
          <TabsTrigger value="templates" className="gap-1.5">
            <BookTemplate className="w-3.5 h-3.5" />
            Templates
          </TabsTrigger>
        </TabsList>

        {/* Recent Encounters Tab */}
        <TabsContent value="encounters">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Recent Encounters</CardTitle>
              <CardDescription>Latest clinical encounters and their documentation status</CardDescription>
            </CardHeader>
            <CardContent>
              {calls.length === 0 ? (
                <div className="py-12 text-center">
                  <Stethoscope className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
                  <h3 className="text-lg font-semibold">No clinical encounters yet</h3>
                  <p className="text-muted-foreground mt-2">Upload or record a patient encounter to get started.</p>
                  <Button className="mt-4" onClick={() => navigate("/clinical/upload")}>
                    <Plus className="w-4 h-4 mr-2" />
                    Record Encounter
                  </Button>
                </div>
              ) : (
                <div className="space-y-2">
                  {calls.map(call => (
                    <div
                      key={call.id}
                      className="flex items-center justify-between py-3 px-3 rounded-md hover:bg-muted/50 border border-transparent hover:border-border transition-colors cursor-pointer"
                      onClick={() => navigate(`/clinical/notes/${call.id}`)}
                    >
                      <div className="flex items-center gap-3">
                        <Stethoscope className="w-4 h-4 text-primary" />
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium">
                              {call.analysis?.clinicalNote?.chiefComplaint || call.fileName || "Encounter"}
                            </span>
                            {call.status === "processing" && (
                              <Badge variant="outline" className="text-xs">
                                <Clock className="w-3 h-3 mr-1" />
                                Processing
                              </Badge>
                            )}
                          </div>
                          <div className="flex items-center gap-2 text-xs text-muted-foreground">
                            {call.employee?.name && <span>{call.employee.name}</span>}
                            {call.uploadedAt && <span>{new Date(call.uploadedAt).toLocaleDateString()}</span>}
                            {call.callCategory && (
                              <Badge variant="outline" className="text-xs capitalize">
                                {call.callCategory.replace(/_/g, " ")}
                              </Badge>
                            )}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {call.analysis?.clinicalNote ? (
                          call.analysis.clinicalNote.providerAttested ? (
                            <Badge className="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300 text-xs">
                              <CheckCircle className="w-3 h-3 mr-1" />
                              Attested
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="text-amber-600 border-amber-300 text-xs">
                              Draft
                            </Badge>
                          )
                        ) : call.status === "completed" ? (
                          <Badge variant="outline" className="text-xs text-muted-foreground">No note</Badge>
                        ) : null}
                        {call.analysis?.clinicalNote?.documentationCompleteness != null && (
                          <span className="text-xs text-muted-foreground font-mono">
                            {call.analysis.clinicalNote.documentationCompleteness.toFixed(1)}/10
                          </span>
                        )}
                        <ChevronRight className="w-4 h-4 text-muted-foreground" />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Style Learning Tab */}
        <TabsContent value="style">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Brain className="w-5 h-5 text-purple-500" />
                Provider Style Learning
              </CardTitle>
              <CardDescription>
                AI analyzes your attested notes to learn your documentation style and automatically adapt future note generation.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {styleLoading ? (
                <div className="flex items-center justify-center py-12">
                  <Activity className="w-6 h-6 animate-spin text-purple-500 mr-3" />
                  <span className="text-muted-foreground">Analyzing your documentation style...</span>
                </div>
              ) : !styleResult?.success ? (
                <div className="py-8 text-center">
                  <Brain className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
                  <h3 className="text-lg font-semibold">Not enough data yet</h3>
                  <p className="text-muted-foreground mt-2 max-w-md mx-auto">
                    {styleResult?.message || "Attest at least 3 clinical notes so the AI can learn your documentation style."}
                  </p>
                  <p className="text-sm text-muted-foreground mt-1">
                    Notes analyzed: {styleResult?.noteCount || 0} / 3 required
                  </p>
                  <Progress value={((styleResult?.noteCount || 0) / 3) * 100} className="h-1.5 max-w-xs mx-auto mt-3" />
                </div>
              ) : (
                <div className="space-y-6">
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    {/* Detected Format */}
                    <div className="p-4 rounded-lg border bg-muted/30">
                      <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Preferred Format</p>
                      <p className="text-lg font-semibold capitalize">
                        {FORMAT_LABELS[styleResult.analysis!.noteFormat.value] || styleResult.analysis!.noteFormat.value}
                      </p>
                      <div className="flex items-center gap-2 mt-1">
                        <Progress value={styleResult.analysis!.noteFormat.confidence * 100} className="h-1 flex-1" />
                        <span className="text-xs text-muted-foreground">
                          {Math.round(styleResult.analysis!.noteFormat.confidence * 100)}%
                        </span>
                      </div>
                    </div>

                    {/* Abbreviation Level */}
                    <div className="p-4 rounded-lg border bg-muted/30">
                      <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Abbreviation Level</p>
                      <p className="text-lg font-semibold capitalize">{styleResult.analysis!.abbreviationLevel.value}</p>
                      <div className="flex items-center gap-2 mt-1">
                        <Progress value={styleResult.analysis!.abbreviationLevel.confidence * 100} className="h-1 flex-1" />
                        <span className="text-xs text-muted-foreground">
                          {Math.round(styleResult.analysis!.abbreviationLevel.confidence * 100)}%
                        </span>
                      </div>
                    </div>

                    {/* Section Emphasis */}
                    <div className="p-4 rounded-lg border bg-muted/30">
                      <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Section Emphasis</p>
                      <p className="text-lg font-semibold capitalize">{styleResult.analysis!.sectionEmphasis.value}</p>
                      <div className="flex items-center gap-2 mt-1">
                        <Progress value={styleResult.analysis!.sectionEmphasis.confidence * 100} className="h-1 flex-1" />
                        <span className="text-xs text-muted-foreground">
                          {Math.round(styleResult.analysis!.sectionEmphasis.confidence * 100)}%
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Additional insights */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="p-4 rounded-lg border bg-muted/30">
                      <p className="text-xs text-muted-foreground uppercase tracking-wide mb-2">Details</p>
                      <div className="space-y-2 text-sm">
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Negative pertinents</span>
                          <span className="font-medium">
                            {styleResult.analysis!.includeNegativePertinents.value ? "Included" : "Omitted"}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Avg note length</span>
                          <span className="font-medium">{styleResult.analysis!.avgNoteLength} chars</span>
                        </div>
                        {styleResult.analysis!.preferredSpecialty && (
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">Primary specialty</span>
                            <span className="font-medium capitalize">
                              {styleResult.analysis!.preferredSpecialty.value.replace(/_/g, " ")}
                            </span>
                          </div>
                        )}
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Notes analyzed</span>
                          <span className="font-medium">{styleResult.noteCount}</span>
                        </div>
                      </div>
                    </div>

                    {styleResult.analysis!.commonPhrases.value.length > 0 && (
                      <div className="p-4 rounded-lg border bg-muted/30">
                        <p className="text-xs text-muted-foreground uppercase tracking-wide mb-2">Common Phrases</p>
                        <div className="flex flex-wrap gap-1.5">
                          {styleResult.analysis!.commonPhrases.value.slice(0, 8).map((phrase, i) => (
                            <Badge key={i} variant="outline" className="text-xs">{phrase}</Badge>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Apply button */}
                  <div className="flex items-center justify-between pt-2 border-t">
                    <p className="text-sm text-muted-foreground">
                      Apply these learned preferences to automatically adapt future note generation to your style.
                    </p>
                    <Button
                      onClick={() => applyStyleMutation.mutate(styleResult.analysis!.suggestedPreferences)}
                      disabled={applyStyleMutation.isPending}
                    >
                      <Sparkles className="w-4 h-4 mr-2" />
                      {applyStyleMutation.isPending ? "Applying..." :
                        applyStyleMutation.isSuccess ? "Applied!" : "Apply Preferences"}
                    </Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Templates Tab */}
        <TabsContent value="templates">
          <Card>
            <CardHeader>
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div>
                  <CardTitle className="text-lg flex items-center gap-2">
                    <BookTemplate className="w-5 h-5 text-blue-500" />
                    Clinical Note Templates
                  </CardTitle>
                  <CardDescription>Pre-built templates for common encounter types across specialties.</CardDescription>
                </div>
                <div className="relative w-full sm:w-64">
                  <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Search templates..."
                    value={templateSearch}
                    onChange={e => setTemplateSearch(e.target.value)}
                    className="pl-9"
                  />
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {!templates || templates.length === 0 ? (
                <div className="py-8 text-center text-muted-foreground">
                  <BookTemplate className="w-12 h-12 mx-auto mb-4 opacity-50" />
                  <p>{templateSearch ? "No templates match your search." : "No templates available."}</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                  {templates.map(tmpl => (
                    <div
                      key={tmpl.id}
                      className="p-4 rounded-lg border hover:border-primary/50 hover:bg-muted/30 transition-colors cursor-pointer"
                      onClick={() => navigate(`/clinical/upload?template=${tmpl.id}`)}
                    >
                      <div className="flex items-start justify-between mb-2">
                        <h4 className="text-sm font-semibold line-clamp-1">{tmpl.name}</h4>
                        <Badge variant="outline" className="text-xs shrink-0 ml-2">
                          {FORMAT_LABELS[tmpl.format] || tmpl.format}
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground line-clamp-2 mb-3">{tmpl.description}</p>
                      <div className="flex flex-wrap gap-1">
                        <Badge variant="secondary" className="text-xs capitalize">
                          {tmpl.specialty.replace(/_/g, " ")}
                        </Badge>
                        <Badge variant="secondary" className="text-xs capitalize">
                          {tmpl.category.replace(/_/g, " ")}
                        </Badge>
                        {tmpl.defaultCodes && tmpl.defaultCodes.length > 0 && (
                          <Badge variant="secondary" className="text-xs">
                            {tmpl.defaultCodes.length} codes
                          </Badge>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
