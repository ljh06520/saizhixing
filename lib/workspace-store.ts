import type { Profile, SourceDocument, Stage } from './competition';
import type { Rule } from './rules';
export interface Workspace { id: string; name: string; year: number; documents: SourceDocument[]; profile: Profile; stage: Stage; checked: string[]; rules: Rule[] }
export interface Library { version: 2; activeId: string; workspaces: Workspace[] }
// profile 由调用方提供：默认画像会让核对结果凭空成立。
export function emptyWorkspace(name: string, year: number, profile: Profile, stage: Stage = '省赛'): Workspace { return { id: crypto.randomUUID(), name, year, documents: [], profile, stage, checked: [], rules: [] }; }
async function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('saizhixing-workspace', 2);
    req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains('workspace')) req.result.createObjectStore('workspace'); };
    req.onsuccess = () => { req.result.onversionchange = () => req.result.close(); resolve(req.result); };
    req.onerror = () => reject(req.error); req.onblocked = () => reject(new Error('请关闭其他旧版页面后重试，旧资料仍保留。'));
  });
}
export async function loadLibrary(): Promise<Library> {
  const db = await database();
  const values = await new Promise<{ saved: Library | undefined; old: Partial<Workspace> | undefined }>((resolve, reject) => { const tx = db.transaction('workspace', 'readonly'); const store = tx.objectStore('workspace'); const saved = store.get('library-v2'); const old = store.get('current'); tx.oncomplete = () => resolve({ saved: saved.result, old: old.result }); tx.onerror = () => reject(tx.error); });
  db.close(); if (values.saved) return values.saved;
  const workspace = { ...emptyWorkspace(values.old ? '旧版迁移资料' : '我的赛事', 2026, { education: '本科生', school: '普通本科', members: 3 }), ...values.old, rules: [] };
  const library: Library = { version: 2, activeId: workspace.id, workspaces: [workspace] };
  // 仅写入新版键；旧版 current 永久留作恢复备份。
  await saveLibrary(library); return library;
}
export async function saveLibrary(value: Library): Promise<void> {
  const db = await database(); return new Promise((resolve, reject) => { const tx = db.transaction('workspace', 'readwrite'); tx.objectStore('workspace').put(value, 'library-v2'); tx.oncomplete = () => { db.close(); resolve(); }; tx.onerror = () => { db.close(); reject(tx.error); }; tx.onabort = () => { db.close(); reject(tx.error ?? new Error('保存取消')); }; });
}
