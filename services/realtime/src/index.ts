import { Server } from "socket.io";
import { Pool, PoolClient } from "pg";
import { createServer } from "node:http";
import { jwtVerify } from "jose";
import { DEFAULT_JWT_SECRET } from "@local/jwt";

const port = Number(process.env.REALTIME_PORT ?? 54323);
const databaseUrl =
  process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/app";

const pgPool = new Pool({ connectionString: databaseUrl });
let listenClient: PoolClient | null = null;
const httpServer = createServer();

async function getListenClient(): Promise<PoolClient> {
  if (!listenClient) {
    listenClient = await pgPool.connect();
  }
  return listenClient;
}

httpServer.on("request", (req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
  } else {
    res.writeHead(404);
    res.end("Not Found");
  }
});

const io = new Server(httpServer, {
  cors: { origin: "*", methods: ["GET", "POST"] },
  transports: ["websocket"],
  pingTimeout: 60000,
  pingInterval: 25000,
});

type AuthClaims = {
  sub: string;
  role: "anon" | "authenticated" | "service_role";
  email?: string;
};

type ClientState = {
  channels: Set<string>;
  presence: Map<string, unknown>;
};

type ChannelState = {
  clients: Set<string>;
  presence: Map<string, unknown>;
};

type RealtimeMessage = {
  event: string;
  topic: string;
  payload?: unknown;
  ref?: string;
};

type PresenceJoinEvent = {
  event: "presence_state";
  topic: string;
  payload: Record<string, unknown>;
  ref: string;
};

type PresenceDiffEvent = {
  event: "presence_diff";
  topic: string;
  payload: {
    joins: Record<string, unknown>;
    leaves: Record<string, unknown>;
  };
  ref: string;
};

type BroadcastEvent = {
  event: string;
  topic: string;
  payload: { [key: string]: unknown };
  ref: string;
};

type SubscribeEvent = {
  event: "phx_join";
  topic: string;
  payload?: { config?: { postgres_changes?: Array<{ event: string; schema?: string; table?: string; filter?: string }> } };
  ref: string;
};

type UnsubscribeEvent = {
  event: "phx_leave";
  topic: string;
  ref: string;
};

type HeartbeatEvent = {
  event: "heartbeat";
  topic: string;
  ref: string;
};

const clients = new Map<string, ClientState>();
const channels = new Map<string, ChannelState>();

async function verifyJwt(token: string): Promise<AuthClaims | null> {
  try {
    const { payload } = await jwtVerify(
      token,
      new TextEncoder().encode(DEFAULT_JWT_SECRET),
    );
    return {
      sub: String(payload.sub),
      role: (payload.role as "anon" | "authenticated" | "service_role") || "anon",
      email: payload.email as string | undefined,
    };
  } catch {
    return null;
  }
}

function getClientState(socketId: string): ClientState {
  let state = clients.get(socketId);
  if (!state) {
    state = { channels: new Set(), presence: new Map() };
    clients.set(socketId, state);
  }
  return state;
}

function getChannelState(channelName: string): ChannelState {
  let state = channels.get(channelName);
  if (!state) {
    state = { clients: new Set(), presence: new Map() };
    channels.set(channelName, state);
  }
  return state;
}

function canAccessChannel(channelName: string, claims: AuthClaims): boolean {
  if (channelName.startsWith("public:")) return true;
  if (channelName.startsWith("authenticated:") && claims.role === "authenticated")
    return true;
  if (channelName.startsWith("private:") && claims.sub) return true;
  return false;
}

function isPostgresChannel(channelName: string): boolean {
  return channelName.startsWith("postgres:");
}

