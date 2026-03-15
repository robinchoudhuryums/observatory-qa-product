import { useState, useRef, useCallback, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Mic, Square, RotateCcw, Check, AlertCircle } from "lucide-react";

interface AudioRecorderProps {
  onRecordingComplete: (file: File) => void;
}

type RecorderState = "idle" | "recording" | "preview";

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function generateFileName(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `live-recording-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(now.getHours())}-${pad(now.getMinutes())}.webm`;
}

export default function AudioRecorder({ onRecordingComplete }: AudioRecorderProps) {
  const [state, setState] = useState<RecorderState>("idle");
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [recordedFile, setRecordedFile] = useState<File | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const animFrameRef = useRef<number | null>(null);

  // Check browser compatibility
  const isSupported =
    typeof navigator !== "undefined" &&
    typeof navigator.mediaDevices !== "undefined" &&
    typeof navigator.mediaDevices.getUserMedia === "function" &&
    typeof MediaRecorder !== "undefined";

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopVisualization();
      if (timerRef.current) clearInterval(timerRef.current);
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
      }
      if (audioCtxRef.current && audioCtxRef.current.state !== "closed") {
        audioCtxRef.current.close();
      }
      if (audioUrl) URL.revokeObjectURL(audioUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const stopVisualization = useCallback(() => {
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }
  }, []);

  const drawWaveform = useCallback(() => {
    const canvas = canvasRef.current;
    const analyser = analyserRef.current;
    if (!canvas || !analyser) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);

    const draw = () => {
      animFrameRef.current = requestAnimationFrame(draw);
      analyser.getByteTimeDomainData(dataArray);

      const width = canvas.width;
      const height = canvas.height;

      ctx.fillStyle = getComputedStyle(canvas).getPropertyValue("--waveform-bg") || "rgba(0,0,0,0)";
      ctx.clearRect(0, 0, width, height);

      ctx.lineWidth = 2;
      ctx.strokeStyle = getComputedStyle(canvas).getPropertyValue("--waveform-color") || "#3b82f6";
      ctx.beginPath();

      const sliceWidth = width / bufferLength;
      let x = 0;

      for (let i = 0; i < bufferLength; i++) {
        const v = dataArray[i] / 128.0;
        const y = (v * height) / 2;
        if (i === 0) {
          ctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }
        x += sliceWidth;
      }
      ctx.lineTo(width, height / 2);
      ctx.stroke();
    };

    draw();
  }, []);

  const startRecording = useCallback(async () => {
    setError(null);

    if (!isSupported) {
      setError("Your browser does not support audio recording. Please use a modern browser like Chrome, Firefox, or Edge.");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      // Set up audio context and analyser for visualization
      const audioCtx = new AudioContext();
      audioCtxRef.current = audioCtx;
      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 2048;
      source.connect(analyser);
      analyserRef.current = analyser;

      // Determine supported MIME type
      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : MediaRecorder.isTypeSupported("audio/webm")
          ? "audio/webm"
          : undefined;

      const mediaRecorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      mediaRecorderRef.current = mediaRecorder;
      chunksRef.current = [];

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          chunksRef.current.push(e.data);
        }
      };

      mediaRecorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: mimeType || "audio/webm" });
        const file = new File([blob], generateFileName(), { type: blob.type });
        const url = URL.createObjectURL(blob);

        // Clean up previous preview URL
        if (audioUrl) URL.revokeObjectURL(audioUrl);

        setRecordedFile(file);
        setAudioUrl(url);
        setState("preview");

        // Stop stream tracks
        stream.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      };

      mediaRecorder.start(250); // collect data every 250ms
      setState("recording");
      setElapsed(0);

      // Start timer
      timerRef.current = setInterval(() => {
        setElapsed((prev) => prev + 1);
      }, 1000);

      // Start visualization
      drawWaveform();
    } catch (err: unknown) {
      const message =
        err instanceof DOMException && err.name === "NotAllowedError"
          ? "Microphone access was denied. Please allow microphone permissions in your browser settings and try again."
          : err instanceof DOMException && err.name === "NotFoundError"
            ? "No microphone detected. Please connect a microphone and try again."
            : err instanceof Error
              ? `Could not access microphone: ${err.message}`
              : "An unexpected error occurred while accessing the microphone.";
      setError(message);
    }
  }, [isSupported, audioUrl, drawWaveform]);

  const stopRecording = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    stopVisualization();

    if (audioCtxRef.current && audioCtxRef.current.state !== "closed") {
      audioCtxRef.current.close();
      audioCtxRef.current = null;
    }

    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
    }
  }, [stopVisualization]);

  const reRecord = useCallback(() => {
    if (audioUrl) URL.revokeObjectURL(audioUrl);
    setAudioUrl(null);
    setRecordedFile(null);
    setElapsed(0);
    setState("idle");
  }, [audioUrl]);

  const useRecording = useCallback(() => {
    if (recordedFile) {
      onRecordingComplete(recordedFile);
      // Reset to idle after handing off
      if (audioUrl) URL.revokeObjectURL(audioUrl);
      setAudioUrl(null);
      setRecordedFile(null);
      setElapsed(0);
      setState("idle");
    }
  }, [recordedFile, onRecordingComplete, audioUrl]);

  if (!isSupported) {
    return (
      <Card>
        <CardContent className="p-6">
          <div className="flex items-center gap-3 text-amber-600 dark:text-amber-400">
            <AlertCircle className="w-5 h-5 shrink-0" />
            <div>
              <p className="font-medium">Browser Not Supported</p>
              <p className="text-sm text-muted-foreground mt-1">
                Audio recording requires a modern browser with MediaRecorder support (Chrome, Firefox, or Edge).
                Please update your browser or switch to a supported one.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="p-6 space-y-4">
        {/* Error display */}
        {error && (
          <div className="flex items-start gap-3 p-3 rounded-lg bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900">
            <AlertCircle className="w-5 h-5 text-red-600 dark:text-red-400 shrink-0 mt-0.5" />
            <div>
              <p className="text-sm text-red-800 dark:text-red-300">{error}</p>
            </div>
          </div>
        )}

        {/* Idle state */}
        {state === "idle" && (
          <div className="flex flex-col items-center py-8 space-y-4">
            <div className="w-20 h-20 rounded-full bg-red-100 dark:bg-red-950/40 flex items-center justify-center">
              <Mic className="w-8 h-8 text-red-600 dark:text-red-400" />
            </div>
            <div className="text-center">
              <p className="text-sm text-muted-foreground">
                Click to start recording from your microphone.
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                Put your phone on speaker and position it near the microphone.
              </p>
            </div>
            <Button onClick={startRecording} size="lg" className="gap-2">
              <Mic className="w-4 h-4" />
              Start Recording
            </Button>
          </div>
        )}

        {/* Recording state */}
        {state === "recording" && (
          <div className="flex flex-col items-center space-y-4">
            {/* Timer */}
            <div className="flex items-center gap-3">
              <span className="relative flex h-3 w-3">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-3 w-3 bg-red-500" />
              </span>
              <span className="text-2xl font-mono font-semibold text-foreground">
                {formatTime(elapsed)}
              </span>
            </div>

            {/* Waveform canvas */}
            <canvas
              ref={canvasRef}
              width={400}
              height={80}
              className="w-full max-w-md rounded-lg bg-muted"
              style={
                {
                  "--waveform-color": "hsl(var(--primary))",
                  "--waveform-bg": "transparent",
                } as React.CSSProperties
              }
            />

            {/* Stop button */}
            <Button
              onClick={stopRecording}
              variant="destructive"
              size="lg"
              className="gap-2"
            >
              <Square className="w-4 h-4" />
              Stop Recording
            </Button>
          </div>
        )}

        {/* Preview state */}
        {state === "preview" && audioUrl && (
          <div className="flex flex-col items-center space-y-4">
            <div className="text-center">
              <p className="text-sm font-medium text-foreground">Recording Preview</p>
              <p className="text-xs text-muted-foreground mt-1">
                Duration: {formatTime(elapsed)}
              </p>
            </div>

            {/* Audio playback */}
            <audio
              controls
              src={audioUrl}
              className="w-full max-w-md"
            />

            {/* Actions */}
            <div className="flex items-center gap-3">
              <Button onClick={reRecord} variant="outline" className="gap-2">
                <RotateCcw className="w-4 h-4" />
                Re-record
              </Button>
              <Button onClick={useRecording} className="gap-2">
                <Check className="w-4 h-4" />
                Use Recording
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
