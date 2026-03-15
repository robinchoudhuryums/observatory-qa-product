import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, ChevronRight, ChevronLeft, Upload, BarChart3, Search, Users, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ObservatoryLogo } from "@/components/observatory-logo";

interface TourStep {
  title: string;
  description: string;
  icon: React.ReactNode;
  target?: string; // CSS selector for highlight (optional)
  position: "center" | "top-right" | "bottom-left";
}

const TOUR_STEPS: TourStep[] = [
  {
    title: "Welcome to your QA Dashboard",
    description: "This is your command center for call quality analysis. Let's take a quick tour of the key features.",
    icon: <ObservatoryLogo variant="icon" height={24} color="white" />,
    position: "center",
  },
  {
    title: "Upload Call Recordings",
    description: "Drag and drop audio files to automatically transcribe, analyze sentiment, and score agent performance. Processing takes 1-3 minutes per call.",
    icon: <Upload className="w-6 h-6" />,
    target: "[data-testid='upload-call-button']",
    position: "top-right",
  },
  {
    title: "Track Performance Metrics",
    description: "Your dashboard shows real-time KPIs: total calls, average sentiment, team score, and transcription time. These update automatically as calls are processed.",
    icon: <BarChart3 className="w-6 h-6" />,
    position: "center",
  },
  {
    title: "Search & Filter Calls",
    description: "Use the search bar to find specific calls by keyword, agent name, or topic. Filter by sentiment, status, or employee to narrow results.",
    icon: <Search className="w-6 h-6" />,
    target: "[data-testid='search-input']",
    position: "top-right",
  },
  {
    title: "Manage Your Team",
    description: "Add employees to auto-assign calls to agents. The AI detects agent names from transcripts and links them to your roster.",
    icon: <Users className="w-6 h-6" />,
    position: "center",
  },
  {
    title: "Generate Reports & Insights",
    description: "View performance reports by employee, department, or time period. Export to CSV or download detailed text reports with AI-generated summaries.",
    icon: <FileText className="w-6 h-6" />,
    position: "center",
  },
];

const STORAGE_KEY = "observatory-tour-completed";

export default function OnboardingTour() {
  const [step, setStep] = useState(0);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    // Only show tour if user hasn't completed it
    const completed = localStorage.getItem(STORAGE_KEY);
    if (completed) return;

    // Small delay so the dashboard renders first
    const timer = setTimeout(() => setVisible(true), 1500);
    return () => clearTimeout(timer);
  }, []);

  const dismiss = useCallback(() => {
    setVisible(false);
    localStorage.setItem(STORAGE_KEY, "true");
  }, []);

  const next = useCallback(() => {
    if (step < TOUR_STEPS.length - 1) {
      setStep(s => s + 1);
    } else {
      dismiss();
    }
  }, [step, dismiss]);

  const prev = useCallback(() => {
    if (step > 0) setStep(s => s - 1);
  }, [step]);

  // Keyboard navigation
  useEffect(() => {
    if (!visible) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") dismiss();
      if (e.key === "ArrowRight" || e.key === "Enter") next();
      if (e.key === "ArrowLeft") prev();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [visible, next, prev, dismiss]);

  if (!visible) return null;

  const currentStep = TOUR_STEPS[step];
  const isLast = step === TOUR_STEPS.length - 1;

  return (
    <AnimatePresence>
      {visible && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/60 z-[100]"
            onClick={dismiss}
          />

          {/* Tour card */}
          <motion.div
            key={step}
            initial={{ opacity: 0, y: 20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -20, scale: 0.95 }}
            transition={{ type: "spring", stiffness: 300, damping: 25 }}
            className="fixed z-[101] left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[90vw] max-w-md"
          >
            <div className="bg-card border border-border rounded-2xl shadow-2xl overflow-hidden">
              {/* Progress bar */}
              <div className="h-1 bg-muted">
                <motion.div
                  className="h-full bg-gradient-to-r from-primary to-primary/60"
                  initial={{ width: 0 }}
                  animate={{ width: `${((step + 1) / TOUR_STEPS.length) * 100}%` }}
                  transition={{ duration: 0.3 }}
                />
              </div>

              {/* Content */}
              <div className="p-6">
                {/* Close button */}
                <button
                  onClick={dismiss}
                  className="absolute top-4 right-4 text-muted-foreground hover:text-foreground transition-colors"
                  aria-label="Close tour"
                >
                  <X className="w-4 h-4" />
                </button>

                {/* Icon */}
                <motion.div
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  transition={{ delay: 0.1, type: "spring", stiffness: 400, damping: 20 }}
                  className="w-12 h-12 rounded-xl flex items-center justify-center mb-4"
                  style={{
                    background: "linear-gradient(135deg, hsl(var(--brand-from)), hsl(var(--brand-to)))",
                  }}
                >
                  <span className="text-white">{currentStep.icon}</span>
                </motion.div>

                {/* Step counter */}
                <p className="text-xs text-muted-foreground mb-1">
                  Step {step + 1} of {TOUR_STEPS.length}
                </p>

                {/* Title */}
                <h3 className="text-lg font-semibold text-foreground mb-2">
                  {currentStep.title}
                </h3>

                {/* Description */}
                <p className="text-sm text-muted-foreground leading-relaxed mb-6">
                  {currentStep.description}
                </p>

                {/* Navigation */}
                <div className="flex items-center justify-between">
                  <div className="flex gap-1.5">
                    {TOUR_STEPS.map((_, i) => (
                      <button
                        key={i}
                        onClick={() => setStep(i)}
                        className={`w-2 h-2 rounded-full transition-all duration-200 ${
                          i === step
                            ? "w-6 bg-primary"
                            : i < step
                            ? "bg-primary/40"
                            : "bg-muted-foreground/20"
                        }`}
                        aria-label={`Go to step ${i + 1}`}
                      />
                    ))}
                  </div>

                  <div className="flex items-center gap-2">
                    {step > 0 && (
                      <Button variant="ghost" size="sm" onClick={prev}>
                        <ChevronLeft className="w-4 h-4 mr-1" />
                        Back
                      </Button>
                    )}
                    {step === 0 && (
                      <Button variant="ghost" size="sm" onClick={dismiss} className="text-muted-foreground">
                        Skip tour
                      </Button>
                    )}
                    <Button size="sm" onClick={next}>
                      {isLast ? "Get Started" : "Next"}
                      {!isLast && <ChevronRight className="w-4 h-4 ml-1" />}
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
