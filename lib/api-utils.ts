const active = new Map<string, number>();
const recent = new Map<string, { start: number; count: number }>();
export async function readJson(req: Request, maxBytes = 1200000) {
  const reader = req.body?.getReader(); if (!reader) throw new Error('请求体为空');
  let size = 0; let raw = ''; const decoder = new TextDecoder();
  while (true) { const { done, value } = await reader.read(); if (done) break; size += value.byteLength; if (size > maxBytes) { await reader.cancel(); throw new Error('请求体超过限制'); } raw += decoder.decode(value, { stream: true }); }
  return JSON.parse(raw + decoder.decode());
}
export function acquire(id: string) {
  const now = Date.now(); const hit = recent.get(id);
  if (active.size > 1000 || recent.size > 1000) { for (const [key, item] of recent) if (now - item.start > 60000) recent.delete(key); }
  const window = hit && now - hit.start < 60000 ? hit : { start: now, count: 0 };
  if ((active.get(id) ?? 0) >= 1 || window.count >= 12 || active.size >= 8) throw new Error('请求过于频繁，请稍后重试。');
  window.count++; recent.set(id, window); active.set(id, 1); return () => active.delete(id);
}
