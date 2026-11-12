'use client';

import { useEffect, useRef } from 'react';
import { useChat } from '@ai-sdk/react';

// 空状态下展示的示例问题，点一下会填进输入框
const SUGGESTIONS = [
  '用三句话解释什么是 RAG',
  '写一段 50 字左右的产品介绍，主题是「校园二手书交易」',
  '帮我把这句话改得更简洁：本次比赛的评审标准包括创新性、完成度和展示效果。',
];

export default function Home() {
  // useChat 是 AI SDK 提供的聊天 Hook，帮我们管理消息列表、输入框内容和流式状态
  // status 有四种值：ready（空闲）、submitted（已发出、等第一个字）、streaming（正在逐字输出）、error（出错）
  const {
    messages,
    input,
    handleInputChange,
    handleSubmit,
    status,
    error,
    stop,
    reload,
    setInput,
  } = useChat({ api: '/api/chat' });

  const bottomRef = useRef<HTMLDivElement>(null);
  const isLoading = status === 'submitted' || status === 'streaming';

  // 每次新消息或状态变化，把滚动条拉到底部，保证能看到最新回答
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages, status]);

  return (
    <div className="mx-auto flex h-dvh w-full max-w-3xl flex-col px-4 sm:px-6">
      {/* 顶部标题栏 */}
      <header className="flex items-center justify-between gap-4 border-b border-slate-200 py-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 text-base font-bold text-white shadow-sm">
            AI
          </div>
          <div>
            <h1 className="text-base font-semibold text-slate-900">文档问答助手</h1>
            <p className="text-xs text-slate-500">阶段 1 · 与 DeepSeek 流式对话</p>
          </div>
        </div>
        <span className="hidden rounded-full border border-slate-200 bg-white px-3 py-1 text-xs text-slate-500 sm:inline">
          deepseek-chat
        </span>
      </header>

      {/* 聊天记录区 */}
      <main className="flex-1 space-y-5 overflow-y-auto py-6">
        {messages.length === 0 && <EmptyState onPick={(q) => setInput(q)} />}

        {messages.map((message, index) => {
          const isUser = message.role === 'user';
          const isLastMessage = index === messages.length - 1;

          return (
            <div
              key={message.id}
              className={`flex gap-3 ${isUser ? 'flex-row-reverse' : ''}`}
            >
              <Avatar isUser={isUser} />
              <div
                className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-4 py-3 text-sm leading-7 ${
                  isUser
                    ? 'rounded-tr-sm bg-blue-600 text-white'
                    : 'rounded-tl-sm border border-slate-200 bg-white text-slate-800 shadow-sm'
                }`}
              >
                {message.content}
                {/* 正在输出时，在最后一条回答末尾放一个闪烁光标 */}
                {!isUser && status === 'streaming' && isLastMessage && (
                  <span
                    aria-hidden
                    className="ml-0.5 inline-block h-4 w-1.5 animate-pulse rounded-sm bg-blue-500 align-middle"
                  />
                )}
              </div>
            </div>
          );
        })}

        {/* 请求已发出、还没收到第一个字：显示「思考中」 */}
        {status === 'submitted' && <ThinkingBubble />}

        {/* 出错时展示原因和重试入口 */}
        {error && (
          <ErrorPanel
            message={error.message}
            onRetry={() => {
              void reload();
            }}
          />
        )}

        <div ref={bottomRef} />
      </main>

      {/* 输入区 */}
      <form
        onSubmit={handleSubmit}
        className="border-t border-slate-200 bg-slate-50/80 py-4"
      >
        <div className="flex items-center gap-2 rounded-2xl border border-slate-300 bg-white p-2 shadow-sm transition focus-within:border-blue-500 focus-within:ring-2 focus-within:ring-blue-100">
          <input
            value={input}
            onChange={handleInputChange}
            autoFocus
            placeholder="输入你的问题，按 Enter 发送…"
            aria-label="输入你的问题"
            className="min-w-0 flex-1 bg-transparent px-2 py-2 text-sm text-slate-900 outline-none placeholder:text-slate-400"
          />
          {isLoading ? (
            <button
              type="button"
              onClick={stop}
              className="shrink-0 rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-100"
            >
              停止
            </button>
          ) : (
            <button
              type="submit"
              disabled={!input.trim()}
              className="shrink-0 rounded-xl bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300"
            >
              发送
            </button>
          )}
        </div>
        <p className="mt-2 text-center text-[11px] text-slate-400">
          回答由 deepseek-chat 生成 · API 密钥只保存在本机 .env.local
        </p>
      </form>
    </div>
  );
}

/** 头像：用户显示「我」，AI 显示「AI」 */
function Avatar({ isUser }: { isUser: boolean }) {
  return (
    <div
      className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-xs font-semibold ${
        isUser
          ? 'bg-slate-200 text-slate-600'
          : 'bg-gradient-to-br from-blue-500 to-indigo-600 text-white'
      }`}
    >
      {isUser ? '我' : 'AI'}
    </div>
  );
}

/** 空状态：介绍这个阶段能做什么，并给出几个可直接点击的示例问题 */
function EmptyState({ onPick }: { onPick: (question: string) => void }) {
  return (
    <div className="flex flex-col items-center gap-6 rounded-2xl border border-dashed border-slate-300 bg-white/60 px-6 py-12 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-blue-50 text-2xl">
        💬
      </div>
      <div className="space-y-1">
        <p className="text-sm font-medium text-slate-800">开始一段对话</p>
        <p className="text-xs leading-6 text-slate-500">
          这是阶段 1 的成果：回答会一个字一个字地流式显示。
          <br />
          可以先点下面的问题，也可以直接输入你自己的问题。
        </p>
      </div>
      <div className="flex w-full flex-col gap-2">
        {SUGGESTIONS.map((question) => (
          <button
            key={question}
            type="button"
            onClick={() => onPick(question)}
            className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-left text-xs leading-6 text-slate-600 transition hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700"
          >
            {question}
          </button>
        ))}
      </div>
    </div>
  );
}

/** 「思考中」气泡：等第一个字返回时显示三个跳动的圆点 */
function ThinkingBubble() {
  return (
    <div className="flex gap-3" aria-live="polite">
      <Avatar isUser={false} />
      <div className="flex items-center gap-2 rounded-2xl rounded-tl-sm border border-slate-200 bg-white px-4 py-3 text-sm text-slate-500 shadow-sm">
        <span className="flex gap-1">
          <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-blue-500 [animation-delay:-300ms]" />
          <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-blue-500 [animation-delay:-150ms]" />
          <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-blue-500" />
        </span>
        思考中…
      </div>
    </div>
  );
}

/** 错误提示：把服务端返回的原因原样展示，并允许重新发送上一条消息 */
function ErrorPanel({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div
      role="alert"
      className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
    >
      <p className="font-medium">请求失败</p>
      <p className="mt-1 break-words text-xs leading-6 text-red-600">
        {message || '未知错误，请打开浏览器控制台查看详情。'}
      </p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-3 rounded-lg border border-red-300 bg-white px-3 py-1.5 text-xs font-medium text-red-600 transition hover:bg-red-100"
      >
        重新发送
      </button>
    </div>
  );
}
