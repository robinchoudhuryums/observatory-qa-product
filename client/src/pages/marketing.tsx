import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import {
  Megaphone, Target, DollarSign, TrendingUp, Users, Plus,
  BarChart3, Loader2, Trash2, ArrowUpRight, ArrowDownRight,
  PieChart, Globe, Phone, UserPlus,
} from "lucide-react";
import { MARKETING_SOURCES, type MarketingCampaign, type MarketingSourceMetrics } from "@shared/schema";

function formatCurrency(val: number | null | undefined) {
  if (val == null) return "—";
  return `$${val.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

function roiColor(roi: number | null) {
  if (roi === null) return "text-muted-foreground";
  if (roi > 0.5) return "text-green-600";
  if (roi > 0) return "text-amber-600";
  return "text-red-600";
}

function SourceMetricCard({ metric }: { metric: MarketingSourceMetrics }) {
  const sourceDef = MARKETING_SOURCES.find(s => s.value === metric.source);
  const conversionRate = metric.totalCalls > 0 ? (metric.convertedCalls / metric.totalCalls * 100) : 0;

  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-start justify-between mb-3">
          <div>
            <h3 className="font-medium text-sm">{sourceDef?.label || metric.source}</h3>
            <p className="text-xs text-muted-foreground">{metric.totalCalls} calls</p>
          </div>
          <div className="text-right">
            <div className="text-lg font-bold text-green-600">{formatCurrency(metric.totalRevenue)}</div>
            <p className="text-xs text-muted-foreground">revenue</p>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-2 text-center text-xs mb-3">
          <div>
            <div className="font-bold">{metric.newPatients}</div>
            <div className="text-muted-foreground">New Patients</div>
          </div>
          <div>
            <div className="font-bold">{conversionRate.toFixed(0)}%</div>
            <div className="text-muted-foreground">Converted</div>
          </div>
          <div>
            <div className="font-bold">{metric.avgPerformanceScore > 0 ? metric.avgPerformanceScore.toFixed(1) : "—"}</div>
            <div className="text-muted-foreground">Avg Score</div>
          </div>
        </div>

        <div className="flex items-center justify-between text-xs">
          {metric.costPerLead !== null && (
            <span className="text-muted-foreground">
              CPL: {formatCurrency(metric.costPerLead)}
            </span>
          )}
          {metric.roi !== null && (
            <span className={`font-medium ${roiColor(metric.roi)}`}>
              ROI: {(metric.roi * 100).toFixed(0)}%
              {metric.roi > 0 ? <ArrowUpRight className="w-3 h-3 inline ml-0.5" /> : <ArrowDownRight className="w-3 h-3 inline ml-0.5" />}
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function CreateCampaignForm({ onSuccess }: { onSuccess: () => void }) {
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [source, setSource] = useState("google_ads");
  const [budget, setBudget] = useState("");
  const [trackingCode, setTrackingCode] = useState("");

  const createMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/marketing/campaigns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name, source, budget: budget ? parseFloat(budget) : undefined,
          trackingCode: trackingCode || undefined,
          startDate: new Date().toISOString(),
        }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message || "Failed");
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Campaign created" });
      setName(""); setBudget(""); setTrackingCode("");
      queryClient.invalidateQueries({ queryKey: ["/api/marketing/campaigns"] });
      onSuccess();
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Plus className="w-4 h-4" /> Create Campaign
        </CardTitle>
        <CardDescription>Track marketing campaigns to measure ROI</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label>Campaign Name *</Label>
            <Input value={name} onChange={e => setName(e.target.value)} placeholder="e.g., Spring Google Ads 2026" />
          </div>
          <div>
            <Label>Source *</Label>
            <Select value={source} onValueChange={setSource}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {MARKETING_SOURCES.map(s => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label>Budget ($)</Label>
            <Input type="number" value={budget} onChange={e => setBudget(e.target.value)} placeholder="Monthly budget" />
          </div>
          <div>
            <Label>Tracking Code / Number</Label>
            <Input value={trackingCode} onChange={e => setTrackingCode(e.target.value)} placeholder="UTM or tracking phone" />
          </div>
        </div>
        <Button onClick={() => createMutation.mutate()} disabled={createMutation.isPending || !name.trim()}>
          {createMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Plus className="w-4 h-4 mr-2" />}
          Create Campaign
        </Button>
      </CardContent>
    </Card>
  );
}

function MetricsOverview() {
  const { data: metrics } = useQuery<{
    sources: MarketingSourceMetrics[];
    totalAttributed: number;
    totalNewPatients: number;
    totalRevenue: number;
    totalBudget: number;
    activeCampaigns: number;
  }>({
    queryKey: ["/api/marketing/metrics"],
  });

  if (!metrics) return null;

  const overallROI = metrics.totalBudget > 0
    ? ((metrics.totalRevenue - metrics.totalBudget) / metrics.totalBudget * 100)
    : null;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-muted-foreground mb-1">
              <Phone className="w-4 h-4" /><span className="text-xs font-medium">Attributed</span>
            </div>
            <div className="text-2xl font-bold">{metrics.totalAttributed}</div>
            <div className="text-xs text-muted-foreground">calls tracked</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-muted-foreground mb-1">
              <UserPlus className="w-4 h-4" /><span className="text-xs font-medium">New Patients</span>
            </div>
            <div className="text-2xl font-bold text-blue-600">{metrics.totalNewPatients}</div>
            <div className="text-xs text-muted-foreground">from all sources</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-muted-foreground mb-1">
              <DollarSign className="w-4 h-4" /><span className="text-xs font-medium">Revenue</span>
            </div>
            <div className="text-2xl font-bold text-green-600">{formatCurrency(metrics.totalRevenue)}</div>
            <div className="text-xs text-muted-foreground">attributed revenue</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-muted-foreground mb-1">
              <Target className="w-4 h-4" /><span className="text-xs font-medium">Spend</span>
            </div>
            <div className="text-2xl font-bold">{formatCurrency(metrics.totalBudget)}</div>
            <div className="text-xs text-muted-foreground">{metrics.activeCampaigns} active campaigns</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-muted-foreground mb-1">
              <TrendingUp className="w-4 h-4" /><span className="text-xs font-medium">ROI</span>
            </div>
            <div className={`text-2xl font-bold ${roiColor(overallROI ? overallROI / 100 : null)}`}>
              {overallROI !== null ? `${overallROI.toFixed(0)}%` : "—"}
            </div>
            <div className="text-xs text-muted-foreground">overall return</div>
          </CardContent>
        </Card>
      </div>

      {metrics.sources.length > 0 && (
        <div>
          <h3 className="text-sm font-medium mb-3">Performance by Source</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {metrics.sources.map(m => <SourceMetricCard key={m.source} metric={m} />)}
          </div>
        </div>
      )}
    </div>
  );
}

export default function MarketingPage() {
  const [activeTab, setActiveTab] = useState("analytics");

  const { data: campaigns = [] } = useQuery<MarketingCampaign[]>({
    queryKey: ["/api/marketing/campaigns"],
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await fetch(`/api/marketing/campaigns/${id}`, { method: "DELETE" });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/marketing/campaigns"] });
      queryClient.invalidateQueries({ queryKey: ["/api/marketing/metrics"] });
    },
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <Megaphone className="w-6 h-6" />
          Marketing Attribution
        </h1>
        <p className="text-muted-foreground text-sm">
          Track where calls come from and measure marketing ROI by source.
        </p>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="analytics" className="gap-1.5">
            <BarChart3 className="w-4 h-4" /> Analytics
          </TabsTrigger>
          <TabsTrigger value="campaigns" className="gap-1.5">
            <Target className="w-4 h-4" /> Campaigns ({campaigns.length})
          </TabsTrigger>
          <TabsTrigger value="create" className="gap-1.5">
            <Plus className="w-4 h-4" /> Create Campaign
          </TabsTrigger>
        </TabsList>

        <TabsContent value="analytics" className="mt-4">
          <MetricsOverview />
        </TabsContent>

        <TabsContent value="campaigns" className="mt-4 space-y-3">
          {campaigns.length === 0 ? (
            <Card>
              <CardContent className="p-8 text-center">
                <Megaphone className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
                <h3 className="font-medium mb-1">No campaigns yet</h3>
                <p className="text-sm text-muted-foreground mb-4">
                  Create campaigns to track where your calls come from and measure ROI.
                </p>
                <Button onClick={() => setActiveTab("create")}>
                  <Plus className="w-4 h-4 mr-2" /> Create First Campaign
                </Button>
              </CardContent>
            </Card>
          ) : (
            campaigns.map(c => (
              <Card key={c.id}>
                <CardContent className="p-4 flex items-center justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="font-medium text-sm">{c.name}</h3>
                      <Badge variant={c.isActive ? "default" : "secondary"} className="text-xs">
                        {c.isActive ? "Active" : "Inactive"}
                      </Badge>
                    </div>
                    <div className="text-xs text-muted-foreground mt-1">
                      {MARKETING_SOURCES.find(s => s.value === c.source)?.label || c.source}
                      {c.budget && ` · Budget: ${formatCurrency(c.budget)}`}
                      {c.trackingCode && ` · Code: ${c.trackingCode}`}
                    </div>
                  </div>
                  <Button variant="ghost" size="sm" onClick={() => deleteMutation.mutate(c.id)}>
                    <Trash2 className="w-4 h-4 text-muted-foreground" />
                  </Button>
                </CardContent>
              </Card>
            ))
          )}
        </TabsContent>

        <TabsContent value="create" className="mt-4">
          <CreateCampaignForm onSuccess={() => setActiveTab("campaigns")} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
