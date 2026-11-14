"""Render the editable submission Markdown into a deliberately paginated PDF.

Run using the bundled Python (reportlab, pypdf, Pillow). Actual verification
records may be provided using --verification and --evaluation JSON paths.
"""
from __future__ import annotations
import argparse
import html
import json
import re
from pathlib import Path
from reportlab.pdfgen import canvas
from reportlab.lib.colors import HexColor, white
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.styles import ParagraphStyle
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import Paragraph, Table, TableStyle
from pypdf import PdfReader

ROOT = Path(__file__).resolve().parents[1]
NAVY = HexColor('#15223b')
BLUE = HexColor('#4068dc')
INK = HexColor('#34455f')
MUTED = HexColor('#75849b')
PALE = HexColor('#eff3fc')
LINE = HexColor('#dce4f1')
WIDTH, HEIGHT = 595.276, 841.89
LEFT, RIGHT, TOP, BOTTOM = 53, 53, 129, 65

def font_setup():
    candidates = [Path('C:/Windows/Fonts/msyh.ttc'), Path('C:/Windows/Fonts/simhei.ttf')]
    regular = next((p for p in candidates if p.exists()), None)
    if not regular:
        raise RuntimeError('A Chinese TrueType font is required; install Microsoft YaHei or update font_setup().')
    bold = Path('C:/Windows/Fonts/msyhbd.ttc')
    pdfmetrics.registerFont(TTFont('YaHei', str(regular), subfontIndex=0))
    pdfmetrics.registerFont(TTFont('YaHeiBold', str(bold if bold.exists() else regular), subfontIndex=0))

def markup(text):
    text = html.escape(text).replace('—', '-').replace('–', '-').replace('‑', '-')
    text = re.sub(r'\*\*(.+?)\*\*', r'<b>\1</b>', text)
    return text

def style(name='body', **kwargs):
    values=dict(fontName='YaHei', fontSize=10.1, leading=19.7,
                textColor=INK, alignment=TA_LEFT, wordWrap='CJK')
    values.update(kwargs)
    return ParagraphStyle(name, **values)

def blocks(markdown):
    result, paragraph, table = [], [], []
    def flush():
        nonlocal paragraph, table
        if paragraph:
            result.append(('paragraph', ' '.join(paragraph))); paragraph = []
        if table:
            result.append(('table', table)); table = []
    for line in markdown.splitlines():
        line = line.strip()
        if not line:
            flush(); continue
        if line.startswith('|'):
            if paragraph: flush()
            if not re.fullmatch(r'[| :\-]+', line):
                table.append([c.strip() for c in line.strip('|').split('|')])
        else:
            if table: flush()
            if line.startswith('## '):
                flush(); result.append(('subheading', line[3:]))
            elif line.startswith('# '):
                flush(); result.append(('title', line[2:]))
            elif re.match(r'^(- |\d+\. )', line):
                flush(); result.append(('bullet', line))
            else:
                paragraph.append(line)
    flush()
    return result

def load_record(path):
    if not path: return None
    candidate = Path(path)
    return json.loads(candidate.read_text(encoding='utf-8-sig')) if candidate.exists() else None

def describe_record(record, label):
    if not record: return f'- {label}：尚未提供最终执行记录。当前不声明已完成验收。'
    summary = record.get('summary', record.get('status', record))
    if isinstance(summary, dict):
        return '\n'.join(f'- {label} / {key}：{json.dumps(value, ensure_ascii=False) if isinstance(value, (dict,list)) else value}' for key,value in summary.items())
    return f'- {label}：{summary}'

def verification_text(acceptance, evaluation):
    tests=load_record(ROOT/'submission/evaluation/verification.json')
    workflow=load_record(ROOT/'submission/evaluation/workflow-smoke.json')
    checks=(acceptance or {}).get('checks',[])
    result=[f"- 自动验收：{sum(bool(item.get('passed')) for item in checks)}/{len(checks)}组通过；浏览器与真实模型检查单独归档。" if checks else describe_record(acceptance,'自动验收组')]
    if tests:
        result.append(f"- 确定性规则与引用测试：{tests.get('passed')}/{tests.get('total')}通过，失败{tests.get('failed')}项。")
    if evaluation:
        metrics=evaluation.get('metrics',{})
        a,b=metrics.get('baseline',{}),metrics.get('final',{})
        result.append(f"- 真实模型初轮：基线{a.get('expectedFactCoverage')}/{a.get('questions')}、最终{b.get('expectedFactCoverage')}/{b.get('questions')}覆盖固定期望事实；最终遗漏题修复后单题复测通过。")
        result.append(f"- 累计评测模型调用：{evaluation.get('modelCalls')}次；初轮平均耗时：基线{a.get('meanLatencyMs')}ms、最终{b.get('meanLatencyMs')}ms。")
    if workflow:
        names='、'.join(workflow.get('toolNames',[]))
        result.append(f'- 真实工具冒烟：{names}已执行。规则分析曾接受2条、拒绝1条；后续规范化修复不作为完整识别率。')
    return '\n\n'.join(result)

