import { useState, useEffect } from "react";
import { Link, useLocation } from "wouter";
import { Mic, BarChart3, Upload, FileText, Heart, Users, UserPlus, Search, LogOut, User, TrendingUp, Sun, Moon, Shield, Building2, SlidersHorizontal, ClipboardCheck, Palette, ScrollText } from "lucide-react";
import { cn } from "@/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient, getQueryFn } from "@/lib/queryClient";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { CallWithDetails, Employee, AccessRequest, AuthUser } from "@shared/schema";
import { useAppName, useOrganization } from "@/hooks/use-organization";

type NavItem = { name: string; href: string; icon: any; section?: string; requireRole?: string[] };

const navigation: NavItem[] = [
  { name: "Dashboard", href: "/", icon: BarChart3 },
  { name: "Upload Calls", href: "/upload", icon: Upload },
  { name: "Transcripts", href: "/transcripts", icon: FileText },
  { name: "Search", href: "/search", icon: Search },
  { name: "Sentiment", href: "/sentiment", icon: Heart, section: "Analytics" },
  { name: "Performance", href: "/performance", icon: Users },
  { name: "Reports", href: "/reports", icon: TrendingUp },
  { name: "Insights", href: "/insights", icon: Building2 },
  { name: "Employees", href: "/employees", icon: UserPlus, section: "Management" },
  { name: "Coaching", href: "/coaching", icon: ClipboardCheck, requireRole: ["manager", "admin"] },
];

