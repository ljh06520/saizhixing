/**
 * 文档处理工具：读取文本文件 + 把长文切成 300–500 字的小块。
 *
 * 这里只做纯文本处理，不依赖 React 和网络，方便单独测试。
 * 阶段 3 会把这些小块拿去做向量检索，所以每块要尽量语义完整、长度接近。
 */

// 单个文件最大 2 MB，防止浏览器读入超大文件后卡死
export const MAX_FILE_SIZE = 2 * 1024 * 1024;
// 每段最少 / 最少的字数（中文一个字算一个字符）
export const CHUNK_MIN = 300;
export const CHUNK_MAX = 500;

// 只支持纯文本和 Markdown
export const SUPPORTED_EXTENSIONS = ['.txt', '.md', '.markdown'];

export interface TextChunk {
  /** 稳定的 ID，React 列表和后续检索都用它 */
  id: string;
  /** 从 0 开始的序号 */
  index: number;
  content: string;
  charCount: number;
}

/** 句子结束符：在这些字符后面切开，段落换行也算一个天然边界 */
const SENTENCE_END = new Set(['。', '！', '？', '!', '?', '；', ';', '…', '\n']);

/** 判断扩展名是否支持（不看 MIME 类型，因为不同系统给的 MIME 经常不准） */
export function isSupportedFile(file: File): boolean {
  const name = file.name.toLowerCase();
  return SUPPORTED_EXTENSIONS.some((ext) => name.endsWith(ext));
}

/** 校验文件，返回中文错误提示；没问题时返回 null */
export function validateFile(file: File): string | null {
  if (!isSupportedFile(file)) {
    return '只支持 .txt 和 .md 文件（Markdown 的 .markdown 也可以）。';
  }
  if (file.size === 0) {
    return '这个文件是空的，请换一个。';
  }
  if (file.size > MAX_FILE_SIZE) {
    const sizeInMb = (file.size / 1024 / 1024).toFixed(1);
    return `文件太大了，最大支持 2 MB（当前约 ${sizeInMb} MB）。`;
  }
  return null;
}

/**
 * 读取文件文字。
 * 中文 .txt 在 Windows 上经常是 GBK 编码，直接按 UTF-8 读会变成乱码，
 * 所以先按 UTF-8 解，发现大量「�」时再尝试 GBK，选乱码更少的那个。
 */
export async function readTextFile(file: Blob): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const utf8 = new TextDecoder('utf-8').decode(bytes);

  if (countReplacementChars(utf8) === 0) {
    return utf8;
  }

  try {
    const gbk = new TextDecoder('gbk').decode(bytes);
    return countReplacementChars(gbk) < countReplacementChars(utf8) ? gbk : utf8;
  } catch {
    // 个别浏览器不支持 gbk 解码，就退回 UTF-8 的结果
    return utf8;
  }
}

/** 统计解码失败时产生的替换符数量，用来判断哪种编码更靠谱 */
function countReplacementChars(text: string): number {
  return (text.match(/\uFFFD/g) ?? []).length;
}

