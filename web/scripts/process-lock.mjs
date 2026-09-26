import { openSync, closeSync, writeFileSync, readFileSync, unlinkSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

function alive(record) {
  const pid = Number(record.split(':')[0]);
  if (!Number.isSafeInteger(pid) || pid <= 0) throw new Error('Invalid process lock. Inspect the lock before removing it.');
  try { process.kill(pid, 0); return true; }
  catch (error) { if (error.code === 'ESRCH') return false; throw new Error('Cannot verify process-lock ownership.'); }
}

/** Every caller holds the same lock throughout reading and changing bridge state. */
export function acquireProcessLock(path) {
  const token = `${process.pid}:${randomUUID()}`;
  const create = () => {
    const fd = openSync(path, 'wx', 0o600);
    try { writeFileSync(fd, token); } finally { closeSync(fd); }
  };
  try { create(); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    if (alive(readFileSync(path, 'utf8'))) throw new Error('Another sender or configuration command is running. Stop it before continuing.');
    // Serialize stale removal. A second contender must never unlink the new
    // owner's lock after both observed the same dead PID. A crashed recovery
    // remains fail-closed and names the small guard that needs inspection.
    const guard = path + '.recovery';
    let fd;
    try { fd = openSync(guard, 'wx', 0o600); }
    catch (cause) {
      if (cause.code === 'EEXIST') throw new Error('Process-lock recovery is already in progress. If its owner exited, inspect and remove '+guard+'.');
      throw cause;
    }
    try {
      writeFileSync(fd, token);
      let previous;
      try { previous = readFileSync(path, 'utf8'); } catch (cause) { if (cause.code !== 'ENOENT') throw cause; }
      if (previous !== undefined) {
        if (alive(previous)) throw new Error('Another sender or configuration command is running.');
        unlinkSync(path);
      }
      create();
    } finally { closeSync(fd); unlinkSync(guard); }
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    try { if (readFileSync(path, 'utf8') === token) unlinkSync(path); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  };
}