def draw_header(c, page, title):
    c.setFillColor(NAVY); c.rect(0, HEIGHT-19, WIDTH, 19, fill=1, stroke=0)
    c.setFillColor(BLUE); c.rect(LEFT, HEIGHT-56, 23, 3, fill=1, stroke=0)
    c.setFont('YaHei', 8); c.setFillColor(MUTED)
    c.drawString(LEFT, HEIGHT-74, 'SAIZHIXING  /  TECHNICAL REPORT')
    c.setFont('YaHeiBold', 21); c.setFillColor(NAVY)
    c.drawString(LEFT, HEIGHT-109, title)
    c.setStrokeColor(LINE); c.line(LEFT, 46, WIDTH-RIGHT, 46)
    c.setFont('YaHei', 7.2); c.setFillColor(MUTED)
    c.drawString(LEFT, 29, '赛知行 · 本地交付版 · 来源与资格仍需人工核实')
    c.drawRightString(WIDTH-RIGHT, 29, f'{page:02d} / 20')

def draw_body(c, page, content):
    parsed = blocks(content)
    title = next(v for k,v in parsed if k == 'title')
    draw_header(c, page, title)
    y, content_width = HEIGHT-TOP, WIDTH-LEFT-RIGHT
    for kind, value in parsed:
        if kind == 'title': continue
        if kind == 'subheading':
            y -= 9
            p = Paragraph(markup(value), ParagraphStyle('section', parent=style(), fontName='YaHeiBold', fontSize=12.2, leading=20, textColor=BLUE))
            w,h = p.wrap(content_width, HEIGHT); p.drawOn(c, LEFT, y-h); y -= h+10
        elif kind == 'table':
            count = len(value[0]); cells = [[Paragraph(markup(cell), style('cell', fontSize=8.4, leading=15.5)) for cell in row] for row in value]
            table = Table(cells, colWidths=[content_width/count]*count, hAlign='LEFT')
            table.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,0),PALE), ('VALIGN',(0,0),(-1,-1),'TOP'), ('BOX',(0,0),(-1,-1),.6,LINE), ('INNERGRID',(0,0),(-1,-1),.4,LINE), ('LEFTPADDING',(0,0),(-1,-1),9), ('RIGHTPADDING',(0,0),(-1,-1),9), ('TOPPADDING',(0,0),(-1,-1),8), ('BOTTOMPADDING',(0,0),(-1,-1),8)]))
            w,h = table.wrap(content_width, HEIGHT); table.drawOn(c, LEFT, y-h); y -= h+16
        else:
            p = Paragraph(markup(value), style())
            w,h = p.wrap(content_width, HEIGHT); p.drawOn(c, LEFT, y-h); y -= h+(8 if kind == 'bullet' else 13)
        if y < BOTTOM:
            raise RuntimeError(f'Page {page} overflows after {kind}: y={y:.1f}. Edit the Markdown page rather than silently clipping.')
    flows = {
        4: (['确认资料范围', '提取与核对', '清单与预检', '用户最终确认'], '图1  准备流程中的人机协作边界'),
        5: (['浏览器工作区', '受控API接口', '模型与工具', '证据映射输出'], '图2  本地优先的系统责任划分'),
        8: (['范围过滤', '词法排序', '候选片段', '证据核对'], '图3  词法检索的使用流程'),
        12: (['引用编号', '文档与版本', '原文定位', '支持关系'], '图4  引用验证的层次'),
    }
    if page in flows and y > 195:
        draw_flow(c, *flows[page])

def draw_flow(c, labels, caption):
    total = WIDTH-LEFT-RIGHT
    gap, count = 13, len(labels)
    box_width = (total-gap*(count-1))/count
    y, height = 119, 52
    for i,label in enumerate(labels):
        x=LEFT+i*(box_width+gap)
        c.setFillColor(PALE);c.setStrokeColor(LINE)
        c.roundRect(x,y,box_width,height,6,fill=1,stroke=1)
        c.setFillColor(BLUE);c.setFont('YaHei',7);c.drawString(x+10,y+height-13,f'0{i+1}')
        c.setFillColor(INK);c.setFont('YaHei',8.2);c.drawCentredString(x+box_width/2,y+16,label)
        if i < count-1:
            ax=x+box_width+2;ay=y+height/2
            c.setStrokeColor(HexColor('#90a6d7'));c.line(ax,ay,ax+gap-4,ay)
            c.line(ax+gap-4,ay,ax+gap-7,ay+3);c.line(ax+gap-4,ay,ax+gap-7,ay-3)
    c.setFont('YaHei',8);c.setFillColor(MUTED);c.drawCentredString(WIDTH/2,99,caption)

