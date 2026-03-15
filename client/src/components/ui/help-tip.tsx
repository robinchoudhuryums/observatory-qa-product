import { HelpCircle } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

interface HelpTipProps {
  text: string;
  side?: "top" | "right" | "bottom" | "left";
  className?: string;
}

/**
 * Inline help tooltip icon — hover to see contextual help text.
 * Usage: <HelpTip text="Explanation here" />
 */
export function HelpTip({ text, side = "top", className }: HelpTipProps) {
  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            className={`inline-flex items-center justify-center text-muted-foreground/50 hover:text-muted-foreground transition-colors ${className || ""}`}
            aria-label="Help"
          >
            <HelpCircle className="w-3.5 h-3.5" />
          </button>
        </TooltipTrigger>
        <TooltipContent side={side} className="max-w-[260px] text-xs leading-relaxed">
          {text}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
