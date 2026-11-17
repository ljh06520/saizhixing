/** Paid model calls are opt-in; an existing local key alone never enables them. */
export function modelConfig() {
  const apiKey = process.env.DEEPSEEK_API_KEY?.trim();
  return {
    enabled: process.env.AI_ENABLED === 'true' && Boolean(apiKey),
    apiKey,
    model: process.env.MODEL_ID?.trim() || 'deepseek-chat',
    baseURL: process.env.DEEPSEEK_BASE_URL?.trim() || undefined,
  };
}
