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
import { Progress } from "@/components/ui/progress";
import {
  BookOpen, GraduationCap, Search, Plus, Sparkles, Clock, CheckCircle2,
  FileText, HelpCircle, Loader2, BarChart3, BookMarked, Users, ArrowRight,
  Trash2,
} from "lucide-react";
import { LMS_CATEGORIES, LMS_CONTENT_TYPES, type LearningModule, type LearningPath, type ReferenceDocument } from "@shared/schema";
import { toDisplayString } from "@/lib/display-utils";

function difficultyColor(d?: string) {
  if (d === "beginner") return "bg-green-100 text-green-700";
  if (d === "advanced") return "bg-red-100 text-red-700";
  return "bg-amber-100 text-amber-700";
}

function contentTypeIcon(type: string) {
  switch (type) {
    case "article": return <FileText className="w-4 h-4" />;
    case "quiz": return <HelpCircle className="w-4 h-4" />;
    case "ai_generated": return <Sparkles className="w-4 h-4" />;
    default: return <BookOpen className="w-4 h-4" />;
  }
}

function ModuleCard({ module, onDelete }: { module: LearningModule; onDelete?: () => void }) {
  return (
    <Card className="hover:shadow-md transition-shadow">
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-1">
              {contentTypeIcon(module.contentType)}
              <h3 className="font-medium text-sm">{module.title}</h3>
              {!module.isPublished && <Badge variant="outline" className="text-xs">Draft</Badge>}
              {module.isPlatformContent && <Badge variant="secondary" className="text-xs">Platform</Badge>}
            </div>
            {module.description && (
              <p className="text-xs text-muted-foreground mb-2 line-clamp-2">{toDisplayString(module.description)}</p>
            )}
            <div className="flex items-center gap-2 flex-wrap">
              {module.category && (
                <Badge variant="outline" className="text-xs">
                  {LMS_CATEGORIES.find(c => c.value === module.category)?.label || module.category}
                </Badge>
              )}
              {module.difficulty && (
                <Badge className={`text-xs ${difficultyColor(module.difficulty)}`}>{module.difficulty}</Badge>
              )}
              {module.estimatedMinutes && (
                <span className="text-xs text-muted-foreground flex items-center gap-1">
                  <Clock className="w-3 h-3" /> {module.estimatedMinutes} min
                </span>
              )}
              {module.contentType === "quiz" && module.quizQuestions && (
                <span className="text-xs text-muted-foreground">
                  {module.quizQuestions.length} questions
                </span>
              )}
            </div>
          </div>
          {onDelete && (
            <Button variant="ghost" size="sm" onClick={onDelete}>
              <Trash2 className="w-4 h-4 text-muted-foreground" />
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function CreateModuleForm({ onSuccess }: { onSuccess: () => void }) {
  const { toast } = useToast();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [content, setContent] = useState("");
  const [category, setCategory] = useState("general");
  const [difficulty, setDifficulty] = useState("intermediate");
  const [estimatedMinutes, setEstimatedMinutes] = useState("10");

  const createMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/lms/modules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title, description, content, category, difficulty,
          contentType: "article",
          estimatedMinutes: parseInt(estimatedMinutes) || 10,
          isPublished: false,
        }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message || "Failed");
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Module created", description: "You can now publish it when ready" });
      setTitle(""); setDescription(""); setContent("");
      queryClient.invalidateQueries({ queryKey: ["/api/lms/modules"] });
      onSuccess();
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Plus className="w-4 h-4" /> Create Learning Module
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label>Title *</Label>
            <Input value={title} onChange={e => setTitle(e.target.value)} placeholder="Module title" />
          </div>
          <div>
            <Label>Category</Label>
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {LMS_CATEGORIES.map(c => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div>
          <Label>Description</Label>
          <Input value={description} onChange={e => setDescription(e.target.value)} placeholder="Brief description" />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label>Difficulty</Label>
            <Select value={difficulty} onValueChange={setDifficulty}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="beginner">Beginner</SelectItem>
                <SelectItem value="intermediate">Intermediate</SelectItem>
                <SelectItem value="advanced">Advanced</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Estimated Minutes</Label>
            <Input type="number" value={estimatedMinutes} onChange={e => setEstimatedMinutes(e.target.value)} />
          </div>
        </div>
        <div>
          <Label>Content (Markdown)</Label>
          <Textarea value={content} onChange={e => setContent(e.target.value)} rows={10} placeholder="Write your training content in Markdown..." className="font-mono text-sm" />
        </div>
        <Button onClick={() => createMutation.mutate()} disabled={createMutation.isPending || !title.trim()}>
          {createMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Plus className="w-4 h-4 mr-2" />}
          Create Module
        </Button>
      </CardContent>
    </Card>
  );
}

function AIGenerateModule({ onSuccess }: { onSuccess: () => void }) {
  const { toast } = useToast();
  const [selectedDoc, setSelectedDoc] = useState("");
  const [category, setCategory] = useState("general");
  const [generateQuiz, setGenerateQuiz] = useState(true);

  const { data: refDocs = [] } = useQuery<ReferenceDocument[]>({
    queryKey: ["/api/onboarding/reference-docs"],
  });

  const generateMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/lms/modules/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ documentId: selectedDoc, category, generateQuiz }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message || "Failed");
      return res.json();
    },
    onSuccess: (data) => {
      toast({ title: "Module generated!", description: `"${data.title}" created from reference document` });
      queryClient.invalidateQueries({ queryKey: ["/api/lms/modules"] });
      onSuccess();
    },
    onError: (e: Error) => toast({ title: "Generation failed", description: e.message, variant: "destructive" }),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Sparkles className="w-4 h-4" /> AI-Generate from Reference Document
        </CardTitle>
        <CardDescription>
          Transform your uploaded reference documents into structured training modules with optional quizzes.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {refDocs.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No reference documents uploaded yet. Upload documents in the Onboarding section first.
          </p>
        ) : (
          <>
            <div>
              <Label>Source Document *</Label>
              <Select value={selectedDoc} onValueChange={setSelectedDoc}>
                <SelectTrigger><SelectValue placeholder="Select a document..." /></SelectTrigger>
                <SelectContent>
                  {refDocs.map(d => (
                    <SelectItem key={d.id} value={d.id}>
                      {d.name} ({d.category})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Category</Label>
                <Select value={category} onValueChange={setCategory}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {LMS_CATEGORIES.map(c => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-end">
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={generateQuiz} onChange={e => setGenerateQuiz(e.target.checked)} className="rounded" />
                  Generate quiz questions
                </label>
              </div>
            </div>
            <Button onClick={() => generateMutation.mutate()} disabled={generateMutation.isPending || !selectedDoc}>
              {generateMutation.isPending ? (
                <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Generating (this may take 30-60s)...</>
              ) : (
                <><Sparkles className="w-4 h-4 mr-2" /> Generate Training Module</>
              )}
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function KnowledgeSearch() {
  const [query, setQuery] = useState("");
  const [searchQuery, setSearchQuery] = useState("");

  const { data: results, isLoading } = useQuery<{
    modules: LearningModule[];
    knowledgeBase: Array<{ text: string; documentName: string; relevance: number }>;
    totalResults: number;
  }>({
    queryKey: ["/api/lms/knowledge-search", searchQuery],
    enabled: searchQuery.length >= 3,
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Search className="w-4 h-4" /> Knowledge Base Search
        </CardTitle>
        <CardDescription>Search training modules and reference documents</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex gap-2">
          <Input
            placeholder="Search for insurance codes, procedures, policies..."
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={e => e.key === "Enter" && setSearchQuery(query)}
          />
          <Button onClick={() => setSearchQuery(query)} disabled={query.length < 3}>
            <Search className="w-4 h-4" />
          </Button>
        </div>

        {isLoading && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="w-4 h-4 animate-spin" /> Searching...
          </div>
        )}

        {results && (
          <div className="space-y-3">
            {results.modules.length > 0 && (
              <div>
                <h4 className="text-sm font-medium mb-2 flex items-center gap-1">
                  <BookOpen className="w-3 h-3" /> Training Modules ({results.modules.length})
                </h4>
                {results.modules.map(m => <ModuleCard key={m.id} module={m} />)}
              </div>
            )}
            {results.knowledgeBase.length > 0 && (
              <div>
                <h4 className="text-sm font-medium mb-2 flex items-center gap-1">
                  <FileText className="w-3 h-3" /> Knowledge Base ({results.knowledgeBase.length})
                </h4>
                {results.knowledgeBase.map((kb, i) => (
                  <Card key={i} className="mb-2">
                    <CardContent className="p-3">
                      <div className="text-xs text-muted-foreground mb-1">
                        {kb.documentName} (relevance: {(kb.relevance * 100).toFixed(0)}%)
                      </div>
                      <p className="text-sm">{kb.text}</p>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
            {results.totalResults === 0 && (
              <p className="text-sm text-muted-foreground text-center py-4">No results found</p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function StatsOverview() {
  const { data: stats } = useQuery<{
    totalModules: number;
    publishedModules: number;
    aiGeneratedModules: number;
    totalPaths: number;
    totalCompletions: number;
    totalInProgress: number;
    modulesByCategory: Record<string, number>;
  }>({
    queryKey: ["/api/lms/stats"],
  });

  if (!stats) return null;

  return (
    <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
      <Card>
        <CardContent className="p-4">
          <div className="flex items-center gap-2 text-muted-foreground mb-1">
            <BookOpen className="w-4 h-4" />
            <span className="text-xs font-medium">Modules</span>
          </div>
          <div className="text-2xl font-bold">{stats.publishedModules}</div>
          <div className="text-xs text-muted-foreground">{stats.totalModules - stats.publishedModules} drafts</div>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="p-4">
          <div className="flex items-center gap-2 text-muted-foreground mb-1">
            <Sparkles className="w-4 h-4" />
            <span className="text-xs font-medium">AI-Generated</span>
          </div>
          <div className="text-2xl font-bold">{stats.aiGeneratedModules}</div>
          <div className="text-xs text-muted-foreground">from reference docs</div>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="p-4">
          <div className="flex items-center gap-2 text-muted-foreground mb-1">
            <BookMarked className="w-4 h-4" />
            <span className="text-xs font-medium">Paths</span>
          </div>
          <div className="text-2xl font-bold">{stats.totalPaths}</div>
          <div className="text-xs text-muted-foreground">learning paths</div>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="p-4">
          <div className="flex items-center gap-2 text-muted-foreground mb-1">
            <CheckCircle2 className="w-4 h-4" />
            <span className="text-xs font-medium">Completions</span>
          </div>
          <div className="text-2xl font-bold text-green-600">{stats.totalCompletions}</div>
          <div className="text-xs text-muted-foreground">{stats.totalInProgress} in progress</div>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="p-4">
          <div className="flex items-center gap-2 text-muted-foreground mb-1">
            <BarChart3 className="w-4 h-4" />
            <span className="text-xs font-medium">Categories</span>
          </div>
          <div className="text-2xl font-bold">{Object.keys(stats.modulesByCategory).length}</div>
          <div className="text-xs text-muted-foreground">topics covered</div>
        </CardContent>
      </Card>
    </div>
  );
}

export default function LearningPage() {
  const [activeTab, setActiveTab] = useState("modules");
  const { toast } = useToast();

  const { data: modules = [], isLoading } = useQuery<LearningModule[]>({
    queryKey: ["/api/lms/modules"],
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/lms/modules/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to delete");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/lms/modules"] });
      toast({ title: "Module deleted" });
    },
  });

  const publishMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/lms/modules/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isPublished: true }),
      });
      if (!res.ok) throw new Error("Failed to publish");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/lms/modules"] });
      toast({ title: "Module published" });
    },
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <GraduationCap className="w-6 h-6" />
          Learning Center
        </h1>
        <p className="text-muted-foreground text-sm">
          Training modules, knowledge base, and learning paths for your team.
        </p>
      </div>

      <StatsOverview />

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="modules" className="gap-1.5">
            <BookOpen className="w-4 h-4" /> Modules ({modules.length})
          </TabsTrigger>
          <TabsTrigger value="create" className="gap-1.5">
            <Plus className="w-4 h-4" /> Create
          </TabsTrigger>
          <TabsTrigger value="ai-generate" className="gap-1.5">
            <Sparkles className="w-4 h-4" /> AI Generate
          </TabsTrigger>
          <TabsTrigger value="search" className="gap-1.5">
            <Search className="w-4 h-4" /> Knowledge Search
          </TabsTrigger>
        </TabsList>

        <TabsContent value="modules" className="mt-4 space-y-3">
          {isLoading ? (
            <div className="flex items-center justify-center h-32">
              <Loader2 className="w-6 h-6 animate-spin" />
            </div>
          ) : modules.length === 0 ? (
            <Card>
              <CardContent className="p-8 text-center">
                <GraduationCap className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
                <h3 className="font-medium mb-1">No learning modules yet</h3>
                <p className="text-sm text-muted-foreground mb-4">
                  Create modules manually or AI-generate them from your reference documents.
                </p>
                <div className="flex gap-2 justify-center">
                  <Button variant="outline" onClick={() => setActiveTab("create")}>
                    <Plus className="w-4 h-4 mr-2" /> Create Manually
                  </Button>
                  <Button onClick={() => setActiveTab("ai-generate")}>
                    <Sparkles className="w-4 h-4 mr-2" /> AI Generate
                  </Button>
                </div>
              </CardContent>
            </Card>
          ) : (
            modules.map(m => (
              <div key={m.id} className="flex items-center gap-2">
                <div className="flex-1">
                  <ModuleCard module={m} onDelete={() => deleteMutation.mutate(m.id)} />
                </div>
                {!m.isPublished && (
                  <Button size="sm" variant="outline" onClick={() => publishMutation.mutate(m.id)}>
                    Publish
                  </Button>
                )}
              </div>
            ))
          )}
        </TabsContent>

        <TabsContent value="create" className="mt-4">
          <CreateModuleForm onSuccess={() => setActiveTab("modules")} />
        </TabsContent>

        <TabsContent value="ai-generate" className="mt-4">
          <AIGenerateModule onSuccess={() => setActiveTab("modules")} />
        </TabsContent>

        <TabsContent value="search" className="mt-4">
          <KnowledgeSearch />
        </TabsContent>
      </Tabs>
    </div>
  );
}
