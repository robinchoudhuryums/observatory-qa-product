import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, getQueryFn } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import {
  Scale, Plus, Users, CheckCircle2, Clock, AlertTriangle, BarChart3,
} from "lucide-react";
import type { Call, User } from "@shared/schema";

type CalibrationSessionSummary = {
  id: string;
  title: string;
  callId: string;
  callFileName?: string;
  callCategory?: string;
  facilitatorId: string;
  evaluatorIds: string[];
  status: string;
  evaluationCount: number;
  expectedEvaluations: number;
  scoreVariance?: number;
  avgScore: number | null;
  targetScore?: number;
  createdAt?: string;
};

type CalibrationDetail = CalibrationSessionSummary & {
  evaluations: Array<{
    id: string;
    evaluatorId: string;
    evaluatorName: string;
    performanceScore: number;
    subScores?: { compliance?: number; customerExperience?: number; communication?: number; resolution?: number };
    notes?: string;
  }>;
  call?: Call;
  aiScore: number | null;
  facilitatorName: string;
  consensusNotes?: string;
};

const statusIcons: Record<string, typeof Clock> = {
  scheduled: Clock,
  in_progress: Users,
  completed: CheckCircle2,
};

const statusColors: Record<string, string> = {
  scheduled: "bg-blue-100 text-blue-800",
  in_progress: "bg-yellow-100 text-yellow-800",
  completed: "bg-green-100 text-green-800",
};

