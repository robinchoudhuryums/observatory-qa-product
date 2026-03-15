import { useMemo } from "react";
import { Search, Plus, AlertTriangle, Award, TrendingUp, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Link, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";
import MetricsOverview from "@/components/dashboard/metrics-overview";
import SentimentAnalysis from "@/components/dashboard/sentiment-analysis";
import PerformanceCard from "@/components/dashboard/performance-card";
import FileUpload from "@/components/upload/file-upload";
import CallsTable from "@/components/tables/calls-table";
import type { CallWithDetails, PlanTier } from "@shared/schema";
import { PLAN_DEFINITIONS } from "@shared/schema";
import { getQueryFn } from "@/lib/queryClient";
import OnboardingTour from "@/components/onboarding-tour";

export default function Dashboard() {
  const [, navigate] = useLocation();

  // Fetch recent calls to extract flagged ones for the dashboard alert panel
  const { data: calls, error: callsError } = useQuery<CallWithDetails[]>({
    queryKey: ["/api/calls", { status: "", sentiment: "", employee: "" }],
  });

  // Fetch billing/subscription for quota alerts
  const { data: billing } = useQuery<{
    subscription: { planTier: string; status: string };
    plan: { name: string; limits: { callsPerMonth: number; aiAnalysesPerMonth: number; storageMb: number } };
    usage: { callsThisMonth: number; aiAnalysesThisMonth: number; storageMbUsed: number };
  }>({
    queryKey: ["/api/billing/subscription"],
    staleTime: 60000,
  });

  // Compute quota warnings (80%+ usage)
  const quotaWarnings = useMemo(() => {
    if (!billing?.plan || !billing?.usage) return [];
    const warnings: Array<{ label: string; used: number; limit: number; pct: number }> = [];
    const { limits } = billing.plan;
    const { callsThisMonth, aiAnalysesThisMonth, storageMbUsed } = billing.usage;

    const check = (label: string, used: number, limit: number) => {
      if (limit <= 0 || limit === -1) return; // unlimited
      const pct = Math.round((used / limit) * 100);
      if (pct >= 80) warnings.push({ label, used, limit, pct });
    };

    check("Calls", callsThisMonth, limits.callsPerMonth);
    check("AI Analyses", aiAnalysesThisMonth, limits.aiAnalysesPerMonth);
    check("Storage (MB)", storageMbUsed, limits.storageMb);
    return warnings;
  }, [billing]);

  const flaggedCalls = (calls || []).filter(c => {
    const flags = c.analysis?.flags;
    return Array.isArray(flags) && flags.length > 0 && flags.some(f =>
      f === "low_score" || f.startsWith("agent_misconduct") || f === "exceptional_call"
    );
  });

  const badCalls = flaggedCalls.filter(c => {
    const flags = c.analysis?.flags;
    return Array.isArray(flags) && flags.some(f => f === "low_score" || f.startsWith("agent_misconduct"));
  });
  const goodCalls = flaggedCalls.filter(c => {
    const flags = c.analysis?.flags;
    return Array.isArray(flags) && flags.includes("exceptional_call");
  });

  // Compute daily trend data from calls for the last 30 days
  const trendData = useMemo(() => {
    if (!calls || calls.length === 0) return [];
    const now = new Date();
    const thirtyDaysAgo = new Date(now);
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const dayMap = new Map<string, { calls: number; positive: number; neutral: number; negative: number; totalScore: number; scored: number }>();

    // Initialize last 30 days
    for (let i = 29; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      const key = d.toISOString().slice(5, 10); // MM-DD
      dayMap.set(key, { calls: 0, positive: 0, neutral: 0, negative: 0, totalScore: 0, scored: 0 });
    }

    for (const call of calls) {
      const date = new Date(call.uploadedAt || 0);
      if (date < thirtyDaysAgo) continue;
      const key = date.toISOString().slice(5, 10);
      const entry = dayMap.get(key);
      if (!entry) continue;
      entry.calls++;
      const sent = call.sentiment?.overallSentiment;
      if (sent === "positive") entry.positive++;
      else if (sent === "negative") entry.negative++;
      else if (sent === "neutral") entry.neutral++;
      if (call.analysis?.performanceScore) {
        entry.totalScore += parseFloat(call.analysis.performanceScore);
        entry.scored++;
      }
    }

    return Array.from(dayMap.entries()).map(([day, data]) => ({
      day,
      calls: data.calls,
      positive: data.positive,
      neutral: data.neutral,
      negative: data.negative,
      avgScore: data.scored > 0 ? Math.round((data.totalScore / data.scored) * 10) / 10 : null,
    }));
  }, [calls]);

  return (
    <div className="min-h-screen" data-testid="dashboard-page">
      <OnboardingTour />
      {callsError && (
        <div className="mx-6 mt-4 p-4 bg-destructive/10 border border-destructive/20 rounded-md text-destructive text-sm">
          Failed to load dashboard data. Please try refreshing the page.
        </div>
      )}
      {/* Header */}
      <header className="dashboard-header px-6 py-5">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <div>
            <h2 className="text-2xl font-bold text-foreground tracking-tight">Call Analysis Dashboard</h2>
            <p className="text-sm text-muted-foreground mt-0.5">Monitor performance and sentiment across all customer interactions</p>
          </div>
          <div className="flex items-center space-x-3 w-full sm:w-auto">
            <Button
              variant="outline"
              className="flex-1 sm:flex-none sm:w-64 justify-start text-muted-foreground rounded-lg"
              onClick={() => navigate("/search")}
              data-testid="search-input"
            >
              <Search className="w-4 h-4 mr-2" />
              Search calls...
            </Button>
            <Link href="/upload">
              <Button
                className="text-white border-0 shadow-md rounded-lg brand-gradient-btn whitespace-nowrap"
                data-testid="upload-call-button"
              >
                <Plus className="w-4 h-4 mr-2" />
                Upload Call
              </Button>
            </Link>
          </div>
        </div>
      </header>

      <div className="p-6 space-y-6">
        {/* Usage Quota Warning Banner */}
        {quotaWarnings.length > 0 && (() => {
          const anyExhausted = quotaWarnings.some(w => w.pct >= 100);
          const bgClass = anyExhausted
            ? "bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-900"
            : "bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-900";
          const iconColor = anyExhausted ? "text-red-500" : "text-amber-500";
          const titleColor = anyExhausted ? "text-red-700 dark:text-red-400" : "text-amber-700 dark:text-amber-400";
          const labelColor = anyExhausted ? "text-red-700 dark:text-red-300" : "text-amber-700 dark:text-amber-300";
          const footerColor = anyExhausted ? "text-red-600/80 dark:text-red-400/60" : "text-amber-600/80 dark:text-amber-400/60";

          return (
            <div className={`rounded-lg border p-4 ${bgClass}`}>
              <div className="flex items-center gap-2 mb-2">
                {anyExhausted ? <AlertTriangle className={`w-5 h-5 ${iconColor}`} /> : <Zap className={`w-5 h-5 ${iconColor}`} />}
                <h3 className={`font-semibold ${titleColor}`}>
                  {anyExhausted ? "Plan Limit Reached" : "Approaching Plan Limits"}
                </h3>
                <Badge variant="outline" className="text-xs ml-auto">
                  {billing?.plan?.name || "Free"} Plan
                </Badge>
              </div>
              <div className="space-y-2">
                {quotaWarnings.map(w => (
                  <div key={w.label} className="flex items-center gap-3">
                    <span className={`text-sm ${labelColor} min-w-[120px]`}>
                      {w.label}: {w.used}/{w.limit}
                    </span>
                    <div className="flex-1 h-2 bg-amber-200 dark:bg-amber-900 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full ${w.pct >= 100 ? "bg-red-500" : "bg-amber-500"}`}
                        style={{ width: `${Math.min(w.pct, 100)}%` }}
                      />
                    </div>
                    <span className={`text-xs font-semibold ${w.pct >= 100 ? "text-red-600 dark:text-red-400" : "text-amber-600 dark:text-amber-400"}`}>
                      {w.pct}%
                    </span>
                  </div>
                ))}
              </div>
              <div className={`flex items-center justify-between mt-3 ${anyExhausted ? "pt-3 border-t border-red-200 dark:border-red-900" : ""}`}>
                <p className={`text-xs ${footerColor}`}>
                  {anyExhausted
                    ? "You've hit your plan limit. Uploads and analyses are blocked until you upgrade or the next billing cycle."
                    : "You're approaching your plan limits for this billing period."}
                </p>
                <Link href="/admin/settings?tab=billing">
                  <Button
                    size="sm"
                    variant={anyExhausted ? "default" : "outline"}
                    className={anyExhausted ? "bg-red-600 hover:bg-red-700 text-white" : ""}
                  >
                    <Zap className="w-3.5 h-3.5 mr-1.5" />
                    Upgrade Plan
                  </Button>
                </Link>
              </div>
            </div>
          );
        })()}

        {/* Flagged Calls Alert Banner */}
        {flaggedCalls.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {badCalls.length > 0 && (
              <div className="bg-red-50 dark:bg-red-950/30 rounded-lg border border-red-200 dark:border-red-900 p-4">
                <div className="flex items-center gap-2 mb-2">
                  <AlertTriangle className="w-5 h-5 text-red-500" />
                  <h3 className="font-semibold text-red-700 dark:text-red-400">
                    {badCalls.length} Call{badCalls.length > 1 ? "s" : ""} Need Attention
                  </h3>
                </div>
                <p className="text-sm text-red-600/80 dark:text-red-400/80 mb-2">
                  Calls flagged for low scores or agent misconduct.
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {badCalls.slice(0, 5).map(c => (
                    <Link key={c.id} href={`/transcripts/${c.id}`}>
                      <Badge className="bg-red-200 text-red-900 text-xs cursor-pointer hover:bg-red-300">
                        {c.employee?.name || "Unassigned"} — {Number(c.analysis?.performanceScore || 0).toFixed(1)}
                      </Badge>
                    </Link>
                  ))}
                  {badCalls.length > 5 && (
                    <Link href="/reports">
                      <Badge variant="outline" className="text-xs cursor-pointer">+{badCalls.length - 5} more</Badge>
                    </Link>
                  )}
                </div>
              </div>
            )}
            {goodCalls.length > 0 && (
              <div className="bg-emerald-50 dark:bg-emerald-950/30 rounded-lg border border-emerald-200 dark:border-emerald-900 p-4">
                <div className="flex items-center gap-2 mb-2">
                  <Award className="w-5 h-5 text-emerald-500" />
                  <h3 className="font-semibold text-emerald-700 dark:text-emerald-400">
                    {goodCalls.length} Exceptional Call{goodCalls.length > 1 ? "s" : ""}
                  </h3>
                </div>
                <p className="text-sm text-emerald-600/80 dark:text-emerald-400/80 mb-2">
                  Calls where agents went above and beyond.
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {goodCalls.slice(0, 5).map(c => (
                    <Link key={c.id} href={`/transcripts/${c.id}`}>
                      <Badge className="bg-emerald-200 text-emerald-900 text-xs cursor-pointer hover:bg-emerald-300">
                        <Award className="w-3 h-3 mr-1" />
                        {c.employee?.name || "Unassigned"} — {Number(c.analysis?.performanceScore || 0).toFixed(1)}
                      </Badge>
                    </Link>
                  ))}
                  {goodCalls.length > 5 && (
                    <Link href="/reports">
                      <Badge variant="outline" className="text-xs cursor-pointer">+{goodCalls.length - 5} more</Badge>
                    </Link>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Metrics Overview */}
        <MetricsOverview />

        {/* Sentiment & Call Volume Trend (Last 30 Days) */}
        {trendData.length > 0 && trendData.some(d => d.calls > 0) && (
          <div className="modern-card rounded-xl p-6">
            <h3 className="text-lg font-semibold text-foreground mb-4 flex items-center">
              <TrendingUp className="w-5 h-5 mr-2" style={{ color: "hsl(var(--brand-from))" }} />
              Sentiment &amp; Volume — Last 30 Days
            </h3>
            <ResponsiveContainer width="100%" height={250}>
              <AreaChart data={trendData}>
                <defs>
                  <linearGradient id="greenGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#22c55e" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#22c55e" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="grayGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#94a3b8" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#94a3b8" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="redGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#ef4444" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#ef4444" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="day" tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" interval="preserveStartEnd" />
                <YAxis tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
                <Tooltip contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", fontSize: 12 }} />
                <Legend />
                <Area type="monotone" dataKey="positive" name="Positive" stackId="sentiment" stroke="#22c55e" fill="url(#greenGrad)" animationDuration={1200} animationEasing="ease-out" />
                <Area type="monotone" dataKey="neutral" name="Neutral" stackId="sentiment" stroke="#94a3b8" fill="url(#grayGrad)" animationDuration={1200} animationEasing="ease-out" animationBegin={150} />
                <Area type="monotone" dataKey="negative" name="Negative" stackId="sentiment" stroke="#ef4444" fill="url(#redGrad)" animationDuration={1200} animationEasing="ease-out" animationBegin={300} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* File Upload Section */}
        <FileUpload />

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Sentiment Analysis */}
          <SentimentAnalysis />

          {/* Top Performers */}
          <PerformanceCard />
        </div>

        {/* Recent Calls Table */}
        <CallsTable />
      </div>
    </div>
  );
}
