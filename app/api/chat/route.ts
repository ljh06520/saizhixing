import { createDeepSeek } from '@ai-sdk/deepseek';
import { convertToCoreMessages, streamText } from 'ai';

// 流式回答最长允许 30 秒，避免被平台的默认超时掐断
export const maxDuration = 30;

// 系统提示词：规定 AI 的身份和回答风格；阶段 1 还没有接文档
const SYSTEM_PROMPT = `你是一个中文 AI 助手，服务于一个「文档问答」产品。
回答要求：
1. 用简体中文，表达简洁，必要时分点说明；
2. 不确定的内容直接说「我不确定」，不要编造事实；
3. 现阶段还没有接入任何文档，如果用户问的是某份文档里的内容，请提醒他「文件上传功能会在后续版本提供」。`;

/** 统一的纯文本错误响应，前端 useChat 会把这段文字显示出来 */
function textError(message: string, status: number) {
  return new Response(message, {
    status,
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}

export async function POST(req: Request) {
  // 1. 密钥只从服务端环境变量读取，永远不会发给浏览器
  if (!process.env.DEEPSEEK_API_KEY) {
    return textError(
      '服务端没有找到 DEEPSEEK_API_KEY：请把它写进项目根目录的 .env.local，然后重启 pnpm dev。',
      500,
    );
  }

  try {
    // 2. 取出前端传来的消息列表
    const { messages } = await req.json();
    if (!Array.isArray(messages) || messages.length === 0) {
      return textError('请求格式不正确：messages 不能为空。', 400);
    }

    // 3. 调用 DeepSeek：streamText 一边生成一边返回，前端就能逐字显示
    const deepseek = createDeepSeek({ apiKey: process.env.DEEPSEEK_API_KEY });
    const result = streamText({
      model: deepseek('deepseek-chat'),
      system: SYSTEM_PROMPT,
      messages: convertToCoreMessages(messages),
      temperature: 0.7,
    });

    // toDataStreamResponse 会把结果包装成前端 useChat 能识别的流式格式
    return result.toDataStreamResponse();
  } catch (error) {
    // 只把简单提示返回给前端，具体堆栈留在服务端日志里
    console.error('[api/chat] 调用 DeepSeek 失败：', error);
    return textError('调用模型失败，请稍后重试；如果一直失败，请检查 API 密钥和账户余额。', 500);
  }
}
