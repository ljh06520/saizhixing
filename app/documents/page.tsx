'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { clearDocument, loadDocument, saveDocument } from '@/lib/document-store';
import {
  CHUNK_MAX,
  CHUNK_MIN,
  CHUNK_OVERLAP,
  MAX_FILE_SIZE,
  normalizeText,
  readTextFile,
  splitIntoChunks,
  validateFile,
  type TextChunk,
} from '@/lib/document';

// 页面状态：空闲 / 正在读文件 / 切好了 / 出错
type PageState =
  | { status: 'idle' }
  | { status: 'loading'; fileName: string }
  | {
      status: 'ready';
      fileName: string;
      fileSize: number;
      charCount: number;
      chunks: TextChunk[];
    }
  | { status: 'error'; message: string };

export default function DocumentsPage() {
  const [state, setState] = useState<PageState>({ status: 'idle' });
  const [isDragging, setIsDragging] = useState(false);
  const [isRestoring, setIsRestoring] = useState(true);
  const [isClearing, setIsClearing] = useState(false);
  const busyRef = useRef(true);
  const inputRef = useRef<HTMLInputElement>(null);

  // 首次进入页面时恢复上次保存的文档，恢复结束前禁止上传，避免覆盖竞态。
  useEffect(() => {
    let active = true;
    void loadDocument()
      .then((snapshot) => {
        if (!active || !snapshot) return;
        setState({
          status: 'ready',
          fileName: snapshot.document.name,
          fileSize: snapshot.document.size,
          charCount: snapshot.document.charCount,
          chunks: snapshot.chunks,
        });
      })
      .catch((error) => {
        console.error('[documents] 恢复文档失败', error);
        if (active) setState({ status: 'error', message: '读取本地文档失败，请检查浏览器是否允许使用 IndexedDB，然后刷新重试。' });
      })
      .finally(() => {
        if (active) {
          busyRef.current = false;
          setIsRestoring(false);
        }
      });
    return () => { active = false; };
  }, []);

  const handleClear = useCallback(async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    setIsClearing(true);
    try {
      await clearDocument();
      setState({ status: 'idle' });
    } catch (error) {
      console.error('[documents] 清空文档失败', error);
      setState({ status: 'error', message: '清空本地文档失败，数据可能仍保留在浏览器中，请刷新后重试。' });
    } finally {
      busyRef.current = false;
      setIsClearing(false);
    }
  }, []);

  // 用隐藏的 <input type="file"> 打开系统选文件窗口
  const openFilePicker = useCallback(() => {
    if (busyRef.current) return;
    inputRef.current?.click();
  }, []);

  // 读取 + 切块：全部在浏览器本地完成，文件不会上传到服务器
  const handleFile = useCallback(async (file: File) => {
    if (busyRef.current) return;
    const validationError = validateFile(file);
    if (validationError) {
      setState({ status: 'error', message: validationError });
      return;
    }

    busyRef.current = true;
    setState({ status: 'loading', fileName: file.name });

    try {
      const text = await readTextFile(file);
      const normalized = normalizeText(text);
      const chunks = splitIntoChunks(normalized);

      if (chunks.length === 0) {
        setState({ status: 'error', message: '这个文件里没有可用的文字内容。' });
        return;
      }

      await saveDocument(file, normalized.length, chunks);
      setState({
        status: 'ready',
        fileName: file.name,
        fileSize: file.size,
        charCount: normalized.length,
        chunks,
      });
    } catch (error) {
      console.error('[documents] 读取或保存文件失败', error);
      setState({
        status: 'error',
        message: '读取或保存文件失败，请确认文件是纯文本，并检查浏览器存储权限与剩余空间后重试。',
      });
    } finally {
      busyRef.current = false;
    }
  }, []);

  const handleInputChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      // 清空 value，这样再次选择同一个文件也能触发 change
      event.target.value = '';
      if (file) {
        void handleFile(file);
      }
    },
    [handleFile],
  );

  const handleDrop = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      setIsDragging(false);
      const file = event.dataTransfer.files?.[0];
      if (file) {
        void handleFile(file);
      }
    },
    [handleFile],
  );

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-3xl flex-col px-4 sm:px-6">
      <header className="flex items-center justify-between gap-4 border-b border-slate-200 py-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 text-lg text-white shadow-sm">
            📄
          </div>
          <div>
            <h1 className="text-base font-semibold text-slate-900">文档上传</h1>
            <p className="text-xs text-slate-500">
              阶段 3 · 本地保存 {CHUNK_MIN}–{CHUNK_MAX} 字的文档片段
            </p>
          </div>
        </div>
        <Link
          href="/"
          className="shrink-0 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-600 transition hover:border-blue-300 hover:text-blue-700"
        >
          ← 返回对话
        </Link>
      </header>

      <main className="flex-1 space-y-6 py-6">
        {/* 真正的文件选择器，界面上隐藏，由点击/拖拽来触发 */}
        <input
          ref={inputRef}
          type="file"
          accept=".txt,.md,.markdown,text/plain,text/markdown"
          onChange={handleInputChange}
          className="hidden"
          aria-label="选择 txt 或 md 文件"
        />

        {state.status !== 'ready' && (
          <>
            {state.status === 'error' && (
              <div
                role="alert"
                className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
              >
                <p className="font-medium">文档处理失败</p>
                <p className="mt-1 break-words text-xs leading-6 text-red-600">
                  {state.message}
                </p>
              </div>
            )}

            <div
              role="button"
              tabIndex={0}
              onClick={state.status === 'loading' ? undefined : openFilePicker}
              onKeyDown={(event) => {
                if (busyRef.current) return;
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  openFilePicker();
                }
              }}
              onDragOver={(event) => {
                event.preventDefault();
                setIsDragging(true);
              }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={handleDrop}
              className={`flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed px-6 py-14 text-center transition ${
                isDragging
                  ? 'border-blue-500 bg-blue-50'
                  : 'border-slate-300 bg-white hover:border-blue-400 hover:bg-blue-50/40'
              }`}
            >
              {isRestoring || state.status === 'loading' ? (
                <>
                  <span className="h-2.5 w-2.5 animate-ping rounded-full bg-blue-500" />
                  <p className="mt-4 text-sm text-slate-600">
                    {isRestoring ? '正在恢复本地文档…' : state.status === 'loading' ? `正在读取、切分并保存「${state.fileName}」…` : ''}
                  </p>
                </>
              ) : (
                <>
                  <p className="text-4xl">📄</p>
                  <p className="mt-4 text-sm font-medium text-slate-800">
                    点击选择文件，或把文件拖到这里
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    支持 .txt / .md · 最大{' '}
                    {Math.round(MAX_FILE_SIZE / 1024 / 1024)} MB ·
                    只在浏览器本地处理，不会上传服务器
                  </p>
                </>
              )}
            </div>

            <div className="rounded-2xl border border-blue-100 bg-blue-50/60 p-4 text-xs leading-6 text-blue-900/80">
              <p className="font-medium text-blue-900">切块规则</p>
              <p className="mt-1">
                先按空行分段，Markdown 标题行会强制另起一段；相邻短段合并到{' '}
                {CHUNK_MIN}–{CHUNK_MAX} 字；单段超过 {CHUNK_MAX}{' '}
                字时按 。！？； 切开，整段没有标点才硬切。
              </p>
              <p className="mt-1">
                相邻块之间重叠约 {CHUNK_OVERLAP}{' '}
                字，方便检索时接上被切断的上下文；每段仍是阶段 3 检索的最小单位。
              </p>
            </div>
          </>
        )}

        {state.status === 'ready' && (
          <>
            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p
                    className="truncate text-sm font-medium text-slate-900"
                    title={state.fileName}
                  >
                    📄 {state.fileName}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    {formatFileSize(state.fileSize)} ·{' '}
                    {state.charCount.toLocaleString('zh-CN')} 字 · 共{' '}
                    {state.chunks.length} 段 · 平均{' '}
                    {Math.round(state.charCount / state.chunks.length)} 字/段
                  </p>
                </div>
                <div className="flex shrink-0 gap-2">
                  <button
                    type="button"
                    disabled={isClearing}
                    onClick={openFilePicker}
                    className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-blue-700"
                  >
                    换一个文件（替换当前文档）
                  </button>
                  <button
                    type="button"
                    disabled={isClearing}
                    onClick={() => void handleClear()}
                    className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:bg-slate-100"
                  >
                    {isClearing ? '正在清空…' : '清空本地文档'}
                  </button>
                </div>
              </div>
            </div>

            <ChunkList chunks={state.chunks} />
          </>
        )}
      </main>

      <footer className="border-t border-slate-200 py-4 text-center text-[11px] text-slate-400">
        文件保存在当前浏览器的 IndexedDB 中 · 刷新可恢复 · 清除浏览器数据后会丢失
      </footer>
    </div>
  );
}

/** 切块结果列表：每块显示序号、字数和完整原文 */
function ChunkList({ chunks }: { chunks: TextChunk[] }) {
  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-900">切块结果</h2>
        <span className="text-xs text-slate-500">
          每段 {CHUNK_MIN}–{CHUNK_MAX} 字 · 与上一段重叠约 {CHUNK_OVERLAP} 字
        </span>
      </div>

      {chunks.map((chunk) => (
        <article
          key={chunk.id}
          className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
        >
          <div className="mb-2 flex items-center justify-between gap-3">
            <span className="rounded-md bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700">
              第 {chunk.index + 1} 段
            </span>
            <span className="text-xs text-slate-400">{chunk.charCount} 字</span>
          </div>
          <p className="whitespace-pre-wrap break-words text-sm leading-7 text-slate-700">
            {chunk.content}
          </p>
        </article>
      ))}

      <p className="pt-1 text-center text-[11px] text-slate-400">
        已保存到当前浏览器，刷新页面可恢复；更换文件将替换当前文档
      </p>
    </section>
  );
}

/** 把字节数变成人类好读的大小 */
function formatFileSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
