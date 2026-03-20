import { useEffect, useState, lazy, Suspense } from "react";
import { Switch, Route, useLocation } from "wouter";
import { queryClient, getQueryFn } from "./lib/queryClient";
import { QueryClientProvider, useQuery } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import Sidebar from "@/components/layout/sidebar";
import { ErrorBoundary } from "@/components/lib/error-boundary";
import { BrandingProvider } from "@/components/branding-provider";
import { AudioWaveform } from "lucide-react";
import { useWebSocket } from "@/hooks/use-websocket";
import { AnimatePresence, motion } from "framer-motion";
import type { AuthUser } from "@shared/schema";
import { useToast } from "@/hooks/use-toast";

// Role hierarchy for route protection
const ROLE_LEVEL: Record<string, number> = { admin: 3, manager: 2, viewer: 1 };

function ProtectedRoute({ minRole, children }: { minRole: string; children: React.ReactNode }) {
  const { data: user } = useQuery<AuthUser>({
    queryKey: ["/api/auth/me"],
    staleTime: Infinity,
  });
  const userLevel = ROLE_LEVEL[user?.role || "viewer"] ?? 0;
  const requiredLevel = ROLE_LEVEL[minRole] ?? 0;
  if (userLevel < requiredLevel) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-muted-foreground">You don't have permission to access this page.</p>
      </div>
    );
  }
  return <>{children}</>;
}

// Route-level code splitting — each page loads on demand
const Dashboard = lazy(() => import("@/pages/dashboard"));
const Upload = lazy(() => import("@/pages/upload"));
const Transcripts = lazy(() => import("@/pages/transcripts"));
const PerformancePage = lazy(() => import("@/pages/performance"));
const SentimentPage = lazy(() => import("@/pages/sentiment"));
const ReportsPage = lazy(() => import("@/pages/reports"));
const SearchPage = lazy(() => import("@/pages/search"));
const EmployeesPage = lazy(() => import("@/pages/employees"));
const AdminPage = lazy(() => import("@/pages/admin"));
const PromptTemplatesPage = lazy(() => import("@/pages/prompt-templates"));
const InsightsPage = lazy(() => import("@/pages/insights"));
const CoachingPage = lazy(() => import("@/pages/coaching"));
const SettingsPage = lazy(() => import("@/pages/settings"));
const AuditLogsPage = lazy(() => import("@/pages/audit-logs"));
const OnboardingWizard = lazy(() => import("@/pages/onboarding"));
const AuthPage = lazy(() => import("@/pages/auth"));
const LandingPage = lazy(() => import("@/pages/landing"));
const InviteAcceptPage = lazy(() => import("@/pages/invite-accept"));
const ABTestingPage = lazy(() => import("@/pages/ab-testing"));
const SpendTrackingPage = lazy(() => import("@/pages/spend-tracking"));
const ClinicalDashboardPage = lazy(() => import("@/pages/clinical-dashboard"));
const ClinicalUploadPage = lazy(() => import("@/pages/clinical-upload"));
const ClinicalNotesPage = lazy(() => import("@/pages/clinical-notes"));
const ClinicalTemplatesPage = lazy(() => import("@/pages/clinical-templates"));
const NotFound = lazy(() => import("@/pages/not-found"));

function PageLoader() {
  return (
    <div className="flex items-center justify-center h-64">
      <AudioWaveform className="w-8 h-8 animate-spin text-primary" />
    </div>
  );
}

const pageTransition = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -8 },
  transition: { duration: 0.2, ease: "easeInOut" },
};

function AnimatedPage({ children }: { children: React.ReactNode }) {
  return (
    <motion.div {...pageTransition}>
      {children}
    </motion.div>
  );
}

const KEYBOARD_SHORTCUTS = [
  { key: "D", description: "Go to Dashboard" },
  { key: "K", description: "Go to Search" },
  { key: "N", description: "Upload new call" },
  { key: "R", description: "Go to Reports" },
  { key: "?", description: "Show this help" },
];

function ShortcutsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Keyboard Shortcuts</DialogTitle>
        </DialogHeader>
        <div className="space-y-2 mt-2">
          {KEYBOARD_SHORTCUTS.map(({ key, description }) => (
            <div key={key} className="flex items-center justify-between py-1.5">
              <span className="text-sm text-muted-foreground">{description}</span>
              <kbd className="px-2 py-1 text-xs font-mono bg-muted rounded border border-border">{key}</kbd>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Router() {
  const [location, navigate] = useLocation();
  const [showShortcuts, setShowShortcuts] = useState(false);

  // WebSocket listener for real-time notifications
  useWebSocket();

  // Redirect to onboarding wizard if not yet completed (admin only, one-time)
  const { data: orgData } = useQuery<{ settings?: { branding?: { onboardingCompleted?: boolean } } }>({
    queryKey: ["/api/organization"],
    staleTime: 5 * 60 * 1000,
  });
  useEffect(() => {
    if (
      orgData &&
      !orgData.settings?.branding?.onboardingCompleted &&
      location !== "/onboarding"
    ) {
      navigate("/onboarding");
    }
  }, [orgData, location, navigate]);

  // Global keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Ignore when typing in inputs/textareas
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      switch (e.key) {
        case "?":
          e.preventDefault();
          setShowShortcuts(prev => !prev);
          break;
        case "k":
        case "K":
          e.preventDefault();
          navigate("/search");
          break;
        case "n":
        case "N":
          e.preventDefault();
          navigate("/upload");
          break;
        case "d":
        case "D":
          e.preventDefault();
          navigate("/");
          break;
        case "r":
        case "R":
          e.preventDefault();
          navigate("/reports");
          break;
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [navigate]);

  return (
    <div className="flex h-screen">
      <BrandingProvider />
      <ShortcutsDialog open={showShortcuts} onOpenChange={setShowShortcuts} />
      <Sidebar />
      <main className="flex-1 overflow-auto pt-14 md:pt-0">
        <Suspense fallback={<PageLoader />}>
          <AnimatePresence mode="wait">
            <Switch key={location}>
              <Route path="/">{() => <ErrorBoundary><AnimatedPage><Dashboard /></AnimatedPage></ErrorBoundary>}</Route>
              <Route path="/upload">{() => <ErrorBoundary><AnimatedPage><Upload /></AnimatedPage></ErrorBoundary>}</Route>
              <Route path="/transcripts">{() => <ErrorBoundary><AnimatedPage><Transcripts /></AnimatedPage></ErrorBoundary>}</Route>
              <Route path="/transcripts/:id">{() => <ErrorBoundary><AnimatedPage><Transcripts /></AnimatedPage></ErrorBoundary>}</Route>
              <Route path="/search">{() => <ErrorBoundary><AnimatedPage><SearchPage /></AnimatedPage></ErrorBoundary>}</Route>
              <Route path="/performance">{() => <ErrorBoundary><AnimatedPage><PerformancePage /></AnimatedPage></ErrorBoundary>}</Route>
              <Route path="/sentiment">{() => <ErrorBoundary><AnimatedPage><SentimentPage /></AnimatedPage></ErrorBoundary>}</Route>
              <Route path="/reports">{() => <ErrorBoundary><AnimatedPage><ReportsPage /></AnimatedPage></ErrorBoundary>}</Route>
              <Route path="/employees">{() => <ErrorBoundary><AnimatedPage><EmployeesPage /></AnimatedPage></ErrorBoundary>}</Route>
              <Route path="/insights">{() => <ErrorBoundary><AnimatedPage><InsightsPage /></AnimatedPage></ErrorBoundary>}</Route>
              <Route path="/coaching">{() => <ErrorBoundary><AnimatedPage><ProtectedRoute minRole="manager"><CoachingPage /></ProtectedRoute></AnimatedPage></ErrorBoundary>}</Route>
              <Route path="/admin">{() => <ErrorBoundary><AnimatedPage><ProtectedRoute minRole="admin"><AdminPage /></ProtectedRoute></AnimatedPage></ErrorBoundary>}</Route>
              <Route path="/admin/templates">{() => <ErrorBoundary><AnimatedPage><ProtectedRoute minRole="admin"><PromptTemplatesPage /></ProtectedRoute></AnimatedPage></ErrorBoundary>}</Route>
              <Route path="/admin/settings">{() => <ErrorBoundary><AnimatedPage><ProtectedRoute minRole="admin"><SettingsPage /></ProtectedRoute></AnimatedPage></ErrorBoundary>}</Route>
              <Route path="/admin/audit-logs">{() => <ErrorBoundary><AnimatedPage><ProtectedRoute minRole="admin"><AuditLogsPage /></ProtectedRoute></AnimatedPage></ErrorBoundary>}</Route>
              <Route path="/admin/ab-testing">{() => <ErrorBoundary><AnimatedPage><ProtectedRoute minRole="admin"><ABTestingPage /></ProtectedRoute></AnimatedPage></ErrorBoundary>}</Route>
              <Route path="/admin/spend-tracking">{() => <ErrorBoundary><AnimatedPage><ProtectedRoute minRole="admin"><SpendTrackingPage /></ProtectedRoute></AnimatedPage></ErrorBoundary>}</Route>
              <Route path="/clinical">{() => <ErrorBoundary><AnimatedPage><ClinicalDashboardPage /></AnimatedPage></ErrorBoundary>}</Route>
              <Route path="/clinical/upload">{() => <ErrorBoundary><AnimatedPage><ClinicalUploadPage /></AnimatedPage></ErrorBoundary>}</Route>
              <Route path="/clinical/notes/:id">{() => <ErrorBoundary><AnimatedPage><ClinicalNotesPage /></AnimatedPage></ErrorBoundary>}</Route>
              <Route path="/clinical/templates">{() => <ErrorBoundary><AnimatedPage><ClinicalTemplatesPage /></AnimatedPage></ErrorBoundary>}</Route>
              <Route path="/onboarding">{() => <ErrorBoundary><OnboardingWizard /></ErrorBoundary>}</Route>
              <Route>{() => <AnimatedPage><NotFound /></AnimatedPage>}</Route>
            </Switch>
          </AnimatePresence>
        </Suspense>
      </main>
    </div>
  );
}

function AuthenticatedApp() {
  const [authView, setAuthView] = useState<"landing" | "login" | "register" | "invite" | null>(null);
  const { data: user, isLoading, error } = useQuery<AuthUser>({
    queryKey: ["/api/auth/me"],
    queryFn: getQueryFn({ on401: "returnNull" }),
    retry: false,
    staleTime: Infinity,
    refetchOnWindowFocus: true,
  });

  // Check for invite token in URL
  const urlParams = typeof window !== "undefined" ? new URLSearchParams(window.location.search) : null;
  const inviteToken = urlParams?.get("invite");

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <AudioWaveform className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  // Handle invite accept flow (even if user is already logged in, show invite accept)
  if (inviteToken && !user) {
    return (
      <Suspense fallback={<PageLoader />}>
        <InviteAcceptPage
          token={inviteToken}
          onComplete={() => {
            // Clear the invite param from URL
            window.history.replaceState({}, "", "/");
            queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
          }}
        />
      </Suspense>
    );
  }

  if (!user || error) {
    // Show landing page by default, or auth page if navigated
    const currentView = authView || "landing";

    if (currentView === "landing") {
      return (
        <Suspense fallback={<PageLoader />}>
          <LandingPage onNavigate={(v) => setAuthView(v)} />
        </Suspense>
      );
    }

    return (
      <Suspense fallback={<PageLoader />}>
        <AuthPage
          initialView={currentView === "register" ? "register" : "login"}
          onLogin={() => {
            queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
          }}
          onBack={() => setAuthView(null)}
        />
      </Suspense>
    );
  }

  return (
    <ErrorBoundary>
      <Router />
    </ErrorBoundary>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <AuthenticatedApp />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
