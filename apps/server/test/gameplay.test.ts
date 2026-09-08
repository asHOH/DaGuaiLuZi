import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { io, type Socket } from "socket.io-client";
import {
  decide,
  derivePlayerView,
  evolve,
  RANDOMNESS_VERSION,
  SHUFFLE_VERSION,
  type Command,
  type Event,
} from "@dglz/game-core";
import {
  PROTOCOL_VERSION,
  rulesConfigurationPreset,
  PROTOCOL_VERSION_HEADER,
  RoomCommandAckSchema,
  RoomResponseEnvelopeSchema,
  RoomViewSyncEnvelopeSchema,
  type RoomCommandEnvelope,
  type RoomCommandPayload,
  type RoomViewData,
  type RulesetId,
} from "@dglz/protocol";
import { createApp } from "../src/app.js";
import { provisionAccount } from "../src/auth.js";
import { openDatabase } from "../src/db/index.js";
import { appendRoomCreated, appendRoomEvents } from "../src/rooms.js";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function table(
  rulesetId: RulesetId,
  terminal = false,
  preset: "省心" | "自主" = "省心",
  fixture?: {
    initialSeed: string;
    nextSeed?: string;
    randomTribute?: boolean;
    deferConnect?: boolean;
  },
) {
  const directory = await mkdtemp(join(tmpdir(), "dglz-gameplay-"));
  cleanups.push(() =>
    rm(directory, { recursive: true, force: true, maxRetries: 3 }),
  );
  const dbPath = join(directory, "room.sqlite");
  const database = openDatabase(dbPath);
  cleanups.push(async () => database.close());
  const accounts = [];
  for (let i = 0; i < (rulesetId === "dglz-4p-2d-v1" ? 4 : 6); i++) {
    accounts.push(
      await provisionAccount(database, {
        username: `player${i}`,
        password: "secret",
      }),
    );
  }
  const roomId = randomUUID();
  const created: Event = {
    type: "RoomCreated",
    roomId,
    ownerId: accounts[0]!.accountId,
    rulesConfiguration: {
      ...rulesConfigurationPreset(rulesetId, preset),
      ...(fixture?.randomTribute
        ? { tributeCardSelection: "fair-random" as const }
        : {}),
    },
    seatingPolicy: "fixed",
  };
  appendRoomCreated(database, created);
  let state = evolve(undefined, created);
  let revision = 1;
  const seedCommand = (command: Command) => {
    const decision = decide(state, command);
    if (!decision.ok) throw new Error(decision.rejection.reason);
    // Start at level 5 only for the terminal serialization fixture.
    const events = decision.events.map((event): Event =>
      terminal && event.type === "MatchStarted"
        ? { ...event, teamLevels: ["5", "5"], trumpRank: "5" }
        : event,
    );
    appendRoomEvents(database, {
      roomId,
      expectedRevision: revision,
      causationCommandId: null,
      events,
    });
    revision += events.length;
    for (const event of events) state = evolve(state, event);
  };
  for (const account of accounts.slice(1))
    seedCommand({ type: "JoinRoom", playerId: account.accountId });
  seedCommand({ type: "SelectMatch", playerId: accounts[0]!.accountId });
  for (const [seatIndex, account] of accounts.entries()) {
    seedCommand({ type: "AssignSeat", playerId: account.accountId, seatIndex });
    seedCommand({
      type: "SetReadiness",
      playerId: account.accountId,
      ready: true,
    });
  }
  seedCommand({
    type: "StartMatch",
    handSeed: fixture?.initialSeed ?? "gameplay-integration",
    randomnessVersion: RANDOMNESS_VERSION,
    shuffleVersion: SHUFFLE_VERSION,
  });
  if (fixture !== undefined) {
    // Seed a reachable completed Hand through core decisions; exercise setup via real sockets below.
    for (let step = 0; step < 1500; step++) {
      const view = derivePlayerView(state, accounts[0]!.accountId);
      if (view.handResult !== undefined) break;
      const playerId = view.currentActor!;
      const own = derivePlayerView(state, playerId);
      const card =
        view.unbeatenPlay === undefined
          ? own.hand![0]
          : own.hand!.find(
              (card) =>
                decide(state, { type: "Play", playerId, cards: [card] }).ok,
            );
      seedCommand(
        card === undefined
          ? { type: "Pass", playerId }
          : { type: "Play", playerId, cards: [card] },
      );
    }
    if (
      derivePlayerView(state, accounts[0]!.accountId).handResult === undefined
    )
      throw new Error("fixture-hand-did-not-settle");
    if (fixture.nextSeed !== undefined)
      seedCommand({
        type: "StartNextHand",
        handSeed: fixture.nextSeed,
        randomnessVersion: RANDOMNESS_VERSION,
        shuffleVersion: SHUFFLE_VERSION,
      });
  }
  const options = {
    dbPath,
    allowedOrigin: "https://game.example",
    secureCookies: false,
  };
  let app = await createApp(options);
  cleanups.push(async () => app.close());
  await app.listen({ host: "127.0.0.1", port: 0 });
  const sessions: string[] = [];
  for (const account of accounts) {
    const login = await app.inject({
      method: "POST",
      url: "/api/login",
      headers: {
        [PROTOCOL_VERSION_HEADER]: String(PROTOCOL_VERSION),
      },
      payload: { username: account.username, password: "secret" },
    });
    expect(login.statusCode).toBe(200);
    const cookie = login.headers["set-cookie"];
    if (typeof cookie !== "string") throw new Error("missing-cookie");
    sessions.push(cookie.split(";", 1)[0]!);
  }
  let sockets: Socket[] = [];
  let views: RoomViewData[] = [];
  cleanups.push(async () => {
    for (const socket of sockets) socket.close();
  });
  async function connectAll() {
    views = [];
    const address = app.server.address();
    if (address === null || typeof address === "string")
      throw new Error("not-listening");
    const port = address.port;
    sockets = await Promise.all(
      sessions.map(async (cookie, index) => {
        const socket = io(`http://127.0.0.1:${port}`, {
          auth: { protocolVersion: PROTOCOL_VERSION, roomId },
          extraHeaders: { cookie, origin: options.allowedOrigin },
          transports: ["websocket"],
          reconnection: false,
        });
        socket.on("room:view", (raw) => {
          views[index] = RoomViewSyncEnvelopeSchema.parse(raw).data;
        });
        await new Promise<void>((resolve, reject) => {
          socket.once("room:view", (raw) => {
            RoomViewSyncEnvelopeSchema.parse(raw);
            resolve();
          });
          socket.once("connect_error", reject);
        });
        return socket;
      }),
    );
  }
  if (!fixture?.deferConnect) await connectAll();
  const requestRoom = (index: number) =>
    app.inject({
      method: "GET",
      url: `/api/rooms/${roomId}`,
      headers: {
        [PROTOCOL_VERSION_HEADER]: String(PROTOCOL_VERSION),
        cookie: sessions[index],
      },
    });
  const read = async (index: number) => {
    const response = await requestRoom(index);
    expect(response.statusCode).toBe(200);
    return RoomResponseEnvelopeSchema.parse(response.json()).data;
  };
  const envelope = (
    view: RoomViewData,
    payload: RoomCommandPayload,
  ): RoomCommandEnvelope => ({
    protocolVersion: PROTOCOL_VERSION,
    commandId: randomUUID(),
    expectedRevision: view.revision,
    roomId,
    payload,
  });
  const send = async (index: number, command: RoomCommandEnvelope) =>
    RoomCommandAckSchema.parse(
      await sockets[index]!.timeout(5000).emitWithAck("room:command", command),
    );
  const rows = () =>
    database.sqlite
      .prepare(
        "SELECT event_type AS type, causation_command_id AS commandId FROM room_events WHERE room_id = ? ORDER BY sequence",
      )
      .all(roomId) as Array<{ type: string; commandId: string | null }>;
  return {
    accounts,
    database,
    read,
    requestRoom,
    async live(index: number, revision: number): Promise<RoomViewData> {
      if (views[index] !== undefined && views[index]!.revision >= revision)
        return views[index]!;
      return new Promise((resolve) => {
        const receive = (raw: unknown) => {
          const data = RoomViewSyncEnvelopeSchema.parse(raw).data;
          if (data.revision < revision) return;
          sockets[index]!.off("room:view", receive);
          resolve(data);
        };
        sockets[index]!.on("room:view", receive);
      });
    },
    envelope,
    send,
    rows,
    async restart() {
      for (const socket of sockets) socket.close();
      await app.close();
      app = await createApp(options);
      await app.listen({ host: "127.0.0.1", port: 0 });
      await connectAll();
    },
  };
}

