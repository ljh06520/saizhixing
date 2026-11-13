/**
 * 文档处理工具：读取文本文件 + 把长文切成 300–500 字的小块。
 *
 * 这里只做纯文本处理，不依赖 React 和网络，方便单独测试。
 * 阶段 3 会把这些小块拿去做向量检索，所以每块要尽量语义完整、长度接近，
 * 相邻块之间还要留一点重叠，避免答案刚好跨在两块中间时丢上下文。
 */

// 单个文件最大 2 MB，防止浏览器读入超大文件后卡死
export const MAX_FILE_SIZE = 2 * 1024 * 1024;
// 每块的字数范围（中文一个字算一个字符）
export const CHUNK_MIN = 300;
export const CHUNK_MAX = 500;
// 相邻块重复的上下文字数；它会计入每块的 500 字上限
export const CHUNK_OVERLAP = 50;

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

/** 句子结束符：按这些字符切句，换行也算天然边界 */
const SENTENCE_END = new Set(['。', '！', '？', '!', '?', '；', ';', '…', '\n']);

/** Markdown 标题行：行首最多 3 个空格，1–6 个 #，后面必须有空格 */
const HEADING_LINE = /^ {0,3}#{1,6}[ \t]+\S/;

/** 切块过程中的中间结构 */
interface Block {
  text: string;
  /** 这一块是否以 Markdown 标题开头（标题不跟上一段挤在一起） */
  isHeading: boolean;
}

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
 * 把整篇文档切成若干块，每块 300–500 字，相邻块重叠约 50 字。
 *
 * 优先级（从高到低）：
 * 1. 空行分段（\n\s*\n），Markdown 标题行也强制另起一段；
 * 2. 相邻短段合并，目标每块 300–500 字；
 * 3. 单段超过 500 字时，按 。！？；换行 切开；
 * 4. 整段一个标点都没有时，才硬切；
 * 5. 相邻块按完整句子增加不超过 50 字的重叠；标题块保持标题在块首。
 */
export function splitIntoChunks(
  raw: string,
  min = CHUNK_MIN,
  max = CHUNK_MAX,
  overlap = CHUNK_OVERLAP,
): TextChunk[] {
  const text = normalizeText(raw);

  if (!text) {
    return [];
  }

  // 整篇就很短时直接一块，不必硬凑 300 字，也谈不上重叠
  if (text.length <= max) {
    return [createChunk(text, 0)];
  }

  // 每块正文最多 449 字：预留 50 字重叠 + 1 个换行，加完重叠也不超过 500
  const bodyMax = Math.max(min, max - overlap - 1);

  // 1 + 3：先按空行和标题行分块，超长块再按标点切开
  const blocks = splitIntoBlocks(text).flatMap((block) =>
    splitLongBlock(block, bodyMax),
  );

  // 2 + 4：拼到 300–bodyMax，再合并过短块、微调最后一块
  const grouped = groupBlocks(blocks, min, bodyMax);
  const merged = mergeShortChunks(grouped, min, bodyMax);
  const balanced = rebalanceLastChunk(merged, min, bodyMax);

  // 5：相邻块加上重叠
  const overlapped = applyOverlap(
    balanced.map((chunk) => chunk.trim()).filter(Boolean),
    overlap,
    max,
  );

  return overlapped.map((content, index) => createChunk(content, index));
}

function createChunk(content: string, index: number): TextChunk {
  return {
    id: `chunk-${index}`,
    index,
    content,
    charCount: content.length,
  };
}

/** 第一步：空行 + Markdown 标题行 → 若干 Block */
function splitIntoBlocks(text: string): Block[] {
  const blocks: Block[] = [];

  // 空行分段：两个换行之间允许有空格/制表符
  for (const paragraph of text.split(/\n\s*\n/)) {
    const trimmed = paragraph.trim();
    if (trimmed) {
      blocks.push(...splitAtHeadings(trimmed));
    }
  }

  return blocks;
}

/**
 * 把一段文字在 Markdown 标题行前切开。
 * 标题和它后面的正文留在同一个 Block 里，避免标题跟正文被拆散。
 * 例如「正文…\n## 标题\n标题下的文字」会切成：
 * [{ text: '正文…' }, { text: '## 标题\n标题下的文字', isHeading: true }]
 */
