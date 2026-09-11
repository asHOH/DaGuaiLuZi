import { randomUUID } from "node:crypto";
import Fastify, {
  type FastifyInstance,
  type FastifyReply,
  type FastifyRequest,
} from "fastify";
import cookie from "@fastify/cookie";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import fastifyStatic from "@fastify/static";
import { Server as SocketIOServer, type Socket } from "socket.io";
import { evolve } from "@dglz/game-core";
import {
  CommandIdSchema,
  CreateChallengeCodeSchema,
  CreateRoomCommandSchema,
  LoginCommandSchema,
  LoginResponseDataSchema,
  LogoutResponseDataSchema,
  LookupChallengeCodeSchema,
  PROTOCOL_VERSION,
  PROTOCOL_VERSION_HEADER,
  RoomCommandAckSchema,
  RoomCommandEnvelopeSchema,
  RoomIdSchema,
  RoomViewSyncEnvelopeSchema,
  SOCKET_ROOM_COMMAND_EVENT,
  SOCKET_ROOM_VIEW_EVENT,
  type ProtocolErrorCode,
  type RoomCommandAck,
  errorEnvelope,
  parseProtocolVersion,
  successEnvelope,
} from "@dglz/protocol";

import {
  authenticate,
  createDummyPasswordHash,
  normalizeUsername,
  resolveSession,
  revokeSession,
  SESSION_COOKIE_NAME,
} from "./auth.js";
import { openDatabase } from "./db/index.js";
import {
  appendRoomCreated,
  defaultRoomRulesConfiguration,
  deriveRoomView,
  UnsupportedPersistedEventError,
} from "./rooms.js";
import { RoomExecutorRegistry, type RoomPresence } from "./room-executor.js";
import { challengePreview, lookupChallenge } from "./challenges.js";

export type ServerOptions = Readonly<{
  webRoot?: string;
  dbPath?: string;
  allowedOrigin?: string;
  secureCookies?: boolean;
  logger?: boolean;
}>;

const DEFAULT_DB_PATH = "data/daguailuzi.sqlite";

function normalizeAllowedOrigin(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  const url = new URL(value);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("invalid-allowed-origin");
  }
  return url.origin;
}

function errorStatus(code: Parameters<typeof errorEnvelope>[0]): number {
  switch (code) {
    case "reload-required":
    case "domain-rejected":
    case "stale-revision":
    case "command-id-reused":
      return 409;
    case "malformed-input":
      return 400;
    case "invalid-credentials":
    case "unauthorized":
      return 401;
    case "origin-forbidden":
    case "forbidden":
      return 403;
    case "room-not-found":
    case "not-found":
      return 404;
    case "rate-limited":
      return 429;
    case "unsupported-persisted-event":
    case "internal-error":
      return 500;
  }
}

function sendError(
  reply: FastifyReply,
  code: Parameters<typeof errorEnvelope>[0],
): FastifyReply {
  return reply.code(errorStatus(code)).send(errorEnvelope(code));
}

function requestCookieToken(request: FastifyRequest): string | undefined {
  return request.cookies[SESSION_COOKIE_NAME];
}

function requestAccount(
  database: ReturnType<typeof openDatabase>,
  request: FastifyRequest,
): ReturnType<typeof resolveSession> {
  return resolveSession(database, requestCookieToken(request));
}

type SocketData = {
  accountId?: string;
  sessionToken?: string;
  initialRoomId?: string;
};

function socketError(
  code: ProtocolErrorCode,
): Error & { data: { code: string } } {
  const error = new Error(code) as Error & { data: { code: string } };
  error.data = { code };
  return error;
}

function socketProtocolVersion(socket: Socket): number | undefined {
  const header = socket.handshake.headers[PROTOCOL_VERSION_HEADER];
  const fromHeader = parseProtocolVersion(
    typeof header === "string" || Array.isArray(header) ? header : undefined,
  );
  if (fromHeader !== undefined) {
    return fromHeader;
  }
  const auth = socket.handshake.auth as
    { protocolVersion?: unknown } | undefined;
  if (typeof auth?.protocolVersion === "number") {
    return Number.isSafeInteger(auth.protocolVersion)
      ? auth.protocolVersion
      : undefined;
  }
  return typeof auth?.protocolVersion === "string"
    ? parseProtocolVersion(auth.protocolVersion)
    : undefined;
}

