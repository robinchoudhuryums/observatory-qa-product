import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Palette, Users, Settings, Save, Plus, Trash2, Edit2,
  Eye, Shield, CheckCircle2, XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import type { Organization } from "@shared/schema";

type TabView = "branding" | "users" | "organization";

interface UserRecord {
  id: string;
  username: string;
  name: string;
  role: string;
  createdAt?: string;
}

export default function SettingsPage() {
  const [tab, setTab] = useState<TabView>("branding");
  const { toast } = useToast();
  const queryClient = useQueryClient();

  return (
    <div className="min-h-screen" data-testid="settings-page">
      <header className="bg-card border-b border-border px-6 py-4">
        <div>
          <h2 className="text-2xl font-bold text-foreground">Settings</h2>
          <p className="text-muted-foreground">Branding, user management, and organization configuration</p>
        </div>
      </header>

      <div className="p-6 space-y-6">
        <div className="flex gap-2">
          <Button variant={tab === "branding" ? "default" : "outline"} size="sm" onClick={() => setTab("branding")}>
            <Palette className="w-4 h-4 mr-2" />Branding
          </Button>
          <Button variant={tab === "users" ? "default" : "outline"} size="sm" onClick={() => setTab("users")}>
            <Users className="w-4 h-4 mr-2" />Users
          </Button>
          <Button variant={tab === "organization" ? "default" : "outline"} size="sm" onClick={() => setTab("organization")}>
            <Settings className="w-4 h-4 mr-2" />Organization
          </Button>
        </div>

        {tab === "branding" && <BrandingTab />}
        {tab === "users" && <UsersTab />}
        {tab === "organization" && <OrganizationTab />}
      </div>
    </div>
  );
}

