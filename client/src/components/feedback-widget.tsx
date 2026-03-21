import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useToast } from "@/hooks/use-toast";
import { MessageSquarePlus, Star } from "lucide-react";
import { useLocation } from "wouter";
import { FEEDBACK_TYPES, FEEDBACK_CONTEXTS } from "@shared/schema";

/**
 * Floating feedback widget accessible from any page.
 * Allows users to submit ratings, bug reports, and suggestions.
 */
export function FeedbackWidget() {
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<string>("feature_rating");
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState("");
  const [location] = useLocation();
  const { toast } = useToast();

  // Map current page to feedback context
  const getContext = (): string => {
    if (location.includes("/clinical")) return "clinical";
    if (location.includes("/transcripts")) return "transcripts";
    if (location.includes("/upload")) return "upload";
    if (location.includes("/coaching")) return "coaching";
    if (location.includes("/search")) return "search";
    if (location.includes("/reports")) return "reports";
    if (location.includes("/insights")) return "insights";
    if (location.includes("/dashboard") || location === "/") return "dashboard";
    if (location.includes("/ab-testing")) return "ab_testing";
    if (location.includes("/spend")) return "spend_tracking";
    return "general";
  };

  const submitMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type,
          context: getContext(),
          rating: rating > 0 ? rating : undefined,
          comment: comment || undefined,
          page: location,
        }),
      });
      if (!res.ok) throw new Error("Failed to submit feedback");
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Thank you for your feedback!" });
      setOpen(false);
      setRating(0);
      setComment("");
      setType("feature_rating");
    },
  });

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          size="sm"
          variant="outline"
          className="fixed bottom-4 right-4 z-50 rounded-full shadow-lg gap-1.5"
        >
          <MessageSquarePlus className="w-4 h-4" />
          Feedback
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80" side="top" align="end">
        <div className="space-y-3">
          <p className="font-medium text-sm">Share your feedback</p>

          <Select value={type} onValueChange={setType}>
            <SelectTrigger className="h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="feature_rating">Rate this feature</SelectItem>
              <SelectItem value="bug_report">Report a bug</SelectItem>
              <SelectItem value="suggestion">Suggestion</SelectItem>
              <SelectItem value="nps">Overall satisfaction (NPS)</SelectItem>
              <SelectItem value="general">General feedback</SelectItem>
            </SelectContent>
          </Select>

          {(type === "feature_rating" || type === "nps") && (
            <div>
              <p className="text-xs text-muted-foreground mb-1">
                {type === "nps" ? "How likely are you to recommend Observatory? (0-10)" : "Rate this feature (1-10)"}
              </p>
              <div className="flex gap-1">
                {Array.from({ length: 10 }, (_, i) => i + 1).map(n => (
                  <button
                    key={n}
                    onClick={() => setRating(n)}
                    className={`w-7 h-7 rounded text-xs font-medium transition-colors ${
                      n <= rating ? "bg-primary text-primary-foreground" : "bg-muted hover:bg-muted/80"
                    }`}
                  >
                    {n}
                  </button>
                ))}
              </div>
            </div>
          )}

          <Textarea
            value={comment}
            onChange={e => setComment(e.target.value)}
            placeholder={type === "bug_report" ? "Describe the issue..." : "Your thoughts..."}
            rows={3}
            className="text-sm"
          />

          <Button
            size="sm"
            className="w-full"
            onClick={() => submitMutation.mutate()}
            disabled={submitMutation.isPending || (!comment && rating === 0)}
          >
            {submitMutation.isPending ? "Submitting..." : "Submit Feedback"}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
