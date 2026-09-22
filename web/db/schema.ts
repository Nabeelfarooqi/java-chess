import { sql } from 'drizzle-orm';
import { integer, sqliteTable, text, uniqueIndex, index, check, unique } from 'drizzle-orm/sqlite-core';
export const players = sqliteTable('players', { id: text('id').primaryKey(), name: text('name').notNull(), pinHash: text('pin_hash'), character: text('character', { enum: ['walan', 'gud', 'saif'] }) }, t => [uniqueIndex('idx_players_pin').on(t.pinHash), uniqueIndex('idx_players_character').on(t.character)]);
export const pinSettings = sqliteTable('pin_settings', { id: integer('id').primaryKey(), salt: text('salt').notNull() });
export const spectatorSettings = sqliteTable('spectator_settings', { id: integer('id').primaryKey(), pinHash: text('pin_hash') });
export const spectatorSessions = sqliteTable('spectator_sessions', { tokenHash: text('token_hash').primaryKey(), expires: integer('expires').notNull() }, t => [index('idx_spectator_sessions_expiry').on(t.expires)]);
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

export const playerPresence = sqliteTable('player_presence', {
    tokenHash: text('token_hash').primaryKey().references(() => sessions.tokenHash, {onDelete:'cascade'}), lastSeen: integer('last_seen').notNull(),
});
export const series = sqliteTable('series', {
    id:text('id').primaryKey(), playerOne:text('player_one').notNull().references(()=>players.id), playerTwo:text('player_two').notNull().references(()=>players.id),
    bestOf:integer('best_of').notNull(), minutes:integer('minutes').notNull(), increment:integer('increment').notNull(),
    status:text('status',{enum:['active','finished','cancelled']}).notNull().default('active'),
    oneWins:integer('one_wins').notNull().default(0),twoWins:integer('two_wins').notNull().default(0),draws:integer('draws').notNull().default(0),winner:text('winner'),
    version:integer('version').notNull().default(0),createdAt:integer('created_at').notNull(),finishedAt:integer('finished_at'),
},t=>[check('series_best_of',sql`${t.bestOf} IN (3,5)`),check('series_minutes',sql`${t.minutes} IN (1,3,5,10)`),check('series_increment',sql`${t.increment} IN (0,2)`),check('series_status',sql`${t.status} IN ('active','finished','cancelled')`),check('series_players',sql`${t.playerOne} <> ${t.playerTwo}`)]);
export const seriesSeats=sqliteTable('series_seats',{playerId:text('player_id').primaryKey().references(()=>players.id),seriesId:text('series_id').notNull().references(()=>series.id)});
export const practicePuzzles=sqliteTable('practice_puzzles',{
    id:text('id').primaryKey(),playerId:text('player_id').notNull().references(()=>players.id),gameId:text('game_id').notNull().references(()=>games.id),
    ply:integer('ply').notNull(),fen:text('fen').notNull(),solution:text('solution').notNull(),loss:integer('loss').notNull(),depth:integer('depth').notNull(),
    createdAt:integer('created_at').notNull(),solvedAt:integer('solved_at'),attempts:integer('attempts').notNull().default(0),
},t=>[unique('practice_puzzles_player_id_game_id_ply_unique').on(t.playerId,t.gameId,t.ply),index('idx_practice_player').on(t.playerId,t.createdAt)]);

// idx_games_series is a SQL-managed expression index in 0007, alongside the atomic series triggers.
