import { useEffect, useRef, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";

interface CallUpdate {
  type: "call_update";
  callId: string;
  status: string;
  step?: number;
  totalSteps?: number;
  label?: string;
}

const MAX_RETRIES = 8;
const BASE_DELAY_MS = 1000;
const MAX_DELAY_MS = 30000;

export function useWebSocket() {
  const wsRef = useRef<WebSocket | null>(null);
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const reconnectTimer = useRef<ReturnType<typeof setTimeout>>();
  const retryCount = useRef(0);
  // Use a ref for toast to avoid it as a dependency (new ref each render)
  const toastRef = useRef(toast);
  toastRef.current = toast;

  const connect = useCallback(() => {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const url = `${protocol}//${window.location.host}/ws`;

    try {
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => {
        retryCount.current = 0; // Reset on successful connection
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === "live_transcript") {
            // Broadcast live transcript events to clinical-live page
            window.dispatchEvent(new CustomEvent("ws:live_transcript", { detail: data }));
            return;
          }
          if (data.type === "call_update") {
            // Broadcast to other components (e.g., file-upload progress tracking)
            window.dispatchEvent(new CustomEvent("ws:call_update", { detail: data }));

            if (data.status === "completed") {
              toastRef.current({
                title: "Call Processing Complete",
                description: data.label || "Your call has been analyzed and is ready to view.",
              });
              // Refresh calls and dashboard data
              queryClient.invalidateQueries({ queryKey: ["/api/calls"] });
              queryClient.invalidateQueries({ queryKey: ["/api/dashboard/metrics"] });
            } else if (data.status === "failed") {
              toastRef.current({
                title: "Call Processing Failed",
                description: data.label || "There was an error processing your call.",
                variant: "destructive",
              });
              queryClient.invalidateQueries({ queryKey: ["/api/calls"] });
            }
          }
        } catch {
          // Ignore malformed messages
        }
      };

      ws.onclose = () => {
        wsRef.current = null;
        if (retryCount.current < MAX_RETRIES) {
          const delay = Math.min(BASE_DELAY_MS * Math.pow(2, retryCount.current), MAX_DELAY_MS);
          retryCount.current++;
          reconnectTimer.current = setTimeout(connect, delay);
        }
      };

      ws.onerror = () => {
        ws.close();
      };
    } catch {
      // WebSocket not available, retry with backoff
      if (retryCount.current < MAX_RETRIES) {
        const delay = Math.min(BASE_DELAY_MS * Math.pow(2, retryCount.current), MAX_DELAY_MS);
        retryCount.current++;
        reconnectTimer.current = setTimeout(connect, delay);
      }
    }
  }, [queryClient]);

  useEffect(() => {
    connect();
    return () => {
      clearTimeout(reconnectTimer.current);
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [connect]);
}
