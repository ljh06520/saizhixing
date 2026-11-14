import type { Evidence } from './competition';
export interface GroundedFact { citation: string; quote: string }
export function verifiedAnswer(text: string, evidence: Evidence[]) {
  try {
    const raw = JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, ''));
    if (!Array.isArray(raw.facts) || raw.facts.length > 12) throw new Error('format');
    const facts = raw.facts as GroundedFact[];
    if (!facts.every(f => f && typeof f.citation === 'string' && typeof f.quote === 'string' && f.quote.trim().length >= 3 && f.quote.length <= 900 && evidence.some(e => e.id === f.citation && e.content.includes(f.quote)))) throw new Error('unsupported');
    if (!facts.length) return { valid: true, text: '当前证据不足以形成可靠结论。请补充适用通知，或换用原文中的关键词提问。' };
    return { valid: true, text: `原文事实（已校验摘录与引用）：\n\n${facts.map((f, i) => `${i + 1}. ${f.quote} [${evidence.findIndex(e => e.id === f.citation) + 1}]`).join('\n\n')}\n\n辅助建议：以上是原文事实摘录，请结合适用阶段、组别及例外条件核对。来源存在冲突时，请向组委会确认；演示摘录未经官网核验。` };
  } catch { return { valid: false, text: `本次生成的引用或摘录未通过校验，已回退到原文证据。\n\n${evidence.map((e, i) => `[${i + 1}] ${e.content}`).join('\n\n')}\n\n系统不据此给出确定性资格结论，请核对原文。` }; }
}