function splitAtHeadings(paragraph: string): Block[] {
  const lines = paragraph.split('\n');
  const blocks: Block[] = [];
  let current: string[] = [];
  let currentIsHeading = false;

  const flush = () => {
    const text = current.join('\n').trim();
    if (text) {
      blocks.push({ text, isHeading: currentIsHeading });
    }
    current = [];
    currentIsHeading = false;
  };

  for (const line of lines) {
    if (HEADING_LINE.test(line)) {
      flush();
      current = [line];
      currentIsHeading = true;
    } else {
      current.push(line);
    }
  }
  flush();

  return blocks;
}

/**
 * 单个 Block 超过 max 时按句子切开：
 * 优先在 。！？；换行 处切；只有一整句都没有标点时才硬切。
 */
function splitLongBlock(block: Block, max: number): Block[] {
  if (block.text.length <= max) {
    return [block];
  }

  const pieces: string[] = [];
  let buffer = '';

  for (const sentence of splitSentences(block.text)) {
    // 一整句（中间没有任何标点）就超过 max，只能硬切
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

  return pieces
    .map((piece) => piece.trim())
    .filter(Boolean)
    .map((text, index) => ({
      text,
      // 只有切开后的第一段还保留“以标题开头”的身份
      isHeading: index === 0 && block.isHeading,
    }));
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
 * 把 Block 拼成块：
 * - 能放下就继续放；
 * - 放不下且当前块已经有 300 字，就在段落边界切开；
 * - 当前块还太短时，从下一段开头切一小段补进来，避免出现很碎的块；
 * - 标题不跟前面已经够长的内容挤在同一块里，避免标题孤零零挂在块尾。
 */
function groupBlocks(blocks: Block[], min: number, max: number): string[] {
  const chunks: string[] = [];
  let buffer = '';

  const flush = () => {
    if (buffer) {
      chunks.push(buffer);
      buffer = '';
    }
  };

  for (const block of blocks) {
    // 标题行是硬边界：前面内容已经够长，就先收尾，让标题从下一块开头出现
    if (block.isHeading && buffer.length >= min) {
      flush();
    }

    let rest = block.text;

    while (rest.length > 0) {
      const separator = buffer ? '\n\n' : '';

      if (buffer.length + separator.length + rest.length <= max) {
        buffer += separator + rest;
        rest = '';
        continue;
      }

      if (buffer.length >= min) {
        flush();
        continue;
      }

      // 当前块太短：从 rest 里切一段补到接近 max，尽量在标点处切
      const room = max - buffer.length - separator.length;
      const piece = cutAtBoundary(rest, room);
      buffer += separator + piece;
      rest = rest.slice(piece.length).replace(/^\s+/, '');

      if (buffer.length >= min) {
        flush();
      }
    }
  }

  flush();

  return chunks;
}

/**
 * 在 maxLength 以内找最靠后的自然切点（标点优先，其次空格）。
 * 只有整段都找不到标点和空格时，才在 maxLength 处硬切。
 */
function cutAtBoundary(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text;
  }

  const window = text.slice(0, maxLength);

  for (let i = window.length - 1; i >= 0; i -= 1) {
    if (SENTENCE_END.has(window[i])) {
      return window.slice(0, i + 1);
    }
  }

  const spaceIndex = window.lastIndexOf(' ');
  if (spaceIndex > 0) {
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

/** 相邻块只复制完整句子，避免下一块从半句话开始。 */
function applyOverlap(chunks: string[], overlap: number, max: number): string[] {
  if (overlap <= 0 || chunks.length < 2) {
    return chunks;
  }

  return chunks.map((chunk, index) => {
    if (index === 0 || HEADING_LINE.test(chunk)) {
      return chunk;
    }

    const prefix = findSemanticOverlap(chunks[index - 1], overlap);
    if (!prefix) {
      return chunk;
    }

    const withOverlap = `${prefix}\n${chunk}`;
    return withOverlap.length <= max ? withOverlap : chunk;
  });
}

/** 从上一块末尾挑选完整句子，长度尽量接近 overlap 但绝不截断句子。 */
function findSemanticOverlap(text: string, maxLength: number): string {
  const candidates: string[] = [];

  for (let start = 0; start < text.length; start += 1) {
    if (start > 0 && !SENTENCE_END.has(text[start - 1]) && text[start - 1] !== '\n') {
      continue;
    }
    const candidate = text.slice(start).trim();
    if (candidate && candidate.length <= maxLength) {
      candidates.push(candidate);
    }
  }

  return candidates.sort((left, right) => right.length - left.length)[0] ?? '';
}
