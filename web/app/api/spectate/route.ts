import { env } from 'cloudflare:workers';
import { handleSpectator } from '@/lib/server/spectator';
export const dynamic = 'force-dynamic';
export const GET = (req: Request) => handleSpectator(req, env);
export const POST = (req: Request) => handleSpectator(req, env);