// =============================================================================
// BRANDING TAB
// =============================================================================
function BrandingTab() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: org, isLoading } = useQuery<Organization>({ queryKey: ["/api/organization"] });

  const [appName, setAppName] = useState("");
  const [logoUrl, setLogoUrl] = useState("");
  const [primaryColor, setPrimaryColor] = useState("");
  const [initialized, setInitialized] = useState(false);

  // Initialize form from fetched org data
  if (org && !initialized) {
    setAppName(org.settings?.branding?.appName || "Observatory");
    setLogoUrl(org.settings?.branding?.logoUrl || "");
    setPrimaryColor((org.settings as any)?.branding?.primaryColor || "");
    setInitialized(true);
  }

  const mutation = useMutation({
    mutationFn: async (branding: { appName: string; logoUrl?: string; primaryColor?: string }) => {
      const res = await apiRequest("PATCH", "/api/organization/settings", { branding });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/organization"] });
      toast({ title: "Branding Updated", description: "Your branding changes have been saved." });
    },
    onError: (error) => {
      toast({ title: "Save Failed", description: error.message, variant: "destructive" });
    },
  });

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    mutation.mutate({
      appName: appName.trim() || "Observatory",
      logoUrl: logoUrl.trim() || undefined,
      primaryColor: primaryColor.trim() || undefined,
    });
  };

  if (isLoading) {
    return (
      <Card>
        <CardContent className="pt-6 space-y-4">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Palette className="w-5 h-5 text-primary" />
            White-Label Branding
          </CardTitle>
          <CardDescription>
            Customize the platform appearance for your organization. Changes apply to all users in your org.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSave} className="space-y-5">
            <div>
              <label className="text-sm font-medium text-foreground">Application Name</label>
              <Input
                value={appName}
                onChange={(e) => setAppName(e.target.value)}
                placeholder="Observatory"
              />
              <p className="text-xs text-muted-foreground mt-1">
                Displayed in the sidebar, login page, and report headers.
              </p>
            </div>

            <div>
              <label className="text-sm font-medium text-foreground">Logo URL</label>
              <Input
                value={logoUrl}
                onChange={(e) => setLogoUrl(e.target.value)}
                placeholder="https://example.com/logo.png"
                type="url"
              />
              <p className="text-xs text-muted-foreground mt-1">
                Optional. Square image recommended (32x32px or larger). Replaces the default icon in the sidebar.
              </p>
            </div>

            <div>
              <label className="text-sm font-medium text-foreground">Primary Color</label>
              <div className="flex gap-3 items-center">
                <input
                  type="color"
                  value={primaryColor || "#3b82f6"}
                  onChange={(e) => setPrimaryColor(e.target.value)}
                  className="w-10 h-10 rounded border border-border cursor-pointer"
                />
                <Input
                  value={primaryColor}
                  onChange={(e) => setPrimaryColor(e.target.value)}
                  placeholder="#3b82f6"
                  className="flex-1"
                />
                {primaryColor && (
                  <Button type="button" variant="ghost" size="sm" onClick={() => setPrimaryColor("")}>
                    Reset
                  </Button>
                )}
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Override the default blue theme color. Used for buttons, active nav items, and accents.
              </p>
            </div>

            {/* Live Preview */}
            <div className="border border-border rounded-lg p-4 bg-muted/30">
              <p className="text-xs font-semibold text-muted-foreground mb-3 uppercase tracking-wider">Preview</p>
              <div className="flex items-center space-x-3">
                {logoUrl ? (
                  <img src={logoUrl} alt="Logo" className="w-8 h-8 rounded-lg object-contain" />
                ) : (
                  <div
                    className="w-8 h-8 rounded-lg flex items-center justify-center"
                    style={{ backgroundColor: primaryColor || "hsl(217, 91%, 60%)" }}
                  >
                    <span className="text-white text-xs font-bold">
                      {(appName || "O").charAt(0).toUpperCase()}
                    </span>
                  </div>
                )}
                <div>
                  <p className="font-bold text-lg text-foreground">{appName || "Observatory"}</p>
                  <p className="text-xs text-muted-foreground">QA Dashboard</p>
                </div>
              </div>
            </div>

            <Button type="submit" disabled={mutation.isPending}>
              <Save className="w-4 h-4 mr-2" />
              {mutation.isPending ? "Saving..." : "Save Branding"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

// =============================================================================
// USERS TAB
// =============================================================================
function UsersTab() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: users, isLoading } = useQuery<UserRecord[]>({ queryKey: ["/api/users"] });

  const [showCreate, setShowCreate] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  // Create form state
  const [newUsername, setNewUsername] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newName, setNewName] = useState("");
  const [newRole, setNewRole] = useState("viewer");

  // Edit form state
  const [editName, setEditName] = useState("");
  const [editRole, setEditRole] = useState("");
  const [editPassword, setEditPassword] = useState("");

  const createMutation = useMutation({
    mutationFn: async (data: { username: string; password: string; name: string; role: string }) => {
      const res = await apiRequest("POST", "/api/users", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
      toast({ title: "User Created", description: "New user account has been created." });
      setShowCreate(false);
      setNewUsername("");
      setNewPassword("");
      setNewName("");
      setNewRole("viewer");
    },
    onError: (error) => {
      toast({ title: "Create Failed", description: error.message, variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, ...data }: { id: string; name?: string; role?: string; password?: string }) => {
      const res = await apiRequest("PATCH", `/api/users/${id}`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
      toast({ title: "User Updated" });
      setEditingId(null);
    },
    onError: (error) => {
      toast({ title: "Update Failed", description: error.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/users/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
      toast({ title: "User Deleted" });
    },
    onError: (error) => {
      toast({ title: "Delete Failed", description: error.message, variant: "destructive" });
    },
  });

  const startEdit = (user: UserRecord) => {
    setEditingId(user.id);
    setEditName(user.name);
    setEditRole(user.role);
    setEditPassword("");
  };

  const handleUpdate = (id: string) => {
    const updates: Record<string, string> = {};
    if (editName) updates.name = editName;
    if (editRole) updates.role = editRole;
    if (editPassword) updates.password = editPassword;
    updateMutation.mutate({ id, ...updates });
  };

  const roleBadge = (role: string) => {
    const colors: Record<string, string> = {
      viewer: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
      manager: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400",
      admin: "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400",
    };
    const labels: Record<string, string> = { viewer: "Viewer", manager: "Manager", admin: "Admin" };
    return <Badge className={colors[role] || "bg-gray-100 text-gray-800"}>{labels[role] || role}</Badge>;
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-lg flex items-center gap-2">
                <Users className="w-5 h-5 text-primary" />
                User Management
              </CardTitle>
              <CardDescription>Create, edit, and manage user accounts for your organization.</CardDescription>
            </div>
            <Button size="sm" onClick={() => setShowCreate(!showCreate)}>
              <Plus className="w-4 h-4 mr-2" />Add User
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {/* Create User Form */}
          {showCreate && (
            <div className="border border-border rounded-lg p-4 mb-6 bg-muted/30">
              <h4 className="text-sm font-semibold text-foreground mb-3">Create New User</h4>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  createMutation.mutate({ username: newUsername, password: newPassword, name: newName, role: newRole });
                }}
                className="grid grid-cols-2 gap-4"
              >
                <div>
                  <label className="text-xs font-medium text-muted-foreground">Username</label>
                  <Input value={newUsername} onChange={(e) => setNewUsername(e.target.value)} placeholder="jdoe" required />
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground">Full Name</label>
                  <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Jane Doe" required />
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground">Password</label>
                  <Input
                    type="password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="Secure password"
                    required
                    minLength={6}
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground">Role</label>
                  <Select value={newRole} onValueChange={setNewRole}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="viewer">Viewer</SelectItem>
                      <SelectItem value="manager">Manager</SelectItem>
                      <SelectItem value="admin">Admin</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="col-span-2 flex gap-2">
                  <Button type="submit" size="sm" disabled={createMutation.isPending}>
                    {createMutation.isPending ? "Creating..." : "Create User"}
                  </Button>
                  <Button type="button" variant="ghost" size="sm" onClick={() => setShowCreate(false)}>Cancel</Button>
                </div>
              </form>
            </div>
          )}

          {/* Users List */}
          {isLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="flex items-center gap-3 py-3">
                  <Skeleton className="h-10 w-10 rounded-full" />
                  <div className="space-y-1.5 flex-1">
                    <Skeleton className="h-4 w-32" />
                    <Skeleton className="h-3 w-48" />
                  </div>
                </div>
              ))}
            </div>
          ) : !users || users.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <Users className="w-8 h-8 mx-auto mb-2 opacity-50" />
              <p>No users found. Create one above.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {users.map((user) => (
                <div key={user.id} className="flex items-center gap-4 p-3 rounded-lg border border-border hover:bg-muted/30 transition-colors">
                  <div className="w-10 h-10 bg-gradient-to-br from-primary/20 to-primary/5 rounded-full flex items-center justify-center shrink-0">
                    <span className="text-sm font-bold text-primary">
                      {user.name?.charAt(0).toUpperCase() || "U"}
                    </span>
                  </div>

                  {editingId === user.id ? (
                    <div className="flex-1 grid grid-cols-3 gap-3">
                      <Input value={editName} onChange={(e) => setEditName(e.target.value)} placeholder="Name" />
                      <Select value={editRole} onValueChange={setEditRole}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="viewer">Viewer</SelectItem>
                          <SelectItem value="manager">Manager</SelectItem>
                          <SelectItem value="admin">Admin</SelectItem>
                        </SelectContent>
                      </Select>
                      <Input
                        type="password"
                        value={editPassword}
                        onChange={(e) => setEditPassword(e.target.value)}
                        placeholder="New password (optional)"
                      />
                      <div className="col-span-3 flex gap-2">
                        <Button size="sm" onClick={() => handleUpdate(user.id)} disabled={updateMutation.isPending}>
                          Save
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setEditingId(null)}>Cancel</Button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="font-medium text-foreground">{user.name}</p>
                          {roleBadge(user.role)}
                        </div>
                        <p className="text-sm text-muted-foreground">{user.username}</p>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <Button variant="ghost" size="sm" onClick={() => startEdit(user)} title="Edit user">
                          <Edit2 className="w-4 h-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950/30"
                          onClick={() => {
                            if (confirm(`Delete user "${user.name}"? This cannot be undone.`)) {
                              deleteMutation.mutate(user.id);
                            }
                          }}
                          title="Delete user"
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    </>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// =============================================================================
// ORGANIZATION TAB
// =============================================================================
function OrganizationTab() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: org, isLoading } = useQuery<Organization>({ queryKey: ["/api/organization"] });

  const [emailDomain, setEmailDomain] = useState("");
  const [retentionDays, setRetentionDays] = useState("90");
  const [departments, setDepartments] = useState("");
  const [callCategories, setCallCategories] = useState("");
  const [maxCallsPerDay, setMaxCallsPerDay] = useState("");
  const [maxStorageMb, setMaxStorageMb] = useState("");
  const [initialized, setInitialized] = useState(false);

  if (org && !initialized) {
    setEmailDomain(org.settings?.emailDomain || "");
    setRetentionDays(String(org.settings?.retentionDays ?? 90));
    setDepartments((org.settings?.departments || []).join(", "));
    setCallCategories((org.settings?.callCategories || []).join(", "));
    setMaxCallsPerDay(org.settings?.maxCallsPerDay ? String(org.settings.maxCallsPerDay) : "");
    setMaxStorageMb(org.settings?.maxStorageMb ? String(org.settings.maxStorageMb) : "");
    setInitialized(true);
  }

  const mutation = useMutation({
    mutationFn: async (settings: Record<string, unknown>) => {
      const res = await apiRequest("PATCH", "/api/organization/settings", settings);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/organization"] });
      toast({ title: "Settings Saved" });
    },
    onError: (error) => {
      toast({ title: "Save Failed", description: error.message, variant: "destructive" });
    },
  });

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    const parsedDepartments = departments.split(",").map(s => s.trim()).filter(Boolean);
    const parsedCategories = callCategories.split(",").map(s => s.trim()).filter(Boolean);

    mutation.mutate({
      emailDomain: emailDomain.trim() || undefined,
      retentionDays: parseInt(retentionDays) || 90,
      departments: parsedDepartments.length > 0 ? parsedDepartments : undefined,
      callCategories: parsedCategories.length > 0 ? parsedCategories : undefined,
      maxCallsPerDay: maxCallsPerDay ? parseInt(maxCallsPerDay) : undefined,
      maxStorageMb: maxStorageMb ? parseInt(maxStorageMb) : undefined,
    });
  };

  if (isLoading) {
    return <Card><CardContent className="pt-6"><Skeleton className="h-40 w-full" /></CardContent></Card>;
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Settings className="w-5 h-5 text-primary" />
            Organization Configuration
          </CardTitle>
          <CardDescription>
            Configure organization-wide settings. Current org: <strong>{org?.name}</strong> ({org?.slug})
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSave} className="space-y-5">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium text-foreground">Email Domain</label>
                <Input value={emailDomain} onChange={(e) => setEmailDomain(e.target.value)} placeholder="company.com" />
                <p className="text-xs text-muted-foreground mt-1">Used for user email validation.</p>
              </div>
              <div>
                <label className="text-sm font-medium text-foreground">Data Retention (days)</label>
                <Input
                  type="number"
                  value={retentionDays}
                  onChange={(e) => setRetentionDays(e.target.value)}
                  min={7}
                  max={365}
                />
                <p className="text-xs text-muted-foreground mt-1">Calls older than this are auto-purged.</p>
              </div>
            </div>

            <div>
              <label className="text-sm font-medium text-foreground">Departments</label>
              <Input
                value={departments}
                onChange={(e) => setDepartments(e.target.value)}
                placeholder="Sales, Support, Billing"
              />
              <p className="text-xs text-muted-foreground mt-1">Comma-separated list of department names.</p>
            </div>

            <div>
              <label className="text-sm font-medium text-foreground">Call Categories</label>
              <Input
                value={callCategories}
                onChange={(e) => setCallCategories(e.target.value)}
                placeholder="inbound, outbound, internal"
              />
              <p className="text-xs text-muted-foreground mt-1">Custom categories for organizing calls.</p>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium text-foreground">Max Calls / Day</label>
                <Input
                  type="number"
                  value={maxCallsPerDay}
                  onChange={(e) => setMaxCallsPerDay(e.target.value)}
                  placeholder="Unlimited"
                  min={1}
                />
                <p className="text-xs text-muted-foreground mt-1">Daily upload quota.</p>
              </div>
              <div>
                <label className="text-sm font-medium text-foreground">Max Storage (MB)</label>
                <Input
                  type="number"
                  value={maxStorageMb}
                  onChange={(e) => setMaxStorageMb(e.target.value)}
                  placeholder="Unlimited"
                  min={100}
                />
                <p className="text-xs text-muted-foreground mt-1">Total storage limit for audio files.</p>
              </div>
            </div>

            <Button type="submit" disabled={mutation.isPending}>
              <Save className="w-4 h-4 mr-2" />
              {mutation.isPending ? "Saving..." : "Save Settings"}
            </Button>
          </form>
        </CardContent>
      </Card>

      {/* Org Info (read-only) */}
      <Card className="bg-muted/30 border-dashed">
        <CardContent className="pt-6">
          <h4 className="text-sm font-semibold text-foreground mb-2">Organization Info</h4>
          <div className="grid grid-cols-3 gap-4 text-sm">
            <div>
              <p className="text-muted-foreground">Name</p>
              <p className="font-medium">{org?.name}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Slug</p>
              <p className="font-mono">{org?.slug}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Status</p>
              <Badge variant={org?.status === "active" ? "default" : "secondary"}>
                {org?.status}
              </Badge>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
