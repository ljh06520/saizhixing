/**
 * 切块逻辑的回归测试（不需要浏览器）：
 *   pnpm check:chunk
 *
 * 它会用 TypeScript 自带编译器把 lib/document.ts 现场编译成 CommonJS，
 * 再在 Node 里跑用例，所以不额外增加测试框架依赖。
 */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const here = path.dirname(fileURLToPath(import.meta.url));
const sourcePath = path.join(here, '..', 'lib', 'document.ts');
const source = fs.readFileSync(sourcePath, 'utf8');

const { outputText } = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2020,
    esModuleInterop: true,
  },
  fileName: 'document.ts',
});

const moduleRecord = { exports: {} };
const load = new Function('exports', 'module', 'require', outputText);
load(moduleRecord.exports, moduleRecord, () => {
  throw new Error('lib/document.ts 目前不应该依赖其他模块');
});

const {
  CHUNK_MAX,
  CHUNK_MIN,
  CHUNK_OVERLAP,
  normalizeText,
  readTextFile,
  splitIntoChunks,
} = moduleRecord.exports;

// ---------- 造数据 ----------
const SENTENCES = [
  '校园二手书交易平台希望解决教材浪费的问题。',
  '学生可以发布用过的教材，也可以按课程名搜索需要的书。',
  '平台会校验每本书的品相和价格，尽量减少交易纠纷。',
  '线下交易地点统一设在图书馆门口，方便双方见面。',
  '每学期结束后的两周是交易高峰期，平台会提前提醒用户。',
];

/** 从 SENTENCES 里循环取句子，拼出约 count 句的段落 */
function paragraph(count, start = 0) {
  let text = '';
  for (let i = 0; i < count; i += 1) {
    text += SENTENCES[(start + i) % SENTENCES.length];
  }
  return text;
}

const strip = (text) => text.replace(/\s+/g, '');

function printCase(title, raw, chunks) {
  console.log(`\n=== ${title} ===`);
  console.log(`原文 ${normalizeText(raw).length} 字 → ${chunks.length} 块`);
  for (const chunk of chunks) {
    const head = chunk.content.slice(0, 20).replace(/\n/g, '⏎');
    console.log(
      `第 ${chunk.index + 1} 块：${String(chunk.charCount).padStart(3, ' ')} 字，开头 20 字「${head}」`,
    );
  }
}

/** 每块都必须在 300–500 字之间 */
function assertChunkSizes(chunks) {
  for (const chunk of chunks) {
    assert.ok(chunk.charCount > 0, '不能出现空块');
    assert.ok(
      chunk.charCount >= CHUNK_MIN,
      `第 ${chunk.index + 1} 块只有 ${chunk.charCount} 字，少于 ${CHUNK_MIN}`,
    );
    assert.ok(
      chunk.charCount <= CHUNK_MAX,
      `第 ${chunk.index + 1} 块有 ${chunk.charCount} 字，超过 ${CHUNK_MAX}`,
    );
  }
}

/** 第 2 块开始，开头必须是上一块最后 50 个字 */
function assertOverlap(chunks) {
  for (let i = 1; i < chunks.length; i += 1) {
    const prefix = chunks[i - 1].content.slice(-CHUNK_OVERLAP).trim();
    assert.ok(prefix.length > 0, '重叠前缀不能为空');
    assert.ok(
      chunks[i].content.startsWith(`${prefix}\n`),
      `第 ${i + 1} 块没有带上第 ${i} 块最后 ${CHUNK_OVERLAP} 字的重叠`,
    );
  }
}

/** 去掉重叠部分后拼回去，应该和原文一字不差（忽略空白差异） */
function assertNoTextLoss(raw, chunks) {
  const rebuilt = chunks
    .map((chunk, index) => {
      if (index === 0) {
        return chunk.content;
      }
      const prefix = chunks[index - 1].content.slice(-CHUNK_OVERLAP).trim();
      return chunk.content.startsWith(`${prefix}\n`)
        ? chunk.content.slice(prefix.length + 1)
        : chunk.content;
    })
    .join('');

  assert.equal(strip(rebuilt), strip(normalizeText(raw)), '切块后文字不能丢失或乱序');
}

