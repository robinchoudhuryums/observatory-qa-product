import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  BookTemplate, Search, ArrowLeft, FileText, Code, ChevronDown, ChevronUp,
} from "lucide-react";

interface ClinicalTemplate {
  id: string;
  name: string;
  specialty: string;
  format: string;
  category: string;
  description: string;
  sections: Record<string, string>;
  defaultCodes?: Array<{ code: string; description: string }>;
  tags: string[];
}

const FORMAT_LABELS: Record<string, string> = {
  soap: "SOAP", dap: "DAP", birp: "BIRP",
  hpi_focused: "HPI-Focused", procedure_note: "Procedure Note",
};

const CATEGORY_LABELS: Record<string, string> = {
  general: "General", dental: "Dental", behavioral_health: "Behavioral Health",
  surgical: "Surgical", preventive: "Preventive",
};

export default function ClinicalTemplatesPage() {
  const [, navigate] = useLocation();
  const [search, setSearch] = useState("");
  const [filterCategory, setFilterCategory] = useState<string>("all");
  const [filterFormat, setFilterFormat] = useState<string>("all");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const { data: templates, isLoading } = useQuery<ClinicalTemplate[]>({
    queryKey: ["/api/clinical/templates", search, filterCategory, filterFormat],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (search) params.set("search", search);
      if (filterCategory !== "all") params.set("category", filterCategory);
      if (filterFormat !== "all") params.set("format", filterFormat);
      const qs = params.toString();
      const res = await fetch(`/api/clinical/templates${qs ? "?" + qs : ""}`, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    staleTime: 60000,
  });

  return (
    <div className="p-4 md:p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <Button variant="ghost" size="sm" className="mb-2" onClick={() => navigate("/clinical")}>
            <ArrowLeft className="w-4 h-4 mr-1" />
            Back to Dashboard
          </Button>
          <div className="flex items-center gap-3">
            <BookTemplate className="w-6 h-6 text-primary" />
            <h1 className="text-2xl font-bold text-foreground">Clinical Note Templates</h1>
          </div>
          <p className="text-muted-foreground mt-1">
            Pre-built templates for common encounter types. Click to use as a starting point.
          </p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search templates..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={filterCategory} onValueChange={setFilterCategory}>
          <SelectTrigger className="w-full sm:w-48">
            <SelectValue placeholder="Category" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Categories</SelectItem>
            {Object.entries(CATEGORY_LABELS).map(([val, label]) => (
              <SelectItem key={val} value={val}>{label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={filterFormat} onValueChange={setFilterFormat}>
          <SelectTrigger className="w-full sm:w-48">
            <SelectValue placeholder="Format" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Formats</SelectItem>
            {Object.entries(FORMAT_LABELS).map(([val, label]) => (
              <SelectItem key={val} value={val}>{label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Templates List */}
      {isLoading ? (
        <div className="flex items-center justify-center py-12 text-muted-foreground">Loading templates...</div>
      ) : !templates || templates.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <BookTemplate className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
            <h3 className="text-lg font-semibold">No templates found</h3>
            <p className="text-muted-foreground mt-2">Try adjusting your search or filters.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {templates.map(tmpl => {
            const isExpanded = expandedId === tmpl.id;
            return (
              <Card key={tmpl.id} className="overflow-hidden">
                <div
                  className="flex items-center justify-between p-4 cursor-pointer hover:bg-muted/30 transition-colors"
                  onClick={() => setExpandedId(isExpanded ? null : tmpl.id)}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="text-sm font-semibold">{tmpl.name}</h3>
                      <Badge variant="outline" className="text-xs">
                        {FORMAT_LABELS[tmpl.format] || tmpl.format}
                      </Badge>
                      <Badge variant="secondary" className="text-xs capitalize">
                        {tmpl.category.replace(/_/g, " ")}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground line-clamp-1">{tmpl.description}</p>
                  </div>
                  <div className="flex items-center gap-2 ml-4">
                    <Badge variant="secondary" className="text-xs capitalize shrink-0">
                      {tmpl.specialty.replace(/_/g, " ")}
                    </Badge>
                    {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                  </div>
                </div>

                {isExpanded && (
                  <CardContent className="pt-0 border-t">
                    <div className="space-y-4 mt-4">
                      {/* Template Sections */}
                      <div>
                        <h4 className="text-sm font-semibold mb-2 flex items-center gap-2">
                          <FileText className="w-4 h-4" />
                          Template Sections
                        </h4>
                        <div className="space-y-3">
                          {Object.entries(tmpl.sections).map(([name, content]) => (
                            <div key={name} className="rounded-lg border p-3 bg-muted/20">
                              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">
                                {name.replace(/([A-Z])/g, " $1").trim()}
                              </p>
                              <p className="text-xs whitespace-pre-wrap font-mono leading-relaxed">{content}</p>
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* Default Codes */}
                      {tmpl.defaultCodes && tmpl.defaultCodes.length > 0 && (
                        <div>
                          <h4 className="text-sm font-semibold mb-2 flex items-center gap-2">
                            <Code className="w-4 h-4" />
                            Default Billing Codes
                          </h4>
                          <div className="flex flex-wrap gap-2">
                            {tmpl.defaultCodes.map(code => (
                              <Badge key={code.code} variant="outline" className="text-xs">
                                {code.code}: {code.description}
                              </Badge>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Tags */}
                      <div className="flex flex-wrap gap-1.5">
                        {tmpl.tags.map(tag => (
                          <Badge key={tag} variant="secondary" className="text-xs">{tag}</Badge>
                        ))}
                      </div>

                      {/* Use Template Button */}
                      <div className="flex justify-end pt-2">
                        <Button onClick={() => navigate(`/clinical/upload?template=${tmpl.id}`)}>
                          Use Template
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
