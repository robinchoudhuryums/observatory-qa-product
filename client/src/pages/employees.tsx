import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { UserPlus, Users, Upload, ChevronDown, ChevronRight } from "lucide-react";
import type { Employee } from "@shared/schema";

interface DepartmentGroup {
  department: string;
  employees: Employee[];
}

function groupByDepartment(employees: Employee[]): DepartmentGroup[] {
  const map = new Map<string, Employee[]>();
  for (const emp of employees) {
    const dept = emp.role || "Unassigned";
    if (!map.has(dept)) map.set(dept, []);
    map.get(dept)!.push(emp);
  }
  return Array.from(map.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([department, employees]) => ({ department, employees }));
}

export default function EmployeesPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("");
  const [status, setStatus] = useState("Active");
  const [collapsedDepts, setCollapsedDepts] = useState<Set<string>>(new Set());

  const { data: employees, isLoading } = useQuery<Employee[]>({
    queryKey: ["/api/employees"],
  });

  const departments = useMemo(() => {
    if (!employees) return [];
    return groupByDepartment(employees);
  }, [employees]);

  const toggleDept = (dept: string) => {
    setCollapsedDepts(prev => {
      const next = new Set(prev);
      if (next.has(dept)) next.delete(dept);
      else next.add(dept);
      return next;
    });
  };

  const createMutation = useMutation({
    mutationFn: async (data: { name: string; email: string; role?: string; initials?: string; status?: string }) => {
      const res = await apiRequest("POST", "/api/employees", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/employees"] });
      toast({ title: "Employee Added", description: "The employee has been added successfully." });
      resetForm();
      setOpen(false);
    },
    onError: (error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const importMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/employees/import-csv");
      return res.json();
    },
    onSuccess: (data: { message: string }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/employees"] });
      toast({ title: "Import Complete", description: data.message });
    },
    onError: (error) => {
      toast({ title: "Import Failed", description: error.message, variant: "destructive" });
    },
  });

  const resetForm = () => {
    setName("");
    setEmail("");
    setRole("");
    setStatus("Active");
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !email.trim()) {
      toast({ title: "Validation Error", description: "Name and email are required.", variant: "destructive" });
      return;
    }

    const nameParts = name.trim().split(/\s+/);
    const initials = nameParts.length >= 2
      ? (nameParts[0][0] + nameParts[nameParts.length - 1][0]).toUpperCase()
      : name.slice(0, 2).toUpperCase();

    createMutation.mutate({
      name: name.trim(),
      email: email.trim(),
      role: role.trim() || undefined,
      initials,
      status,
    });
  };

  const totalActive = employees?.filter(e => e.status === "Active").length || 0;

  return (
    <div className="min-h-screen" data-testid="employees-page">
      <header className="bg-card border-b border-border px-6 py-4 flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-foreground">Employees</h2>
          <p className="text-muted-foreground">
            {employees ? `${employees.length} total, ${totalActive} active` : "Manage employees for call assignment"}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => importMutation.mutate()} disabled={importMutation.isPending}>
            <Upload className="w-4 h-4 mr-2" />
            {importMutation.isPending ? "Importing..." : "Import from CSV"}
          </Button>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button>
                <UserPlus className="w-4 h-4 mr-2" />
                Add Employee
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Add New Employee</DialogTitle>
              </DialogHeader>
              <form onSubmit={handleSubmit} className="space-y-4 mt-2">
                <div>
                  <Label htmlFor="name">Full Name *</Label>
                  <Input id="name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Jane Smith" />
                </div>
                <div>
                  <Label htmlFor="email">Email *</Label>
                  <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="jane.smith@company.com" />
                </div>
                <div>
                  <Label htmlFor="role">Department / Role</Label>
                  <Input id="role" value={role} onChange={(e) => setRole(e.target.value)} placeholder="Billing, Intake - Power Mobility, etc." />
                </div>
                <div>
                  <Label htmlFor="status">Status</Label>
                  <Select value={status} onValueChange={setStatus}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Active">Active</SelectItem>
                      <SelectItem value="Inactive">Inactive</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <Button type="submit" className="w-full" disabled={createMutation.isPending}>
                  {createMutation.isPending ? "Adding..." : "Add Employee"}
                </Button>
              </form>
            </DialogContent>
          </Dialog>
        </div>
      </header>

      <div className="p-6">
        {isLoading ? (
          <p className="text-muted-foreground">Loading employees...</p>
        ) : !employees || employees.length === 0 ? (
          <div className="text-center py-12">
            <Users className="mx-auto h-12 w-12 text-muted-foreground" />
            <h3 className="mt-4 text-lg font-medium text-foreground">No employees yet</h3>
            <p className="text-muted-foreground mt-1 mb-4">Import from the CSV or add employees manually.</p>
            <Button variant="outline" onClick={() => importMutation.mutate()} disabled={importMutation.isPending}>
              <Upload className="w-4 h-4 mr-2" />
              {importMutation.isPending ? "Importing..." : "Import from CSV"}
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            {departments.map(({ department, employees: deptEmployees }) => {
              const isCollapsed = collapsedDepts.has(department);
              const activeCount = deptEmployees.filter(e => e.status === "Active").length;
              return (
                <div key={department} className="bg-card rounded-lg border border-border overflow-hidden">
                  <button
                    onClick={() => toggleDept(department)}
                    className="w-full flex items-center justify-between px-4 py-3 bg-muted hover:bg-muted/80 transition-colors"
                  >
                    <div className="flex items-center gap-2">
                      {isCollapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                      <span className="font-semibold text-sm text-foreground">{department}</span>
                    </div>
                    <span className="text-xs text-muted-foreground">
                      {activeCount} active / {deptEmployees.length} total
                    </span>
                  </button>
                  {!isCollapsed && (
                    <table className="w-full">
                      <thead>
                        <tr className="border-b border-border">
                          <th className="text-left px-4 py-2 text-xs font-medium text-muted-foreground">Name</th>
                          <th className="text-left px-4 py-2 text-xs font-medium text-muted-foreground">Email</th>
                          <th className="text-left px-4 py-2 text-xs font-medium text-muted-foreground">Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {deptEmployees.map((emp) => (
                          <tr key={emp.id} className="hover:bg-muted/30">
                            <td className="px-4 py-2.5 text-sm font-medium text-foreground">
                              <div className="flex items-center gap-2">
                                <span className="w-6 h-6 rounded-full bg-primary/10 text-primary text-[10px] font-bold flex items-center justify-center shrink-0">
                                  {emp.initials || emp.name?.slice(0, 2).toUpperCase()}
                                </span>
                                {emp.name}
                              </div>
                            </td>
                            <td className="px-4 py-2.5 text-sm text-muted-foreground">{emp.email}</td>
                            <td className="px-4 py-2.5 text-sm">
                              <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                                emp.status === "Active" ? "bg-green-100 text-green-800" : "bg-gray-100 text-gray-800"
                              }`}>
                                {emp.status || "Active"}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
