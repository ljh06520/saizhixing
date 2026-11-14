import { z } from 'zod';
import { fingerprint, extractLocalRules, type Rule } from './rules';
import type { SourceDocument } from './competition';

const documentSchema = z.object({ id: z.string().min(1).max(100), name: z.string().min(1).max(300), text: z.string().min(1).max(200000), stage: z.enum(['省赛', '国赛', '通用']), createdAt: z.number(), version: z.string().optional(), year: z.number().int().min(2000).max(2100).optional(), group: z.string().max(50).optional(), source: z.string().max(1000).optional(), supersedes: z.string().optional(), metadataConfirmed: z.boolean().optional(), demo: z.boolean().optional(), pages: z.array(z.object({ page: z.number().int().positive(), text: z.string() })).max(100).optional() });
export const snapshotSchema = z.object({ workspaceId: z.string().min(1).max(100), stage: z.enum(['省赛', '国赛', '通用']), documents: z.array(documentSchema).max(20), profile: z.object({ education: z.enum(['本科生', '研究生', '高职高专']), school: z.enum(['普通本科', '985 / 211', '高职高专院校']), members: z.number().int().min(1).max(20) }) });
export function validateSnapshot(input: unknown) {
  const snapshot = snapshotSchema.parse(input);
  if (snapshot.documents.reduce((sum, d) => sum + d.text.length, 0) > 300000) throw new Error('工作区最多30万字。');
  const ids = new Set(snapshot.documents.map(d => d.id));
  if (ids.size !== snapshot.documents.length) throw new Error('文档ID重复。');
  for (const d of snapshot.documents) {
    if (d.pages && d.pages.map(p => p.text).join('\n') !== d.text) throw new Error('PDF页码与原文快照不一致。');
    if (d.version && d.version !== fingerprint(d.text)) throw new Error('文档版本与内容不一致。');
    if (d.supersedes && (!ids.has(d.supersedes) || d.supersedes === d.id)) throw new Error('替代关系无效。');
    const visited = new Set([d.id]); let next = d.supersedes;
    while (next) { if (visited.has(next)) throw new Error('版本替代形成循环。'); visited.add(next); next = snapshot.documents.find(item => item.id === next)?.supersedes; }
  }
  return snapshot;
}
export const extractedSchema = z.object({ rules: z.array(z.object({ documentId: z.string(), kind: z.enum(['team', 'group', 'deadline', 'award', 'material']), topic: z.string().max(100), value: z.string().max(1500), quote: z.string().min(1).max(2000), stage: z.enum(['省赛', '国赛', '通用']), group: z.string().max(50), year: z.number().int(), conditions: z.string().max(300), min: z.number().optional(), max: z.number().optional(), required: z.boolean().optional() })).max(100) });
export function verifyModelRules(raw: z.infer<typeof extractedSchema>, docs: SourceDocument[]): { rules: Rule[]; rejected: number } {
  const accepted: Rule[] = []; let rejected = 0;
  for (const r of raw.rules) {
    const doc = docs.find(d => d.id === r.documentId);
    if (!doc || !doc.text.includes(r.quote) || (doc.stage !== '通用' && r.stage !== doc.stage) || (doc.year != null && r.year !== doc.year) || (r.min !== undefined && r.max !== undefined && r.min > r.max) || (r.min != null && !r.quote.includes(String(r.min))) || (r.max != null && !r.quote.includes(String(r.max)))) { rejected++; continue; }
    const parsed = extractLocalRules([{ ...doc, text: r.quote, pages: undefined }]).find(local => local.kind === r.kind);
    const canonical = parsed ? { topic: parsed.topic, value: parsed.value, min: parsed.min, max: parsed.max, required: parsed.required } : r.kind === 'material' ? { value: r.quote } : {};
    const start = doc.text.indexOf(r.quote);
    accepted.push({ ...r, ...canonical, id: `${doc.id}:${fingerprint(r.kind + r.quote)}`, confirmed: false, origin: 'model', evidence: { id: `${doc.id}:quote:${start}`, documentId: doc.id, name: doc.name, stage: r.stage, content: r.quote, index: 0, start, end: start + r.quote.length, version: doc.version ?? fingerprint(doc.text) } });
  }
  return { rules: accepted, rejected };
}
