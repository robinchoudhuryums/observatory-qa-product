import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, getQueryFn } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  MessageSquare, ThumbsUp, Bug, Lightbulb, Star, BarChart3, TrendingUp,
} from "lucide-react";
import { FEEDBACK_TYPES, FEEDBACK_CONTEXTS, type Feedback } from "@shared/schema";

type FeedbackSummary = {
  totalFeedback: number;
  npsScore: number | null;
  npsResponses: number;
  avgFeatureRating: number | null;
  byType: Record<string, number>;
  byContext: Record<string, { count: number; avgRating: number | null }>;
  recentFeedback: Feedback[];
};

const typeIcons: Record<string, typeof MessageSquare> = {
  feature_rating: Star,
  bug_report: Bug,
  suggestion: Lightbulb,
  nps: BarChart3,
  general: MessageSquare,
};

const statusColors: Record<string, string> = {
  new: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  reviewed: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200",
  actioned: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  dismissed: "bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200",
};

export default function FeedbackPage() {
  const { toast } = useToast();

  const { data: summary } = useQuery<FeedbackSummary>({
    queryKey: ["/api/feedback/summary"],
    queryFn: getQueryFn({ on401: "returnNull" }),
  });

  const { data: allFeedback = [] } = useQuery<Feedback[]>({
    queryKey: ["/api/feedback"],
    queryFn: getQueryFn({ on401: "returnNull" }),
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, status, adminResponse }: { id: string; status?: string; adminResponse?: string }) => {
      const res = await fetch(`/api/feedback/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status, adminResponse }),
      });
      if (!res.ok) throw new Error("Failed to update feedback");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/feedback"] });
      queryClient.invalidateQueries({ queryKey: ["/api/feedback/summary"] });
      toast({ title: "Feedback updated" });
    },
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">User Feedback</h1>
        <p className="text-muted-foreground">Review and respond to user feedback across all tools</p>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Total Feedback</CardDescription>
            <CardTitle className="text-3xl">{summary?.totalFeedback ?? 0}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>NPS Score</CardDescription>
            <CardTitle className="text-3xl">
              {summary?.npsScore != null ? (
                <span className={summary.npsScore >= 50 ? "text-green-600" : summary.npsScore >= 0 ? "text-yellow-600" : "text-red-600"}>
                  {summary.npsScore}
                </span>
              ) : "—"}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground">{summary?.npsResponses ?? 0} responses</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Avg Feature Rating</CardDescription>
            <CardTitle className="text-3xl">
              {summary?.avgFeatureRating != null ? `${summary.avgFeatureRating}/10` : "—"}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Needs Review</CardDescription>
            <CardTitle className="text-3xl text-blue-600">
              {allFeedback.filter(f => f.status === "new").length}
            </CardTitle>
          </CardHeader>
        </Card>
      </div>

      {/* Feature Ratings by Context */}
      {summary?.byContext && Object.keys(summary.byContext).length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Satisfaction by Feature</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {Object.entries(summary.byContext)
                .sort((a, b) => b[1].count - a[1].count)
                .map(([ctx, data]) => (
                  <div key={ctx} className="p-3 rounded-lg border">
                    <p className="text-sm font-medium capitalize">{ctx.replace(/_/g, " ")}</p>
                    <p className="text-2xl font-bold">
                      {data.avgRating != null ? data.avgRating.toFixed(1) : "—"}
                    </p>
                    <p className="text-xs text-muted-foreground">{data.count} responses</p>
                  </div>
                ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Feedback List */}
      <Tabs defaultValue="all">
        <TabsList>
          <TabsTrigger value="all">All ({allFeedback.length})</TabsTrigger>
          <TabsTrigger value="new">New ({allFeedback.filter(f => f.status === "new").length})</TabsTrigger>
          <TabsTrigger value="bugs">Bugs ({allFeedback.filter(f => f.type === "bug_report").length})</TabsTrigger>
          <TabsTrigger value="suggestions">Suggestions ({allFeedback.filter(f => f.type === "suggestion").length})</TabsTrigger>
        </TabsList>

        {["all", "new", "bugs", "suggestions"].map(tab => (
          <TabsContent key={tab} value={tab} className="space-y-3">
            {allFeedback
              .filter(f => {
                if (tab === "new") return f.status === "new";
                if (tab === "bugs") return f.type === "bug_report";
                if (tab === "suggestions") return f.type === "suggestion";
                return true;
              })
              .map(f => {
                const Icon = typeIcons[f.type] || MessageSquare;
                return (
                  <Card key={f.id}>
                    <CardContent className="pt-4">
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex items-start gap-3 flex-1">
                          <Icon className="w-5 h-5 mt-0.5 text-muted-foreground" />
                          <div className="flex-1">
                            <div className="flex items-center gap-2 mb-1">
                              <Badge variant="outline" className="capitalize">{f.type.replace(/_/g, " ")}</Badge>
                              {f.context && <Badge variant="secondary" className="capitalize">{f.context.replace(/_/g, " ")}</Badge>}
                              <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusColors[f.status || "new"]}`}>
                                {f.status}
                              </span>
                              {f.rating != null && (
                                <span className="text-sm font-medium">{f.rating}/10</span>
                              )}
                            </div>
                            {f.comment && <p className="text-sm mt-1">{f.comment}</p>}
                            <p className="text-xs text-muted-foreground mt-1">
                              {f.createdAt ? new Date(f.createdAt).toLocaleDateString() : ""}
                            </p>
                          </div>
                        </div>
                        <div className="flex gap-1">
                          {f.status === "new" && (
                            <>
                              <Button size="sm" variant="outline" onClick={() => updateMutation.mutate({ id: f.id, status: "reviewed" })}>
                                Review
                              </Button>
                              <Button size="sm" variant="outline" onClick={() => updateMutation.mutate({ id: f.id, status: "actioned" })}>
                                Action
                              </Button>
                            </>
                          )}
                          {f.status !== "dismissed" && (
                            <Button size="sm" variant="ghost" onClick={() => updateMutation.mutate({ id: f.id, status: "dismissed" })}>
                              Dismiss
                            </Button>
                          )}
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}