async function subscribeToPostgresChanges(
  socketId: string,
  channelName: string,
  config?: { postgres_changes?: Array<{ event: string; schema?: string; table?: string; filter?: string }> },
) {
  if (!config?.postgres_changes) return;

  for (const change of config.postgres_changes) {
    const channel = `${change.schema || "public"}:${change.table || "*"}`;

    const lc = await getListenClient();
    await lc.query(`LISTEN ${channel}`);

    lc.on("notification", async (notification) => {
      if (notification.channel !== channel) return;
      
      const socket = io.sockets.sockets.get(socketId);
      if (!socket || !socket.connected) return;
      
      try {
        const payload = JSON.parse(notification.payload || "{}");
        
        socket.emit("postgres_changes", {
          event: change.event,
          schema: change.schema,
          table: change.table,
          payload,
        });
      } catch (error) {
        console.error(`Failed to parse postgres notification:`, error);
      }
    });
  }
}

async function unsubscribeFromPostgresChanges(channelName: string) {
  if (!listenClient) return;
  const parts = channelName.split(":");
  if (parts.length >= 3) {
    const [_, schema, table] = parts;
    await listenClient.query(`UNLISTEN ${schema}:${table}`);
  }
}

function broadcastToChannel(
  channelName: string,
  excludeSocketId: string,
  event: string,
  payload: unknown,
) {
  const channelState = channels.get(channelName);
  if (!channelState) return;

  const message: RealtimeMessage = {
    event,
    topic: channelName,
    payload,
    ref: Date.now().toString(),
  };

  for (const clientSocketId of channelState.clients) {
    if (clientSocketId === excludeSocketId) continue;
    
    const socket = io.sockets.sockets.get(clientSocketId);
    if (socket?.connected) {
      socket.emit("message", message);
    }
  }
}

function sendPresenceState(socketId: string, channelName: string) {
  const channelState = channels.get(channelName);
  if (!channelState) return;

  const presenceState = Object.fromEntries(channelState.presence);
  
  const socket = io.sockets.sockets.get(socketId);
  if (socket?.connected) {
    const event: PresenceJoinEvent = {
      event: "presence_state",
      topic: channelName,
      payload: presenceState,
      ref: Date.now().toString(),
    };
    socket.emit("message", event);
  }
}

function broadcastPresenceDiff(
  channelName: string,
  joins: Record<string, unknown>,
  leaves: Record<string, unknown>,
) {
  if (Object.keys(joins).length === 0 && Object.keys(leaves).length === 0) return;

  const event: PresenceDiffEvent = {
    event: "presence_diff",
    topic: channelName,
    payload: { joins, leaves },
    ref: Date.now().toString(),
  };

  broadcastToChannel(channelName, "", event.event, event);
}

