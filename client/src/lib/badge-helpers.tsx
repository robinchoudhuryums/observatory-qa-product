import { Badge } from "@/components/ui/badge";

type BadgeVariant = "default" | "secondary" | "destructive" | "outline";

const sentimentVariants: Record<string, BadgeVariant> = {
  positive: "default",
  neutral: "secondary",
  negative: "destructive",
};

const statusColors: Record<string, string> = {
  completed: "bg-green-100 text-green-800",
  processing: "bg-blue-100 text-blue-800",
  failed: "bg-red-100 text-red-800",
};

export function getSentimentBadge(sentiment?: string) {
  if (!sentiment) return <Badge variant="secondary">Unknown</Badge>;
  return (
    <Badge variant={sentimentVariants[sentiment] || "secondary"}>
      {sentiment.charAt(0).toUpperCase() + sentiment.slice(1)}
    </Badge>
  );
}

export function getStatusBadge(status?: string) {
  if (!status) return <Badge variant="secondary">Unknown</Badge>;
  return (
    <Badge className={statusColors[status] || "bg-gray-100 text-gray-800"}>
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </Badge>
  );
}
