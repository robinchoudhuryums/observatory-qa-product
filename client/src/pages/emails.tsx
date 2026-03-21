import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import {
  Mail, Send, BarChart3, MessageSquare, Clock, TrendingUp,
  AlertCircle, CheckCircle2, Loader2, Inbox, ArrowUpRight,
  ChevronRight, Star, Flag, Users,
} from "lucide-react";
import { CALL_CATEGORIES, type CallWithDetails } from "@shared/schema";
import { toDisplayString } from "@/lib/display-utils";

const EMAIL_CATEGORIES = CALL_CATEGORIES.filter(c => c.value.startsWith("email_"));

function sentimentColor(sentiment?: string) {
  if (sentiment === "positive") return "text-green-600 bg-green-100";
  if (sentiment === "negative") return "text-red-600 bg-red-100";
  return "text-amber-600 bg-amber-100";
}

function scoreColor(score: number) {
  if (score >= 8) return "text-green-600";
  if (score >= 6) return "text-amber-600";
  return "text-red-600";
}

function EmailCard({ email }: { email: CallWithDetails }) {
  const score = parseFloat(email.analysis?.performanceScore || "0");
  const sentiment = email.sentiment?.overallSentiment;
  const isProcessing = email.status === "processing";
  const isFailed = email.status === "failed";

  return (
    <Card className="hover:shadow-md transition-shadow cursor-pointer">
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <Mail className="w-4 h-4 text-muted-foreground flex-shrink-0" />
              <h3 className="font-medium text-sm truncate">{email.emailSubject || "No subject"}</h3>
              {isProcessing && <Loader2 className="w-3 h-3 animate-spin text-blue-500 flex-shrink-0" />}
              {isFailed && <AlertCircle className="w-3 h-3 text-red-500 flex-shrink-0" />}
            </div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground mb-2">
              <span>{email.emailFrom || "Unknown sender"}</span>
              <ChevronRight className="w-3 h-3" />
              <span>{email.emailTo || "Unknown recipient"}</span>
            </div>
            {email.analysis?.summary && (
              <p className="text-xs text-muted-foreground line-clamp-2">{toDisplayString(email.analysis.summary)}</p>
            )}
            <div className="flex items-center gap-2 mt-2 flex-wrap">
              {email.callCategory && (
                <Badge variant="outline" className="text-xs">
                  {EMAIL_CATEGORIES.find(c => c.value === email.callCategory)?.label || email.callCategory}
                </Badge>
              )}
              {sentiment && (
                <Badge variant="outline" className={`text-xs ${sentimentColor(sentiment)}`}>
                  {sentiment}
                </Badge>
              )}
              {email.analysis?.flags?.includes("urgent") && (
                <Badge variant="destructive" className="text-xs">Urgent</Badge>
              )}
              {email.analysis?.flags?.includes("escalation_needed") && (
                <Badge variant="destructive" className="text-xs">Escalation</Badge>
              )}
              {email.employee && (
                <Badge variant="secondary" className="text-xs">
                  <Users className="w-3 h-3 mr-1" />{email.employee.name}
                </Badge>
              )}
            </div>
          </div>
          <div className="text-right flex-shrink-0">
            {score > 0 && (
              <div className={`text-lg font-bold ${scoreColor(score)}`}>
                {score.toFixed(1)}
              </div>
            )}
            <div className="text-xs text-muted-foreground mt-1">
              {email.uploadedAt ? new Date(email.uploadedAt).toLocaleDateString() : ""}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function SubmitEmailForm({ onSuccess }: { onSuccess: () => void }) {
  const { toast } = useToast();
  const [subject, setSubject] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [body, setBody] = useState("");
  const [category, setCategory] = useState("email_general");

  const submitMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/emails/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subject, from, to, body, category }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ message: "Failed to submit email" }));
        throw new Error(err.message);
      }
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Email submitted", description: "AI analysis is in progress" });
      setSubject("");
      setFrom("");
      setTo("");
      setBody("");
      setCategory("email_general");
      queryClient.invalidateQueries({ queryKey: ["/api/emails"] });
      queryClient.invalidateQueries({ queryKey: ["/api/emails/stats"] });
      onSuccess();
    },
    onError: (err: Error) => {
      toast({ title: "Failed", description: err.message, variant: "destructive" });
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Send className="w-4 h-4" />
          Submit Email for Analysis
        </CardTitle>
        <CardDescription>Paste an email to analyze its quality, sentiment, and compliance.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label>From</Label>
            <Input placeholder="sender@example.com" value={from} onChange={e => setFrom(e.target.value)} />
          </div>
          <div>
            <Label>To</Label>
            <Input placeholder="recipient@example.com" value={to} onChange={e => setTo(e.target.value)} />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label>Subject *</Label>
            <Input placeholder="Email subject line" value={subject} onChange={e => setSubject(e.target.value)} />
          </div>
          <div>
            <Label>Category</Label>
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {EMAIL_CATEGORIES.map(c => (
                  <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div>
          <Label>Email Body *</Label>
          <Textarea
            placeholder="Paste the email content here..."
            value={body}
            onChange={e => setBody(e.target.value)}
            rows={8}
            className="font-mono text-sm"
          />
          <p className="text-xs text-muted-foreground mt-1">{body.length} characters</p>
        </div>
        <Button
          onClick={() => submitMutation.mutate()}
          disabled={submitMutation.isPending || !subject.trim() || body.trim().length < 5}
          className="w-full"
        >
          {submitMutation.isPending ? (
            <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Analyzing...</>
          ) : (
            <><Mail className="w-4 h-4 mr-2" /> Submit for Analysis</>
          )}
        </Button>
      </CardContent>
    </Card>
  );
}

function StatsOverview() {
  const { data: stats } = useQuery<{
    totalEmails: number;
    completed: number;
    processing: number;
    failed: number;
    avgPerformanceScore: number;
    sentimentDistribution: { positive: number; neutral: number; negative: number };
    categoryBreakdown: Record<string, number>;
    threadCount: number;
  }>({
    queryKey: ["/api/emails/stats"],
    refetchInterval: 10000,
  });

  if (!stats) return null;

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      <Card>
        <CardContent className="p-4">
          <div className="flex items-center gap-2 text-muted-foreground mb-1">
            <Inbox className="w-4 h-4" />
            <span className="text-xs font-medium">Total Emails</span>
          </div>
          <div className="text-2xl font-bold">{stats.totalEmails}</div>
          <div className="text-xs text-muted-foreground">
            {stats.processing > 0 && <span className="text-blue-500">{stats.processing} processing</span>}
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="p-4">
          <div className="flex items-center gap-2 text-muted-foreground mb-1">
            <Star className="w-4 h-4" />
            <span className="text-xs font-medium">Avg Score</span>
          </div>
          <div className={`text-2xl font-bold ${scoreColor(stats.avgPerformanceScore)}`}>
            {stats.avgPerformanceScore > 0 ? stats.avgPerformanceScore.toFixed(1) : "—"}
          </div>
          <div className="text-xs text-muted-foreground">out of 10.0</div>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="p-4">
          <div className="flex items-center gap-2 text-muted-foreground mb-1">
            <TrendingUp className="w-4 h-4" />
            <span className="text-xs font-medium">Sentiment</span>
          </div>
          <div className="flex items-center gap-1">
            <span className="text-xs text-green-600">{stats.sentimentDistribution.positive} pos</span>
            <span className="text-xs text-muted-foreground">/</span>
            <span className="text-xs text-amber-600">{stats.sentimentDistribution.neutral} neu</span>
            <span className="text-xs text-muted-foreground">/</span>
            <span className="text-xs text-red-600">{stats.sentimentDistribution.negative} neg</span>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="p-4">
          <div className="flex items-center gap-2 text-muted-foreground mb-1">
            <MessageSquare className="w-4 h-4" />
            <span className="text-xs font-medium">Threads</span>
          </div>
          <div className="text-2xl font-bold">{stats.threadCount}</div>
          <div className="text-xs text-muted-foreground">conversations</div>
        </CardContent>
      </Card>
    </div>
  );
}

export default function EmailsPage() {
  const [activeTab, setActiveTab] = useState("inbox");

  const { data: emails = [], isLoading } = useQuery<CallWithDetails[]>({
    queryKey: ["/api/emails"],
    refetchInterval: 5000,
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Mail className="w-6 h-6" />
            Email QA
          </h1>
          <p className="text-muted-foreground text-sm">
            Analyze email communications for quality, sentiment, and compliance — no transcription cost.
          </p>
        </div>
      </div>

      <StatsOverview />

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="inbox" className="gap-1.5">
            <Inbox className="w-4 h-4" /> Analyzed Emails ({emails.length})
          </TabsTrigger>
          <TabsTrigger value="submit" className="gap-1.5">
            <Send className="w-4 h-4" /> Submit Email
          </TabsTrigger>
        </TabsList>

        <TabsContent value="inbox" className="space-y-3 mt-4">
          {isLoading ? (
            <div className="flex items-center justify-center h-32">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          ) : emails.length === 0 ? (
            <Card>
              <CardContent className="p-8 text-center">
                <Mail className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
                <h3 className="font-medium mb-1">No emails analyzed yet</h3>
                <p className="text-sm text-muted-foreground mb-4">
                  Submit an email to get AI-powered quality analysis.
                </p>
                <Button variant="outline" onClick={() => setActiveTab("submit")}>
                  <Send className="w-4 h-4 mr-2" /> Submit Your First Email
                </Button>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {emails.map(email => (
                <EmailCard key={email.id} email={email} />
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="submit" className="mt-4">
          <SubmitEmailForm onSuccess={() => setActiveTab("inbox")} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