async function main() {
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth.token || socket.handshake.headers.authorization?.replace("Bearer ", "");
      
      if (!token) {
        return next(new Error("Authentication required"));
      }

      const claims = await verifyJwt(token);
      if (!claims) {
        return next(new Error("Invalid JWT"));
      }

      socket.data.claims = claims;
      socket.data.socketId = socket.id;
      getClientState(socket.id);
      
      next();
    } catch (error) {
      next(new Error("Authentication failed"));
    }
  });

  io.on("connection", (socket) => {
    const claims = socket.data.claims as AuthClaims;
    const socketId = socket.id;
    console.log(`Client connected: ${socketId} (${claims.role} - ${claims.sub})`);

    socket.on("message", async (message: string) => {
      try {
        const msg = JSON.parse(message) as RealtimeMessage;
        const clientState = getClientState(socketId);

        switch (msg.event) {
          case "phx_join": {
            const joinMsg = msg as SubscribeEvent;
            
            if (!canAccessChannel(joinMsg.topic, claims)) {
              socket.emit("error", { message: "Access denied to channel" });
              return;
            }

            const channelState = getChannelState(joinMsg.topic);
            channelState.clients.add(socketId);
            clientState.channels.add(joinMsg.topic);

            if (isPostgresChannel(joinMsg.topic) && joinMsg.payload?.config) {
              await subscribeToPostgresChanges(socketId, joinMsg.topic, joinMsg.payload.config);
            }

            sendPresenceState(socketId, joinMsg.topic);
            
            const socketInstance = io.sockets.sockets.get(socketId);
            if (socketInstance?.connected) {
              socketInstance.emit("phx_reply", {
                event: "phx_reply",
                topic: joinMsg.topic,
                ref: joinMsg.ref,
                payload: { status: "ok" },
              });
            }
            break;
          }

          case "phx_leave": {
            const leaveMsg = msg as UnsubscribeEvent;
            
            const channelState = channels.get(leaveMsg.topic);
            if (channelState) {
              channelState.clients.delete(socketId);
              
              const presenceData = channelState.presence.get(socketId);
              if (presenceData) {
                channelState.presence.delete(socketId);
                broadcastPresenceDiff(leaveMsg.topic, {}, { [socketId]: presenceData });
              }
              
              if (channelState.clients.size === 0) {
                if (isPostgresChannel(leaveMsg.topic)) {
                  await unsubscribeFromPostgresChanges(leaveMsg.topic);
                }
                channels.delete(leaveMsg.topic);
              }
            }

            clientState.channels.delete(leaveMsg.topic);
            
            const socketInstance = io.sockets.sockets.get(socketId);
            if (socketInstance?.connected) {
              socketInstance.emit("phx_reply", {
                event: "phx_reply",
                topic: leaveMsg.topic,
                ref: leaveMsg.ref,
                payload: { status: "ok" },
              });
            }
            break;
          }

          case "broadcast": {
            const broadcastMsg = msg as BroadcastEvent;
            
            if (!clientState.channels.has(broadcastMsg.topic)) {
              return;
            }

            broadcastToChannel(
              broadcastMsg.topic,
              socketId,
              broadcastMsg.event,
              broadcastMsg.payload,
            );
            break;
          }

          case "presence": {
            if (!msg.payload || typeof msg.payload !== "object") return;
            
            for (const [channelName, data] of Object.entries(msg.payload)) {
              if (!clientState.channels.has(channelName)) continue;
              
              const channelState = getChannelState(channelName);
              const oldPresence = channelState.presence.get(socketId);
              
              if (oldPresence) {
                channelState.presence.set(socketId, data);
                broadcastPresenceDiff(
                  channelName,
                  { [socketId]: data },
                  { [socketId]: oldPresence },
                );
              } else {
                channelState.presence.set(socketId, data);
                clientState.presence.set(channelName, data);
                broadcastPresenceDiff(channelName, { [socketId]: data }, {});
              }
            }
            break;
          }

          case "heartbeat": {
            const heartbeatMsg = msg as HeartbeatEvent;
            
            const socketInstance = io.sockets.sockets.get(socketId);
            if (socketInstance?.connected) {
              socketInstance.emit("phx_reply", {
                event: "phx_reply",
                topic: heartbeatMsg.topic,
                ref: heartbeatMsg.ref,
                payload: {},
              });
            }
            break;
          }

          default:
            console.warn(`Unknown event: ${msg.event}`);
        }
      } catch (error) {
        console.error(`Error processing message:`, error);
        socket.emit("error", { message: "Invalid message format" });
      }
    });

    socket.on("disconnect", async () => {
      console.log(`Client disconnected: ${socketId}`);
      
      const clientState = clients.get(socketId);
      if (clientState) {
        for (const channelName of clientState.channels) {
          const channelState = channels.get(channelName);
          if (channelState) {
            channelState.clients.delete(socketId);
            
            const presenceData = channelState.presence.get(socketId);
            if (presenceData) {
              channelState.presence.delete(socketId);
              broadcastPresenceDiff(channelName, {}, { [socketId]: presenceData });
            }
            
            if (channelState.clients.size === 0) {
              if (isPostgresChannel(channelName)) {
                await unsubscribeFromPostgresChanges(channelName);
              }
              channels.delete(channelName);
            }
          }
        }
        clients.delete(socketId);
      }
    });
  });

  io.on("error", (error) => {
    console.error(`Socket.IO error:`, error);
  });

  httpServer.listen(port, () => {
    console.log(`Realtime WebSocket server listening on port ${port}`);
  });
}

main().catch((error) => {
  console.error("Failed to start realtime server:", error);
  process.exit(1);
});