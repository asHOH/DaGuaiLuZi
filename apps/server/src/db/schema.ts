import {
  foreignKey,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";

export const accounts = sqliteTable("accounts", {
  id: text("id").primaryKey(),
  username: text("username").notNull().unique(),
  email: text("email"),
  passwordHash: text("password_hash").notNull(),
  createdAt: integer("created_at", { mode: "number" }).notNull(),
});

export const sessions = sqliteTable(
  "sessions",
  {
    tokenHash: text("token_hash").primaryKey(),
    accountId: text("account_id").notNull(),
    createdAt: integer("created_at", { mode: "number" }).notNull(),
    expiresAt: integer("expires_at", { mode: "number" }).notNull(),
    revokedAt: integer("revoked_at", { mode: "number" }),
  },
  (table) => ({
    accountReference: foreignKey({
      columns: [table.accountId],
      foreignColumns: [accounts.id],
      name: "sessions_account_id_accounts_id_fk",
    }),
    accountIndex: index("sessions_account_id_idx").on(table.accountId),
  }),
);

export const roomEvents = sqliteTable(
  "room_events",
  {
    roomId: text("room_id").notNull(),
    sequence: integer("sequence", { mode: "number" }).notNull(),
    eventType: text("event_type").notNull(),
    eventSchemaVersion: integer("event_schema_version", {
      mode: "number",
    }).notNull(),
    causationCommandId: text("causation_command_id"),
    recordedAt: integer("recorded_at", { mode: "number" }).notNull(),
    payload: text("payload").notNull(),
  },
  (table) => ({
    roomSequence: primaryKey({ columns: [table.roomId, table.sequence] }),
  }),
);

export const acceptedCommands = sqliteTable("accepted_commands", {
  commandId: text("command_id").primaryKey(),
  accountId: text("account_id")
    .notNull()
    .references(() => accounts.id, { onDelete: "cascade" }),
  roomId: text("room_id").notNull(),
  requestFingerprint: text("request_fingerprint").notNull(),
  acknowledgement: text("acknowledgement").notNull(),
});

export const schema = { accounts, sessions, roomEvents, acceptedCommands };
