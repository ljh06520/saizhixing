import { modelConfig } from '@/lib/model-config';
export const dynamic = 'force-dynamic';

export function GET() {
  const config = modelConfig();
  return Response.json({ ai: config.enabled, mode: config.enabled ? 'model' : 'local', model: config.enabled ? config.model : null }, { headers: { 'Cache-Control': 'no-store' } });
}
