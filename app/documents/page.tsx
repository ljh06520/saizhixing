'use client';

import Link from 'next/link';
import { useCallback, useRef, useState } from 'react';
import {
  CHUNK_MAX,
  CHUNK_MIN,
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
  const inputRef = useRef<HTMLInputElement>(null);

  // 用隐藏的 <input type="file"> 打开系统选文件窗口
  const openFilePicker = useCallback(() => {
    inputRef.current?.click();
  }, []);

  // 读取 + 切块：全部在浏览器本地完成，文件不会上传到服务器
  const handleFile = useCallback(async (file: File) => {
    const validationError = validateFile(file);
    if (validationError) {
      setState({ status: 'error', message: validationError });
      return;
    }

    setState({ status: 'loading', fileName: file.name });

    try {
      const text = await readTextFile(file);
      const normalized = normalizeText(text);
      const chunks = splitIntoChunks(normalized);

      if (chunks.length === 0) {
        setState({ status: 'error', message: '这个文件里没有可用的文字内容。' });
        return;
      }

      setState({
        status: 'ready',
        fileName: file.name,
        fileSize: file.size,
        charCount: normalized.length,
        chunks,
      });
    } catch (error) {
      console.error('[documents] 读取文件失败', error);
      setState({
        status: 'error',
        message: '读取文件失败，请确认它是纯文本文件后重试。',
      });
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
              阶段 2 · 上传后切成 {CHUNK_MIN}–{CHUNK_MAX} 字的小段
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
                <p className="font-medium">上传失败</p>
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
                if (state.status === 'loading') return;
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
              {state.status === 'loading' ? (
                <>
                  <span className="h-2.5 w-2.5 animate-ping rounded-full bg-blue-500" />
                  <p className="mt-4 text-sm text-slate-600">
                    正在读取并切分「{state.fileName}」…
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
                先按空行分段；不足 {CHUNK_MIN} 字就继续拼，快超过 {CHUNK_MAX}{' '}
                字时在句号处截断；超长段落按句子切开，过短的尾块并进前一段。
              </p>
              <p className="mt-1">
                每段是阶段 3 检索的最小单位，所以尽量保持语义完整。
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
                    onClick={openFilePicker}
                    className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-blue-700"
                  >
                    换一个文件
                  </button>
                  <button
                    type="button"
                    onClick={() => setState({ status: 'idle' })}
                    className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:bg-slate-100"
                  >
                    清空
                  </button>
                </div>
              </div>
            </div>

            <ChunkList chunks={state.chunks} />
          </>
        )}
      </main>

      <footer className="border-t border-slate-200 py-4 text-center text-[11px] text-slate-400">
        文件只在浏览器内存里处理 · 阶段 3 会存进 IndexedDB，刷新不丢
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
          每段 {CHUNK_MIN}–{CHUNK_MAX} 字
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
        当前只存在内存里，刷新页面会清空
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