function active(data: RoomViewData) {
  if (data.view.lifecycle !== "ACTIVE") throw new Error("expected-active-hand");
  return data.view;
}

/* oxlint-disable vitest/no-conditional-expect -- Shared setup driver checks the reached rule branch; preset cases and the required candidate-offer fixture cover those branches. */
async function finishSetup(
  game: Awaited<ReturnType<typeof table>>,
  initial: RoomViewData,
) {
  let current = initial;
  for (
    let step = 0;
    step < 60 && active(current).setupStage !== "play";
    step++
  ) {
    const view = active(current);
    const actor = view.pendingPlayerIds[0]!;
    const index = game.accounts.findIndex(
      (account) => account.accountId === actor,
    );
    const own = active(await game.live(index, current.revision));
    let payload: RoomCommandPayload;
    if (own.tieKind !== undefined) {
      payload = {
        type: "SubmitTieChoiceBallot",
        tieKind: own.tieKind,
        round: own.tieRound!,
        candidateId: null,
      };
    } else if (own.setupStage === "tribute-selection") {
      if (own.rulesConfiguration.rulesetId === "dglz-4p-2d-v1") {
        expect(
          own.eligibleTributeCards.every((card) => !/^(SMALL|BIG)#/.test(card)),
        ).toBe(true);
      }
      payload = {
        type: "SelectTributeCard",
        card: own.eligibleTributeCards[0]!,
      };
    } else {
      const offer = own.returnCandidates.find(
        (candidate) => candidate.giverId === actor,
      );
      const transfer = own.tributeTransfers.find(
        (candidate) => candidate.recipientId === actor,
      );
      if (offer !== undefined) {
        payload = { type: "SelectReturnCard", card: offer.candidateCards[0]! };
      } else if (
        own.rulesConfiguration.rulesetId === "dglz-6p-3d-v1" &&
        own.rulesConfiguration.returnCardSelection ===
          "giver-choice-from-candidates" &&
        /^(SMALL|BIG)#/.test(transfer!.card)
      ) {
        const cardRank = (card: string) =>
          card.replace(/#[0-9]+$/, "").replace(/[SHDC]$/, "");
        const repeated = own.hand.find(
          (card) =>
            own.hand.filter((other) => cardRank(other) === cardRank(card))
              .length > 1,
        )!;
        const sameRank = own.hand.filter(
          (card) => cardRank(card) === cardRank(repeated),
        );
        const count = transfer!.card.startsWith("SMALL") ? 2 : 3;
        const invalid = [
          sameRank[0]!,
          sameRank[1]!,
          ...own.hand.filter((card) => !sameRank.includes(card)),
        ].slice(0, count);
        expect(sameRank.length).toBeGreaterThanOrEqual(2);
        expect(
          await game.send(
            index,
            game.envelope(current, {
              type: "OfferReturnCandidates",
              candidateCards: invalid,
            }),
          ),
        ).toMatchObject({
          ok: false,
          error: { reason: "return-candidates-invalid" },
        });
        const ranks = new Set<string>();
        const candidateCards = own.hand
          .filter((card) => {
            const rank = cardRank(card);
            if (ranks.has(rank)) return false;
            ranks.add(rank);
            return true;
          })
          .slice(0, transfer!.card.startsWith("SMALL") ? 2 : 3);
        payload = { type: "OfferReturnCandidates", candidateCards };
      } else {
        // Returning the received Tribute Card is legal and must survive transport.
        payload = { type: "SelectReturnCard", card: transfer!.card };
      }
    }
    const command = game.envelope(current, payload);
    const ack = await game.send(index, command);
    if (!ack.ok)
      throw new Error(`${payload.type}:${ack.error.reason ?? ack.error.code}`);
    current = ack.data;
    expect(await game.send(index, command)).toEqual(ack);
  }
  expect(active(current).setupStage).toBe("play");
  const before = await game.read(0);
  await game.restart();
  expect(await game.read(0)).toEqual(before);
  return current;
}
/* oxlint-enable vitest/no-conditional-expect */

/* oxlint-disable vitest/no-conditional-expect -- Each event-dependent check is required by the final coverage flags. */
for (const ruleset of ["dglz-4p-2d-v1", "dglz-6p-3d-v1"] as const) {
  for (const preset of ["省心", "自主"] as const) {
    it(`${ruleset} ${preset}: settles and starts the next Hand atomically, then completes setup`, async () => {
      const game = await table(ruleset, false, preset);
      let current = await game.read(0);
      const actor = game.accounts.findIndex(
        (account) => account.accountId === active(current).currentActor,
      );
      const actorData = await game.read(actor);
      const other = (actor + 1) % game.accounts.length;
      const foreignCard = active(await game.read(other)).hand[0]!;
      for (const [index, payload, reason] of [
        [other, { type: "Pass" }, "not-current-player"],
        [actor, { type: "Pass" }, "pass-on-open-lead"],
        [actor, { type: "Play", cards: [foreignCard] }, "card-not-in-hand"],
        [
          actor,
          { type: "Play", cards: active(actorData).hand.slice(0, 4) },
          "unsupported-card-count",
        ],
      ] as const) {
        expect(
          await game.send(
            index,
            game.envelope(current, {
              ...payload,
              ...(payload.type === "Play" ? { cards: [...payload.cards] } : {}),
            } as RoomCommandPayload),
          ),
        ).toMatchObject({
          ok: false,
          error: { code: "domain-rejected", reason },
        });
      }
      expect((await game.read(0)).revision).toBe(current.revision);

      let ordinaryReset = false;
      let automaticReset = false;
      let rollbackChecked = false;
      let retryChecked = false;
      for (let step = 0; step < 1200; step++) {
        const view = active(current);
        if (view.completedHandCount === 1) break;
        const index = game.accounts.findIndex(
          (account) => account.accountId === view.currentActor,
        );
        const ownData = await game.live(index, current.revision);
        const own = active(ownData);
        const payload: RoomCommandPayload =
          own.unbeatenPlay === undefined
            ? { type: "Play", cards: [own.hand[0]!] }
            : { type: "Pass" };
        const command = game.envelope(current, payload);
        const finalPlay =
          payload.type === "Play" &&
          own.hand.length === 1 &&
          own.handSizes.every(
            (size, seat) =>
              seat === own.currentActorSeat ||
              seat % 2 !== own.currentActorSeat! % 2 ||
              size === 0,
          );
        if (finalPlay) {
          game.database.sqlite.exec(
            "CREATE TRIGGER fail_settlement BEFORE INSERT ON room_events WHEN NEW.event_type = 'HandStarted' BEGIN SELECT RAISE(ABORT, 'forced-next-hand-failure'); END",
          );
          expect(await game.send(index, command)).toMatchObject({
            ok: false,
            error: { code: "internal-error" },
          });
          expect(await game.read(index)).toEqual(ownData);
          expect(
            game.rows().some((row) => row.commandId === command.commandId),
          ).toBe(false);
          expect(
            game.database.sqlite
              .prepare(
                "SELECT command_id FROM accepted_commands WHERE command_id = ?",
              )
              .get(command.commandId),
          ).toBeUndefined();
          game.database.sqlite.exec("DROP TRIGGER fail_settlement");
          rollbackChecked = true;
        }
        const accepted = await game.send(index, command);
        expect(accepted.ok).toBe(true);
        if (!accepted.ok) throw new Error(accepted.error.code);
        current = accepted.data;
        const batch = game
          .rows()
          .filter((row) => row.commandId === command.commandId)
          .map((row) => row.type);
        if (payload.type === "Pass" && batch.includes("LeadReset"))
          ordinaryReset = true;
        if (payload.type === "Play" && payload.cards[0]!.startsWith("BIG#")) {
          expect(batch).toEqual([
            "CardsPlayed",
            ...(own.hand.length === 1 ? ["PlayerFinished"] : []),
            "LeadReset",
          ]);
          expect(active(current).unbeatenPlay).toBeUndefined();
          automaticReset = true;
        }
        if (!retryChecked || finalPlay) {
          const before = await Promise.all(
            game.accounts.map((_, seat) => game.read(seat)),
          );
          for (const data of before) {
            expect(JSON.stringify(data)).not.toContain("handSeed");
          }
          for (let a = 0; a < before.length; a++)
            for (let b = a + 1; b < before.length; b++)
              expect(
                active(before[a]!).hand.filter((card) =>
                  active(before[b]!).hand.includes(card),
                ),
              ).toEqual([]);
          await game.restart();
          expect(
            await Promise.all(game.accounts.map((_, seat) => game.read(seat))),
          ).toEqual(before);
          // The client may have lost the first acknowledgement; resend its exact envelope.
          expect(await game.send(index, command)).toEqual(accepted);
          expect((await game.read(0)).revision).toBe(current.revision);
          retryChecked = true;
        }
        if (finalPlay)
          expect(batch.slice(0, 5)).toEqual([
            "CardsPlayed",
            "PlayerFinished",
            "HandResultDetermined",
            "HandSettled",
            "HandStarted",
          ]);
      }
      expect(active(current)).toMatchObject({
        completedHandCount: 1,
        handNumber: 2,
        lastHandResult: { handNumber: 1, result: { outcome: "win" } },
      });
      expect(active(current).currentActor).toBeUndefined();
      expect(
        ordinaryReset && automaticReset && rollbackChecked && retryChecked,
      ).toBe(true);
      expect(
        game.rows().filter((row) => row.type === "HandStarted"),
      ).toHaveLength(1);
      current = await finishSetup(game, current);
      const nextActor = game.accounts.findIndex(
        (account) => account.accountId === active(current).currentActor,
      );
      const nextOwn = active(await game.live(nextActor, current.revision));
      expect(
        await game.send(
          nextActor,
          game.envelope(current, { type: "Play", cards: [nextOwn.hand[0]!] }),
        ),
      ).toMatchObject({ ok: true });
    }, 30000);
  }
}

/* oxlint-enable vitest/no-conditional-expect */

it("keeps concurrent ballots private across restart and persists pairing/leader fallback", async () => {
  const game = await table("dglz-6p-3d-v1", false, "自主", {
    initialSeed: "phase-5-singleton-tie-initial-36",
    nextSeed: "phase-5-singleton-tie-2",
    randomTribute: true,
  });
  let current = await game.read(0);
  expect(active(current).setupStage).toBe("recipient-pairing-tie");
  const voters = active(current).tieVoterIds!;
  const indices = voters.map((id) =>
    game.accounts.findIndex((account) => account.accountId === id),
  );
  const ballot = (data: RoomViewData): RoomCommandPayload => ({
    type: "SubmitTieChoiceBallot",
    tieKind: active(data).tieKind!,
    round: active(data).tieRound!,
    candidateId: null,
  });
  const commands = indices
    .slice(0, 2)
    .map(() => game.envelope(current, ballot(current)));
  const raced = await Promise.all(
    commands.map((command, i) => game.send(indices[i]!, command)),
  );
  expect(raced.filter((ack) => ack.ok)).toHaveLength(1);
  expect(raced.filter((ack) => !ack.ok)).toMatchObject([
    { ok: false, error: { code: "stale-revision" } },
  ]);
  const winner = raced.findIndex((ack) => ack.ok);
  const accepted = raced[winner]!;
  if (!accepted.ok) throw new Error("missing-accepted-ballot");
  current = accepted.data;
  expect(active(current)).toHaveProperty("tieOwnBallot", null);
  expect(active(await game.read(indices[1 - winner]!))).not.toHaveProperty(
    "tieOwnBallot",
  );
  expect(active(current).tieResolvedRounds ?? []).toEqual([]);
  const before = await game.read(indices[winner]!);
  await game.restart();
  expect(await game.read(indices[winner]!)).toEqual(before);
  expect(await game.send(indices[winner]!, commands[winner]!)).toEqual(
    accepted,
  );
  current = await finishSetup(game, current);
  const resolved = game.database.sqlite
    .prepare(
      "SELECT payload FROM room_events WHERE event_type = 'TieChoiceRoundResolved'",
    )
    .all() as Array<{ payload: string }>;
  const rounds = resolved.map(
    (row) =>
      JSON.parse(row.payload) as {
        tieKind: string;
        round: number;
        fallback: boolean;
      },
  );
  expect(rounds).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        tieKind: "recipient-pairing",
        round: 3,
        fallback: true,
      }),
      expect.objectContaining({
        tieKind: "leader-selection",
        round: 3,
        fallback: true,
      }),
    ]),
  );
  expect(
    game.rows().filter((row) => row.type === "ReturnCandidatesOffered").length,
  ).toBeGreaterThan(0);
  expect(active(current).lastHandResult?.handNumber).toBe(1);
}, 30000);

