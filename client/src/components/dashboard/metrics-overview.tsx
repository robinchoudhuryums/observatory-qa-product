import { useQuery } from "@tanstack/react-query";
import { Phone, Heart, Clock, Star, AlertTriangle } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import type { DashboardMetrics } from "@shared/schema";

export default function MetricsOverview() {
  const { data: metrics, isLoading, error } = useQuery<DashboardMetrics>({
    queryKey: ["/api/dashboard/metrics"],
  });

  if (error) {
    return (
      <div className="bg-card rounded-lg border border-destructive/30 p-6 text-center">
        <AlertTriangle className="w-6 h-6 text-destructive mx-auto mb-2" />
        <p className="text-sm font-medium text-destructive">Failed to load metrics</p>
        <p className="text-xs text-muted-foreground">{error.message}</p>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="metric-card rounded-lg p-6">
            <div className="flex items-center justify-between">
              <div className="space-y-2">
                <Skeleton className="h-4 w-20" />
                <Skeleton className="h-8 w-16" />
                <Skeleton className="h-3 w-28" />
              </div>
              <Skeleton className="w-12 h-12 rounded-lg" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  const totalCalls = metrics?.totalCalls ?? 0;
  const metricCards = [
    {
      title: "Total Calls",
      value: totalCalls,
      change: `${totalCalls} analyzed`,
      icon: Phone,
      iconBg: "bg-gradient-to-br from-teal-500/20 to-blue-500/10 dark:from-teal-500/20 dark:to-blue-500/10",
      iconColor: "text-teal-600 dark:text-teal-400",
      glowClass: "metric-glow-teal",
    },
    {
      title: "Avg Sentiment",
      value: `${(metrics?.avgSentiment ?? 0).toFixed(1)}/10`,
      change: "Avg across calls",
      icon: Heart,
      iconBg: "bg-gradient-to-br from-emerald-500/20 to-green-500/10 dark:from-emerald-500/20 dark:to-green-500/10",
      iconColor: "text-emerald-600 dark:text-emerald-400",
      glowClass: "metric-glow-green",
    },
    {
      title: "Transcription Time",
      value: `${metrics?.avgTranscriptionTime ?? 0}min`,
      change: "Avg per call",
      icon: Clock,
      iconBg: "bg-gradient-to-br from-blue-500/20 to-indigo-500/10 dark:from-blue-500/20 dark:to-indigo-500/10",
      iconColor: "text-blue-600 dark:text-blue-400",
      glowClass: "metric-glow-blue",
    },
    {
      title: "Team Score",
      value: `${(metrics?.avgPerformanceScore ?? 0).toFixed(1)}/10`,
      change: "Avg performance",
      icon: Star,
      iconBg: "bg-gradient-to-br from-purple-500/20 to-pink-500/10 dark:from-purple-500/20 dark:to-pink-500/10",
      iconColor: "text-purple-600 dark:text-purple-400",
      glowClass: "metric-glow-purple",
    },
  ];

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6" data-testid="metrics-overview">
      {metricCards.map((metric) => {
        const Icon = metric.icon;
        return (
          <div key={metric.title} className={`metric-card rounded-xl p-6 ${metric.glowClass}`}>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-muted-foreground text-sm font-medium">{metric.title}</p>
                <p className="text-3xl font-bold text-foreground mt-1" data-testid={`metric-${metric.title.toLowerCase().replace(/\s+/g, '-')}`}>
                  {metric.value}
                </p>
                <p className="text-xs mt-1.5 text-muted-foreground">
                  {metric.change}
                </p>
              </div>
              <div className={`w-12 h-12 ${metric.iconBg} rounded-xl flex items-center justify-center`}>
                <Icon className={`${metric.iconColor} w-5 h-5`} />
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
