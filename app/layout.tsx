import type { Metadata } from 'next';
import './globals.css';

// 页面标题与描述（会显示在浏览器标签和搜索结果里）
export const metadata: Metadata = {
  title: '文档问答助手 | 全国高校 AI Web 开发挑战赛',
  description: '基于 Next.js 与 DeepSeek 的 RAG 文档问答 Demo',
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body className="h-full bg-slate-50 text-slate-900 antialiased">
        {children}
      </body>
    </html>
  );
}