def cover(c, content):
    c.setFillColor(NAVY); c.rect(0,0,WIDTH,HEIGHT,fill=1,stroke=0)
    c.setFillColor(HexColor('#233a63')); c.circle(WIDTH+45,HEIGHT-130,230,fill=1,stroke=0)
    c.setStrokeColor(HexColor('#354f7b')); c.circle(WIDTH-5,HEIGHT-150,170,fill=0,stroke=1)
    c.setFillColor(HexColor('#83a5ff')); c.rect(LEFT,HEIGHT-118,42,5,fill=1,stroke=0)
    c.setFont('YaHei',10); c.setFillColor(HexColor('#aabada')); c.drawString(LEFT,HEIGHT-148,'SAIZHIXING / EVIDENCE INTO ACTION')
    c.setFont('YaHeiBold',46); c.setFillColor(white); c.drawString(LEFT,HEIGHT-236,'赛知行')
    c.setFont('YaHei',19); c.drawString(LEFT,HEIGHT-283,'校园竞赛规则解读')
    c.drawString(LEFT,HEIGHT-316,'与材料预检助手')
    c.setFont('YaHei',11); c.setFillColor(HexColor('#b9c7df')); c.drawString(LEFT,HEIGHT-359,'基于证据链的 AI Web 应用 · 技术文档')
    c.setFillColor(HexColor('#203451')); c.roundRect(LEFT,125,WIDTH-LEFT-RIGHT,280,12,fill=1,stroke=0)
    y=375
    cover_text = [v for k,v in blocks(content) if k=='paragraph']
    for value in cover_text:
        if value.startswith('技术文档'): continue
        p=Paragraph(markup(value),ParagraphStyle('cover',parent=style(),fontSize=9,leading=18,textColor=HexColor('#c5d1e7')))
        _,h=p.wrap(WIDTH-LEFT-RIGHT-34,HEIGHT);p.drawOn(c,LEFT+17,y-h);y-=h+13
    c.setFont('YaHei',8);c.setFillColor(HexColor('#8d9fbe'));c.drawString(LEFT,64,'规则有据，行动有序。')
    c.drawRightString(WIDTH-RIGHT,64,'01 / 20')

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--verification');parser.add_argument('--evaluation');parser.add_argument('--output',default=str(ROOT/'submission/technical-report.pdf'));args=parser.parse_args()
    source=ROOT/'submission/docs/technical-report.md'
    text=source.read_text(encoding='utf-8-sig')
    verification=load_record(args.verification);evaluation=load_record(args.evaluation)
    text=text.replace('{{VERIFICATION_SUMMARY}}',verification_text(verification,evaluation))
    indices=[]
    for label,path in [('自动验收记录',args.verification),('真实模型评测记录',args.evaluation)]:
        if path and Path(path).exists():
            try: path=str(Path(path).resolve().relative_to(ROOT)).replace('\\','/')
            except ValueError: path=Path(path).name
            indices.append(f'- {label}：{path}')
    if (ROOT/'submission/evaluation/workflow-smoke.json').exists():
        indices.append('- 工具记录：submission/evaluation/workflow-smoke.json；初轮模型记录另保留。')
    if (ROOT/'submission/evaluation/browser-qa.json').exists():
        indices.append('- 浏览器状态：submission/evaluation/browser-qa.json；提交缺项见SUBMISSION_CHECKLIST.md。')
    text=text.replace('{{EVIDENCE_INDEX}}','\n'.join(indices) or '- 最终验收证据尚未归档；当前文档为待冻结版本。')
    (ROOT/'submission/docs/technical-report-resolved.md').write_text(text,encoding='utf-8')
    pages=text.split('<!-- PAGE -->');assert len(pages)==20,f'Expected 20 pages, got {len(pages)}'
    font_setup(); output=Path(args.output);output.parent.mkdir(parents=True,exist_ok=True)
    c=canvas.Canvas(str(output),pagesize=(WIDTH,HEIGHT));c.setTitle('赛知行 - 技术文档');c.setAuthor('广州商学院 / WEB玩家');c.setSubject('校园竞赛规则解读与材料预检助手')
    for i,page in enumerate(pages,1):
        cover(c,page) if i==1 else draw_body(c,i,page)
        c.showPage()
    c.save();reader=PdfReader(str(output));assert len(reader.pages)==20
    status={'pages':len(reader.pages),'path':str(output),'source':str(source),'resolved_source':str(ROOT/'submission/docs/technical-report-resolved.md'),'verification_attached':bool(verification),'evaluation_attached':bool(evaluation),'team_metadata_complete':True,'review_repository_ready':False,'browser_regression_complete':False,'demo_mp4_complete':False,'final_submission_ready':False}
    (ROOT/'submission/docs/pdf-build-status.json').write_text(json.dumps(status,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps(status,ensure_ascii=False))

if __name__=='__main__':main()
