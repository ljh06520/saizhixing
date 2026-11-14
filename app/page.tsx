'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useChat } from '@ai-sdk/react';
import { buildChecklist, checkEligibility, DEMO_DOCUMENTS, findConflicts, getEvidence, retrieve, type Evidence, type Profile, type SourceDocument, type Stage } from '@/lib/competition';
import { readTextFile, validateFile } from '@/lib/document';
import { loadLibrary, saveLibrary, emptyWorkspace, type Workspace } from '@/lib/workspace-store';
import { activeRules, rankedRetrieve, ruleConflicts, materialChecklist, eligibilityResult, fingerprint, type Rule } from '@/lib/rules';
import { importSource } from '@/lib/import-file';
import { MaterialPreflight, MetadataEditor, RulesPanel, EvidenceContent } from './components/CompetitionPanels';
function Icon({ name, size = 20 }: {
    name: string;
    size?: number;
}) {
    const paths: Record<string, React.ReactNode> = {
        grid: <><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></>,
        chat: <path d="M21 11.5a8.5 8.5 0 0 1-8.5 8.5H4l-2 2V11.5A8.5 8.5 0 0 1 10.5 3h2A8.5 8.5 0 0 1 21 11.5Z"/>,
        file: <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6M8 13h8M8 17h5"/></>,
        check: <><rect x="3" y="3" width="18" height="18" rx="4"/><path d="m7 12 3 3 7-7"/></>,
        arrow: <path d="M5 12h14m-5-5 5 5-5 5"/>, upload: <><path d="M12 16V3m-5 5 5-5 5 5M4 16v4h16v-4"/></>,
        spark: <><path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5Z"/><path d="m20 2 .5 1.5L22 4l-1.5.5L20 6l-.5-1.5L18 4l1.5-.5Z"/></>,
        shield: <><path d="m12 2 8 4v6c0 5-8 10-8 10S4 17 4 12V6Z"/><path d="m8 12 3 3 5-6"/></>,
        link: <><path d="m10 13 4-4m-6 7-2 2a4 4 0 0 1-6-6l4-4a4 4 0 0 1 6 0m4 0 2-2a4 4 0 0 1 6 6l-4 4a4 4 0 0 1-6 0" transform="translate(1 0)"/></>,
        warn: <><path d="m12 3 10 18H2Z"/><path d="M12 9v5m0 3v1"/></>, download: <><path d="M12 3v13m-5-5 5 5 5-5M4 17v4h16v-4"/></>,
        close: <path d="m6 6 12 12M18 6 6 18"/>, trash: <><path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7"/></>, send: <><path d="m3 3 19 9-19 9 4-9Z"/><path d="M7 12h15"/></>,
    };
    return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name] ?? paths.file}</svg>;
}
const NAV = [{ id: 'overview', icon: 'grid', title: '工作台' }, { id: 'assistant', icon: 'chat', title: '证据问答' }, { id: 'documents', icon: 'file', title: '赛事资料' }, { id: 'checklist', icon: 'check', title: '材料清单' }, { id: 'rules', icon: 'shield', title: '规则审阅' }];
const QUESTIONS = ['我需要准备哪些提交材料？', '我可以报名哪个组别？', '奖项比例有哪些冲突？'];
export default function Home() {
    const [view, setView] = useState('overview');
    const [spaces, setSpaces] = useState<Workspace[]>([]);
    const [activeId, setActiveId] = useState('');
    const [rules, setRules] = useState<Rule[]>([]);
    const [analyzing, setAnalyzing] = useState(false);
    const [documents, setDocuments] = useState<SourceDocument[]>([]);
    const [profile, setProfile] = useState<Profile>({ education: '本科生', school: '普通本科', members: 2 });
    const [stage, setStage] = useState<Stage>('省赛');
    const [checked, setChecked] = useState<string[]>([]);
    const [hydrated, setHydrated] = useState(false);
    const [notice, setNotice] = useState('');
    const [selected, setSelected] = useState<Evidence | null>(null);
    const [modal, setModal] = useState<'profile' | 'conflicts' | null>(null);
    const [busyUpload, setBusyUpload] = useState(false);
    const [draft, setDraft] = useState('');
    const [answerEvidence, setAnswerEvidence] = useState<Record<string, Evidence[]>>({});
    const [events, setEvents] = useState<string[]>([]);
    const inputRef = useRef<HTMLInputElement>(null);
    const bottomRef = useRef<HTMLDivElement>(null);
    const { messages, append, status, error, stop, setMessages, data, setData } = useChat({ api: '/api/chat', onFinish: () => setEvents(prev => [...prev, '回答生成完成']), onError: () => setEvents(prev => [...prev, '问答请求失败，可重试；本地资料仍保留']) });
    const loading = status === 'submitted' || status === 'streaming';
    const conflicts = useMemo(() => ruleConflicts(documents, rules), [documents, rules]);
    const checklist = useMemo(() => materialChecklist(documents, stage, rules), [documents, stage, rules]);
    const eligibility = useMemo(() => eligibilityResult(profile, documents, stage, rules), [profile, documents, stage, rules]);
    const completed = checklist.filter(i => checked.includes(i.id)).length;
    const progress = checklist.length ? Math.round(completed / checklist.length * 100) : 0;
    useEffect(() => { loadLibrary().then(library => { setSpaces(library.workspaces); const current = library.workspaces.find(w => w.id === library.activeId) ?? library.workspaces[0]; setActiveId(current.id); setDocuments(current.documents); setProfile(current.profile); setStage(current.stage); setChecked(current.checked); setRules(current.rules ?? []); setHydrated(true); }).catch(() => setNotice('本地迁移或恢复失败，旧数据仍保留。请关闭旧页面后重试。')); }, []);
    useEffect(() => { if (!hydrated || !activeId) return; const next = spaces.map(w => w.id === activeId ? { ...w, documents, profile, stage, checked, rules } : w); void saveLibrary({ version: 2, activeId, workspaces: next }).catch(() => setNotice('保存失败，旧版备份未删除；请导出所需资料。')); }, [documents, profile, stage, checked, rules, activeId, hydrated, spaces]);
    useEffect(() => { for (const item of data ?? []) { const event = item as unknown as { type: string; messageId: string; evidence?: Evidence[]; name?: string; result?: string; elapsedMs?: number; valid?: boolean }; if (event.type === 'evidence' && event.evidence) setAnswerEvidence(prev => ({ ...prev, [event.messageId]: event.evidence! })); } }, [data]);
    useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages, status]);
    useEffect(() => { if (!notice)
        return; const t = setTimeout(() => setNotice(''), 6500); return () => clearTimeout(t); }, [notice]);
    useEffect(() => { function close(e: KeyboardEvent) { if (e.key === 'Escape') {
        setModal(null);
        setSelected(null);
    } } window.addEventListener('keydown', close); return () => window.removeEventListener('keydown', close); }, []);
    useEffect(() => {
        if (!modal && !selected)
            return;
        const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
        const focusable = () => Array.from(dialog?.querySelectorAll<HTMLElement>('button:not(:disabled), input, select, textarea, a[href]') ?? []);
        const previousOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        focusable()[0]?.focus();
        const trap = (event: KeyboardEvent) => {
            if (event.key !== 'Tab')
                return;
            const elements = focusable();
            const first = elements[0];
            const last = elements[elements.length - 1];
            if (event.shiftKey && document.activeElement === first) {
                event.preventDefault();
                last?.focus();
            }
            else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault();
                first?.focus();
            }
        };
        document.addEventListener('keydown', trap);
        return () => { document.body.style.overflow = previousOverflow; document.removeEventListener('keydown', trap); previous?.focus(); };
    }, [modal, selected]);
    function resetConversation() { stop(); setMessages([]); setAnswerEvidence({}); setEvents([]); setData([]); setSelected(null); }
    function loadDemo() { if (!hydrated)
        return; if (documents.length && !window.confirm('导入演示资料会替换当前资料和清单状态，是否继续？'))
        return; resetConversation(); setRules([]); setDocuments(DEMO_DOCUMENTS.map(d => ({ ...d, version: fingerprint(d.text), year: 2026, group: '全部', source: '用户提供赛事文本摘录，未经官网核验', metadataConfirmed: true }))); setChecked([]); setStage('省赛'); setNotice('已载入3份演示摘录，来自所提供的赛事介绍，未经官网核验。'); }
    async function upload(files: FileList | null) {
        if (!files?.length)
            return;
        setBusyUpload(true);
        try {
            const next: SourceDocument[] = [];
            for (const file of Array.from(files)) {
                const parsed = await importSource(file);
                next.push({ id: crypto.randomUUID(), name: file.name, ...parsed, stage, year: spaces.find(w => w.id === activeId)?.year ?? 2026, group: '全部', metadataConfirmed: false, createdAt: Date.now() });
            }
            if (documents.length + next.length > 20 || [...documents, ...next].reduce((n, d) => n + d.text.length, 0) > 300000) throw new Error('每个工作区最多20份文档、30万字。');
            resetConversation();
            setDocuments(prev => [...prev, ...next]);
            setNotice(`已导入${next.length}份资料，标注为${stage}；混合阶段文件请拆分，或标注为“通用”。`);
        }
        catch (e) {
            setNotice(e instanceof Error ? e.message : '导入失败');
        }
        finally {
            setBusyUpload(false);
            if (inputRef.current)
                inputRef.current.value = '';
        }
    }
    function removeDocument(id: string) { if (!window.confirm('删除资料及检索片段？相关聊天记录也会清空。'))
        return; resetConversation(); setDocuments(prev => prev.filter(d => d.id !== id)); setChecked(prev => prev.filter(key => !key.startsWith(`${id}:`))); }
    async function ask(question: string) {
        if (loading)
            return;
        if (!documents.length) {
            setNotice('请先导入赛事资料，或载入演示资料。');
            return;
        }
        const query = question.trim();
        if (!query)
            return;
        if (query.length > 2000) {
            setNotice('问题请控制在2000字以内。');
            return;
        }
        setView('assistant');
        setDraft('');
        const started = performance.now();
        const evidence = rankedRetrieve(query, documents, stage);
        const messageId = crypto.randomUUID();
        setAnswerEvidence(prev => ({ ...prev, [messageId]: evidence }));
        setEvents([`在${stage}与通用资料中检索 · ${Math.round(performance.now() - started)}ms`, `召回${evidence.length}个证据片段`, '请求问答接口，等待回答']);
        await append({ id: messageId, role: 'user', content: query }, { body: { workspaceId: activeId, documents, profile, stage, messageId, rules } });
    }
    function switchWorkspace(id: string) {
        const saved = spaces.map(w => w.id === activeId ? { ...w, documents, profile, stage, checked, rules } : w);
        const next = saved.find(w => w.id === id); if (!next) return; resetConversation(); setSpaces(saved); setActiveId(id); setDocuments(next.documents); setProfile(next.profile); setStage(next.stage); setChecked(next.checked); setRules(next.rules ?? []);
    }
    function createWorkspace() {
        const name = window.prompt('赛事名称'); if (!name?.trim()) return;
        const yearText = window.prompt('赛事年份', '2026'); if (!yearText) return; const year = Number(yearText); if (!Number.isInteger(year) || year < 2000 || year > 2100) { setNotice('请输入2000—2100之间的年份。'); return; }
        const next = emptyWorkspace(name.trim().slice(0, 80), year);
        const saved = spaces.map(w => w.id === activeId ? { ...w, documents, profile, stage, checked, rules } : w);
        resetConversation(); setSpaces([...saved, next]); setActiveId(next.id); setDocuments([]); setProfile(next.profile); setStage(next.stage); setChecked([]); setRules([]);
    }
    async function analyzeRules() {
        setAnalyzing(true); try { const response = await fetch('/api/analyze', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ workspaceId: activeId, documents, profile, stage }) }); const result = await response.json(); if (!response.ok) throw new Error(result.error); setRules(result.rules); setChecked([]); setNotice(`分析得到${result.rules.length}条规则；${result.rejected}条未通过原文校验。请逐项审阅后确认。`); } catch(e) { setNotice(e instanceof Error ? e.message : '分析失败，本地规则仍可使用。'); } finally { setAnalyzing(false); }
    }
    function exportChecklist() {
        const content = `# 赛知行 · ${stage}材料清单\n\n资料未经官网核验；勾选仅表示用户自查。\n\n${checklist.map(i => `- [${checked.includes(i.id) ? 'x' : ' '}] ${i.title}\n  - 要求：${i.requirement}\n  - 来源：${i.evidence.name}，片段${i.evidence.index + 1}`).join('\n\n')}\n\n## 待确认冲突\n${conflicts.filter(c => c.stage === stage).map(c => `- ${c.topic}：${c.entries.map(e => `${e.value}（${e.evidence.name}）`).join(' / ')}`).join('\n') || '当前支持的规则类型中未检出冲突，不代表全部规则一致。'}`;
        const url = URL.createObjectURL(new Blob([content], { type: 'text/markdown;charset=utf-8' }));
        const link = document.createElement('a');
        link.href = url;
        link.download = `赛知行-${stage}-材料清单.md`;
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
    const showEvidence = (e: Evidence) => { setModal(null); setSelected(e); };
    return <div className="app-shell">
    <aside className="sidebar"><a className="brand" href="/" aria-label="赛知行首页"><span className="brand-mark"><Icon name="spark" size={25}/></span><span>赛知行<small>SAIZHIXING</small></span></a><div className="sidebar-label">参赛准备空间</div><nav aria-label="主要导航">{NAV.map(item => <button key={item.id} className={`nav-item ${view === item.id ? 'active' : ''}`} onClick={() => setView(item.id)}><Icon name={item.icon}/><span>{item.title}</span>{item.id === 'documents' && <small>{documents.length.toString().padStart(2, '0')}</small>}</button>)}</nav><div className="sidebar-tip"><span className="tip-icon"><Icon name="shield"/></span><h3>每一步，都有据可循</h3><p>让复杂的赛事规则，成为清晰的下一步。</p><button onClick={loadDemo}>体验演示资料 <Icon name="arrow" size={15}/></button></div><button className="profile-button" onClick={() => setModal('profile')}><span className="user-avatar">我</span><span>我的参赛画像<small>{profile.education} · {profile.members}人团队</small></span><span className="profile-edit">↗</span></button></aside>
    <div className="main-shell"><header className="topbar"><div className="breadcrumb">我的空间 <span>/</span><strong>{NAV.find(n => n.id === view)?.title}</strong></div><div className="topbar-actions"><span className="local-status"><i />本地工作区</span><div className="stage-select-wrap"><Icon name="file" size={15}/><select aria-label="当前赛事阶段" value={stage} onChange={e => { resetConversation(); setStage(e.target.value as Stage); }}>{['省赛', '国赛', '通用'].map(s => <option key={s}>{s}</option>)}</select></div></div></header>
    <div className="workspace-layout"><main className="main-content"><div className="workspace-switcher"><label>赛事工作区 <select aria-label="赛事工作区" disabled={!hydrated} value={activeId} onChange={e => switchWorkspace(e.target.value)}>{spaces.map(w => <option key={w.id} value={w.id}>{w.name} · {w.year}</option>)}</select></label><button className="text-button" disabled={!hydrated} onClick={createWorkspace}>＋ 新建赛事</button></div>
      {view === 'overview' && <>
        <div className="page-heading"><div><div className="eyebrow">YOUR COMPETITION, CLEARER.</div><h1>让参赛准备，心中有数<span>。</span></h1><p>从读懂规则到备齐材料，每一个结论都能找到依据。</p></div><span className="heading-stamp">AI 参赛助手 <Icon name="spark" size={16}/></span></div>
        <section className="hero-card"><div className="hero-copy"><span className="hero-tag"><i />从这里开启你的参赛计划</span><h2>资料再多，也能<br />理清下一步。</h2><p>导入赛事通知，交给 AI 整理报名条件、核对规则冲突，<br className="desktop-break"/>生成属于你的材料准备清单。</p><div className="hero-buttons"><button className="button primary" disabled={busyUpload || !hydrated} onClick={() => inputRef.current?.click()}><Icon name="upload" size={17}/>{busyUpload ? '正在读取…' : '导入赛事资料'}</button><button className="hero-demo" onClick={loadDemo}>先体验演示 <Icon name="arrow" size={17}/></button></div><small>TXT / Markdown ≤2 MB · 文本PDF ≤10 MB</small></div><div className="hero-art" aria-hidden="true"><div className="orbit orbit-one"/><div className="orbit orbit-two"/><div className="art-card back"><div /><div /><div /></div><div className="art-card front"><span className="art-mini-label">YOUR NEXT STEP</span><div className="art-title">参赛计划，已就绪</div>{['报名条件已梳理', '原文依据可追溯', '材料清单更清晰'].map(t => <div className="art-check" key={t}><span>✓</span>{t}</div>)}<div className="art-progress"><i /></div><span className="art-footer">从规则，到行动</span></div><span className="floating-badge badge-shield"><Icon name="shield" size={24}/></span><span className="floating-badge badge-spark"><Icon name="spark" size={23}/></span></div></section>
        <div className="stats-grid"><Stat label="已导入资料" value={documents.length.toString().padStart(2, '0')} unit="份" icon="file" detail={documents.length ? '已建立可检索片段' : '等待导入你的赛事资料'}/><Stat label="待确认规则冲突" value={conflicts.length.toString().padStart(2, '0')} unit="项" icon="warn" detail="奖项比例 / 提交日期" warn={conflicts.length > 0}/><Stat label="材料准备进度" value={String(progress)} unit="%" icon="check" detail={`${completed} / ${checklist.length} 项已自查`}/></div>
        <section className="quick-section"><div className="section-heading"><h2>你想先完成什么？</h2><span>选择一个任务，即刻开始</span></div><div className="quick-grid"><Task icon="shield" color="blue" title="核对报名条件" text="结合参赛画像，找到适用的报名规则。" onClick={() => setModal('profile')}/><Task icon="link" color="orange" title="查找规则冲突" text="对照不同资料，让模糊要求有迹可循。" onClick={() => setModal('conflicts')}/><Task icon="check" color="green" title="生成材料清单" text="把提交要求，变成可勾选的准备事项。" onClick={() => setView('checklist')}/></div></section>
        <section className="recent-section"><div className="section-heading"><h2>赛事资料<span className="count-pill">{documents.length}</span></h2><button className="text-button" onClick={() => setView('documents')}>管理全部资料 <Icon name="arrow" size={15}/></button></div>{documents.length ? documents.slice(0, 3).map(doc => <button className="document-row" key={doc.id} onClick={() => setSelected(getEvidence([doc])[0])}><span className="file-icon"><Icon name="file"/></span><span className="document-name">{doc.name}<small>{doc.demo ? '演示摘录 · 未经官网核验' : '个人导入 · 来源待核验'} · {getEvidence([doc]).length}个片段</small></span><span className="tag">{doc.stage}</span><Icon name="arrow" size={17}/></button>) : <div className="empty-inline"><Icon name="file" size={24}/><p>还没有赛事资料<span>导入通知，或载入演示资料，开始你的第一次准备。</span></p><button className="text-button" onClick={loadDemo}>载入演示 <Icon name="arrow" size={15}/></button></div>}</section>
      </>}

      {view === 'documents' && <><PageTitle eyebrow="YOUR SOURCE OF TRUTH" title="赛事资料" text="保留原文与阶段标注，让每一次检索都有迹可循。"/><div className="toolbar"><p>当前导入阶段：<strong>{stage}</strong></p><button className="button primary" onClick={() => inputRef.current?.click()} disabled={busyUpload || !hydrated}><Icon name="upload" size={16}/>导入资料</button></div><button className="upload-zone" disabled={busyUpload || !hydrated} onClick={() => inputRef.current?.click()} onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); if (hydrated && !busyUpload)
        void upload(e.dataTransfer.files); }}><span><Icon name="upload" size={28}/></span><strong>{busyUpload ? '正在读取资料…' : '点击选择，或把资料拖到这里'}</strong><p>TXT / Markdown ≤2 MB · 文本PDF ≤10 MB · 支持多文件</p></button><p className="info-note">每个工作区用于一项赛事。混合阶段资料请先拆分，或标注为“通用”。原文保存在此浏览器，问答时会向模型发送检索片段。</p>{documents.map(doc => <article className="source-card" key={doc.id}><div className="source-top"><span className="file-icon"><Icon name="file"/></span><div><h3>{doc.name}</h3><p>{doc.text.length.toLocaleString()} 字 · {getEvidence([doc]).length} 个片段 · {doc.demo ? '演示资料，未经官网核验' : new Date(doc.createdAt).toLocaleDateString('zh-CN') + ' 导入'}</p></div><button className="icon-button delete" aria-label={`删除${doc.name}`} onClick={() => removeDocument(doc.id)}><Icon name="trash" size={17}/></button></div><MetadataEditor document={doc} documents={documents} update={updated => { resetConversation(); setDocuments(prev => prev.map(d => d.id === updated.id ? updated : d)); setRules(prev => prev.filter(r => r.documentId !== updated.id)); setChecked([]); }}/><p className="source-preview">{doc.text.slice(0, 145)}…</p><div className="source-bottom"><label>适用阶段 <select value={doc.stage} onChange={e => { resetConversation(); setDocuments(prev => prev.map(d => d.id === doc.id ? { ...d, stage: e.target.value as Stage, metadataConfirmed: false } : d)); setRules(prev => prev.filter(r => r.documentId !== doc.id)); setChecked([]); }}>{['省赛', '国赛', '通用'].map(s => <option key={s}>{s}</option>)}</select></label><button className="text-button" onClick={() => setSelected({ id: doc.id + ':full', documentId: doc.id, name: doc.name, stage: doc.stage, content: doc.text, index: 0 })}>查看完整原文 <Icon name="arrow" size={15}/></button></div></article>)}{documents.length > 0 && <button className="text-button danger" onClick={() => { if (window.confirm('清空资料、清单状态与聊天记录？')) {
        resetConversation();
        setDocuments([]);
        setChecked([]);
    } }}>清空工作区资料</button>}</>}

      {view === 'assistant' && <><PageTitle eyebrow="ANSWERS WITH EVIDENCE" title="证据问答" text="结论来自你的资料。点击引用，回到原文核对。"/><div className="chat-panel">{messages.length === 0 && <div className="chat-empty"><span className="chat-orb"><Icon name="spark" size={30}/></span><h2>把复杂规则，问清楚。</h2><p>从{stage}与通用资料中查找证据，回答你的问题。</p><div className="question-list">{QUESTIONS.map(q => <button key={q} onClick={() => void ask(q)}>{q}<Icon name="arrow" size={16}/></button>)}</div><small>查询国赛要求前，请先将右上角阶段切换为国赛。</small></div>}{messages.map((m, index) => { const query = m.role === 'assistant' ? messages.slice(0, index).reverse().find(x => x.role === 'user')?.id : undefined; const evidence = query ? answerEvidence[query] ?? [] : []; return <article key={m.id} className={`message ${m.role}`}><div className="message-avatar">{m.role === 'user' ? '我' : <Icon name="spark" size={17}/>}</div><div className="message-body"><small>{m.role === 'user' ? '你' : '赛知行 · 基于资料回答'}</small><div className="message-content">{m.content.split(/(\[\d+\])/g).map((part, i) => { const match = part.match(/^\[(\d+)\]$/); const source = match ? evidence[Number(match[1]) - 1] : undefined; return source ? <button className="citation" key={i} onClick={() => setSelected(source)}>{part}</button> : <span key={i}>{part}</span>; })}</div>{m.role === 'assistant' && evidence.length > 0 && <div className="evidence-chips">{evidence.map((e, i) => <button key={e.id} onClick={() => setSelected(e)}><Icon name="file" size={12}/>[{i + 1}] {e.name.split(' · ')[0]}</button>)}</div>}</div></article>; })}{loading && <div className="thinking"><span className="pulse-dot"/>{status === 'submitted' ? '正在根据证据组织回答…' : '正在生成回答…'}</div>}{error && <div className="error-box">{error.message}<button onClick={() => { const q = messages.filter(m => m.role === 'user').at(-1)?.content; if (q)
        void ask(q); }}>重新尝试</button></div>}<div ref={bottomRef}/></div><form className="chat-form" onSubmit={e => { e.preventDefault(); void ask(draft); }}><textarea aria-label="向赛事资料提问" placeholder="例如：技术文档需要包含什么？" value={draft} maxLength={2000} rows={2} onChange={e => setDraft(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
        e.preventDefault();
        void ask(draft);
    } }}/><div><span>仅依据当前资料 · Enter 发送</span>{loading ? <button className="button primary small" type="button" onClick={stop}>停止生成</button> : <button className="button primary small" disabled={!draft.trim() || !hydrated}><Icon name="send" size={16}/>发送</button>}</div></form><p className="privacy-caption">证据片段及参赛画像将发送至模型服务；回答仍需核对原文。</p></>}

      {view === 'checklist' && <><PageTitle eyebrow="FROM RULES TO ACTION" title="材料准备清单" text="把要求逐项落实。勾选表示你的自查记录，不代表官方审核通过。"/><MaterialPreflight/><div className="checklist-summary"><div><span className="eyebrow">{stage} · 准备进度</span><h2>{progress}<small>%</small></h2><p>{completed} / {checklist.length} 项已自查</p></div><div className="summary-right"><button className="button secondary" disabled={!checklist.length} onClick={exportChecklist}><Icon name="download" size={16}/>导出清单</button><span>清单由当前阶段的原文条款提取</span></div><div className="wide-progress"><i style={{ width: `${progress}%` }}/></div></div>{!checklist.length ? <div className="empty-card"><Icon name="check" size={32}/><h3>还没有可提取的材料要求</h3><p>请导入包含仓库、演示视频、技术文档等明确条款的资料，或切换对应阶段。</p><button className="button secondary" onClick={loadDemo}>体验演示资料</button></div> : checklist.map(item => <article className={`checklist-item ${checked.includes(item.id) ? 'done' : ''}`} key={item.id}><input type="checkbox" id={item.id} checked={checked.includes(item.id)} onChange={e => setChecked(prev => e.target.checked ? [...prev, item.id] : prev.filter(id => id !== item.id))}/><div><label htmlFor={item.id}>{item.title}</label><p>{item.requirement}</p><button className="text-button" onClick={() => setSelected(item.evidence)}><Icon name="link" size={13}/>{item.evidence.name} · 查看依据</button></div><span className="item-state">{checked.includes(item.id) ? '已自查' : '待准备'}</span></article>)}<div className="safety-note"><Icon name="shield" size={19}/><p>最终要求以组委会确认为准。在线演示是否必交、材料数量及日期，请结合完整原文核实。</p></div></>}
      {view === 'rules' && <RulesPanel rules={activeRules(documents, rules)} documents={documents} busy={analyzing} analyze={analyzeRules} change={r => { setRules(prev => [...prev.filter(x => x.id !== r.id), r]); setChecked([]); }} showEvidence={showEvidence}/>}<footer className="workspace-footer"><span>赛知行 · 让每一步参赛准备都有依据</span><span>规则有据，行动有序</span></footer>
    </main>
    <aside className="context-panel"><div className="context-heading"><h2><Icon name="spark" size={17}/>准备概览</h2><span className="live-pill">{stage}</span></div><section className="context-section"><div className="mini-label">我的参赛画像<button onClick={() => setModal('profile')}>编辑 ↗</button></div><div className="profile-summary"><span className="profile-large">我</span><div><strong>{profile.education} · {profile.members}人团队</strong><p>{profile.school}</p></div></div></section><section className="context-section"><div className="mini-label">准备进度<span>{progress}%</span></div><div className="progress-track"><i style={{ width: `${progress}%` }}/></div><div className="progress-legend"><span><i />{completed} 项已自查</span><span>{checklist.length - completed} 项待准备</span></div></section><section className="context-section"><div className="mini-label">规则提醒<Icon name="warn" size={15}/></div><div className={conflicts.length ? 'rule-alert' : 'rule-neutral'}><strong>{conflicts.length ? `${conflicts.length}项规则需要确认` : '留意资料中的不确定性'}</strong><p>{conflicts.length ? '不同来源的奖项比例或提交日期存在差异，建议核对官方说明。' : '检查覆盖奖项比例与提交日期，未检出冲突不代表全部规则一致。'}</p><button onClick={() => setModal('conflicts')}>查看检查结果 <Icon name="arrow" size={14}/></button></div></section><section className="context-section"><div className="mini-label">准备路线<span>3 STEPS</span></div><ol className="journey">{[['导入赛事资料', '汇集通知，建立你的资料库'], ['核对规则与条件', '追溯依据，确认适用要求'], ['完成材料自查', '逐项准备，导出提交清单']].map(([title, desc], i) => <li key={title} className={(i === 0 && documents.length || i === 2 && progress === 100) ? 'complete' : ''}><i>{(i === 0 && documents.length || i === 2 && progress === 100) ? '✓' : i + 1}</i><div><strong>{title}</strong><p>{desc}</p></div></li>)}</ol></section>{(events.length > 0 || (data?.length ?? 0) > 0) && <section className="context-section"><div className="mini-label">本次执行记录</div><ul className="execution-log">{events.map((event, i) => <li key={i}>{event}</li>)}{(data ?? []).map((item, i) => { const event = item as unknown as {type:string;name:string;result:string;elapsedMs:number}; return event.type === 'tool' ? <li key={'tool'+i}>{event.name} · {event.result} · {event.elapsedMs}ms</li> : null; })}</ul></section>}<div className="context-bottom"><Icon name="shield" size={18}/><p>资料保存在此浏览器<br /><span>支持删除与清空，密钥留在服务端</span></p></div></aside></div></div>
    <input hidden ref={inputRef} type="file" accept=".txt,.md,.markdown,.pdf" multiple onChange={e => void upload(e.target.files)}/>
    {notice && <div className="toast" role="status"><Icon name="file" size={17}/><span>{notice}</span><button aria-label="关闭通知" onClick={() => setNotice('')}><Icon name="close" size={15}/></button></div>}
    {selected && <div className="modal-backdrop" onClick={() => setSelected(null)}><section className="evidence-drawer" role="dialog" aria-modal="true" aria-label="原文证据" onClick={e => e.stopPropagation()}><ModalHeading title="原文证据" icon="link" onClose={() => setSelected(null)}/><span className="tag">{selected.stage} · {selected.id.endsWith(':full') ? '完整原文' : `片段 ${selected.index + 1}`}</span><h2>{selected.name}</h2><p className="info-note">以下是实际存储的原文。资料来源与适用性仍需核实。</p><EvidenceContent evidence={selected} documents={documents}/><div className="safety-note"><Icon name="shield"/><p>请对照完整通知，注意例外条件与后续补充说明。</p></div></section></div>}
    {modal && <div className="modal-backdrop" onClick={() => setModal(null)}><section className="modal-card" role="dialog" aria-modal="true" aria-label={modal === 'profile' ? '我的参赛画像' : '规则冲突检查'} onClick={e => e.stopPropagation()}><ModalHeading title={modal === 'profile' ? '我的参赛画像' : '规则冲突检查'} icon={modal === 'profile' ? 'shield' : 'warn'} onClose={() => setModal(null)}/>{modal === 'profile' ? <><p className="info-note">仅填写核对条件所需信息，无需姓名、学号或证件号码。</p><div className="profile-fields"><label>在读阶段<select value={profile.education} onChange={e => setProfile({ ...profile, education: e.target.value })}>{['本科生', '研究生', '高职高专'].map(v => <option key={v}>{v}</option>)}</select></label><label>学校类别<select value={profile.school} onChange={e => setProfile({ ...profile, school: e.target.value })}>{['普通本科', '985 / 211', '高职高专院校'].map(v => <option key={v}>{v}</option>)}</select></label><label>团队人数<input type="number" min={1} max={20} value={profile.members} onChange={e => setProfile({ ...profile, members: Math.max(1, Math.min(20, Number(e.target.value) || 1)) })}/></label></div><h3 className="modal-subtitle">当前资料核对结果 · {stage}</h3>{eligibility.map(item => <div className="eligibility-item" key={item.title}><div><strong>{item.title}</strong><span className={`tag ${item.status.includes('不满足') ? 'red' : ''}`}>{item.status}</span></div><p>{item.detail}</p>{item.evidence && <button className="text-button" onClick={() => showEvidence(item.evidence!)}>查看适用原文 ↗</button>}</div>)}<p className="info-note">这是已识别条款的辅助核对，不构成组委会资格认定。例外条件与其他要求需人工确认。</p><button className="button primary full-width" onClick={() => setModal(null)}>保存并返回</button></> : <><p className="info-note">比较同阶段明确条款中的奖项比例与提交日期。“通用”资料不参与自动比较。系统不自行裁定有效版本。</p>{conflicts.length ? conflicts.map(c => <article className="conflict-card" key={c.stage + c.topic}><div><span className="tag amber">待官方确认</span><strong>{c.stage} · {c.topic}</strong></div>{c.entries.map((entry, i) => <button key={entry.evidence.id + i} onClick={() => showEvidence(entry.evidence)}><span className="conflict-value">{entry.value}</span><span>{entry.evidence.name}<small>{entry.evidence.content}</small></span><Icon name="arrow" size={15}/></button>)}</article>) : <div className="empty-card"><Icon name="shield" size={30}/><h3>当前支持的规则类型未检出冲突</h3><p>不代表全部规则一致。请确认资料已导入、阶段标注正确，其他条件仍需人工核对。</p></div>}</>}</section></div>}
  </div>;
}
function ModalHeading({ title, icon, onClose }: {
    title: string;
    icon: string;
    onClose: () => void;
}) { return <div className="modal-heading"><span><Icon name={icon}/>{title}</span><button className="icon-button" aria-label={`关闭${title}`} onClick={onClose}><Icon name="close"/></button></div>; }
function Stat({ label, value, unit, icon, detail, warn }: {
    label: string;
    value: string;
    unit: string;
    icon: string;
    detail: string;
    warn?: boolean;
}) { return <article className={`stat-card ${warn ? 'warning' : ''}`}><div className="stat-label">{label}<Icon name={icon} size={18}/></div><div className="stat-value">{value}<span>{unit}</span></div><p>{detail}</p></article>; }
function Task({ icon, color, title, text, onClick }: {
    icon: string;
    color: string;
    title: string;
    text: string;
    onClick: () => void;
}) { return <button className="task-card" onClick={onClick}><span className={`task-icon ${color}`}><Icon name={icon} size={22}/></span><h3>{title}<Icon name="arrow" size={17}/></h3><p>{text}</p></button>; }
function PageTitle({ eyebrow, title, text }: {
    eyebrow: string;
    title: string;
    text: string;
}) { return <div className="page-heading"><div><div className="eyebrow">{eyebrow}</div><h1>{title}<span>。</span></h1><p>{text}</p></div></div>; }