export default function Sidebar() {
  const [location, navigate] = useLocation();
  const [isDark, setIsDark] = useState(() => document.documentElement.classList.contains("dark"));

  const toggleDarkMode = () => {
    const next = !isDark;
    setIsDark(next);
    document.documentElement.classList.toggle("dark", next);
    localStorage.setItem("theme", next ? "dark" : "light");
  };

  // Initialize dark mode from localStorage or system preference on mount
  useEffect(() => {
    const saved = localStorage.getItem("theme");
    if (saved) {
      const isDarkMode = saved === "dark";
      document.documentElement.classList.toggle("dark", isDarkMode);
      setIsDark(isDarkMode);
    } else {
      // Respect system preference when no explicit choice saved
      const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
      document.documentElement.classList.toggle("dark", prefersDark);
      setIsDark(prefersDark);
    }
  }, []);

  const appName = useAppName();
  const { data: orgData } = useOrganization();
  const logoUrl = orgData?.settings?.branding?.logoUrl;

  const { data: user } = useQuery<AuthUser>({
    queryKey: ["/api/auth/me"],
    queryFn: getQueryFn({ on401: "returnNull" }),
    staleTime: Infinity,
  });

  // Fetch calls for flagged count badge
  const { data: calls } = useQuery<CallWithDetails[]>({
    queryKey: ["/api/calls", { status: "", sentiment: "", employee: "" }],
    staleTime: 30000,
  });

  // Fetch employees for quick-switch
  const { data: employees } = useQuery<Employee[]>({
    queryKey: ["/api/employees"],
    staleTime: 60000,
  });

  // Fetch access requests for admin badge count
  const { data: accessRequests } = useQuery<AccessRequest[]>({
    queryKey: ["/api/access-requests"],
    staleTime: 60000,
    enabled: user?.role === "admin",
  });

  const pendingRequestCount = (accessRequests || []).filter(r => r.status === "pending").length;

  const flaggedCount = (calls || []).filter(c => {
    const flags = c.analysis?.flags;
    return Array.isArray(flags) && flags.some(f => f === "low_score" || f.startsWith("agent_misconduct"));
  }).length;

  const handleLogout = async () => {
    try {
      await apiRequest("POST", "/api/auth/logout");
      queryClient.clear();
      window.location.href = "/";
    } catch (e) {
      // Force reload on error
      window.location.href = "/";
    }
  };

  const handleQuickSwitch = (employeeId: string) => {
    navigate(`/reports?employee=${employeeId}`);
  };

  /** Helper to build admin nav link */
  const AdminLink = ({ href, icon: Icon, label, testId, badge }: {
    href: string; icon: any; label: string; testId: string;
    badge?: { count: number; activeColor: string; inactiveColor: string };
  }) => {
    const isActive = location === href;
    return (
      <Link
        href={href}
        className={cn(
          "flex items-center space-x-3 px-3 py-2 rounded-lg font-medium transition-all duration-200",
          isActive
            ? "sidebar-active-link text-white"
            : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
        )}
        data-testid={testId}
      >
        <Icon className="w-5 h-5" />
        <span>{label}</span>
        {badge && badge.count > 0 && (
          <span className={cn(
            "ml-auto flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full text-[10px] font-bold",
            isActive ? badge.activeColor : badge.inactiveColor
          )}>
            {badge.count}
          </span>
        )}
      </Link>
    );
  };

  return (
    <aside className="w-64 sidebar-container flex flex-col" data-testid="sidebar">
      {/* Brand header */}
      <div className="p-5 sidebar-header">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-3">
            {logoUrl ? (
              <img src={logoUrl} alt="Logo" className="w-9 h-9 rounded-xl object-contain" />
            ) : (
              <div className="w-9 h-9 bg-gradient-to-br from-teal-400 to-blue-500 rounded-xl flex items-center justify-center shadow-lg shadow-teal-500/20">
                <Mic className="text-white w-4 h-4" />
              </div>
            )}
            <div>
              <h1 className="font-bold text-lg text-foreground tracking-tight">{appName}</h1>
              <p className="text-[11px] text-muted-foreground font-medium">QA Dashboard</p>
            </div>
          </div>
          <button
            onClick={toggleDarkMode}
            className="p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-all duration-200"
            title={isDark ? "Switch to light mode" : "Switch to dark mode"}
          >
            {isDark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          </button>
        </div>
      </div>

      <nav className="flex-1 px-3 py-2 space-y-0.5 overflow-y-auto">
        {navigation.map((item) => {
          // Role-based visibility
          if (item.requireRole && (!user?.role || !item.requireRole.includes(user.role))) return null;

          const Icon = item.icon;
          const isActive = location === item.href || (item.href !== "/" && location.startsWith(item.href));
          const showBadge = item.name === "Dashboard" && flaggedCount > 0;

          return (
            <div key={item.name}>
              {item.section && (
                <div className="pt-4 pb-1.5 px-3">
                  <p className="text-[10px] uppercase font-semibold text-muted-foreground/70 tracking-widest">{item.section}</p>
                </div>
              )}
              <Link
                href={item.href}
                className={cn(
                  "flex items-center space-x-3 px-3 py-2 rounded-lg font-medium transition-all duration-200",
                  isActive
                    ? "sidebar-active-link text-white"
                    : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                )}
                data-testid={`nav-link-${item.name.toLowerCase().replace(/\s+/g, '-')}`}
              >
                <Icon className="w-5 h-5" />
                <span>{item.name}</span>
                {showBadge && (
                  <span className={cn(
                    "ml-auto flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full text-[10px] font-bold",
                    isActive
                      ? "bg-red-500 text-white"
                      : "bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-300"
                  )}>
                    {flaggedCount}
                  </span>
                )}
              </Link>
            </div>
          );
        })}

        {/* Admin-only links */}
        {user?.role === "admin" && (
          <>
            <div className="pt-4 pb-1.5 px-3">
              <p className="text-[10px] uppercase font-semibold text-muted-foreground/70 tracking-widest">Admin</p>
            </div>
            <AdminLink
              href="/admin"
              icon={Shield}
              label="Administration"
              testId="nav-link-admin"
              badge={{
                count: pendingRequestCount,
                activeColor: "bg-yellow-500 text-white",
                inactiveColor: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/50 dark:text-yellow-300",
              }}
            />
            <AdminLink href="/admin/templates" icon={SlidersHorizontal} label="Prompt Templates" testId="nav-link-templates" />
            <AdminLink href="/admin/settings" icon={Palette} label="Settings" testId="nav-link-settings" />
            <AdminLink href="/admin/audit-logs" icon={ScrollText} label="Audit Logs" testId="nav-link-audit-logs" />
          </>
        )}
      </nav>

      {/* Quick-switch Employee Selector */}
      {employees && employees.length > 0 && (
        <div className="px-4 pb-3">
          <p className="text-[10px] uppercase font-semibold text-muted-foreground/70 tracking-widest mb-1.5 px-1">Quick View Agent</p>
          <Select onValueChange={handleQuickSwitch}>
            <SelectTrigger className="h-8 text-xs rounded-lg">
              <SelectValue placeholder="Jump to agent profile..." />
            </SelectTrigger>
            <SelectContent>
              {employees.filter(e => e.status === "Active").map(emp => (
                <SelectItem key={emp.id} value={emp.id}>
                  <span className="flex items-center gap-1.5">
                    <span className="w-4 h-4 rounded-full bg-gradient-to-br from-teal-400/20 to-blue-500/20 text-teal-600 dark:text-teal-400 text-[8px] font-bold flex items-center justify-center shrink-0">
                      {emp.initials || emp.name?.slice(0, 2).toUpperCase()}
                    </span>
                    {emp.name}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {/* User footer */}
      <div className="p-4 sidebar-footer">
        <div className="flex items-center space-x-3">
          <div className="w-8 h-8 bg-gradient-to-br from-teal-400/20 to-blue-500/20 rounded-full flex items-center justify-center">
            <User className="text-teal-600 dark:text-teal-400 w-4 h-4" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-medium text-sm text-foreground truncate">{user?.name || "User"}</p>
            <p className="text-xs text-muted-foreground capitalize">{user?.role || "viewer"}</p>
          </div>
          <button
            className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-all duration-200"
            onClick={handleLogout}
            title="Sign out"
            data-testid="logout-button"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </div>
    </aside>
  );
}
