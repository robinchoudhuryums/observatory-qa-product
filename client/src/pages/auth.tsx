import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { AudioWaveform, LogIn, UserPlus, Shield, Eye, Settings } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { USER_ROLES } from "@shared/schema";
import { useAppName } from "@/hooks/use-organization";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface AuthPageProps {
  onLogin: () => void;
  initialView?: AuthView;
}

type AuthView = "login" | "request-access" | "register";

export default function AuthPage({ onLogin, initialView }: AuthPageProps) {
  const [view, setView] = useState<AuthView>(initialView || "login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const { toast } = useToast();
  const appName = useAppName();

  // Request access form state
  const [requestName, setRequestName] = useState("");
  const [requestEmail, setRequestEmail] = useState("");
  const [requestReason, setRequestReason] = useState("");
  const [requestedRole, setRequestedRole] = useState("viewer");
  const [requestSubmitted, setRequestSubmitted] = useState(false);

  // Registration form state
  const [regOrgName, setRegOrgName] = useState("");
  const [regOrgSlug, setRegOrgSlug] = useState("");
  const [regName, setRegName] = useState("");
  const [regUsername, setRegUsername] = useState("");
  const [regPassword, setRegPassword] = useState("");

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);

    try {
      await apiRequest("POST", "/api/auth/login", { username, password });
      onLogin();
    } catch (error: any) {
      const message = error.message?.includes(":")
        ? error.message.split(": ").slice(1).join(": ")
        : error.message;
      toast({
        title: "Login Failed",
        description: message,
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleRequestAccess = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);

    try {
      await apiRequest("POST", "/api/access-requests", {
        name: requestName,
        email: requestEmail,
        reason: requestReason || undefined,
        requestedRole,
      });
      setRequestSubmitted(true);
      toast({
        title: "Request Submitted",
        description: "An administrator will review your access request.",
      });
    } catch (error: any) {
      toast({
        title: "Request Failed",
        description: error.message || "Could not submit access request.",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    try {
      await apiRequest("POST", "/api/auth/register", {
        orgName: regOrgName,
        orgSlug: regOrgSlug,
        username: regUsername,
        password: regPassword,
        name: regName,
      });
      toast({ title: "Organization Created", description: "Welcome! Redirecting to dashboard..." });
      onLogin();
    } catch (error: any) {
      const msg = error.message?.includes(":") ? error.message.split(": ").slice(1).join(": ") : error.message;
      toast({ title: "Registration Failed", description: msg, variant: "destructive" });
    } finally {
      setIsLoading(false);
    }
  };

  const roleIcons: Record<string, React.ReactNode> = {
    viewer: <Eye className="w-4 h-4 text-blue-500" />,
    manager: <Settings className="w-4 h-4 text-amber-500" />,
    admin: <Shield className="w-4 h-4 text-purple-500" />,
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="w-full max-w-md space-y-6">
        <Card>
          <CardHeader className="text-center">
            <div className="flex justify-center mb-4">
              <div className="w-12 h-12 bg-gradient-to-br from-primary/20 to-primary/5 rounded-lg flex items-center justify-center">
                <AudioWaveform className="w-6 h-6 text-primary" />
              </div>
            </div>
            <CardTitle className="text-2xl">{appName}</CardTitle>
            <CardDescription>
              {view === "login"
                ? "Sign in to access the call analysis dashboard"
                : view === "register"
                  ? "Create a new organization and admin account"
                  : requestSubmitted
                    ? "Your request has been submitted"
                    : "Request access to the platform"}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {/* Tab switcher */}
            <div className="flex rounded-lg bg-muted p-1 mb-6">
              <button
                className={`flex-1 py-2 px-3 rounded-md text-sm font-medium transition-colors ${
                  view === "login" ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"
                }`}
                onClick={() => setView("login")}
              >
                <LogIn className="w-4 h-4 inline mr-1.5 -mt-0.5" />
                Sign In
              </button>
              <button
                className={`flex-1 py-2 px-3 rounded-md text-sm font-medium transition-colors ${
                  view === "register" ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"
                }`}
                onClick={() => setView("register")}
              >
                <UserPlus className="w-4 h-4 inline mr-1.5 -mt-0.5" />
                Register
              </button>
            </div>

            {/* LOGIN FORM */}
            {view === "login" && (
              <form onSubmit={handleLogin} className="space-y-4">
                <div>
                  <label className="text-sm font-medium text-foreground" htmlFor="username">
                    Username
                  </label>
                  <Input
                    id="username"
                    type="text"
                    placeholder="username"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    required
                    autoComplete="username"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium text-foreground" htmlFor="password">
                    Password
                  </label>
                  <Input
                    id="password"
                    type="password"
                    placeholder="Enter password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    autoComplete="current-password"
                  />
                </div>
                <Button type="submit" className="w-full" disabled={isLoading}>
                  {isLoading ? (
                    <AudioWaveform className="w-4 h-4 mr-2 animate-spin" />
                  ) : (
                    <LogIn className="w-4 h-4 mr-2" />
                  )}
                  Sign In
                </Button>
                <GoogleLoginButton />
              </form>
            )}

            {/* REGISTER FORM */}
            {view === "register" && (
              <form onSubmit={handleRegister} className="space-y-4">
                <div>
                  <label className="text-sm font-medium text-foreground">Organization Name</label>
                  <Input
                    value={regOrgName}
                    onChange={(e) => {
                      setRegOrgName(e.target.value);
                      // Auto-generate slug from name
                      setRegOrgSlug(e.target.value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""));
                    }}
                    placeholder="Acme Healthcare"
                    required
                  />
                </div>
                <div>
                  <label className="text-sm font-medium text-foreground">Organization Slug</label>
                  <Input
                    value={regOrgSlug}
                    onChange={(e) => setRegOrgSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))}
                    placeholder="acme-healthcare"
                    required
                    pattern="^[a-z0-9-]+$"
                  />
                  <p className="text-xs text-muted-foreground mt-1">URL-safe identifier (lowercase, hyphens)</p>
                </div>
                <div>
                  <label className="text-sm font-medium text-foreground">Your Full Name</label>
                  <Input value={regName} onChange={(e) => setRegName(e.target.value)} placeholder="Jane Doe" required />
                </div>
                <div>
                  <label className="text-sm font-medium text-foreground">Username</label>
                  <Input value={regUsername} onChange={(e) => setRegUsername(e.target.value)} placeholder="jdoe" required autoComplete="username" />
                </div>
                <div>
                  <label className="text-sm font-medium text-foreground">Password</label>
                  <Input
                    type="password"
                    value={regPassword}
                    onChange={(e) => setRegPassword(e.target.value)}
                    placeholder="At least 8 characters"
                    required
                    minLength={8}
                    autoComplete="new-password"
                  />
                </div>
                <Button type="submit" className="w-full" disabled={isLoading}>
                  {isLoading ? (
                    <AudioWaveform className="w-4 h-4 mr-2 animate-spin" />
                  ) : (
                    <UserPlus className="w-4 h-4 mr-2" />
                  )}
                  Create Organization
                </Button>
                <p className="text-xs text-center text-muted-foreground">
                  Already have an account?{" "}
                  <button type="button" className="text-primary hover:underline" onClick={() => setView("login")}>
                    Sign in
                  </button>
                </p>
              </form>
            )}

            {/* REQUEST ACCESS FORM */}
            {view === "request-access" && !requestSubmitted && (
              <form onSubmit={handleRequestAccess} className="space-y-4">
                <div>
                  <label className="text-sm font-medium text-foreground" htmlFor="req-name">
                    Full Name
                  </label>
                  <Input
                    id="req-name"
                    type="text"
                    placeholder="Your full name"
                    value={requestName}
                    onChange={(e) => setRequestName(e.target.value)}
                    required
                  />
                </div>
                <div>
                  <label className="text-sm font-medium text-foreground" htmlFor="req-email">
                    Email Address
                  </label>
                  <Input
                    id="req-email"
                    type="email"
                    placeholder="you@company.com"
                    value={requestEmail}
                    onChange={(e) => setRequestEmail(e.target.value)}
                    required
                  />
                </div>
                <div>
                  <label className="text-sm font-medium text-foreground" htmlFor="req-role">
                    Requested Access Level
                  </label>
                  <Select value={requestedRole} onValueChange={setRequestedRole}>
                    <SelectTrigger id="req-role">
                      <SelectValue placeholder="Select role" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="viewer">Viewer — View dashboards & reports</SelectItem>
                      <SelectItem value="manager">Manager / QA — Edit & manage calls</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="text-sm font-medium text-foreground" htmlFor="req-reason">
                    Reason for Access <span className="text-muted-foreground">(optional)</span>
                  </label>
                  <Input
                    id="req-reason"
                    type="text"
                    placeholder="Why do you need access?"
                    value={requestReason}
                    onChange={(e) => setRequestReason(e.target.value)}
                  />
                </div>
                <Button type="submit" className="w-full" disabled={isLoading}>
                  {isLoading ? (
                    <AudioWaveform className="w-4 h-4 mr-2 animate-spin" />
                  ) : (
                    <UserPlus className="w-4 h-4 mr-2" />
                  )}
                  Submit Request
                </Button>
              </form>
            )}

            {/* REQUEST SUBMITTED CONFIRMATION */}
            {view === "request-access" && requestSubmitted && (
              <div className="text-center py-6">
                <div className="mx-auto w-14 h-14 bg-gradient-to-br from-green-100 to-green-50 dark:from-green-900/30 dark:to-green-900/10 rounded-full flex items-center justify-center mb-4">
                  <UserPlus className="w-7 h-7 text-green-600" />
                </div>
                <h3 className="font-semibold text-foreground mb-1">Request Submitted</h3>
                <p className="text-sm text-muted-foreground mb-4">
                  An administrator will review your request and set up your account. You'll be notified at <strong>{requestEmail}</strong>.
                </p>
                <Button variant="outline" onClick={() => { setView("login"); setRequestSubmitted(false); }}>
                  Back to Sign In
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Permission levels info card */}
        <Card className="bg-muted/50 border-dashed">
          <CardContent className="pt-6">
            <h4 className="text-sm font-semibold text-foreground mb-3">Permission Levels</h4>
            <div className="space-y-3">
              {USER_ROLES.map((role) => (
                <div key={role.value} className="flex items-start gap-3">
                  <div className="mt-0.5">{roleIcons[role.value]}</div>
                  <div>
                    <p className="text-sm font-medium text-foreground">{role.label}</p>
                    <p className="text-xs text-muted-foreground">{role.description}</p>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

/** Shows "Sign in with Google" button if Google OAuth is configured */
function GoogleLoginButton() {
  const { data: providers } = useQuery<{ google: boolean; local: boolean }>({
    queryKey: ["/api/auth/providers"],
    staleTime: 60000,
  });

  if (!providers?.google) return null;

  return (
    <>
      <div className="relative my-3">
        <div className="absolute inset-0 flex items-center">
          <span className="w-full border-t border-border" />
        </div>
        <div className="relative flex justify-center text-xs uppercase">
          <span className="bg-card px-2 text-muted-foreground">or</span>
        </div>
      </div>
      <Button
        type="button"
        variant="outline"
        className="w-full"
        onClick={() => { window.location.href = "/api/auth/google"; }}
      >
        <svg className="w-4 h-4 mr-2" viewBox="0 0 24 24">
          <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" />
          <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
          <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
          <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
        </svg>
        Sign in with Google
      </Button>
    </>
  );
}