function socketRequestedRoomId(
  socket: Socket,
):
  Readonly<{ provided: false }> | Readonly<{ provided: true; value: unknown }> {
  const auth = socket.handshake.auth as { roomId?: unknown } | undefined;
  if (auth !== undefined && Object.hasOwn(auth, "roomId")) {
    return { provided: true, value: auth.roomId };
  }
  if (Object.hasOwn(socket.handshake.query, "roomId")) {
    return { provided: true, value: socket.handshake.query.roomId };
  }
  return { provided: false };
}

function commandErrorAck(
  commandId: string,
  code: ProtocolErrorCode,
): RoomCommandAck {
  return RoomCommandAckSchema.parse({
    protocolVersion: PROTOCOL_VERSION,
    ok: false,
    commandId,
    error: { code },
  });
}

function commandIdFromUnknown(value: unknown): string {
  if (typeof value === "object" && value !== null && "commandId" in value) {
    const commandId = (value as { commandId?: unknown }).commandId;
    if (
      typeof commandId === "string" &&
      CommandIdSchema.safeParse(commandId).success
    ) {
      return commandId;
    }
  }
  return randomUUID();
}

function cookieOptions(secure: boolean): {
  httpOnly: true;
  sameSite: "lax";
  path: "/";
  secure: boolean;
  maxAge: number;
} {
  return {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure,
    maxAge: 30 * 24 * 60 * 60,
  };
}

