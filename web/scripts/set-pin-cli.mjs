import { setPin } from './set-pin.mjs';
try { await setPin(process.argv.slice(2).join(' ')); } catch (error) { console.error(error.message); process.exitCode = 1; }
