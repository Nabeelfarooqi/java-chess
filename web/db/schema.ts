import { integer, sqliteTable, text, uniqueIndex, index } from 'drizzle-orm/sqlite-core';
export const players = sqliteTable('players', { id: text('id').primaryKey(), name: text('name').notNull(), pinHash: text('pin_hash'), character: text('character', { enum: ['walan', 'gud'] }) }, t => [uniqueIndex('idx_players_pin').on(t.pinHash), uniqueIndex('idx_players_character').on(t.character)]);
export const pinSettings = sqliteTable('pin_settings', { id: integer('id').primaryKey(), salt: text('salt').notNull() });
export const gameSeats = sqliteTable('game_seats', { playerId: text('player_id').primaryKey(), gameId: text('game_id').notNull() }, t => [index('idx_game_seats_game').on(t.gameId)]);
export const sessions = sqliteTable('sessions', { tokenHash: text('token_hash').primaryKey(), playerId: text('player_id').notNull(), expires: integer('expires').notNull() }, t => [index('idx_sessions_expiry').on(t.expires)]);
export const attempts = sqliteTable('attempts', { key: text('key').primaryKey(), count: integer('count').notNull(), expires: integer('expires').notNull() });
export const games = sqliteTable('games', { id: text('id').primaryKey(), activeKey: integer('active_key'), state: text('state').notNull(), version: integer('version').notNull(), createdAt: integer('created_at').notNull(), finishedAt: integer('finished_at') }, t => [index('idx_games_active').on(t.activeKey), index('idx_games_finished').on(t.finishedAt)]);
export const notificationSettings = sqliteTable('notification_settings', { id: integer('id').primaryKey(), enabled: integer('enabled').notNull().default(0) });
export const notificationOutbox = sqliteTable('notification_outbox', {
    id: text('id').primaryKey(), gameId: text('game_id').notNull(), kind: text('kind').notNull(),
    status: text('status').notNull().default('pending'), createdAt: integer('created_at').notNull(),
    leaseToken: text('lease_token'), leaseUntil: integer('lease_until').notNull().default(0),
    attempts: integer('attempts').notNull().default(0), detail: text('detail').notNull().default('')
}, t => [index('idx_notification_pending').on(t.status, t.createdAt)]);