// ---------- 1. 多段落文档（含 Markdown 标题）----------
const multiParagraph = [
  '# 校园二手书交易平台',
  paragraph(7, 1),
  '## 项目背景',
  paragraph(15, 0),
  '## 核心功能',
  paragraph(16, 1),
  '### 发布流程',
  paragraph(11, 2),
  '## 技术方案',
  paragraph(13, 3),
  '平台后续还会加入信用评价和教材回收功能。',
].join('\n\n');

const multiChunks = splitIntoChunks(multiParagraph);
printCase('用例 1：多段落文档（含标题）', multiParagraph, multiChunks);
assert.ok(multiChunks.length >= 3, '这样长的文档至少应该切成 3 块');
assertChunkSizes(multiChunks);
assertOverlap(multiChunks);
assertNoTextLoss(multiParagraph, multiChunks);
assert.ok(
  multiChunks[0].content.startsWith('# 校园二手书交易平台'),
  '第一块应该从文档大标题开始',
);
for (const heading of ['## 项目背景', '## 核心功能', '### 发布流程', '## 技术方案']) {
  assert.ok(
    multiChunks.some((chunk) => chunk.content.includes(heading)),
    `标题「${heading}」不能丢`,
  );
}

// ---------- 2. 一段超长文本（没有空行）----------
const longParagraph = paragraph(70, 0);
const longChunks = splitIntoChunks(longParagraph);
printCase('用例 2：一段超长文本', longParagraph, longChunks);
assert.ok(longChunks.length >= 3, '超长段落应该被切成多块');
assertChunkSizes(longChunks);
assertOverlap(longChunks);
assertNoTextLoss(longParagraph, longChunks);

// ---------- 3. 纯标题文档（总字数很短）----------
const onlyHeadings = [
  '# 一级标题',
  '## 二级标题',
  '### 三级标题',
  '#### 四级标题',
].join('\n\n');
const headingChunks = splitIntoChunks(onlyHeadings);
printCase('用例 3：纯标题文档', onlyHeadings, headingChunks);
assert.equal(headingChunks.length, 1, '很短的文档应该只有一块');
assert.ok(
  onlyHeadings
    .split('\n')
    .filter(Boolean)
    .every((line) => headingChunks[0].content.includes(line)),
  '所有标题都应该保留',
);

// ---------- 4. 空文档 ----------
const emptyChunks = splitIntoChunks('   \n\n \t \n');
printCase('用例 4：空文档', '   \n\n \t \n', emptyChunks);
assert.equal(emptyChunks.length, 0, '空文档应该产生 0 块');

// ---------- 附加：完全没有标点的长串，才允许硬切 ----------
const noPunctuation = splitIntoChunks('A'.repeat(1200));
assert.ok(
  noPunctuation.every((chunk) => chunk.charCount <= CHUNK_MAX),
  '无标点文本硬切后也不能超过 500 字',
);
console.log(
  `\n附加检查：1200 字无标点文本 → ${noPunctuation.length} 块（${noPunctuation
    .map((chunk) => chunk.charCount)
    .join(' / ')} 字），最大 ${Math.max(
    ...noPunctuation.map((chunk) => chunk.charCount),
  )} 字`,
);

// ---------- 附加：GBK 编码的中文 txt 能正确解码 ----------
const gbkBytes = Uint8Array.from([
  0xc4, 0xe3, 0xba, 0xc3, 0xa3, 0xac, 0xca, 0xc0, 0xbd, 0xe7, 0xa3, 0xa1,
]);
const gbkText = await readTextFile(new Blob([gbkBytes]));
assert.equal(gbkText, '你好，世界！');
console.log('附加检查：GBK 中文解码通过');

console.log('\n全部检查通过 ✅');
