import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Palette, Users, Settings, Save, Plus, Trash2, Edit2,
  Eye, Shield, CheckCircle2, XCircle, Mail, Copy, Clock, Key, Ban,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import type { Organization, Invitation, ApiKey } from "@shared/schema";

type TabView = "branding" | "users" | "invitations" | "api-keys" | "organization";

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
          <Button variant={tab === "invitations" ? "default" : "outline"} size="sm" onClick={() => setTab("invitations")}>
            <Mail className="w-4 h-4 mr-2" />Invitations
          </Button>
          <Button variant={tab === "api-keys" ? "default" : "outline"} size="sm" onClick={() => setTab("api-keys")}>
            <Key className="w-4 h-4 mr-2" />API Keys
          </Button>
          <Button variant={tab === "organization" ? "default" : "outline"} size="sm" onClick={() => setTab("organization")}>
            <Settings className="w-4 h-4 mr-2" />Organization
          </Button>
        </div>

        {tab === "branding" && <BrandingTab />}
        {tab === "users" && <UsersTab />}
        {tab === "invitations" && <InvitationsTab />}
        {tab === "api-keys" && <ApiKeysTab />}
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
// INVITATIONS TAB
// =============================================================================
function InvitationsTab() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: invitations, isLoading } = useQuery<Invitation[]>({ queryKey: ["/api/invitations"] });

  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("viewer");

  const createMutation = useMutation({
    mutationFn: async (data: { email: string; role: string }) => {
      const res = await apiRequest("POST", "/api/invitations", data);
      return res.json();
    },
    onSuccess: (data: Invitation) => {
      queryClient.invalidateQueries({ queryKey: ["/api/invitations"] });
      toast({ title: "Invitation Sent", description: `Invitation created for ${data.email}` });
      setInviteEmail("");
      setInviteRole("viewer");
    },
    onError: (error) => {
      toast({ title: "Failed", description: error.message, variant: "destructive" });
    },
  });

  const revokeMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/invitations/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/invitations"] });
      toast({ title: "Invitation Revoked" });
    },
    onError: (error) => {
      toast({ title: "Failed", description: error.message, variant: "destructive" });
    },
  });

  const copyInviteLink = (token: string) => {
    const url = `${window.location.origin}?invite=${token}`;
    navigator.clipboard.writeText(url);
    toast({ title: "Link Copied", description: "Invitation link copied to clipboard." });
  };

  const statusBadge = (status: string) => {
    const colors: Record<string, string> = {
      pending: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400",
      accepted: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
      expired: "bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-400",
      revoked: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",
    };
    return <Badge className={colors[status] || ""}>{status}</Badge>;
  };

  const roleBadge = (role: string) => {
    const colors: Record<string, string> = {
      viewer: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
      manager: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400",
      admin: "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400",
    };
    return <Badge className={colors[role] || ""}>{role}</Badge>;
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Mail className="w-5 h-5 text-primary" />
            Team Invitations
          </CardTitle>
          <CardDescription>
            Invite team members by email. They'll receive a link to create their account and join your organization.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {/* Invite Form */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              createMutation.mutate({ email: inviteEmail, role: inviteRole });
            }}
            className="flex gap-3 mb-6"
          >
            <Input
              type="email"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              placeholder="colleague@company.com"
              required
              className="flex-1"
            />
            <Select value={inviteRole} onValueChange={setInviteRole}>
              <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="viewer">Viewer</SelectItem>
                <SelectItem value="manager">Manager</SelectItem>
                <SelectItem value="admin">Admin</SelectItem>
              </SelectContent>
            </Select>
            <Button type="submit" disabled={createMutation.isPending}>
              <Plus className="w-4 h-4 mr-2" />
              {createMutation.isPending ? "Sending..." : "Invite"}
            </Button>
          </form>

          {/* Invitations List */}
          {isLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 2 }).map((_, i) => (
                <Skeleton key={i} className="h-16 w-full" />
              ))}
            </div>
          ) : !invitations || invitations.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Mail className="w-8 h-8 mx-auto mb-2 opacity-50" />
              <p>No invitations sent yet.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {invitations.map((inv) => (
                <div key={inv.id} className="flex items-center gap-4 p-3 rounded-lg border border-border hover:bg-muted/30 transition-colors">
                  <div className="w-10 h-10 bg-gradient-to-br from-primary/20 to-primary/5 rounded-full flex items-center justify-center shrink-0">
                    <Mail className="w-4 h-4 text-primary" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="font-medium text-foreground truncate">{inv.email}</p>
                      {roleBadge(inv.role)}
                      {statusBadge(inv.status)}
                    </div>
                    <div className="flex items-center gap-3 text-xs text-muted-foreground mt-0.5">
                      <span>by {inv.invitedBy}</span>
                      {inv.createdAt && <span>{new Date(inv.createdAt).toLocaleDateString()}</span>}
                      {inv.expiresAt && inv.status === "pending" && (
                        <span className="flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          Expires {new Date(inv.expiresAt).toLocaleDateString()}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {inv.status === "pending" && (
                      <>
                        <Button variant="ghost" size="sm" onClick={() => copyInviteLink(inv.token)} title="Copy invite link">
                          <Copy className="w-4 h-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-red-600 hover:text-red-700"
                          onClick={() => revokeMutation.mutate(inv.id)}
                          title="Revoke invitation"
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </>
                    )}
                  </div>
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
// API KEYS TAB
// =============================================================================
interface ApiKeyRecord {
  id: string;
  name: string;
  keyPrefix: string;
  permissions: string[];
  createdBy: string;
  status: string;
  expiresAt?: string;
  lastUsedAt?: string;
  createdAt?: string;
}

interface CreatedKeyResponse extends ApiKeyRecord {
  key: string; // Full key, only returned on creation
}

function ApiKeysTab() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: keys, isLoading } = useQuery<ApiKeyRecord[]>({ queryKey: ["/api/api-keys"] });

  const [showCreate, setShowCreate] = useState(false);
  const [keyName, setKeyName] = useState("");
  const [keyPerms, setKeyPerms] = useState<string[]>(["read"]);
  const [keyExpiryDays, setKeyExpiryDays] = useState("");
  const [newlyCreatedKey, setNewlyCreatedKey] = useState<string | null>(null);

  const createMutation = useMutation({
    mutationFn: async (data: { name: string; permissions: string[]; expiresInDays?: number }) => {
      const res = await apiRequest("POST", "/api/api-keys", data);
      return res.json() as Promise<CreatedKeyResponse>;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/api-keys"] });
      setNewlyCreatedKey(data.key);
      setKeyName("");
      setKeyPerms(["read"]);
      setKeyExpiryDays("");
    },
    onError: (error) => {
      toast({ title: "Failed", description: error.message, variant: "destructive" });
    },
  });

  const revokeMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("PATCH", `/api/api-keys/${id}/revoke`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/api-keys"] });
      toast({ title: "API Key Revoked" });
    },
    onError: (error) => {
      toast({ title: "Failed", description: error.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/api-keys/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/api-keys"] });
      toast({ title: "API Key Deleted" });
    },
  });

  const togglePerm = (perm: string) => {
    setKeyPerms(prev =>
      prev.includes(perm) ? prev.filter(p => p !== perm) : [...prev, perm]
    );
  };

  const copyKey = (key: string) => {
    navigator.clipboard.writeText(key);
    toast({ title: "Copied", description: "API key copied to clipboard." });
  };

  return (
    <div className="space-y-6">
      {/* Newly created key alert */}
      {newlyCreatedKey && (
        <Card className="border-green-300 dark:border-green-800 bg-green-50 dark:bg-green-950/30">
          <CardContent className="pt-6">
            <h4 className="text-sm font-semibold text-green-800 dark:text-green-400 mb-2">
              API Key Created — Copy it now!
            </h4>
            <p className="text-xs text-green-700 dark:text-green-500 mb-3">
              This key will not be shown again. Store it securely.
            </p>
            <div className="flex gap-2">
              <code className="flex-1 bg-white dark:bg-background border border-border rounded px-3 py-2 text-xs font-mono break-all">
                {newlyCreatedKey}
              </code>
              <Button size="sm" variant="outline" onClick={() => copyKey(newlyCreatedKey)}>
                <Copy className="w-4 h-4" />
              </Button>
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="mt-2"
              onClick={() => setNewlyCreatedKey(null)}
            >
              Dismiss
            </Button>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-lg flex items-center gap-2">
                <Key className="w-5 h-5 text-primary" />
                API Keys
              </CardTitle>
              <CardDescription>
                Create API keys for programmatic access. Use the header: <code className="text-xs">Authorization: Bearer obs_k_...</code>
              </CardDescription>
            </div>
            <Button size="sm" onClick={() => { setShowCreate(!showCreate); setNewlyCreatedKey(null); }}>
              <Plus className="w-4 h-4 mr-2" />New Key
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {/* Create Form */}
          {showCreate && (
            <div className="border border-border rounded-lg p-4 mb-6 bg-muted/30">
              <h4 className="text-sm font-semibold text-foreground mb-3">Create API Key</h4>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  createMutation.mutate({
                    name: keyName,
                    permissions: keyPerms,
                    expiresInDays: keyExpiryDays ? parseInt(keyExpiryDays) : undefined,
                  });
                }}
                className="space-y-4"
              >
                <div>
                  <label className="text-xs font-medium text-muted-foreground">Key Name</label>
                  <Input value={keyName} onChange={(e) => setKeyName(e.target.value)} placeholder="Production API" required />
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground">Permissions</label>
                  <div className="flex gap-2 mt-1">
                    {["read", "write", "admin"].map((perm) => (
                      <Button
                        key={perm}
                        type="button"
                        size="sm"
                        variant={keyPerms.includes(perm) ? "default" : "outline"}
                        onClick={() => togglePerm(perm)}
                      >
                        {perm}
                      </Button>
                    ))}
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    read = view data, write = upload/modify, admin = full access
                  </p>
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground">Expiry (days, optional)</label>
                  <Input
                    type="number"
                    value={keyExpiryDays}
                    onChange={(e) => setKeyExpiryDays(e.target.value)}
                    placeholder="Never expires"
                    min={1}
                    max={365}
                  />
                </div>
                <div className="flex gap-2">
                  <Button type="submit" size="sm" disabled={createMutation.isPending}>
                    {createMutation.isPending ? "Creating..." : "Create Key"}
                  </Button>
                  <Button type="button" variant="ghost" size="sm" onClick={() => setShowCreate(false)}>Cancel</Button>
                </div>
              </form>
            </div>
          )}

          {/* Keys List */}
          {isLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 2 }).map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}
            </div>
          ) : !keys || keys.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Key className="w-8 h-8 mx-auto mb-2 opacity-50" />
              <p>No API keys created yet.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {keys.map((k) => (
                <div key={k.id} className="flex items-center gap-4 p-3 rounded-lg border border-border hover:bg-muted/30 transition-colors">
                  <div className="w-10 h-10 bg-gradient-to-br from-primary/20 to-primary/5 rounded-full flex items-center justify-center shrink-0">
                    <Key className="w-4 h-4 text-primary" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="font-medium text-foreground">{k.name}</p>
                      <code className="text-xs text-muted-foreground font-mono">{k.keyPrefix}...</code>
                      <Badge className={k.status === "active"
                        ? "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400"
                        : "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400"
                      }>
                        {k.status}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-3 text-xs text-muted-foreground mt-0.5">
                      <span>{k.permissions.join(", ")}</span>
                      <span>by {k.createdBy}</span>
                      {k.lastUsedAt && <span>Last used: {new Date(k.lastUsedAt).toLocaleDateString()}</span>}
                      {k.expiresAt && (
                        <span className="flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          Expires {new Date(k.expiresAt).toLocaleDateString()}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {k.status === "active" && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-amber-600"
                        onClick={() => revokeMutation.mutate(k.id)}
                        title="Revoke key"
                      >
                        <Ban className="w-4 h-4" />
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-red-600"
                      onClick={() => {
                        if (confirm(`Delete API key "${k.name}"?`)) deleteMutation.mutate(k.id);
                      }}
                      title="Delete key"
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* OAuth Status Card */}
      <OAuthStatusCard />
    </div>
  );
}

function OAuthStatusCard() {
  const { data: providers } = useQuery<{ google: boolean; local: boolean }>({
    queryKey: ["/api/auth/providers"],
    staleTime: 60000,
  });

  return (
    <Card className="bg-muted/30 border-dashed">
      <CardContent className="pt-6">
        <h4 className="text-sm font-semibold text-foreground mb-3">Single Sign-On (SSO)</h4>
        <div className="space-y-2">
          <div className="flex items-center justify-between py-2">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded bg-white dark:bg-background border border-border flex items-center justify-center">
                <span className="text-sm font-bold">G</span>
              </div>
              <div>
                <p className="text-sm font-medium">Google OAuth</p>
                <p className="text-xs text-muted-foreground">Sign in with Google Workspace</p>
              </div>
            </div>
            <Badge className={providers?.google
              ? "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400"
              : "bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-400"
            }>
              {providers?.google ? "Configured" : "Not configured"}
            </Badge>
          </div>
          {!providers?.google && (
            <p className="text-xs text-muted-foreground">
              Set <code className="bg-muted px-1 rounded">GOOGLE_CLIENT_ID</code> and{" "}
              <code className="bg-muted px-1 rounded">GOOGLE_CLIENT_SECRET</code> environment variables to enable.
              Users with matching email domains will be auto-provisioned.
            </p>
          )}
        </div>
      </CardContent>
    </Card>
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
