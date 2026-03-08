/**
 * WebSocket service for broadcasting real-time call processing updates to connected clients.
 * HIPAA: Connections are authenticated via session cookie verification.
 * Multi-tenant: Updates are scoped to the user's organization.
 */
import { WebSocketServer, WebSocket } from "ws";
import type { Server, ServerResponse, IncomingMessage } from "http";
import { sessionMiddleware, resolveUserOrgId } from "../auth";

let wss: WebSocketServer | null = null;

// Map each WebSocket to its orgId for org-scoped broadcasting
const clientOrgMap = new WeakMap<WebSocket, string>();

export function setupWebSocket(server: Server) {
  wss = new WebSocketServer({ noServer: true });

  wss.on("connection", (ws, req) => {
    // orgId was attached during upgrade handler
    const orgId = (req as any).__orgId;
    if (orgId) {
      clientOrgMap.set(ws, orgId);
    }
    ws.send(JSON.stringify({ type: "connected" }));
  });

  // HIPAA: Authenticate WebSocket connections using the session cookie
  server.on("upgrade", (req: IncomingMessage, socket, head) => {
    // Only handle /ws path
    if (req.url !== "/ws") return;

    // Create a minimal response object for the session middleware
    const res = { writeHead() {}, end() {} } as unknown as ServerResponse;

    sessionMiddleware(req as any, res as any, () => {
      const session = (req as any).session;
      const passport = session?.passport;

      if (!passport?.user) {
        socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
        socket.destroy();
        return;
      }

      // Resolve orgId from the user's session ID
      const orgId = resolveUserOrgId(passport.user);
      (req as any).__orgId = orgId || "";

      wss!.handleUpgrade(req, socket, head, (ws) => {
        wss!.emit("connection", ws, req);
      });
    });
  });

  console.log("WebSocket server initialized on /ws");
}

/**
 * Broadcast a call processing update to all connected clients in the same organization.
 * If orgId is provided, only clients belonging to that org receive the message.
 * If orgId is omitted (backward compat), broadcasts to all clients.
 */
export function broadcastCallUpdate(callId: string, status: string, extra?: Record<string, any>, orgId?: string) {
  if (!wss) return;
  const message = JSON.stringify({ type: "call_update", callId, status, ...extra });
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      // If orgId filtering is active, only send to matching clients
      if (orgId) {
        const clientOrg = clientOrgMap.get(client);
        if (clientOrg && clientOrg !== orgId) return;
      }
      client.send(message);
    }
  });
}
