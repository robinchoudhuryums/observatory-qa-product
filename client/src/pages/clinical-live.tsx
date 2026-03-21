import { useState, useEffect, useRef, useCallback } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import {
  Mic, Square, Pause, Play, FileText, Stethoscope,
  Clock, AlertCircle, CheckCircle2, Radio, ArrowLeft, WifiOff,
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { CLINICAL_SPECIALTIES, CLINICAL_NOTE_FORMATS } from "@shared/schema";
import type { ClinicalNote, LiveSession } from "@shared/schema";

type SessionPhase = "setup" | "recording" | "completed";

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export default function ClinicalLivePage() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Setup state
  const [phase, setPhase] = useState<SessionPhase>("setup");
  const [specialty, setSpecialty] = useState("");
  const [noteFormat, setNoteFormat] = useState("soap");
  const [encounterType, setEncounterType] = useState("clinical_encounter");
  const [consentConfirmed, setConsentConfirmed] = useState(false);

  // Recording state
  const [session, setSession] = useState<LiveSession | null>(null);
  const [isPaused, setIsPaused] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [partialText, setPartialText] = useState("");
  const [finalSegments, setFinalSegments] = useState<string[]>([]);
  const [draftNote, setDraftNote] = useState<ClinicalNote | null>(null);
  const [isGeneratingDraft, setIsGeneratingDraft] = useState(false);
  const [micError, setMicError] = useState<string | null>(null);
  const [transcriptionConnected, setTranscriptionConnected] = useState(true);

  // Refs — isPausedRef solves the closure capture bug in onaudioprocess
  const isPausedRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const transcriptEndRef = useRef<HTMLDivElement | null>(null);

  // Keep isPausedRef in sync with state
  useEffect(() => {
    isPausedRef.current = isPaused;
  }, [isPaused]);

  // Auto-scroll transcript
  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [finalSegments, partialText]);

  // Listen for WebSocket live transcript events
  useEffect(() => {
    function handleCustomEvent(e: Event) {
      const detail = (e as CustomEvent).detail;
      if (detail?.type === "live_transcript" && detail?.sessionId === sessionIdRef.current) {
        if (detail.eventType === "partial") {
          setPartialText(detail.text || "");
        } else if (detail.eventType === "final") {
          setPartialText("");
          if (detail.text?.trim()) {
            setFinalSegments((prev) => [...prev, detail.text]);
          }
        } else if (detail.eventType === "draft_note") {
          setDraftNote(detail.draftNote || null);
          setIsGeneratingDraft(false);
        } else if (detail.eventType === "error") {
          setTranscriptionConnected(false);
        }
      }
    }

    window.addEventListener("ws:live_transcript", handleCustomEvent);
    return () => {
      window.removeEventListener("ws:live_transcript", handleCustomEvent);
    };
  }, []);

  // Timer
  useEffect(() => {
    if (phase === "recording" && !isPaused) {
      timerRef.current = setInterval(() => setElapsed((e) => e + 1), 1000);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [phase, isPaused]);

  const stopAudioCapture = useCallback(() => {
    processorRef.current?.disconnect();
    audioContextRef.current?.close().catch(() => {});
    streamRef.current?.getTracks().forEach((t) => t.stop());
    processorRef.current = null;
    audioContextRef.current = null;
    streamRef.current = null;
  }, []);

  // Start microphone capture and stream audio to server
  const startAudioCapture = useCallback(async (liveSessionId: string) => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { sampleRate: 16000, channelCount: 1, echoCancellation: true, noiseSuppression: true },
      });
      streamRef.current = stream;

      const audioContext = new AudioContext({ sampleRate: 16000 });
      audioContextRef.current = audioContext;
      const source = audioContext.createMediaStreamSource(stream);
      // ScriptProcessorNode is deprecated but AudioWorklet requires a separate file.
      // This works reliably in all current browsers for the audio chunk sizes we need.
      const processor = audioContext.createScriptProcessor(8192, 1, 1);
      processorRef.current = processor;

      processor.onaudioprocess = (e) => {
        // Use ref to get current pause state (not stale closure value)
        if (isPausedRef.current || !sessionIdRef.current) return;
        const inputData = e.inputBuffer.getChannelData(0);
        // Convert Float32 to Int16 PCM
        const pcm16 = new Int16Array(inputData.length);
        for (let i = 0; i < inputData.length; i++) {
          const s = Math.max(-1, Math.min(1, inputData[i]));
          pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
        }
        // Convert to base64
        const bytes = new Uint8Array(pcm16.buffer);
        let binary = "";
        for (let i = 0; i < bytes.length; i++) {
          binary += String.fromCharCode(bytes[i]);
        }
        const base64 = btoa(binary);

        // Send to server (fire-and-forget)
        fetch(`/api/live-sessions/${sessionIdRef.current}/audio`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ audio: base64 }),
        }).catch(() => {
          // Silently handle audio send failures
        });
      };

      source.connect(processor);
      processor.connect(audioContext.destination);
      setMicError(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      setMicError(`Microphone access failed: ${message}`);
      toast({
        title: "Microphone access failed",
        description: "Please allow microphone access to use live recording. The session has been created but no audio is being captured.",
        variant: "destructive",
      });
    }
  }, [toast]);

  // Start session mutation
  const startMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/live-sessions", {
        specialty,
        noteFormat,
        encounterType,
        consentObtained: true,
      });
      return res.json() as Promise<LiveSession & { transcriptionConnected?: boolean }>;
    },
    onSuccess: async (data) => {
      setSession(data);
      sessionIdRef.current = data.id;
      setPhase("recording");
      setTranscriptionConnected(data.transcriptionConnected !== false);

      if (!data.transcriptionConnected) {
        toast({
          title: "Transcription service unavailable",
          description: "Live transcription is not connected. You can still record, but real-time transcript will not appear.",
          variant: "destructive",
        });
      } else {
        toast({ title: "Recording started", description: "Live transcription is active." });
      }

      await startAudioCapture(data.id);
    },
    onError: (err: Error) => {
      toast({ title: "Failed to start session", description: err.message, variant: "destructive" });
    },
  });

  // Stop session
  const stopMutation = useMutation({
    mutationFn: async () => {
      stopAudioCapture();
      const res = await apiRequest("POST", `/api/live-sessions/${sessionIdRef.current}/stop`);
      return res.json();
    },
    onSuccess: (data) => {
      setPhase("completed");
      setSession((s) => s ? { ...s, status: "completed", callId: data.callId } : null);
      toast({ title: "Session completed", description: "Clinical note has been generated." });
      queryClient.invalidateQueries({ queryKey: ["/api/calls"] });
    },
    onError: (err: Error) => {
      toast({ title: "Failed to stop session", description: err.message, variant: "destructive" });
    },
  });

  // Pause/resume
  const pauseMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/live-sessions/${sessionIdRef.current}/pause`);
      return res.json();
    },
    onSuccess: () => {
      setIsPaused((p) => !p);
    },
  });

  // Generate draft note
  const draftNoteMutation = useMutation({
    mutationFn: async () => {
      setIsGeneratingDraft(true);
      const res = await apiRequest("POST", `/api/live-sessions/${sessionIdRef.current}/draft-note`);
      return res.json();
    },
    onSuccess: (data) => {
      if (data.draftNote) {
        setDraftNote(data.draftNote);
      }
      setIsGeneratingDraft(false);
    },
    onError: (err: Error) => {
      setIsGeneratingDraft(false);
      if (err.message.includes("429")) {
        toast({ title: "Please wait", description: "Draft note generation is rate limited to once per 15 seconds." });
      } else {
        toast({ title: "Failed to generate draft", description: err.message, variant: "destructive" });
      }
    },
  });

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopAudioCapture();
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [stopAudioCapture]);

  const fullTranscript = finalSegments.join(" ");

  // --- SETUP PHASE ---
  if (phase === "setup") {
    return (
      <div className="container max-w-3xl mx-auto py-8 px-4">
        <Button variant="ghost" size="sm" className="mb-4" onClick={() => navigate("/clinical")}>
          <ArrowLeft className="w-4 h-4 mr-1" /> Back to Clinical Dashboard
        </Button>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Radio className="w-5 h-5 text-red-500" />
              Live Clinical Recording
            </CardTitle>
            <CardDescription>
              Record a clinical encounter in real-time. The AI will transcribe and generate clinical notes as the conversation happens.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label>Clinical Specialty</Label>
                <Select value={specialty} onValueChange={setSpecialty}>
                  <SelectTrigger><SelectValue placeholder="Select specialty" /></SelectTrigger>
                  <SelectContent>
                    {CLINICAL_SPECIALTIES.map((s) => (
                      <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Note Format</Label>
                <Select value={noteFormat} onValueChange={setNoteFormat}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {CLINICAL_NOTE_FORMATS.map((f) => (
                      <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <Label>Encounter Type</Label>
              <Select value={encounterType} onValueChange={setEncounterType}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="clinical_encounter">In-Person Clinical Encounter</SelectItem>
                  <SelectItem value="telemedicine">Telemedicine Visit</SelectItem>
                  <SelectItem value="dental_encounter">Dental Clinical Encounter</SelectItem>
                  <SelectItem value="dental_consultation">Dental Consultation</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <Separator />

            <div className="flex items-start gap-3 p-4 rounded-lg border border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/30">
              <AlertCircle className="w-5 h-5 text-amber-600 mt-0.5 shrink-0" />
              <div className="space-y-2">
                <p className="text-sm font-medium">Patient Consent Required</p>
                <p className="text-sm text-muted-foreground">
                  You must obtain verbal or written consent from the patient before recording this encounter.
                </p>
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="consent"
                    checked={consentConfirmed}
                    onCheckedChange={(v) => setConsentConfirmed(!!v)}
                  />
                  <Label htmlFor="consent" className="text-sm">
                    I confirm that patient consent has been obtained for this recording
                  </Label>
                </div>
              </div>
            </div>

            <Button
              size="lg"
              className="w-full"
              disabled={!consentConfirmed || startMutation.isPending}
              onClick={() => startMutation.mutate()}
            >
              <Mic className="w-5 h-5 mr-2" />
              {startMutation.isPending ? "Starting..." : "Start Live Recording"}
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // --- RECORDING PHASE ---
  if (phase === "recording") {
    return (
      <div className="container max-w-6xl mx-auto py-6 px-4">
        {/* Error banners */}
        {micError && (
          <div className="flex items-center gap-2 p-3 mb-4 rounded-lg border border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950/30 text-sm text-red-700 dark:text-red-400">
            <AlertCircle className="w-4 h-4 shrink-0" />
            {micError}
          </div>
        )}
        {!transcriptionConnected && (
          <div className="flex items-center gap-2 p-3 mb-4 rounded-lg border border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/30 text-sm text-amber-700 dark:text-amber-400">
            <WifiOff className="w-4 h-4 shrink-0" />
            Transcription service disconnected. Audio is still being captured but real-time transcription is unavailable.
          </div>
        )}

        {/* Header with controls */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <div className={`w-3 h-3 rounded-full ${isPaused ? "bg-amber-500" : "bg-red-500 animate-pulse"}`} />
              <span className="text-lg font-semibold">
                {isPaused ? "Paused" : "Recording"}
              </span>
            </div>
            <Badge variant="outline" className="text-lg px-3 py-1">
              <Clock className="w-4 h-4 mr-1" />
              {formatDuration(elapsed)}
            </Badge>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => pauseMutation.mutate()}
              disabled={pauseMutation.isPending}
            >
              {isPaused ? <Play className="w-4 h-4 mr-1" /> : <Pause className="w-4 h-4 mr-1" />}
              {pauseMutation.isPending ? "..." : isPaused ? "Resume" : "Pause"}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => draftNoteMutation.mutate()}
              disabled={isGeneratingDraft || finalSegments.length === 0}
            >
              <FileText className="w-4 h-4 mr-1" />
              {isGeneratingDraft ? "Generating..." : "Generate Draft Note"}
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => stopMutation.mutate()}
              disabled={stopMutation.isPending}
            >
              <Square className="w-4 h-4 mr-1" />
              {stopMutation.isPending ? "Finalizing..." : "End Session"}
            </Button>
          </div>
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          {/* Live Transcript */}
          <Card className="h-[calc(100vh-200px)] flex flex-col">
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Mic className="w-4 h-4" />
                Live Transcript
              </CardTitle>
              <CardDescription>
                {finalSegments.length} segment{finalSegments.length !== 1 ? "s" : ""} transcribed
              </CardDescription>
            </CardHeader>
            <CardContent className="flex-1 overflow-y-auto">
              <div className="space-y-1 text-sm leading-relaxed">
                {finalSegments.length === 0 && !partialText && (
                  <p className="text-muted-foreground italic">Waiting for speech...</p>
                )}
                {finalSegments.map((segment, i) => (
                  <span key={i} className="text-foreground">{segment} </span>
                ))}
                {partialText && (
                  <span className="text-muted-foreground italic">{partialText}</span>
                )}
                <div ref={transcriptEndRef} />
              </div>
            </CardContent>
          </Card>

          {/* Draft Clinical Note */}
          <Card className="h-[calc(100vh-200px)] flex flex-col">
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Stethoscope className="w-4 h-4" />
                Draft Clinical Note
                {draftNote && (
                  <Badge variant="secondary" className="ml-2">
                    {noteFormat.toUpperCase()}
                  </Badge>
                )}
              </CardTitle>
              <CardDescription>
                {draftNote ? "AI-generated draft — updates with each generation request" : "Click \"Generate Draft Note\" to create a note from the current transcript"}
              </CardDescription>
            </CardHeader>
            <CardContent className="flex-1 overflow-y-auto">
              {isGeneratingDraft && !draftNote && (
                <div className="flex items-center justify-center h-32 text-muted-foreground">
                  <div className="text-center space-y-2">
                    <div className="animate-spin w-6 h-6 border-2 border-primary border-t-transparent rounded-full mx-auto" />
                    <p className="text-sm">Generating draft note...</p>
                  </div>
                </div>
              )}
              {!draftNote && !isGeneratingDraft && (
                <div className="flex items-center justify-center h-32 text-muted-foreground">
                  <div className="text-center space-y-2">
                    <FileText className="w-8 h-8 mx-auto opacity-50" />
                    <p className="text-sm">No draft note yet</p>
                    <p className="text-xs">Record some conversation, then click Generate Draft Note</p>
                  </div>
                </div>
              )}
              {draftNote && <DraftNoteView note={draftNote} />}
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  // --- COMPLETED PHASE ---
  return (
    <div className="container max-w-3xl mx-auto py-8 px-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-green-600">
            <CheckCircle2 className="w-5 h-5" />
            Session Completed
          </CardTitle>
          <CardDescription>
            The recording has been processed and a clinical note has been generated.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Duration</span>
              <span>{formatDuration(elapsed)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Transcript Length</span>
              <span>{fullTranscript.length.toLocaleString()} characters</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Segments</span>
              <span>{finalSegments.length}</span>
            </div>
          </div>

          <Separator />

          <div className="flex gap-2">
            {session?.callId && (
              <Button onClick={() => navigate(`/clinical/notes/${session.callId}`)}>
                <FileText className="w-4 h-4 mr-2" />
                View Clinical Note
              </Button>
            )}
            <Button variant="outline" onClick={() => navigate("/clinical")}>
              Back to Dashboard
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                setPhase("setup");
                setSession(null);
                setFinalSegments([]);
                setPartialText("");
                setDraftNote(null);
                setElapsed(0);
                setConsentConfirmed(false);
                setMicError(null);
                setTranscriptionConnected(true);
                sessionIdRef.current = null;
              }}
            >
              <Radio className="w-4 h-4 mr-2" />
              New Recording
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

/** Render a draft clinical note in a readable format */
function DraftNoteView({ note }: { note: ClinicalNote }) {
  const sections: Array<{ label: string; content: string | undefined }> = [];

  if (note.chiefComplaint) sections.push({ label: "Chief Complaint", content: note.chiefComplaint });

  // SOAP format
  if (note.subjective) sections.push({ label: "Subjective", content: note.subjective });
  if (note.objective) sections.push({ label: "Objective", content: note.objective });
  if (note.assessment) sections.push({ label: "Assessment", content: note.assessment });
  if (note.plan?.length) sections.push({ label: "Plan", content: note.plan.join("\n") });

  // DAP format
  if (note.data) sections.push({ label: "Data", content: note.data });

  // BIRP format
  if (note.behavior) sections.push({ label: "Behavior", content: note.behavior });
  if (note.intervention) sections.push({ label: "Intervention", content: note.intervention });
  if (note.response) sections.push({ label: "Response", content: note.response });

  // HPI
  if (note.hpiNarrative) sections.push({ label: "History of Present Illness", content: note.hpiNarrative });

  // Follow-up
  if (note.followUp) sections.push({ label: "Follow-Up", content: note.followUp });

  return (
    <div className="space-y-4">
      {note.specialty && (
        <Badge variant="outline" className="mb-2">{note.specialty}</Badge>
      )}
      {sections.map((s, i) => (
        <div key={i}>
          <h4 className="text-sm font-semibold text-primary mb-1">{s.label}</h4>
          <p className="text-sm text-foreground whitespace-pre-wrap">{s.content}</p>
        </div>
      ))}

      {note.icd10Codes && note.icd10Codes.length > 0 && (
        <div>
          <h4 className="text-sm font-semibold text-primary mb-1">ICD-10 Codes</h4>
          <div className="flex flex-wrap gap-1">
            {note.icd10Codes.map((c, i) => (
              <Badge key={i} variant="secondary" className="text-xs">{c.code}: {c.description}</Badge>
            ))}
          </div>
        </div>
      )}

      {note.cptCodes && note.cptCodes.length > 0 && (
        <div>
          <h4 className="text-sm font-semibold text-primary mb-1">CPT Codes</h4>
          <div className="flex flex-wrap gap-1">
            {note.cptCodes.map((c, i) => (
              <Badge key={i} variant="secondary" className="text-xs">{c.code}: {c.description}</Badge>
            ))}
          </div>
        </div>
      )}

      {note.documentationCompleteness !== undefined && (
        <div className="flex gap-4 text-xs text-muted-foreground pt-2 border-t">
          <span>Completeness: {note.documentationCompleteness}/10</span>
          {note.clinicalAccuracy !== undefined && <span>Accuracy: {note.clinicalAccuracy}/10</span>}
          {note.missingSections?.length ? (
            <span className="text-amber-600">Missing: {note.missingSections.join(", ")}</span>
          ) : null}
        </div>
      )}
    </div>
  );
}
