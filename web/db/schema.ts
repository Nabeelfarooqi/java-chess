import { integer, sqliteTable, text, uniqueIndex, index } from 'drizzle-orm/sqlite-core';
export const players = sqliteTable('players', { id: text('id').primaryKey(), name: text('name').notNull() });
export const sessions = sqliteTable('sessions', { tokenHash: text('token_hash').primaryKey(), playerId: text('player_id').notNull(), expires: integer('expires').notNull() }, t => [index('idx_sessions_expiry').on(t.expires)]);
export const attempts = sqliteTable('attempts', { key: text('key').primaryKey(), count: integer('count').notNull(), expires: integer('expires').notNull() });
export const games = sqliteTable('games', { id: text('id').primaryKey(), activeKey: integer('active_key'), state: text('state').notNull(), version: integer('version').notNull(), createdAt: integer('created_at').notNull(), finishedAt: integer('finished_at') }, t => [uniqueIndex('idx_games_active').on(t.activeKey), index('idx_games_finished').on(t.finishedAt)]);
