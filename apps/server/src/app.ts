import { randomUUID } from "node:crypto";
import Fastify, {
  type FastifyInstance,
  type FastifyReply,
  type FastifyRequest,
} from "fastify";
import cookie from "@fastify/cookie";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import { evolve } from "@dglz/game-core";
import {
  CreateRoomCommandSchema,
  LoginCommandSchema,
  LoginResponseDataSchema,
  LogoutResponseDataSchema,
  PROTOCOL_VERSION,
  PROTOCOL_VERSION_HEADER,
  RoomIdSchema,
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
  loadRoom,
  UnsupportedPersistedEventError,
} from "./rooms.js";

export type ServerOptions = Readonly<{
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
  await app.register(helmet);
  await app.register(rateLimit, { global: false, hook: "preHandler" });
  app.addHook("onClose", (_instance, done) => {
    database.close();
    done();
  });

  app.addHook("onRequest", async (request, reply) => {
    if (!request.url.startsWith("/api/")) {
      return;
    }
    reply.header(PROTOCOL_VERSION_HEADER, String(PROTOCOL_VERSION));
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
    const data = deriveRoomView({ state, revision: 1 }, account.accountId);
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
        room = loadRoom(database, roomId.data);
      } catch (error) {
        if (error instanceof UnsupportedPersistedEventError) {
          return sendError(reply, "unsupported-persisted-event");
        }
        throw error;
      }
      if (room === undefined) {
        return sendError(reply, "room-not-found");
      }
      const data = deriveRoomView(room, account.accountId);
      if (data === undefined) {
        return sendError(reply, "forbidden");
      }
      return reply.send(successEnvelope(data));
    },
  );

  return app;
}
