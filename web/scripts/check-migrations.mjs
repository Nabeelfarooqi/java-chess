import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { unstable_splitSqlQuery as splitSqlQuery } from 'wrangler';

export const defaultDirectory = fileURLToPath(new URL('../drizzle/', import.meta.url));

export function applyMigration(db, name, source) {
  // Match Wrangler's statement boundaries, not Drizzle's comments or SQLite exec().
  const statements = splitSqlQuery(source);
  let index = 0;
  db.exec('BEGIN');
  try {
    for (const statement of statements) {
      index++;
      db.prepare(statement).run();
    }
    db.exec('COMMIT');
  } catch (cause) {
    db.exec('ROLLBACK');
    throw new Error(`${name}, statement ${index}: ${cause.message}`, { cause });
  }
  return statements.length;
}

export function checkMigrations(directory = defaultDirectory) {
  const files = readdirSync(directory).filter(name => name.endsWith('.sql')).sort();
  if (!files.length) throw new Error(`No SQL migrations found in ${directory}`);
  const db = new DatabaseSync(':memory:');
  try {
    db.exec('PRAGMA foreign_keys = ON');
    let statements = 0;
    for (const name of files) {
      statements += applyMigration(db, name, readFileSync(resolve(directory, name), 'utf8'));
    }
    return { migrations: files.length, statements };
  } finally {
    db.close();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = checkMigrations(process.argv[2] ? resolve(process.argv[2]) : defaultDirectory);
    console.log(`Local migration preflight passed: ${result.migrations} migrations, ${result.statements} Wrangler-parsed statements. Cloudflare validates remote SQL separately during deployment.`);
  } catch (error) {
    console.error(`Migration preflight failed: ${error.message}`);
    process.exitCode = 1;
  }
}
