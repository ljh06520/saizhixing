import { splitIntoChunks } from './document';
export type Stage = '省赛' | '国赛' | '通用';
export interface SourceDocument {
    id: string;
    name: string;
    text: string;
    stage: Stage;
    createdAt: number;
    demo?: boolean;
    version?: string;
    year?: number;
    group?: string;
    source?: string;
    supersedes?: string;
    metadataConfirmed?: boolean;
    pages?: { page: number; text: string }[];
}
export interface Evidence {
    id: string;
    documentId: string;
    name: string;
    stage: Stage;
    content: string;
    index: number;
    score?: number;
    start?: number;
    end?: number;
    page?: number;
    version?: string;
}
export interface ChecklistItem {
    id: string;
    title: string;
    requirement: string;
    evidence: Evidence;
}
export interface Conflict {
    topic: string;
    stage: Stage;
    entries: {
        value: string;
        evidence: Evidence;
    }[];
}
export interface Profile {
    education: string;
    school: string;
    members: number;
}
export const DEMO_DOCUMENTS: SourceDocument[] = [
    { id: 'demo-entry', name: '参赛规则与省赛安排 · 演示摘录', stage: '省赛', demo: true, createdAt: 0, text: `以下摘录自用户提供的赛事介绍，未通过官网核验。\n\n参赛对象\n每支参赛队由1-3名来自同一所学校的学生组成。每队可配备不超过2名指导老师。\n\n赛事组别\n研究生：只能报名研究生组。\n985、211高校本科生：只能报名A组或更高组别（即研究生组）。\n非985/211的普通本科院校本科生：可报名B组或更高组别（即A组或研究生组）。\n高职高专院校学生：可报名C组或任意更高组别（即B组、A组或研究生组）。\n\n省赛时间安排\n报名截止：2026年11月18日。\n作品提交截止时间：2026年11月18日。\n\n作品提交要求\n代码仓库：GitHub / Gitee，须设为Public或提供评审访问权限。README包含项目介绍、技术架构、安装运行指南、团队信息。保留完整的Git提交历史。提供环境变量模板与依赖清单。\n演示视频：5-8分钟，MP4格式，分辨率不低于1080p，普通话讲解，可配字幕。\n技术文档：PDF格式，不超过30页，包含项目概述、需求分析、系统架构设计、AI技术方案、核心功能实现、测试与部署、总结与展望。\n在线演示：可选加分项，提供可公网访问地址，评审期间保持可用。如需登录，须提供评审专用测试账号。\nAPI密钥等敏感信息不得出现在公开仓库中，须通过环境变量方式配置。` },
    { id: 'demo-final-a', name: '国赛安排章节 · 演示摘录', stage: '国赛', demo: true, createdAt: 0, text: `以下摘录自用户提供的赛事介绍“国赛安排”章节，未通过官网核验。\n\n国赛时间安排\n报名时间：2026年12月10日-2026年12月21日。\n作品提交截止时间：2026年12月27日。\n\n全国总决赛奖项比例\n一等奖：≤参赛人数5%。\n二等奖：≤参赛人数20%。\n三等奖：≤参赛人数35%。\n优秀奖：≤参赛人数40%。` },
    { id: 'demo-final-b', name: '文末奖项设置章节 · 演示摘录', stage: '国赛', demo: true, createdAt: 0, text: `以下摘录自同一份用户提供的赛事介绍“奖项设置”章节，未通过官网核验。此章节未说明替代此前条款。\n\n决赛（国赛）奖项比例\n一等奖：5%。\n二等奖：25%。\n三等奖：30%。\n优秀奖：40%。\n\n获奖比例调整权：大赛主办方保留根据实际报名情况、晋级情况及评审需要，对各级奖项比例进行适当调整的权利。` },
];
export function getEvidence(documents: SourceDocument[]): Evidence[] {
    return documents.flatMap(doc => {
        let offset = 0; let index = 0;
        return (doc.pages ?? [{ page: 0, text: doc.text }]).flatMap(page => {
            const result: Evidence[] = []; let start = 0;
            while (start < page.text.length) {
                let end = Math.min(start + 500, page.text.length);
                if (end < page.text.length) {
                    const boundary = page.text.lastIndexOf('\n', end);
                    if (boundary > start + 180) end = boundary + 1;
                }
                const content = page.text.slice(start, end);
                if (content.trim()) result.push({ id: `${doc.id}:${doc.version ?? 'v1'}:${index}`, documentId: doc.id, name: doc.name, stage: doc.stage, content, index: index++, start: offset + start, end: offset + end, page: page.page || undefined, version: doc.version ?? 'v1' });
                if (end >= page.text.length) break;
                start = Math.max(start + 1, end - 45);
            }
            offset += page.text.length + 1; return result;
        });
    });
}
function terms(text: string): string[] {
    const normalized = text.toLowerCase();
    const words = normalized.match(/[a-z0-9]+/g) ?? [];
    const chinese = normalized.match(/[\u4e00-\u9fff]+/g) ?? [];
    return [...new Set([...words, ...chinese.flatMap(word => word.length === 1 ? [word] : Array.from({ length: word.length - 1 }, (_, i) => word.slice(i, i + 2)))])];
}
/** 中文二元词关键词检索。只在当前工作区、当前阶段中检索，不宣称向量检索。 */
export function retrieve(query: string, documents: SourceDocument[], stage?: Stage): Evidence[] {
    const synonyms = query.replace(/材料|提交|准备/g, '材料 提交 代码仓库 演示视频 技术文档').replace(/报名|资格/g, '报名 参赛 组别').replace(/冲突|矛盾/g, '冲突 比例 奖项 截止');
    const queryTerms = terms(synonyms);
    return getEvidence(documents.filter(d => !stage || d.stage === stage || d.stage === '通用'))
        .map(e => ({ ...e, score: queryTerms.reduce((sum, t) => sum + (e.content.toLowerCase().includes(t) ? 1 : 0), 0) / Math.sqrt(Math.max(e.content.length / 300, 1)) }))
        .filter(e => e.score > 0).sort((a, b) => b.score - a.score).slice(0, 6);
}
function lineEvidence(doc: SourceDocument, line: string): Evidence {
    const source = getEvidence([doc]).find(e => e.content.includes(line));
    return source ?? { id: `${doc.id}:line:${doc.text.indexOf(line)}`, documentId: doc.id, name: doc.name, stage: doc.stage, content: line, index: 0 };
}
/** 受控范围：比较已标注阶段中的奖项比例和明确的提交截止日期。 */
export function findConflicts(documents: SourceDocument[]): Conflict[] {
    const groups = new Map<string, Conflict>();
    for (const doc of documents) {
        // 通用或阶段混合的资料不参加自动冲突裁定，避免混淆省赛/国赛。
        if (doc.stage === '通用')
            continue;
        for (const line of doc.text.split('\n')) {
            const award = line.match(/(一等奖|二等奖|三等奖|优秀奖)[：:\s][^\n%％]*?(\d+(?:\.\d+)?)\s*[%％]/);
            const date = line.match(/(?:作品)?提交截止(?:时间|日期)?[：:\s]*(\d{4})年(\d{1,2})月(\d{1,2})日/);
            const topic = award?.[1] ?? (date ? '作品提交截止时间' : null);
            const value = award ? `${award[2]}%` : date ? `${date[1]}-${date[2].padStart(2, '0')}-${date[3].padStart(2, '0')}` : '';
            if (!topic)
                continue;
            const key = `${doc.stage}:${topic}`;
            const group = groups.get(key) ?? { topic, stage: doc.stage, entries: [] };
            group.entries.push({ value, evidence: { ...lineEvidence(doc, line), content: line } });
            groups.set(key, group);
        }
    }
    return [...groups.values()].filter(g => new Set(g.entries.map(e => e.value)).size > 1);
}
export function buildChecklist(documents: SourceDocument[], stage: Stage): ChecklistItem[] {
    const result: ChecklistItem[] = [];
    const definitions = [['代码仓库', /代码仓库|README/i], ['演示视频', /演示视频/], ['技术文档', /技术文档/], ['在线演示（可选性见原文）', /在线演示/], ['密钥与环境配置', /API密钥|环境变量/]] as const;
    for (const [title, pattern] of definitions) {
        for (const doc of documents.filter(d => d.stage === stage || d.stage === '通用')) {
            const lines = doc.text.split('\n').map(s => s.trim()).filter(s => s.length > 12 && pattern.test(s));
            for (const line of lines)
                result.push({ id: `${doc.id}:${title}:${doc.text.indexOf(line)}`, title, requirement: line, evidence: lineEvidence(doc, line) });
        }
    }
    return result;
}
export function checkEligibility(profile: Profile, documents: SourceDocument[], stage: Stage) {
    const sources = documents.filter(d => d.stage === stage || d.stage === '通用');
    const teamDoc = sources.find(d => /1\s*[-—–至]\s*3\s*名/.test(d.text));
    const groupPattern = profile.education === '研究生' ? /研究生[：:]([^\n]+)/ : profile.education === '高职高专' ? /高职高专院校学生[：:]([^\n]+)/ : profile.school === '985 / 211' ? /(?<!非)985、211高校本科生[：:]([^\n]+)/ : /非985\/211的普通本科院校本科生[：:]([^\n]+)/;
    const groupDoc = sources.find(d => groupPattern.test(d.text));
    const match = groupDoc?.text.match(groupPattern);
    return [
        { title: '团队人数', status: teamDoc ? (profile.members >= 1 && profile.members <= 3 ? '按资料满足' : '按资料不满足') : '信息不足', detail: teamDoc ? `当前${profile.members}人；原文要求1—3名，来自同校的要求仍需自行确认。` : '当前阶段未找到可识别的人数规则。', evidence: teamDoc ? lineEvidence(teamDoc, teamDoc.text.split('\n').find(l => /1\s*[-—–至]\s*3\s*名/.test(l))!) : undefined },
        { title: '可报名组别', status: match ? '找到适用条款' : '信息不足', detail: match?.[1] ?? '当前资料中未找到适用的标准组别条款，请查阅原文或补充通知。', evidence: match && groupDoc ? lineEvidence(groupDoc, match[0]) : undefined },
    ];
}
