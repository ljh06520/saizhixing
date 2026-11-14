import { getEvidence, type SourceDocument, type Evidence, type Stage, type Profile, type Conflict, type ChecklistItem } from './competition';

export interface Rule {
  id: string; documentId: string; kind: 'team' | 'group' | 'deadline' | 'award' | 'material';
  topic: string; value: string; quote: string; stage: Stage; group: string; year: number;
  conditions: string; min?: number; max?: number; required?: boolean; confirmed: boolean;
  evidence: Evidence; origin: 'local' | 'model';
}
export function fingerprint(text: string) { let h = 2166136261; for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(16); }
export function canonicalDocuments(documents: SourceDocument[]) {
  const replaced = new Set(documents.filter(d => d.metadataConfirmed && d.supersedes).map(d => d.supersedes));
  return documents.filter(d => !replaced.has(d.id));
}
export function evidenceFor(doc: SourceDocument, quote: string): Evidence {
  const start = doc.text.indexOf(quote);
  const candidate = getEvidence([doc]).find(e => e.content.includes(quote));
  return { ...(candidate ?? { id: `${doc.id}:quote:${start}`, documentId: doc.id, name: doc.name, stage: doc.stage, index: 0 }), content: quote, start, end: start + quote.length, version: doc.version ?? fingerprint(doc.text) };
}

