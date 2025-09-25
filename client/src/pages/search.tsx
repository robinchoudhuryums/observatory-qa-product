import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Search, Filter, Calendar, User, Heart } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Link } from "wouter";
import type { CallWithDetails, Employee } from "@shared/schema";
import { useToast } from "@/hooks/use-toast";
import { AudioWaveform } from "lucide-react";

export default function SearchPage() {
  const [searchQuery, setSearchQuery] = useState("");
  const [employeeFilter, setEmployeeFilter] = useState("all");
  const [sentimentFilter, setSentimentFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const { toast } = useToast();

  // --- CORRECTED DEBOUNCE LOGIC ---
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQuery(searchQuery);
    }, 500); // Wait 500ms after the user stops typing

    return () => {
      clearTimeout(timer); // Clear the timer if the user types again
    };
  }, [searchQuery]); // This effect re-runs whenever searchQuery changes

  const { data: employees } = useQuery<Employee[]>({
    queryKey: ["/api/employees"],
  });

  const { data: searchResults, isLoading: isLoadingSearch } = useQuery<CallWithDetails[]>({
    queryKey: ["/api/search", { q: debouncedQuery }],
    enabled: debouncedQuery.length > 2,
    onError: (error) => {
      toast({
        title: "Search Failed",
        description: error.message || "Could not connect to the server.",
        variant: "destructive",
      });
    },
  });

  const { data: allCalls, isLoading: isLoadingCalls } = useQuery<CallWithDetails[]>({
    queryKey: ["/api/calls", {
      employee: employeeFilter === "all" ? "" : employeeFilter,
      sentiment: sentimentFilter === "all" ? "" : sentimentFilter,
      status: statusFilter === "all" ? "" : statusFilter
    }],
    enabled: debouncedQuery.length === 0,
  });

  const displayCalls = debouncedQuery.length > 2 ? searchResults : allCalls;
  const isLoading = isLoadingSearch || isLoadingCalls;

  const getSentimentBadge = (sentiment?: string) => {
    if (!sentiment) return <Badge variant="secondary">Unknown</Badge>;
    const variants: Record<string, any> = { positive: "default", neutral: "secondary", negative: "destructive" };
    return <Badge variant={variants[sentiment] || "secondary"}>{sentiment.charAt(0).toUpperCase() + sentiment.slice(1)}</Badge>;
  };

  const getStatusBadge = (status?: string) => {
    if (!status) return <Badge variant="secondary">Unknown</Badge>;
    const colors: Record<string, string> = { completed: "bg-green-100 text-green-800", processing: "bg-blue-100 text-blue-800", failed: "bg-red-100 text-red-800" };
    return <Badge className={colors[status] || "bg-gray-100 text-gray-800"}>{status.charAt(0).toUpperCase() + status.slice(1)}</Badge>;
  };

  const formatDuration = (seconds?: number) => {
    if (seconds === null || seconds === undefined) return 'N/A';
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}m ${secs}s`;
  };

  const clearFilters = () => {
    setSearchQuery(""); setEmployeeFilter("all"); setSentimentFilter("all"); setStatusFilter("all"); setDebouncedQuery("");
  };

  return (
    <div className="min-h-screen" data-testid="search-page">
      <header className="bg-card border-b border-border px-6 py-4">
        <div>
          <h2 className="text-2xl font-bold text-foreground">Search Calls</h2>
          <p className="text-muted-foreground">Find specific call recordings using keywords, filters, and criteria</p>
        </div>
      </header>

      <div className="p-6 space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Search className="w-5 h-5" /> Search & Filter</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground w-4 h-4" />
              <Input type="text" placeholder="Search by keywords, transcript content..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="pl-10"/>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <Select value={employeeFilter} onValueChange={setEmployeeFilter}>
                <SelectTrigger><User className="w-4 h-4 mr-2" /><SelectValue placeholder="All Employees" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Employees</SelectItem>
                  {employees?.map((employee) => (<SelectItem key={employee.id} value={employee.id}>{employee.name}</SelectItem>))}
                </SelectContent>
              </Select>
              {/* Other filters */}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Search Results {displayCalls && `(${displayCalls.length} found)`}</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="flex items-center justify-center h-64"><AudioWaveform className="w-8 h-8 animate-spin text-primary" /></div>
            ) : !displayCalls?.length ? (
              <div className="text-center py-12">
                <Search className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
                <h3 className="text-lg font-medium text-foreground mb-2">{debouncedQuery.length > 0 ? 'No matching calls found' : 'No calls available'}</h3>
                <Link href="/upload"><Button>Upload Call Recording</Button></Link>
              </div>
            ) : (
              <div className="space-y-4">
                {displayCalls.map((call, index) => (
                  <Card key={call.id} className="hover:shadow-md transition-shadow">
                    <CardContent className="p-6">
                      <div className="flex items-start justify-between mb-4">
                        <div className="flex items-center space-x-3">
                          {call.employee ? (
                            <>
                              <div className="w-10 h-10 bg-primary/10 rounded-full flex items-center justify-center">
                                <span className="text-primary font-semibold text-sm">{call.employee.initials ?? 'N/A'}</span>
                              </div>
                              <div>
                                <h3 className="font-semibold text-foreground">{call.employee.name ?? 'Unknown'}</h3>
                                <p className="text-sm text-muted-foreground">{new Date(call.uploadedAt).toLocaleDateString()} • {formatDuration(call.duration)}</p>
                              </div>
                            </>
                          ) : (
                            <div>
                              <h3 className="font-semibold text-foreground">Unassigned</h3>
                              <p className="text-sm text-muted-foreground">{new Date(call.uploadedAt).toLocaleDateString()} • {formatDuration(call.duration)}</p>
                            </div>
                          )}
                        </div>
                        <div className="flex items-center space-x-2">
                          {getSentimentBadge(call.sentiment?.overallSentiment)}
                          {getStatusBadge(call.status)}
                        </div>
                      </div>
                      {call.transcript?.text && (
                        <div className="mb-4">
                          <p className="text-sm text-muted-foreground line-clamp-2">{call.transcript.text}</p>
                        </div>
                      )}
                      <div className="flex items-center justify-end">
                        <Link href={`/transcripts/${call.id}`}><Button variant="outline" size="sm" disabled={call.status !== 'completed'}>View Details</Button></Link>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
