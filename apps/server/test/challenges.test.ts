import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import {
  decide,
  derivePlayerView,
  evolve,
  RANDOMNESS_VERSION,
  SHUFFLE_VERSION,
  type ChallengeTemplate,
  type Command,
  type Event,
  type State,
} from "@dglz/game-core";
import {
  ChallengeResponseEnvelopeSchema,
  PROTOCOL_VERSION,
  PROTOCOL_VERSION_HEADER,
  rulesConfigurationPreset,
  type ChallengePreview,
  type RulesetId,
} from "@dglz/protocol";
import { eq } from "drizzle-orm";
import { createApp } from "../src/app.js";
import { hashSessionToken } from "../src/auth.js";
import { createChallengeCode, lookupChallenge } from "../src/challenges.js";
import { openDatabase } from "../src/db/index.js";
import { accounts, challengeTemplates, sessions } from "../src/db/schema.js";
import { RoomExecutorRegistry } from "../src/room-executor.js";
import {
  appendRoomCreated,
  appendRoomEvents,
  readRoomEvents,
  UnsupportedPersistedEventError,
} from "../src/rooms.js";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

function apply(
  state: State,
  command: Command,
): { state: State; events: readonly Event[] } {
  const decision = decide(state, command);
  if (!decision.ok) throw new Error(decision.rejection.reason);
  return {
    state: decision.events.reduce(evolve, state),
    events: decision.events,
  };
}

async function source(rulesetId: RulesetId = "dglz-4p-2d-v1") {
  const directory = await mkdtemp(join(tmpdir(), "dglz-challenges-"));
  cleanups.push(() =>
    rm(directory, { recursive: true, force: true, maxRetries: 3 }),
  );
  const dbPath = join(directory, "room.sqlite");
  const database = openDatabase(dbPath);
  cleanups.push(async () => database.close());
  const playerIds = Array.from(
    { length: rulesetId === "dglz-4p-2d-v1" ? 4 : 6 },
    () => randomUUID(),
  );
  const roomId = randomUUID();
  const created: Extract<Event, { type: "RoomCreated" }> = {
    type: "RoomCreated",
    roomId,
    ownerId: playerIds[0]!,
    rulesConfiguration: rulesConfigurationPreset(rulesetId, "省心"),
    seatingPolicy: "randomized",
  };
  appendRoomCreated(database, created);
  let state = evolve(undefined, created);
  let revision = 1;
  function send(command: Command) {
    const next = apply(state, command);
    appendRoomEvents(database, {
      roomId,
      expectedRevision: revision,
      causationCommandId: null,
      events: next.events,
    });
    state = next.state;
    revision += next.events.length;
    return next.events;
  }
  for (const playerId of playerIds.slice(1))
    send({ type: "JoinRoom", playerId });
  send({ type: "SelectMatch", playerId: playerIds[0]! });
  for (const [seatIndex, playerId] of playerIds.entries()) {
    send({ type: "AssignSeat", playerId, seatIndex });
    send({ type: "SetReadiness", playerId, ready: true });
  }
  const initialStart = revision + 1;
  send({
    type: "StartMatch",
    handSeed: "challenge-source-0",
    randomnessVersion: RANDOMNESS_VERSION,
    shuffleVersion: SHUFFLE_VERSION,
  });
  return {
    database,
    dbPath,
    roomId,
    playerIds,
    initialStart,
    send,
    state: () => state,
    revision: () => revision,
    finish() {
      for (let step = 0; step < 1500; step++) {
        const view = derivePlayerView(state, playerIds[0]!);
        if (view.handResult !== undefined) return;
        if (view.setupStage === "return-card-selection") {
          const playerId = view.pendingPlayerIds![0]!;
          const own = derivePlayerView(state, playerId);
          send({ type: "SelectReturnCard", playerId, card: own.hand![0]! });
          continue;
        }
        const playerId = view.currentActor!;
        const own = derivePlayerView(state, playerId);
        const card =
          view.unbeatenPlay === undefined
            ? own.hand![0]
            : own.hand!.find(
                (candidate) =>
                  decide(state, { type: "Play", playerId, cards: [candidate] })
                    .ok,
              );
        send(
          card === undefined
            ? { type: "Pass", playerId }
            : { type: "Play", playerId, cards: [card] },
        );
      }
      throw new Error("source-hand-did-not-finish");
    },
  };
}