/** 无模型时也可运行的保守解析器。无法明确识别的条件不做资格判定。 */
export function extractLocalRules(documents: SourceDocument[]): Rule[] {
  const rules: Rule[] = [];
  for (const doc of canonicalDocuments(documents)) {
    let contextStage = doc.stage; let contextGroup = doc.group ?? '全部';
    for (const raw of doc.text.split('\n')) {
      const line = raw.trim(); if (!line) continue;
      if (line.length < 35 && /国赛|总决赛|全国决赛/.test(line)) contextStage = '国赛';
      else if (line.length < 35 && /省赛|复赛/.test(line)) contextStage = '省赛';
      if (/^[#\s]*(?:A|B|C|研究生)组(?:规则|要求|条件|[：:])/.test(line)) contextGroup = line.match(/(A|B|C|研究生)组/)![0];
      const base = { documentId: doc.id, quote: line, stage: contextStage, group: contextGroup, year: doc.year ?? 2026, conditions: '', confirmed: !!doc.metadataConfirmed, evidence: evidenceFor(doc, line), origin: 'local' as const };
      const add = (kind: Rule['kind'], topic: string, value: string, extra: Partial<Rule> = {}) => rules.push({ ...base, id: `${doc.id}:${fingerprint([kind, topic, line].join(':'))}`, kind, topic, value, ...extra });
      if (/团队|队伍|参赛队|每队/.test(line) && /人|名/.test(line)) {
        const range = line.match(/(\d+)\s*[-—–~～至到]\s*(\d+)\s*(?:人|名)/);
        const max = line.match(/(?:不超过|最多|至多|上限(?:为)?|≤)\s*(\d+)\s*(?:人|名)/);
        const min = line.match(/(?:不少于|至少|≥)\s*(\d+)\s*(?:人|名)/);
        // 指导教师人数不能当作学生团队人数。
        if (!/^(?:每队可配备|指导教师|指导老师)/.test(line)) {
          if (range) add('team', '团队人数', `${range[1]}-${range[2]}`, { min: +range[1], max: +range[2], conditions: /同一所学校|同校/.test(line) ? '同校' : '' });
          else if (max || min) add('team', '团队人数', `${min?.[1] ?? 1}-${max?.[1] ?? '*'}`, { min: +(min?.[1] ?? 1), max: max ? +max[1] : undefined });
        }
      }
      const award = line.match(/(一等奖|二等奖|三等奖|优秀奖)[：:\s][^%％\n]*?(\d+(?:\.\d+)?)\s*[%％]/);
      if (award) add('award', award[1], `${award[2]}%`);
      const date = line.match(/(报名|作品提交|提交|材料提交)[^。；\n]{0,12}?(?:截止|最迟)[^\d\n]{0,8}(\d{4})[年/.-](\d{1,2})[月/.-](\d{1,2})日?/);
      if (date && +date[3] >= 1 && +date[3] <= 12 && +date[4] >= 1 && +date[4] <= 31) {
        const normalized = `${date[2]}-${date[3].padStart(2, '0')}-${date[4].padStart(2, '0')}`;
        if (!Number.isNaN(Date.parse(normalized)) && new Date(normalized).toISOString().slice(0, 10) === normalized) add('deadline', date[1] === '报名' ? '报名截止时间' : '作品提交截止时间', normalized);
      }
      if (/报名.*组|可报.*组/.test(line)) {
        const prefix = line.split(/[：:]/)[0];
        if (/本科|研究生|高职|专科/.test(prefix)) add('group', '可报名组别', line.split(/[：:]/).slice(1).join('：') || line, { conditions: prefix });
      }
      const materials = [['代码仓库', /代码仓库|README/i], ['演示视频', /演示视频/], ['技术文档', /技术文档/], ['在线演示', /在线演示/], ['密钥与环境配置', /API密钥|环境变量/]] as const;
      if (line.length > 15) for (const [title, pattern] of materials) {
        if (pattern.test(line) && !(/^(?:以下|本节|支持|例如)/.test(line))) add('material', title, line, { required: !/可选|加分项|非必交/.test(line) });
      }
    }
  }
  return rules;
}

export function activeRules(documents: SourceDocument[], overrides?: Rule[]) {
  const ids = new Set(canonicalDocuments(documents).map(d => d.id));
  const modelDocKinds = new Set((overrides ?? []).filter(r => ids.has(r.documentId) && r.origin === 'model').map(r => `${r.documentId}:${r.kind}`));
  const editedIds = new Set((overrides ?? []).map(r => r.id));
  return [...extractLocalRules(documents).filter(r => !modelDocKinds.has(`${r.documentId}:${r.kind}`) && !editedIds.has(r.id)), ...(overrides ?? []).filter(r => ids.has(r.documentId))];
}
export function ruleConflicts(documents: SourceDocument[], overrides?: Rule[]): Conflict[] {
  const grouped = new Map<string, Conflict>();
  for (const r of activeRules(documents, overrides)) {
    if (!['award', 'deadline', 'team'].includes(r.kind)) continue;
    const key = [r.year, r.stage, r.group, r.conditions, r.kind, r.topic].join('|');
    const conflict = grouped.get(key) ?? { topic: `${r.topic}${r.group !== '全部' ? ` · ${r.group}` : ''}`, stage: r.stage, entries: [] };
    if (!conflict.entries.some(e => e.value === r.value && e.evidence.documentId === r.documentId)) conflict.entries.push({ value: r.value, evidence: r.evidence });
    grouped.set(key, conflict);
  }
  return [...grouped.values()].filter(c => new Set(c.entries.map(e => e.value)).size > 1);
}
export function materialChecklist(documents: SourceDocument[], stage: Stage, overrides?: Rule[]): (ChecklistItem & { required?: boolean })[] {
  const rules = activeRules(documents, overrides).filter(r => r.kind === 'material' && (r.stage === stage || r.stage === '通用'));
  const seen = new Set<string>();
  return rules.flatMap(r => { const key = `${r.topic}:${r.value.replace(/\s/g, '')}`; if (seen.has(key)) return []; seen.add(key); return [{ id: `${r.documentId}:${r.id}:${fingerprint(r.value)}`, title: r.topic + (r.required === false ? '（可选）' : ''), requirement: r.value, evidence: r.evidence, required: r.required }]; });
}
export function eligibilityResult(profile: Profile, documents: SourceDocument[], stage: Stage, overrides?: Rule[]) {
  const rules = activeRules(documents, overrides).filter(r => r.stage === stage || r.stage === '通用');
  const teams = rules.filter(r => r.kind === 'team' && (r.group === '全部' || !r.group));
  const conflict = new Set(teams.map(r => r.value + r.conditions)).size > 1;
  const team = teams[0];
  const fits = team && profile.members >= (team.min ?? 1) && profile.members <= (team.max ?? Infinity);
  const groupRules = rules.filter(r => r.kind === 'group').filter(r => {
    if (profile.education === '研究生') return /^研究生/.test(r.conditions);
    if (profile.education === '高职高专') return /高职|专科/.test(r.conditions);
    if (profile.school === '985 / 211') return /985|211/.test(r.conditions) && !/非985|非.*211/.test(r.conditions);
    return /普通本科|非985/.test(r.conditions);
  });
  const groupConflict = new Set(groupRules.map(r => r.value)).size > 1;
  return [
    { title: '团队人数', status: conflict ? '来源存在冲突' : !team ? '信息不足' : !team.confirmed || !documents.find(d => d.id === team.documentId)?.metadataConfirmed ? '待确认资料元数据' : fits ? '按已识别人数条款满足' : '按资料不满足', detail: conflict ? '适用来源给出不同人数条件，请先确认有效规则。' : team ? `当前${profile.members}人；规则${team.min ?? 1}—${team.max ?? '不限'}人。${team.conditions ? '同校条件需另行确认。' : ''}` : '未找到可可靠识别的人数条款。', evidence: team?.evidence },
    { title: '可报名组别', status: groupConflict ? '来源存在冲突' : groupRules.length ? '找到适用条款' : '信息不足', detail: groupConflict ? '多个适用组别条款不一致，请先确认有效版本。' : groupRules[0]?.value ?? '没有找到明确适用的学历与学校类别条款。', evidence: groupRules[0]?.evidence },
  ];
}

function tokens(text: string) {
  const segments = text.toLowerCase().match(/[a-z0-9]+|[\u4e00-\u9fff]+/g) ?? [];
  return segments.flatMap(s => /[\u4e00-\u9fff]/.test(s) ? Array.from({ length: Math.max(0, s.length - 1) }, (_, i) => s.slice(i, i + 2)) : [s]);
}
/** BM25式词法排序。没有语义向量服务。 */
export function rankedRetrieve(query: string, documents: SourceDocument[], stage?: Stage): Evidence[] {
  const corpus = getEvidence(canonicalDocuments(documents).filter(d => !stage || d.stage === stage || d.stage === '通用'));
  const q = [...new Set(tokens(query.replace(/材料|准备/g, '材料 提交 仓库 视频 文档').replace(/资格/g, '资格 报名 组别').replace(/团队|人数/g, '团队 人数 参赛队 每队 学生')))];
  const terms = corpus.map(e => tokens(e.content)); const avg = terms.reduce((a, t) => a + t.length, 0) / (terms.length || 1);
  return corpus.map((e, i) => {
    const score = q.reduce((sum, word) => { const tf = terms[i].filter(t => t === word).length; if (!tf) return sum; const df = terms.filter(t => t.includes(word)).length; const idf = Math.log(1 + (corpus.length - df + .5) / (df + .5)); return sum + idf * tf * 2.2 / (tf + 1.2 * (.25 + .75 * terms[i].length / (avg || 1))); }, 0);
    return { ...e, score };
  }).filter(e => e.score > .15).sort((a, b) => b.score - a.score).slice(0, 6);
}