it("recovers a settled no-Tribute Hand once under concurrent reconnects", async () => {
  const game = await table("dglz-4p-2d-v1", false, "省心", {
    initialSeed: "phase-5-draw-1",
  });
  const current = await game.read(0);
  expect(active(current)).toMatchObject({
    handNumber: 2,
    setupStage: "play",
    lastHandResult: { handNumber: 1, result: { caughtPlayerIds: [] } },
  });
  const result = active(current).lastHandResult!;
  expect(active(current).currentActor).toBe(
    result.seats[result.finishPositions.indexOf(1)]!.playerId,
  );
  expect(game.rows().filter((row) => row.type === "HandStarted")).toHaveLength(
    1,
  );
  expect(
    game.rows().filter((row) => row.type === "TributeTransferred"),
  ).toHaveLength(0);
  await game.restart();
  expect(await game.read(0)).toEqual(current);
  expect(game.rows().filter((row) => row.type === "HandStarted")).toHaveLength(
    1,
  );
}, 30000);

it("installs no next-Hand state when recovery commit fails, then retries once on concurrent reads", async () => {
  const game = await table("dglz-4p-2d-v1", false, "省心", {
    initialSeed: "phase-5-draw-1",
    deferConnect: true,
  });
  const before = game.rows();
  game.database.sqlite.exec(
    "CREATE TRIGGER fail_recovery BEFORE INSERT ON room_events WHEN NEW.event_type = 'HandStarted' BEGIN SELECT RAISE(ABORT, 'forced-recovery-failure'); END",
  );
  expect((await game.requestRoom(0)).statusCode).toBe(500);
  expect(game.rows()).toEqual(before);
  game.database.sqlite.exec("DROP TRIGGER fail_recovery");
  const recovered = await Promise.all(
    game.accounts.map((_, index) => game.read(index)),
  );
  expect(recovered.every((data) => active(data).handNumber === 2)).toBe(true);
  expect(new Set(recovered.map((data) => data.revision)).size).toBe(1);
  expect(game.rows().filter((row) => row.type === "HandStarted")).toHaveLength(
    1,
  );
  await game.restart();
  expect(await game.read(0)).toEqual(recovered[0]);
}, 30000);