function setupSnapshot(state: State) {
  const view = derivePlayerView(state, "public");
  return {
    configuration: view.effectiveRulesConfiguration ?? view.rulesConfiguration,
    teamLevels: view.teamLevels,
    trumpRank: view.trumpRank,
    failureCounters: view.failureCounters,
    actorSeat: view.currentActorSeat,
    setupStage: view.setupStage,
    hands: view.seats.map(
      (seat) => derivePlayerView(state, seat.playerId!).hand,
    ),
    tributes: view.tributeTransfers?.map(
      ({ giverSeat, recipientSeat, card, rank }) => ({
        giverSeat,
        recipientSeat,
        card,
        rank,
      }),
    ),
  };
}

function challengeStart(template: ChallengeTemplate): State {
  const count = template.rulesetId === "dglz-4p-2d-v1" ? 4 : 6;
  let state = evolve(undefined, {
    type: "RoomCreated",
    roomId: randomUUID(),
    ownerId: "copy0",
    rulesConfiguration: template.rulesConfiguration,
    seatingPolicy: "fixed",
  });
  for (let index = 1; index < count; index++)
    state = apply(state, { type: "JoinRoom", playerId: `copy${index}` }).state;
  state = apply(state, {
    type: "SelectChallengeHand",
    playerId: "copy0",
    template,
  }).state;
  for (let seatIndex = 0; seatIndex < count; seatIndex++) {
    const playerId = `copy${seatIndex}`;
    state = apply(state, { type: "AssignSeat", playerId, seatIndex }).state;
    state = apply(state, { type: "SetReadiness", playerId, ready: true }).state;
  }
  return apply(state, { type: "StartChallengeHand" }).state;
}

function preview(value: ChallengePreview | string): ChallengePreview {
  if (typeof value === "string") throw new Error(value);
  return value;
}

for (const rulesetId of ["dglz-4p-2d-v1", "dglz-6p-3d-v1"] as const) {
  it(`${rulesetId}: materializes stable Codes and reproduces initial and subsequent setup by logical seat`, async () => {
    const game = await source(rulesetId);
    const initial = setupSnapshot(game.state());
    game.finish();
    const nextStart = game.revision() + 1;
    const previous = derivePlayerView(game.state(), game.playerIds[0]!);
    expect(previous.handResult?.outcome).toBe("win");
    expect(previous.handResult?.caughtPlayerIds.length).toBeGreaterThan(0);
    game.send({
      type: "StartNextHand",
      handSeed: "challenge-next",
      randomnessVersion: RANDOMNESS_VERSION,
      shuffleVersion: SHUFFLE_VERSION,
    });
    const subsequent = setupSnapshot(game.state());
    expect(subsequent.tributes!.length).toBeGreaterThan(0);
    game.finish();
    const history = [...readRoomEvents(game.database, game.roomId)];
    const registry = new RoomExecutorRegistry(game.database);
    const executor = (await registry.getOrCreate(game.roomId))!;
    const requests = await Promise.all(
      game.playerIds.map((id) =>
        executor.createChallengeCode(id, game.initialStart),
      ),
    );
    expect(
      requests.every(
        (result) => JSON.stringify(result) === JSON.stringify(requests[0]),
      ),
    ).toBe(true);
    const first = preview(requests[0]!);
    expect(first.code).toMatch(/^[0-9a-f]{32}$/);
    const second = preview(
      await executor.createChallengeCode(game.playerIds[0]!, nextStart),
    );
    expect(second.code).not.toBe(first.code);
    const initialTemplate = lookupChallenge(
      game.database,
      first.code,
    )!.template;
    const nextTemplate = lookupChallenge(game.database, second.code)!.template;
    expect(setupSnapshot(challengeStart(initialTemplate))).toEqual(initial);
    expect(setupSnapshot(challengeStart(nextTemplate))).toEqual(subsequent);
    expect(setupSnapshot(challengeStart(nextTemplate))).toEqual(subsequent);
    expect(JSON.stringify(nextTemplate)).not.toContain(game.playerIds[0]);
    expect(JSON.stringify(first)).not.toContain("handSeed");
    expect([...readRoomEvents(game.database, game.roomId)]).toEqual(history);
    expect(executor.revision).toBe(game.revision());
    expect(
      game.database.db.select().from(challengeTemplates).all(),
    ).toHaveLength(2);
    const reopened = openDatabase(game.dbPath);
    try {
      expect(lookupChallenge(reopened, second.code)!.template).toEqual(
        nextTemplate,
      );
      expect(
        createChallengeCode(
          reopened,
          game.roomId,
          game.initialStart,
          game.playerIds[0]!,
        ),
      ).toEqual(first);
    } finally {
      reopened.close();
    }
  }, 15000);
}

