import type { Metadata } from 'next';
import './globals.css';
// 页面标题与描述（会显示在浏览器标签和搜索结果里）
export const metadata: Metadata = {
    title: '赛知行 · 让参赛准备心中有数',
    description: '基于证据链的校园竞赛规则解读与材料预检助手。',
};
export default function RootLayout({ children, }: Readonly<{
    children: React.ReactNode;
}>) {
    return (<html lang="zh-CN">
      <body className="h-full bg-slate-50 text-slate-900 antialiased">
        {children}
      </body>
    </html>);
}