/** 统一换行符、去掉 BOM 和多余空行，保证后续按空行分段时不乱 */
export function normalizeText(raw: string): string {
  return raw
    .replace(/^\uFEFF/, '')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * 把整篇文档切成若干块，每块尽量在 300–500 字之间。
 *
 * 步骤：
 * 1. 按空行拆成段落；
 * 2. 太长的段落先按句子切开，保证没有一段超过 500 字；
 * 3. 把段落依次拼起来：不足 300 字就继续拼，超过 500 字之前切开；
 * 4. 最后把过短的尾块并进前一块。
 */
export function splitIntoChunks(
  raw: string,
  min = CHUNK_MIN,
  max = CHUNK_MAX,
): TextChunk[] {
  const text = normalizeText(raw);

  if (!text) {
    return [];
  }

  // 很短的文档直接作为一块，不必硬凑 300 字
  if (text.length <= max) {
    return [{ id: 'chunk-0', index: 0, content: text, charCount: text.length }];
  }

  // 1. 先按空行拆段，再处理超长段落
  const blocks: string[] = [];
  for (const paragraph of text.split(/\n{2,}/)) {
    const trimmed = paragraph.trim();
    if (trimmed) {
      blocks.push(...splitLongBlock(trimmed, max));
    }
  }

  // 2. 依次拼块，3. 合并过短的小块，4. 微调最后一块
  const grouped = groupBlocks(blocks, min, max);
  const merged = mergeShortChunks(grouped, min, max);
  const balanced = rebalanceLastChunk(merged, min, max);

  return balanced
    .map((content) => content.trim())
    .filter(Boolean)
    .map((content, index) => ({
      id: `chunk-${index}`,
      index,
      content,
      charCount: content.length,
    }));
}

/** 段落本身超过 max 时，按句子切成不超过 max 的小段 */
function splitLongBlock(block: string, max: number): string[] {
  if (block.length <= max) {
    return [block];
  }

  const pieces: string[] = [];
  let buffer = '';

  for (const sentence of splitSentences(block)) {
    // 一句话就超过 max（比如没有标点的长串），只能硬切
    if (sentence.length > max) {
      if (buffer) {
        pieces.push(buffer);
        buffer = '';
      }
      for (let start = 0; start < sentence.length; start += max) {
        pieces.push(sentence.slice(start, start + max));
      }
      continue;
    }

    if (buffer.length + sentence.length > max) {
      if (buffer) {
        pieces.push(buffer);
      }
      buffer = sentence;
    } else {
      buffer += sentence;
    }
  }

  if (buffer) {
    pieces.push(buffer);
  }

  return pieces.map((piece) => piece.trim()).filter(Boolean);
}

/** 按中文/英文标点和换行把一段文字切成句子，标点跟着前一句走 */
function splitSentences(text: string): string[] {
  const sentences: string[] = [];
  let buffer = '';

  for (const char of text) {
    buffer += char;
    if (SENTENCE_END.has(char)) {
      sentences.push(buffer);
      buffer = '';
    }
  }

  if (buffer) {
    sentences.push(buffer);
  }

  return sentences;
}

/**
 * 把段落拼成块：
 * - 能放下就继续放；
 * - 放不下且当前块已经有 300 字，就在段落边界切开；
 * - 当前块还太短时，从下一段开头切一小段补进来，避免出现很碎的块。
 */
function groupBlocks(blocks: string[], min: number, max: number): string[] {
  const chunks: string[] = [];
  let buffer = '';

  for (const block of blocks) {
    let rest = block;

    while (rest.length > 0) {
      const separator = buffer ? '\n\n' : '';

      if (buffer.length + separator.length + rest.length <= max) {
        buffer += separator + rest;
        rest = '';
        continue;
      }

      if (buffer.length >= min) {
        chunks.push(buffer);
        buffer = '';
        continue;
      }

      // 当前块太短：从 rest 里切一段补到接近 max，尽量在句子边界切
      const room = max - buffer.length - separator.length;
      const piece = cutAtBoundary(rest, room);
      buffer += separator + piece;
      rest = rest.slice(piece.length).replace(/^\s+/, '');

      if (buffer.length >= min) {
        chunks.push(buffer);
        buffer = '';
      }
    }
  }

  if (buffer) {
    chunks.push(buffer);
  }

  return chunks;
}

/** 在 maxLength 以内找一个尽量自然的切点（句号、分号、空格），找不到就硬切 */
function cutAtBoundary(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text;
  }

  const window = text.slice(0, maxLength);
  const earliestCut = Math.floor(maxLength * 0.6);

  for (let i = window.length - 1; i >= earliestCut; i -= 1) {
    if (SENTENCE_END.has(window[i])) {
      return window.slice(0, i + 1);
    }
  }

  const spaceIndex = window.lastIndexOf(' ');
  if (spaceIndex >= earliestCut) {
    return window.slice(0, spaceIndex + 1);
  }

  return window;
}

/** 相邻的短块合并，条件是不超过 max；最后剩一个短尾块也尝试并进前一块 */
function mergeShortChunks(chunks: string[], min: number, max: number): string[] {
  const result: string[] = [];

  for (const chunk of chunks) {
    const last = result[result.length - 1];
    if (
      last !== undefined &&
      last.length < min &&
      last.length + 2 + chunk.length <= max
    ) {
      result[result.length - 1] = `${last}\n\n${chunk}`;
    } else {
      result.push(chunk);
    }
  }

  if (result.length > 1) {
    const last = result[result.length - 1];
    const previous = result[result.length - 2];
    if (last.length < min && previous.length + 2 + last.length <= max) {
      result[result.length - 2] = `${previous}\n\n${last}`;
      result.pop();
    }
  }

  return result;
}

/**
 * 最后一块明显偏短时（比如只剩 238 字），从上一块末尾挪一两个句子过来，
 * 让最后两块都落在 300–500 字之间；如果挪完上一块会少于 300 字，就保持原样。
 */
function rebalanceLastChunk(chunks: string[], min: number, max: number): string[] {
  if (chunks.length < 2) {
    return chunks;
  }

  const last = chunks[chunks.length - 1];
  if (last.length >= min) {
    return chunks;
  }

  const previous = chunks[chunks.length - 2];
  const needed = min - last.length;
  const maxMove = Math.min(max - last.length - 2, previous.length - min);

  if (maxMove < needed) {
    return chunks;
  }

  const cut = findCutFromEnd(previous, needed, maxMove);
  if (cut <= 0) {
    return chunks;
  }

  const rest = previous.slice(0, cut).trim();
  const moved = previous.slice(cut).trim();

  if (!moved || rest.length < min || moved.length + 2 + last.length > max) {
    return chunks;
  }

  chunks[chunks.length - 2] = rest;
  chunks[chunks.length - 1] = `${moved}\n\n${last}`;
  return chunks;
}

/** 从末尾往前找切点：保证移走 [minMove, maxMove] 个字，优先落在句子边界 */
function findCutFromEnd(text: string, minMove: number, maxMove: number): number {
  const upper = text.length - minMove; // 最靠右的切点：刚好移走 minMove 个字
  const lower = text.length - maxMove; // 最靠左的切点：移走 maxMove 个字

  for (let cut = upper; cut >= lower; cut -= 1) {
    if (cut <= 0) {
      break;
    }
    if (SENTENCE_END.has(text[cut - 1]) || text[cut] === '\n') {
      return cut;
    }
  }

  return upper; // 找不到自然边界就硬切
}
