import { readTextFile } from './document';
import type { SourceDocument } from './competition';
import { fingerprint } from './rules';

export async function readPdf(file: File) {
  const pdfjs = await import('pdfjs-dist');
  pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';
  let pdf;
  try { pdf = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()), isEvalSupported: false }).promise; }
  catch { throw new Error('PDF无法读取，可能已加密、损坏或使用不支持的格式。'); }
  try {
    if (pdf.numPages > 100) throw new Error('最多支持100页的PDF资料。');
    const pages = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i); const content = await page.getTextContent();
      const text = content.items.map(item => 'str' in item ? item.str + (item.hasEOL ? '\n' : ' ') : '').join('');
      if (text.replace(/\s/g, '').length < 8) throw new Error(`第${i}页没有足够可提取文字，可能是扫描PDF；当前不支持OCR。`);
      if ((text.match(/�/g)?.length ?? 0) > text.length * .02) throw new Error(`第${i}页存在明显乱码，无法可靠建立证据。`);
      pages.push({ page: i, text });
    }
    return { text: pages.map(p => p.text).join('\n'), pages };
  } finally { await pdf.destroy(); }
}
export async function importSource(file: File): Promise<Pick<SourceDocument, 'text' | 'pages' | 'version'>> {
  if (!/\.(txt|md|markdown|pdf)$/i.test(file.name)) throw new Error('支持TXT、Markdown及文本型PDF。');
  const pdf = /\.pdf$/i.test(file.name);
  if (!file.size || file.size > (pdf ? 10 : 2) * 1024 * 1024) throw new Error(`文件为空或超过${pdf ? 10 : 2}MB。`);
  const result = pdf ? await readPdf(file) : { text: await readTextFile(file) };
  if (!result.text.trim()) throw new Error('没有可读取的文本。');
  return { ...result, version: fingerprint(result.text) };
}

export interface MaterialCheck { title: string; status: '通过' | '不满足' | '未检查'; details: string[] }
export async function inspectMaterial(file: File): Promise<MaterialCheck> {
  if (/\.pdf$/i.test(file.name)) {
    try {
      if (file.size > 20 * 1024 * 1024) return { title: file.name, status: '未检查', details: ['预检PDF最大20MB。'] };
      const pdfjs = await import('pdfjs-dist'); pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';
      const pdf = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()), isEvalSupported: false }).promise;
      try { const count = pdf.numPages; return { title: file.name, status: count <= 30 ? '通过' : '不满足', details: [`PDF共${count}页；本次演示检查上限30页。`, '仅读取页数，不依赖OCR，未检查论文内容质量。'] }; } finally { await pdf.destroy(); }
    }
    catch (e) { return { title: file.name, status: '未检查', details: [e instanceof Error ? e.message : 'PDF无法读取'] }; }
  }
  if (/\.(mp4|webm|mov)$/i.test(file.name)) {
    return new Promise(resolve => {
      const video = document.createElement('video'); const url = URL.createObjectURL(file); let settled = false;
      const finish = (result: MaterialCheck) => { if (settled) return; settled = true; clearTimeout(timer); URL.revokeObjectURL(url); video.removeAttribute('src'); resolve(result); };
      const timer = setTimeout(() => finish({ title: file.name, status: '未检查', details: ['视频元数据读取超时。'] }), 10000);
      video.preload = 'metadata'; video.onloadedmetadata = () => { const ok = video.duration >= 300 && video.duration <= 480 && video.videoWidth >= 1920 && video.videoHeight >= 1080 && /\.mp4$/i.test(file.name); finish({ title: file.name, status: ok ? '通过' : '不满足', details: [`${Math.round(video.duration)}秒 · ${video.videoWidth}×${video.videoHeight} · ${file.name.split('.').at(-1)}`, '演示阈值：MP4、300—480秒、不低于1920×1080。未检查音轨、讲解和画面内容。'] }); };
      video.onerror = () => finish({ title: file.name, status: '未检查', details: ['浏览器无法解码视频元数据。'] }); video.src = url;
    });
  }
  if (/\.(md|txt|markdown)$/i.test(file.name)) {
    const text = await readTextFile(file); const checks = ['项目介绍', '技术架构', '安装运行', '团队信息'];
    const patterns = [/项目介绍|项目概述|简介/, /技术架构|系统架构|技术栈/, /安装|运行|部署/, /团队|成员|指导教师/];
    const missing = checks.filter((_, i) => !patterns[i].test(text));
    return { title: file.name, status: missing.length ? '不满足' : '通过', details: [missing.length ? `未找到这些README章节关键词：${missing.join('、')}` : '已找到项目、架构、运行、团队章节关键词。', '仅检查关键词覆盖，不判断说明是否正确完整。'] };
  }
  return { title: file.name, status: '未检查', details: ['仅支持README文本、PDF页数和视频元数据检查。'] };
}