it("rejects incomplete/aborted Hands and nonparticipants; different Matches have different source references", async () => {
  const game = await source();
  expect(
    createChallengeCode(
      game.database,
      game.roomId,
      game.initialStart,
      game.playerIds[0]!,
    ),
  ).toBe("not-found");
  game.finish();
  expect(
    createChallengeCode(
      game.database,
      game.roomId,
      game.initialStart,
      "outsider",
    ),
  ).toBe("forbidden");
  expect(
    createChallengeCode(game.database, game.roomId, 1, game.playerIds[0]!),
  ).toBe("not-found");
  const first = preview(
    createChallengeCode(
      game.database,
      game.roomId,
      game.initialStart,
      game.playerIds[0]!,
    ),
  );
  const abortedStart = game.revision() + 1;
  game.send({
    type: "StartNextHand",
    handSeed: "aborted",
    randomnessVersion: RANDOMNESS_VERSION,
    shuffleVersion: SHUFFLE_VERSION,
  });
  game.send({ type: "AbortMatch", playerId: game.playerIds[0]! });
  expect(
    createChallengeCode(
      game.database,
      game.roomId,
      abortedStart,
      game.playerIds[0]!,
    ),
  ).toBe("not-found");
  game.send({ type: "SelectMatch", playerId: game.playerIds[0]! });
  for (const playerId of game.playerIds)
    game.send({ type: "SetReadiness", playerId, ready: true });
  const secondStart = game.revision() + 1;
  game.send({
    type: "StartMatch",
    handSeed: "challenge-source-0",
    randomnessVersion: RANDOMNESS_VERSION,
    shuffleVersion: SHUFFLE_VERSION,
  });
  game.finish();
  const second = preview(
    createChallengeCode(
      game.database,
      game.roomId,
      secondStart,
      game.playerIds[0]!,
    ),
  );
  expect(second.code).not.toBe(first.code);
  expect(
    createChallengeCode(
      game.database,
      game.roomId,
      game.initialStart,
      game.playerIds[0]!,
    ),
  ).toEqual(first);
});

it("rolls back failed Code creation and rejects corrupted or incompatible stored Templates", async () => {
  const game = await source();
  game.finish();
  const create = () =>
    createChallengeCode(
      game.database,
      game.roomId,
      game.initialStart,
      game.playerIds[0]!,
    );
  game.database.sqlite.exec(
    "CREATE TRIGGER fail_challenge BEFORE INSERT ON challenge_templates BEGIN SELECT RAISE(ABORT, 'forced-failure'); END",
  );
  expect(create).toThrow("forced-failure");
  expect(game.database.db.select().from(challengeTemplates).all()).toHaveLength(
    0,
  );
  game.database.sqlite.exec("DROP TRIGGER fail_challenge");
  const result = preview(create());
  const saved = game.database.db.select().from(challengeTemplates).get()!;
  for (const template of [
    "{",
    JSON.stringify({}),
    JSON.stringify({
      ...lookupChallenge(game.database, result.code)!.template,
      shuffleVersion: "unsupported",
    }),
  ]) {
    game.database.db.update(challengeTemplates).set({ template }).run();
    expect(() => lookupChallenge(game.database, result.code)).toThrow(
      UnsupportedPersistedEventError,
    );
  }
  game.database.db
    .update(challengeTemplates)
    .set({ template: saved.template, templateSchemaVersion: 999 })
    .run();
  expect(() => lookupChallenge(game.database, result.code)).toThrow(
    UnsupportedPersistedEventError,
  );
});