it("serializes natural Match completion and replays its lobby summary", async () => {
  const game = await table("dglz-4p-2d-v1", true);
  let current = await game.read(0);
  for (
    let step = 0;
    step < 1200 && current.view.lifecycle === "ACTIVE";
    step++
  ) {
    const index = game.accounts.findIndex(
      (account) => account.accountId === active(current).currentActor,
    );
    const own = active(await game.live(index, current.revision));
    const ack = await game.send(
      index,
      game.envelope(
        current,
        own.unbeatenPlay === undefined
          ? { type: "Play", cards: [own.hand[0]!] }
          : { type: "Pass" },
      ),
    );
    if (!ack.ok) throw new Error(ack.error.code);
    current = ack.data;
  }
  expect(current.view).toMatchObject({
    lifecycle: "LOBBY",
    completedHandCount: 1,
    matchSummary: {
      outcome: "completed",
      endingReason: "team-level-6",
      completedHandCount: 1,
    },
  });
  expect(current.view).not.toHaveProperty("hand");
  expect(
    await game.send(
      0,
      game.envelope(current, {
        type: "ReplaceMatchRulesConfiguration",
        rulesConfiguration: rulesConfigurationPreset("dglz-4p-2d-v1", "自主"),
      }),
    ),
  ).toMatchObject({
    ok: false,
    error: { reason: "match-rules-configuration-locked" },
  });
  expect(game.rows().at(-1)?.type).toBe("MatchCompleted");
  const before = await game.read(0);
  await game.restart();
  expect(await game.read(0)).toEqual(before);
}, 30000);
