import { useQuery } from "@tanstack/react-query";
import { Phone, Heart, Clock, Star, AlertTriangle, Upload } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Link } from "wouter";
import { motion } from "framer-motion";
import { useCountUp } from "@/hooks/use-count-up";
import { HelpTip } from "@/components/ui/help-tip";
import type { DashboardMetrics } from "@shared/schema";

const cardVariants = {
  hidden: { opacity: 0, y: 16 },
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { delay: i * 0.08, duration: 0.35, ease: "easeOut" },
  }),
};

function CountUpValue({ value, decimals = 1, suffix = "" }: { value: number; decimals?: number; suffix?: string }) {
  const animated = useCountUp(value, 900);
  return <>{animated.toFixed(decimals)}{suffix}</>;
}

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
  const avgSentiment = metrics?.avgSentiment ?? 0;
  const avgTranscription = metrics?.avgTranscriptionTime ?? 0;
  const avgPerformance = metrics?.avgPerformanceScore ?? 0;

  if (totalCalls === 0) {
    return (
      <div className="modern-card rounded-xl p-8 text-center">
        <div className="mx-auto w-16 h-16 bg-gradient-to-br from-primary/20 to-primary/5 rounded-full flex items-center justify-center mb-4">
          <Phone className="w-7 h-7 text-primary/60" />
        </div>
        <h3 className="text-lg font-semibold text-foreground mb-1">No calls analyzed yet</h3>
        <p className="text-sm text-muted-foreground mb-4 max-w-md mx-auto">
          Upload your first call recording to see performance metrics, sentiment analysis, and AI-powered coaching insights.
        </p>
        <Link href="/upload">
          <Button>
            <Upload className="w-4 h-4 mr-2" />
            Upload Your First Call
          </Button>
        </Link>
      </div>
    );
  }

  const metricCards = [
    {
      title: "Total Calls",
      help: "Total number of call recordings that have been uploaded and analyzed.",
      renderValue: () => <CountUpValue value={totalCalls} decimals={0} />,
      change: `${totalCalls} analyzed`,
      icon: Phone,
      iconStyle: { background: "linear-gradient(135deg, hsla(var(--brand-from), 0.2), hsla(var(--brand-to), 0.1))" },
      iconColorStyle: { color: "hsl(var(--brand-from))" },
      glowClass: "metric-glow-brand",
    },
    {
      title: "Avg Sentiment",
      help: "Average customer sentiment score (0-10) across all analyzed calls. Higher is more positive.",
      renderValue: () => <><CountUpValue value={avgSentiment} />/10</>,
      change: "Avg across calls",
      icon: Heart,
      iconStyle: { background: "linear-gradient(135deg, rgba(16, 185, 129, 0.2), rgba(34, 197, 94, 0.1))" },
      iconColorStyle: { color: "rgb(16, 185, 129)" },
      glowClass: "metric-glow-green",
    },
    {
      title: "Transcription Time",
      help: "Average time to transcribe and analyze each call recording.",
      renderValue: () => <><CountUpValue value={avgTranscription} decimals={0} />min</>,
      change: "Avg per call",
      icon: Clock,
      iconStyle: { background: "linear-gradient(135deg, hsla(var(--brand-to), 0.2), hsla(var(--brand-to), 0.1))" },
      iconColorStyle: { color: "hsl(var(--brand-to))" },
      glowClass: "metric-glow-brand-alt",
    },
    {
      title: "Team Score",
      help: "Average AI-generated performance score (0-10) across all agents. Based on compliance, communication, and resolution.",
      renderValue: () => <><CountUpValue value={avgPerformance} />/10</>,
      change: "Avg performance",
      icon: Star,
      iconStyle: { background: "linear-gradient(135deg, rgba(168, 85, 247, 0.2), rgba(236, 72, 153, 0.1))" },
      iconColorStyle: { color: "rgb(168, 85, 247)" },
      glowClass: "metric-glow-purple",
    },
  ];

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6" data-testid="metrics-overview">
      {metricCards.map((metric, i) => {
        const Icon = metric.icon;
        return (
          <motion.div
            key={metric.title}
            custom={i}
            initial="hidden"
            animate="visible"
            variants={cardVariants}
            className={`metric-card rounded-xl p-6 ${metric.glowClass}`}
          >
            <div className="flex items-center justify-between">
              <div>
                <p className="text-muted-foreground text-sm font-medium flex items-center gap-1">
                  {metric.title}
                  <HelpTip text={metric.help} />
                </p>
                <p className="text-3xl font-bold text-foreground mt-1" data-testid={`metric-${metric.title.toLowerCase().replace(/\s+/g, '-')}`}>
                  {metric.renderValue()}
                </p>
                <p className="text-xs mt-1.5 text-muted-foreground">
                  {metric.change}
                </p>
              </div>
              <div className="w-12 h-12 rounded-xl flex items-center justify-center" style={metric.iconStyle}>
                <Icon className="w-5 h-5" style={metric.iconColorStyle} />
              </div>
            </div>
          </motion.div>
        );
      })}
    </div>
  );
}