it("requires authentication, limits invalid lookups, returns public metadata, and keeps Codes out of logs", async () => {
  const game = await source();
  game.finish();
  const outsider = randomUUID();
  // Auth/session behavior is covered separately; seed valid opaque sessions for these endpoints.
  for (const id of [game.playerIds[0]!, outsider]) {
    game.database.db
      .insert(accounts)
      .values({
        id,
        username: id,
        passwordHash: "unused",
        createdAt: Date.now(),
      })
      .run();
    game.database.db
      .insert(sessions)
      .values({
        tokenHash: hashSessionToken(id),
        accountId: id,
        createdAt: Date.now(),
        expiresAt: Date.now() + 60000,
      })
      .run();
  }
  const logs: string[] = [];
  const stdout = vi
    .spyOn(process.stdout, "write")
    .mockImplementation((chunk) => {
      logs.push(String(chunk));
      return true;
    });
  cleanups.push(async () => stdout.mockRestore());
  const app = await createApp({
    dbPath: game.dbPath,
    allowedOrigin: "https://game.example",
    secureCookies: false,
    logger: true,
  });
  cleanups.push(() => app.close());
  const request = (url: string, body: unknown, id?: string) =>
    app.inject({
      method: "POST",
      url,
      payload: body as Record<string, unknown>,
      headers: {
        [PROTOCOL_VERSION_HEADER]: String(PROTOCOL_VERSION),
        origin: "https://game.example",
        ...(id === undefined ? {} : { cookie: `dglz_session=${id}` }),
      },
    });
  const createUrl = `/api/rooms/${game.roomId}/challenges`;
  const body = { handStartSequence: game.initialStart };
  expect((await request(createUrl, body)).statusCode).toBe(401);
  expect((await request(createUrl, body, outsider)).statusCode).toBe(403);
  expect(
    (await request(createUrl, { handStartSequence: 1.5 }, game.playerIds[0]))
      .statusCode,
  ).toBe(400);
  const created = await request(createUrl, body, game.playerIds[0]);
  expect(created.statusCode).toBe(200);
  const data = ChallengeResponseEnvelopeSchema.parse(created.json()).data;
  expect(
    (await request("/api/challenges/lookup", { code: data.code })).statusCode,
  ).toBe(401);
  const found = await request(
    "/api/challenges/lookup",
    { code: data.code },
    outsider,
  );
  expect(found.statusCode).toBe(200);
  expect(ChallengeResponseEnvelopeSchema.parse(found.json()).data).toEqual(
    data,
  );
  expect(Object.keys(data).sort()).toEqual([
    "code",
    "rulesConfiguration",
    "teamLevels",
    "trumpRank",
  ]);
  expect(found.headers["cache-control"]).toBe("no-store");
  const malformedCode = `${data.code}!`;
  expect(
    (await request("/api/challenges/lookup", { code: malformedCode }, outsider))
      .statusCode,
  ).toBe(400);
  const output = logs.join("");
  expect(output).toContain(createUrl);
  expect(output).toContain("/api/challenges/lookup");
  expect(output).toContain('"statusCode":200');
  expect(output).toContain('"statusCode":400');
  expect(output).not.toContain(data.code);
  expect(output).not.toContain(malformedCode);
  for (let i = 0; i < 18; i++) {
    expect(
      (
        await request(
          "/api/challenges/lookup",
          { code: i.toString(16).padStart(32, "0") },
          outsider,
        )
      ).statusCode,
    ).toBe(404);
  }
  expect(
    (await request("/api/challenges/lookup", { code: data.code }, outsider))
      .statusCode,
  ).toBe(429);
  expect(
    (
      await request(
        "/api/challenges/lookup",
        { code: data.code },
        game.playerIds[0],
      )
    ).statusCode,
  ).toBe(200);
  game.database.db
    .update(challengeTemplates)
    .set({ templateSchemaVersion: 999 })
    .where(eq(challengeTemplates.code, data.code))
    .run();
  const incompatible = await request(
    "/api/challenges/lookup",
    { code: data.code },
    game.playerIds[0],
  );
  expect(incompatible.statusCode).toBe(500);
  expect(incompatible.json()).toMatchObject({
    error: { code: "unsupported-persisted-event" },
  });
  game.database.db.update(sessions).set({ revokedAt: Date.now() }).run();
  expect((await request(createUrl, body, game.playerIds[0])).statusCode).toBe(
    401,
  );
  expect(
    (await request("/api/challenges/lookup", { code: data.code }, outsider))
      .statusCode,
  ).toBe(401);
});
