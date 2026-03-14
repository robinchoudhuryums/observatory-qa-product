import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { Employee } from "@shared/schema";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { motion } from "framer-motion";
import { Link } from "wouter";

// Define a more robust type for a performer
type TopPerformer = Partial<Employee> & {
  score?: number | null;
  avgPerformanceScore?: number | null;
  totalCalls?: number | null;
};

export default function PerformanceCard() {
  const queryClient = useQueryClient();
  const { data: performers, isLoading, error } = useQuery<TopPerformer[]>({
    queryKey: ["/api/dashboard/performers"],
  });

  if (error) {
    return (
      <div className="modern-card rounded-xl border-destructive/30 p-6 text-center">
        <AlertTriangle className="w-6 h-6 text-destructive mx-auto mb-2" />
        <p className="text-sm font-medium text-destructive">Failed to load performers</p>
        <button
          onClick={() => queryClient.invalidateQueries({ queryKey: ["/api/dashboard/performers"] })}
          className="mt-2 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <RefreshCw className="w-3 h-3" /> Retry
        </button>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="modern-card rounded-xl p-6">
        <div className="animate-pulse">
          <div className="h-6 bg-muted rounded w-1/2 mb-4"></div>
          <div className="space-y-4">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="h-16 bg-muted rounded-lg"></div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  // A safer way to get the color for initials
  const getInitialsColor = (initials?: string | null) => {
    const colors = [
      'bg-teal-100 text-teal-600 dark:bg-teal-900/30 dark:text-teal-400',
      'bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400',
      'bg-purple-100 text-purple-600 dark:bg-purple-900/30 dark:text-purple-400',
      'bg-cyan-100 text-cyan-600 dark:bg-cyan-900/30 dark:text-cyan-400',
    ];
    // Safety check: if initials are missing, return a default color
    if (!initials) {
      return colors[0];
    }
    return colors[initials.charCodeAt(0) % colors.length];
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: "easeOut", delay: 0.1 }}
      className="modern-card rounded-xl p-6"
      data-testid="performance-card"
    >
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-foreground">Top Performers</h3>
        <Link href="/performance" className="text-sm font-medium hover:underline" style={{ color: "hsl(var(--brand-from))" }} data-testid="view-all-performers">
          View All
        </Link>
      </div>
      
      <div className="space-y-4">
        {/* Add a filter to remove any invalid performer data before rendering */}
        {performers?.filter(p => p && p.id && p.name).map((employee, index) => (
          <motion.div
            key={employee.id}
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: index * 0.06, duration: 0.3, ease: "easeOut" }}
            className="flex items-center justify-between p-3 bg-muted/50 rounded-xl transition-colors hover:bg-muted"
          >
            <div className="flex items-center space-x-3">
              <div className={`w-10 h-10 rounded-full flex items-center justify-center ${getInitialsColor(employee.initials)}`}>
                <span className="font-semibold text-sm">{employee.initials ?? 'N/A'}</span>
              </div>
              <div>
                <p className="font-medium text-foreground" data-testid={`performer-name-${index}`}>
                  {employee.name ?? 'Unknown Employee'}
                </p>
                <p className="text-sm text-muted-foreground">{employee.role ?? 'No role'}</p>
              </div>
            </div>
            <div className="text-right">
              <p className="font-bold text-green-600" data-testid={`performer-score-${index}`}>
                {Number(employee.score ?? employee.avgPerformanceScore ?? 0).toFixed(1) || 'N/A'}
              </p>
              <p className="text-xs text-muted-foreground">Score</p>
            </div>
          </motion.div>
        ))}

        {!performers?.length && (
          <div className="text-center py-8">
            <p className="text-muted-foreground">No performance data available yet</p>
          </div>
        )}
      </div>
    </motion.div>
  );
}
