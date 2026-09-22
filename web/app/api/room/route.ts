import { env } from 'cloudflare:workers';
import { handleGET, handlePOST } from '@/lib/server/api';
export const dynamic = 'force-dynamic';
export const GET = (req: Request) => handleGET(req, env);
export const POST = (req: Request) => handlePOST(req, env);
