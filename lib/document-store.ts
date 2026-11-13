import type { TextChunk } from '@/lib/document';

const DATABASE_NAME = 'rag-doc-qa';
const DATABASE_VERSION = 1;

export interface StoredDocument {
  id: string;
  name: string;
  size: number;
  charCount: number;
  chunkCount: number;
  createdAt: number;
}

interface StoredChunk extends TextChunk {
  documentId: string;
  // 阶段 3 后续生成向量后再填入，当前持久化步骤只保存原文。
  embedding?: ArrayBuffer;
}

export interface DocumentSnapshot {
  document: StoredDocument;
  chunks: TextChunk[];
}

/** 数据库只在浏览器操作时打开，避免服务端渲染访问 IndexedDB。 */
function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);

    request.onupgradeneeded = () => {
      const database = request.result;
      database.createObjectStore('documents', { keyPath: 'id' });
      const chunks = database.createObjectStore('chunks', { keyPath: 'id' });
      chunks.createIndex('documentId', 'documentId');
      database.createObjectStore('meta', { keyPath: 'key' });
    };
    request.onsuccess = () => {
      const database = request.result;
      database.onversionchange = () => database.close();
      resolve(database);
    };
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('数据库升级被其他页面阻塞，请关闭其他页面后重试。'));
  });
}

/** 等整个事务提交后才报告成功，避免界面显示成功但数据尚未落盘。 */
function waitForTransaction(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error ?? new Error('本地存储事务已取消。'));
    transaction.onerror = () => reject(transaction.error);
  });
}

/** 当前页面一次使用一个文档，替换操作和保存新块放在同一个事务里。 */
export async function saveDocument(
  file: Pick<File, 'name' | 'size'>,
  charCount: number,
  chunks: TextChunk[],
): Promise<void> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(['documents', 'chunks', 'meta'], 'readwrite');
    const completion = waitForTransaction(transaction);
    const documentId = crypto.randomUUID();
    const document: StoredDocument = {
      id: documentId,
      name: file.name,
      size: file.size,
      charCount,
      chunkCount: chunks.length,
      createdAt: Date.now(),
    };
    transaction.objectStore('documents').clear();
    transaction.objectStore('chunks').clear();
    transaction.objectStore('meta').clear();
    transaction.objectStore('documents').put(document);
    for (const chunk of chunks) {
      const storedChunk: StoredChunk = {
        ...chunk,
        id: `${documentId}:${chunk.index}`,
        documentId,
      };
      transaction.objectStore('chunks').put(storedChunk);
    }
    transaction.objectStore('meta').put({ key: 'schemaVersion', value: DATABASE_VERSION });
    await completion;
  } finally {
    database.close();
  }
}

/** 按块序号恢复内容；数据库键的字符串顺序不能当作文档顺序。 */
export async function loadDocument(): Promise<DocumentSnapshot | null> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(['documents', 'chunks'], 'readonly');
    const completion = waitForTransaction(transaction);
    const documentRequest = transaction.objectStore('documents').getAll();
    const chunksRequest = transaction.objectStore('chunks').getAll();
    await completion;
    const document = (documentRequest.result as StoredDocument[])[0];
    if (!document) return null;
    const chunks = (chunksRequest.result as StoredChunk[])
      .filter((chunk) => chunk.documentId === document.id)
      .sort((left, right) => left.index - right.index)
      .map(({ id, index, content, charCount }) => ({ id, index, content, charCount }));
    return { document, chunks };
  } finally {
    database.close();
  }
}

/** 清空文档时同时清除块和模型元数据，防止残留旧索引。 */
export async function clearDocument(): Promise<void> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(['documents', 'chunks', 'meta'], 'readwrite');
    const completion = waitForTransaction(transaction);
    transaction.objectStore('documents').clear();
    transaction.objectStore('chunks').clear();
    transaction.objectStore('meta').clear();
    await completion;
  } finally {
    database.close();
  }
}
