import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Stethoscope, FileText, CheckCircle, AlertTriangle, Clock, Plus, Activity } from "lucide-react";

interface ClinicalMetrics {
  totalEncounters: number;
  completedEncounters: number;
  notesGenerated: number;
  notesAttested: number;
  pendingAttestation: number;
  avgDocumentationCompleteness: number;
  avgClinicalAccuracy: number;
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

export default function ClinicalDashboardPage() {
  const [, navigate] = useLocation();

  const { data: metrics, isLoading: metricsLoading } = useQuery<ClinicalMetrics>({
    queryKey: ["/api/clinical/metrics"],
    staleTime: 30000,
  });

  const { data: callsData } = useQuery<CallItem[] | { data: CallItem[]; total: number }>({
    queryKey: ["/api/calls"],
    staleTime: 30000,
  });

  // Filter to clinical calls
  const calls = (Array.isArray(callsData) ? callsData : callsData?.data || [])
    .filter(c => c.callCategory === "clinical_encounter" || c.callCategory === "telemedicine")
    .slice(0, 20);

  if (metricsLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Activity className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <Stethoscope className="w-6 h-6 text-primary" />
            <h1 className="text-2xl font-bold text-foreground">Clinical Dashboard</h1>
          </div>
          <p className="text-muted-foreground mt-1">Overview of clinical documentation activity.</p>
        </div>
        <Button onClick={() => navigate("/clinical/upload")}>
          <Plus className="w-4 h-4 mr-2" />
          New Encounter
        </Button>
      </div>

      {/* Metrics Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-blue-100 dark:bg-blue-900/30">
                <Stethoscope className="w-5 h-5 text-blue-600 dark:text-blue-400" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Total Encounters</p>
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
                <p className="text-sm text-muted-foreground">Notes Generated</p>
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
                <p className="text-sm text-muted-foreground">Pending Attestation</p>
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
                <p className="text-sm text-muted-foreground">Avg Completeness</p>
                <p className="text-2xl font-bold">{metrics?.avgDocumentationCompleteness?.toFixed(1) || "—"}</p>
                <p className="text-xs text-muted-foreground">/10</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Recent Encounters */}
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
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