export default function CalibrationPage() {
  const { toast } = useToast();
  const [showCreate, setShowCreate] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [evalScore, setEvalScore] = useState(5);
  const [evalNotes, setEvalNotes] = useState("");
  const [form, setForm] = useState({ title: "", callId: "", evaluatorIds: [] as string[] });

  const { data: sessions = [] } = useQuery<CalibrationSessionSummary[]>({
    queryKey: ["/api/calibration"],
    queryFn: getQueryFn({ on401: "returnNull" }),
  });

  const { data: detail } = useQuery<CalibrationDetail>({
    queryKey: ["/api/calibration", selectedId],
    queryFn: getQueryFn({ on401: "returnNull" }),
    enabled: !!selectedId,
  });

  const { data: calls = [] } = useQuery<Call[]>({
    queryKey: ["/api/calls"],
    queryFn: getQueryFn({ on401: "returnNull" }),
  });

  const { data: users = [] } = useQuery<User[]>({
    queryKey: ["/api/admin/users"],
    queryFn: getQueryFn({ on401: "returnNull" }),
  });

  const completedCalls = calls.filter(c => c.status === "completed");

  const createMutation = useMutation({
    mutationFn: async (data: typeof form) => {
      const res = await fetch("/api/calibration", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error("Failed to create session");
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/calibration"] });
      setShowCreate(false);
      setSelectedId(data.id);
      toast({ title: "Calibration session created" });
    },
  });

  const evaluateMutation = useMutation({
    mutationFn: async ({ sessionId, performanceScore, notes }: { sessionId: string; performanceScore: number; notes: string }) => {
      const res = await fetch(`/api/calibration/${sessionId}/evaluate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ performanceScore, notes }),
      });
      if (!res.ok) throw new Error("Failed to submit evaluation");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/calibration"] });
      setEvalNotes("");
      toast({ title: "Evaluation submitted" });
    },
  });

  const completeMutation = useMutation({
    mutationFn: async ({ id, targetScore, consensusNotes }: { id: string; targetScore?: number; consensusNotes?: string }) => {
      const res = await fetch(`/api/calibration/${id}/complete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetScore, consensusNotes }),
      });
      if (!res.ok) throw new Error("Failed to complete session");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/calibration"] });
      toast({ title: "Calibration session completed" });
    },
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Scale className="w-6 h-6 text-primary" />
            Calibration Sessions
          </h1>
          <p className="text-muted-foreground">Align QA evaluators with multi-reviewer scoring sessions</p>
        </div>
        <Dialog open={showCreate} onOpenChange={setShowCreate}>
          <DialogTrigger asChild>
            <Button><Plus className="w-4 h-4 mr-2" /> New Session</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create Calibration Session</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <div>
                <Label>Title</Label>
                <Input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                  placeholder="e.g., Weekly QA Calibration #12" />
              </div>
              <div>
                <Label>Call to Evaluate</Label>
                <Select value={form.callId} onValueChange={v => setForm(f => ({ ...f, callId: v }))}>
                  <SelectTrigger><SelectValue placeholder="Select a completed call..." /></SelectTrigger>
                  <SelectContent>
                    {completedCalls.slice(0, 50).map(c => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.fileName || c.id.slice(0, 8)} {c.callCategory ? `(${c.callCategory})` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Evaluators</Label>
                <div className="space-y-1 max-h-40 overflow-y-auto border rounded-md p-2">
                  {users.filter(u => u.role !== "viewer").map(u => (
                    <label key={u.id} className="flex items-center gap-2 text-sm cursor-pointer">
                      <input type="checkbox" checked={form.evaluatorIds.includes(u.id)}
                        onChange={e => {
                          setForm(f => ({
                            ...f,
                            evaluatorIds: e.target.checked
                              ? [...f.evaluatorIds, u.id]
                              : f.evaluatorIds.filter(id => id !== u.id),
                          }));
                        }} />
                      {u.name} ({u.role})
                    </label>
                  ))}
                </div>
              </div>
              <Button className="w-full" onClick={() => createMutation.mutate(form)}
                disabled={!form.title || !form.callId || form.evaluatorIds.length === 0 || createMutation.isPending}>
                Create Session
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Sessions List */}
        <div className="space-y-3">
          {sessions.length === 0 ? (
            <Card>
              <CardContent className="py-8 text-center text-muted-foreground">
                No calibration sessions yet.
              </CardContent>
            </Card>
          ) : (
            sessions.map(s => {
              const StatusIcon = statusIcons[s.status] || Clock;
              return (
                <Card key={s.id}
                  className={`cursor-pointer transition-colors ${selectedId === s.id ? "ring-2 ring-primary" : ""}`}
                  onClick={() => setSelectedId(s.id)}>
                  <CardContent className="pt-4">
                    <div className="flex items-start justify-between">
                      <div>
                        <p className="font-medium">{s.title}</p>
                        <div className="flex items-center gap-2 mt-1">
                          <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusColors[s.status]}`}>
                            {s.status.replace(/_/g, " ")}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {s.evaluationCount}/{s.expectedEvaluations} evaluated
                          </span>
                        </div>
                        {s.scoreVariance != null && (
                          <div className="flex items-center gap-1 mt-1">
                            {s.scoreVariance > 2 ? (
                              <AlertTriangle className="w-3 h-3 text-red-500" />
                            ) : s.scoreVariance > 1 ? (
                              <AlertTriangle className="w-3 h-3 text-yellow-500" />
                            ) : (
                              <CheckCircle2 className="w-3 h-3 text-green-500" />
                            )}
                            <span className="text-xs text-muted-foreground">
                              Variance: {s.scoreVariance.toFixed(2)} | Avg: {s.avgScore?.toFixed(1) ?? "—"}
                            </span>
                          </div>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })
          )}
        </div>

        {/* Detail Panel */}
        <div className="lg:col-span-2 space-y-4">
          {detail ? (
            <>
              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <div>
                      <CardTitle>{detail.title}</CardTitle>
                      <CardDescription>
                        Facilitated by {detail.facilitatorName} | Call: {detail.call?.fileName || detail.callId.slice(0, 8)}
                        {detail.aiScore != null && ` | AI Score: ${detail.aiScore.toFixed(1)}`}
                      </CardDescription>
                    </div>
                    {detail.status !== "completed" && (
                      <Button size="sm" onClick={() => completeMutation.mutate({
                        id: detail.id,
                        targetScore: detail.avgScore ?? undefined,
                        consensusNotes: `Agreed upon score after calibration discussion.`,
                      })}>
                        <CheckCircle2 className="w-4 h-4 mr-1" /> Complete
                      </Button>
                    )}
                  </div>
                </CardHeader>
                <CardContent>
                  {/* Evaluation comparison */}
                  <div className="space-y-3">
                    {detail.evaluations.length === 0 ? (
                      <p className="text-sm text-muted-foreground text-center py-4">
                        No evaluations submitted yet. Evaluators can score this call below.
                      </p>
                    ) : (
                      detail.evaluations.map(ev => (
                        <div key={ev.id} className="flex items-center gap-4 p-3 rounded-lg border">
                          <div className="flex-1">
                            <p className="font-medium text-sm">{ev.evaluatorName}</p>
                            {ev.notes && <p className="text-xs text-muted-foreground mt-1">{ev.notes}</p>}
                          </div>
                          <div className="text-right">
                            <p className="text-2xl font-bold">{ev.performanceScore.toFixed(1)}</p>
                            {detail.targetScore != null && (
                              <p className={`text-xs ${Math.abs(ev.performanceScore - detail.targetScore) <= 1 ? "text-green-600" : "text-red-600"}`}>
                                {ev.performanceScore > detail.targetScore ? "+" : ""}
                                {(ev.performanceScore - detail.targetScore).toFixed(1)} from target
                              </p>
                            )}
                          </div>
                        </div>
                      ))
                    )}
                  </div>

                  {detail.targetScore != null && (
                    <div className="mt-4 p-3 bg-primary/5 rounded-lg">
                      <p className="text-sm font-medium">Consensus Score: {detail.targetScore.toFixed(1)}</p>
                      {detail.consensusNotes && (
                        <p className="text-xs text-muted-foreground mt-1">{detail.consensusNotes}</p>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Submit evaluation */}
              {detail.status !== "completed" && (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">Submit Your Evaluation</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div>
                      <Label>Performance Score: {evalScore.toFixed(1)}</Label>
                      <Slider value={[evalScore]} onValueChange={([v]) => setEvalScore(v)}
                        min={0} max={10} step={0.5} className="mt-2" />
                    </div>
                    <div>
                      <Label>Notes</Label>
                      <Textarea value={evalNotes} onChange={e => setEvalNotes(e.target.value)}
                        placeholder="Explain your scoring rationale..." rows={3} />
                    </div>
                    <Button onClick={() => evaluateMutation.mutate({
                      sessionId: detail.id, performanceScore: evalScore, notes: evalNotes,
                    })} disabled={evaluateMutation.isPending}>
                      Submit Evaluation
                    </Button>
                  </CardContent>
                </Card>
              )}
            </>
          ) : (
            <Card>
              <CardContent className="py-16 text-center text-muted-foreground">
                Select a calibration session from the list or create a new one
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