export async function createApp(
  options: ServerOptions = {},
): Promise<FastifyInstance> {
  const allowedOrigin = normalizeAllowedOrigin(
    options.allowedOrigin ?? process.env.DGLZ_ALLOWED_ORIGIN,
  );
  const secureCookies = options.secureCookies ?? true;
  const dummyPasswordHash = await createDummyPasswordHash();
  const database = openDatabase(
    options.dbPath ?? process.env.DGLZ_DB_PATH ?? DEFAULT_DB_PATH,
  );
  const app = Fastify({ logger: options.logger ?? false });

  await app.register(cookie);
  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: { upgradeInsecureRequests: secureCookies ? [] : null },
    },
  });
  await app.register(rateLimit, { global: false, hook: "preHandler" });
  const roomExecutors = new RoomExecutorRegistry(database);
  const io = new SocketIOServer(app.server, {
    cors: {
      origin: allowedOrigin ?? false,
      credentials: true,
    },
    allowRequest: (request, callback) => {
      const originHeader = request.headers.origin;
      if (
        originHeader !== undefined &&
        (Array.isArray(originHeader) ||
          allowedOrigin === undefined ||
          originHeader !== allowedOrigin)
      ) {
        callback("origin-forbidden", false);
        return;
      }
      callback(null, true);
    },
  });

  io.use((socket, next) => {
    if (socketProtocolVersion(socket) !== PROTOCOL_VERSION) {
      next(socketError("reload-required"));
      return;
    }

    const cookieHeader = socket.handshake.headers.cookie;
    const token =
      typeof cookieHeader === "string"
        ? app.parseCookie(cookieHeader)[SESSION_COOKIE_NAME]
        : undefined;
    const account = resolveSession(database, token);
    if (account === undefined || token === undefined) {
      next(socketError("unauthorized"));
      return;
    }
    const expectedAccountId: unknown = socket.handshake.auth.accountId;
    if (
      expectedAccountId !== undefined &&
      expectedAccountId !== account.accountId
    ) {
      next(socketError("unauthorized"));
      return;
    }

    const requestedRoom = socketRequestedRoomId(socket);
    const data = socket.data as SocketData;
    data.accountId = account.accountId;
    data.sessionToken = token;
    if (!requestedRoom.provided) {
      next();
      return;
    }
    const parsedRoomId = RoomIdSchema.safeParse(requestedRoom.value);
    if (!parsedRoomId.success) {
      next(socketError("malformed-input"));
      return;
    }
    data.initialRoomId = parsedRoomId.data;

    void roomExecutors
      .getOrCreate(parsedRoomId.data)
      .then((executor) => {
        if (executor === undefined) {
          next(socketError("room-not-found"));
          return;
        }
        if (executor.viewFor(account.accountId) === undefined) {
          next(socketError("forbidden"));
          return;
        }
        next();
      })
      .catch(() => next(socketError("internal-error")));
  });

  async function publishRoomViews(
    roomId: string,
    executor: Awaited<ReturnType<typeof roomExecutors.getOrCreate>>,
  ): Promise<void> {
    if (executor === undefined) {
      return;
    }
    for (const connected of await io.in(roomId).fetchSockets()) {
      const data = connected.data as SocketData;
      const account = resolveSession(database, data.sessionToken);
      if (account === undefined || account.accountId !== data.accountId) {
        connected.disconnect(true);
        continue;
      }
      const view = executor.viewFor(account.accountId);
      if (view === undefined) {
        continue;
      }
      connected.emit(
        SOCKET_ROOM_VIEW_EVENT,
        RoomViewSyncEnvelopeSchema.parse({
          protocolVersion: PROTOCOL_VERSION,
          type: SOCKET_ROOM_VIEW_EVENT,
          data: view,
        }),
      );
    }
  }

  const connectedRoomAccounts =
    (roomId: string): RoomPresence =>
    async () => {
      const accountIds = new Set<string>();
      for (const connected of await io.in(roomId).fetchSockets()) {
        const data = connected.data as SocketData;
        const account = resolveSession(database, data.sessionToken);
        if (account === undefined || account.accountId !== data.accountId) {
          connected.disconnect(true);
          continue;
        }
        accountIds.add(account.accountId);
      }
      return accountIds;
    };

  io.on("connection", (socket) => {
    const data = socket.data as SocketData;
    const initialRoomId = data.initialRoomId;
    if (initialRoomId !== undefined) {
      void (async () => {
        const account = resolveSession(database, data.sessionToken);
        if (account === undefined || account.accountId !== data.accountId) {
          socket.disconnect(true);
          return;
        }
        await Promise.resolve(socket.join(initialRoomId));
        const executor = await roomExecutors.getOrCreate(initialRoomId);
        if (executor === undefined) {
          return;
        }
        await executor.resumeSettledHand(account.accountId);
        await executor.autoStart(connectedRoomAccounts(initialRoomId));
        await publishRoomViews(initialRoomId, executor);
      })().catch((error: unknown) => {
        app.log.error(
          { err: error, roomId: initialRoomId },
          "room sync failed",
        );
      });
    }

    socket.on(
      SOCKET_ROOM_COMMAND_EVENT,
      (raw: unknown, acknowledge?: (value: RoomCommandAck) => void) => {
        const respond =
          typeof acknowledge === "function" ? acknowledge : () => undefined;
        const commandId = commandIdFromUnknown(raw);
        const token = data.sessionToken;
        const account = resolveSession(database, token);
        if (account === undefined) {
          respond(commandErrorAck(commandId, "unauthorized"));
          return;
        }
        const parsed = RoomCommandEnvelopeSchema.safeParse(raw);
        if (!parsed.success) {
          const version =
            typeof raw === "object" && raw !== null && "protocolVersion" in raw
              ? (raw as { protocolVersion?: unknown }).protocolVersion
              : undefined;
          const incompatible =
            typeof version === "number" && version !== PROTOCOL_VERSION;
          respond(
            commandErrorAck(
              commandId,
              incompatible ? "reload-required" : "malformed-input",
            ),
          );
          return;
        }

        void roomExecutors
          .getOrCreate(parsed.data.roomId)
          .then(async (executor) => {
            if (executor === undefined) {
              respond(commandErrorAck(commandId, "room-not-found"));
              return;
            }
            await Promise.resolve(socket.join(parsed.data.roomId));
            const result = await executor.execute(
              account.accountId,
              parsed.data,
              connectedRoomAccounts(parsed.data.roomId),
            );
            respond(result);
            if (result.ok) {
              try {
                await publishRoomViews(parsed.data.roomId, executor);
              } catch (error) {
                app.log.error(
                  { err: error, roomId: parsed.data.roomId },
                  "room view publication failed",
                );
              }
            } else if (executor.viewFor(account.accountId) === undefined) {
              await Promise.resolve(socket.leave(parsed.data.roomId));
            }
          })
          .catch(() => respond(commandErrorAck(commandId, "internal-error")));
      },
    );
  });

  app.addHook("preClose", async () => {
    io.disconnectSockets(true);
    await io.close();
  });
  app.addHook("onClose", (_instance, done) => {
    database.close();
    done();
  });

  app.addHook("onRequest", async (request, reply) => {
    if (!request.url.startsWith("/api/")) {
      return;
    }
    reply.header(PROTOCOL_VERSION_HEADER, String(PROTOCOL_VERSION));
    reply.header("Cache-Control", "no-store");
    if (
      parseProtocolVersion(request.headers[PROTOCOL_VERSION_HEADER]) !==
      PROTOCOL_VERSION
    ) {
      sendError(reply, "reload-required");
      return;
    }

    if (request.method === "GET" || request.method === "HEAD") {
      return;
    }
    const originHeader = request.headers.origin;
    if (
      originHeader !== undefined &&
      (Array.isArray(originHeader) ||
        allowedOrigin === undefined ||
        originHeader !== allowedOrigin)
    ) {
      return sendError(reply, "origin-forbidden");
    }
  });

  app.setErrorHandler((error, _request, reply) => {
    if (reply.sent) {
      return;
    }
    if (error instanceof UnsupportedPersistedEventError) {
      sendError(reply, "unsupported-persisted-event");
      return;
    }
    if ((error as Error & { statusCode?: number }).statusCode === 429) {
      sendError(reply, "rate-limited");
      return;
    }
    if (
      error instanceof Error &&
      [
        "FST_ERR_CTP_BODY_TOO_LARGE",
        "FST_ERR_CTP_EMPTY_JSON_BODY",
        "FST_ERR_CTP_INVALID_JSON_BODY",
        "FST_ERR_CTP_INVALID_MEDIA_TYPE",
      ].includes((error as Error & { code?: string }).code ?? "")
    ) {
      sendError(reply, "malformed-input");
      return;
    }
    sendError(reply, "internal-error");
  });

  app.setNotFoundHandler((request, reply) => {
    if (request.url.startsWith("/api/")) {
      return sendError(reply, "not-found");
    }
    const pathname = request.url.split("?", 1)[0] ?? "";
    if (
      options.webRoot !== undefined &&
      (request.method === "GET" || request.method === "HEAD") &&
      (pathname === "/" || pathname.startsWith("/rooms/"))
    ) {
      return reply.header("Cache-Control", "no-cache").sendFile("index.html");
    }
    return reply.code(404).send();
  });

  app.post(
    "/api/login",
    {
      config: {
        rateLimit: {
          max: 5,
          timeWindow: "1 minute",
          keyGenerator: (request) => {
            const username = (request.body as { username?: unknown } | null)
              ?.username;
            return typeof username === "string"
              ? `account:${normalizeUsername(username)}`
              : `ip:${request.ip}`;
          },
        },
      },
    },
    async (request, reply) => {
      const parsed = LoginCommandSchema.safeParse(request.body);
      if (!parsed.success) {
        return sendError(reply, "malformed-input");
      }
      const session = await authenticate(
        database,
        parsed.data.username,
        parsed.data.password,
        dummyPasswordHash,
      );
      if (session === undefined) {
        return sendError(reply, "invalid-credentials");
      }
      const data = LoginResponseDataSchema.parse(session.account);
      reply.setCookie(
        SESSION_COOKIE_NAME,
        session.token,
        cookieOptions(secureCookies),
      );
      return reply.send(successEnvelope(data));
    },
  );

  app.post("/api/logout", async (request, reply) => {
    revokeSession(database, requestCookieToken(request));
    reply.clearCookie(SESSION_COOKIE_NAME, cookieOptions(secureCookies));
    return reply.send(successEnvelope(LogoutResponseDataSchema.parse({})));
  });

  app.get("/api/session", async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    const account = requestAccount(database, request);
    if (account === undefined) {
      return sendError(reply, "unauthorized");
    }
    return reply.send(successEnvelope(LoginResponseDataSchema.parse(account)));
  });

  app.post("/api/rooms", async (request, reply) => {
    const account = requestAccount(database, request);
    if (account === undefined) {
      return sendError(reply, "unauthorized");
    }
    const parsed = CreateRoomCommandSchema.safeParse(request.body);
    if (!parsed.success) {
      return sendError(reply, "malformed-input");
    }

    const event = {
      type: "RoomCreated" as const,
      roomId: randomUUID(),
      ownerId: account.accountId,
      rulesConfiguration: defaultRoomRulesConfiguration(parsed.data.rulesetId),
      seatingPolicy: parsed.data.seatingPolicy,
    };
    const state = evolve(undefined, event);
    appendRoomCreated(database, event);
    const data = deriveRoomView(
      { roomId: event.roomId, state, revision: 1 },
      account.accountId,
    );
    if (data === undefined) {
      return sendError(reply, "internal-error");
    }
    return reply.code(201).send(successEnvelope(data));
  });

  app.get<{ Params: { roomId: string } }>(
    "/api/rooms/:roomId",
    async (request, reply) => {
      const account = requestAccount(database, request);
      if (account === undefined) {
        return sendError(reply, "unauthorized");
      }
      const roomId = RoomIdSchema.safeParse(request.params.roomId);
      if (!roomId.success) {
        return sendError(reply, "malformed-input");
      }
      let room;
      try {
        room = await roomExecutors.getOrCreate(roomId.data);
      } catch (error) {
        if (error instanceof UnsupportedPersistedEventError) {
          return sendError(reply, "unsupported-persisted-event");
        }
        throw error;
      }
      if (room === undefined) {
        return sendError(reply, "room-not-found");
      }
      const data = room.viewFor(account.accountId);
      if (data === undefined) {
        return sendError(reply, "forbidden");
      }
      const revision = room.revision;
      await room.resumeSettledHand(account.accountId);
      if (room.revision !== revision) await publishRoomViews(roomId.data, room);
      return reply.send(successEnvelope(room.viewFor(account.accountId)!));
    },
  );

  app.post<{ Params: { roomId: string } }>(
    "/api/rooms/:roomId/challenges",
    async (request, reply) => {
      const account = requestAccount(database, request);
      if (account === undefined) return sendError(reply, "unauthorized");
      const roomId = RoomIdSchema.safeParse(request.params.roomId);
      const parsed = CreateChallengeCodeSchema.safeParse(request.body);
      if (!roomId.success || !parsed.success)
        return sendError(reply, "malformed-input");
      const room = await roomExecutors.getOrCreate(roomId.data);
      if (room === undefined) return sendError(reply, "room-not-found");
      const result = await room.createChallengeCode(
        account.accountId,
        parsed.data.handStartSequence,
      );
      return typeof result === "string"
        ? sendError(reply, result)
        : reply.send(successEnvelope(result));
    },
  );

  // Keep full Codes out of request URLs and their automatic access logs.
  app.post(
    "/api/challenges/lookup",
    {
      preValidation: async (request, reply) => {
        if (requestAccount(database, request) === undefined)
          return sendError(reply, "unauthorized");
      },
      config: {
        rateLimit: {
          max: 20,
          timeWindow: "1 minute",
          keyGenerator: (request) =>
            requestAccount(database, request)?.accountId ?? request.ip,
        },
      },
    },
    async (request, reply) => {
      const parsed = LookupChallengeCodeSchema.safeParse(request.body);
      if (!parsed.success) return sendError(reply, "malformed-input");
      const found = lookupChallenge(database, parsed.data.code);
      if (found === undefined) return sendError(reply, "not-found");
      return reply.send(
        successEnvelope(challengePreview(found.code, found.template)),
      );
    },
  );

  if (options.webRoot !== undefined) {
    await app.register(fastifyStatic, {
      root: options.webRoot,
      setHeaders: (response, path) => {
        response.header(
          "Cache-Control",
          /[/\\]assets[/\\]/.test(path)
            ? "public, max-age=31536000, immutable"
            : "no-cache",
        );
      },
    });
  }
  return app;
}
