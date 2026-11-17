"""Create a teammate-friendly source package, excluding machine state and keys."""
from pathlib import Path
import hashlib
import json
import os
import re
import subprocess
import zipfile
from datetime import datetime

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'dist-share'
OUT.mkdir(exist_ok=True)
DEST = OUT / '赛知行-队友学习包-2026-11-15.zip'
SKIP_DIRS = {'.git', '.next', 'node_modules', '.pnpm-store', 'tmp', '__pycache__', 'dist-share', '.codex', '.agents', '.aws'}
SKIP_FILES = {'tsconfig.tsbuildinfo', '.DS_Store'}
TEXT_SUFFIXES = {'.ts', '.tsx', '.js', '.mjs', '.json', '.md', '.txt', '.py', '.yaml', '.yml', '.css', '.example', '.srt'}
KEY_PATTERNS = [re.compile(r'sk-[A-Za-z0-9]{20,}'), re.compile(r'(?:DEEPSEEK_API_KEY|OPENAI_API_KEY)\s*[:=]\s*[\'"]?[A-Za-z0-9_-]{20,}')]

def digest(data):
    return hashlib.sha256(data).hexdigest()

files = {}
for current, folders, names in os.walk(ROOT):
    folders[:] = [name for name in folders if name not in SKIP_DIRS]
    for name in names:
        path = Path(current) / name
        relative = path.relative_to(ROOT).as_posix()
        if path.is_symlink() or name in SKIP_FILES or name.endswith(('.zip', '.pyc', '.bundle')):
            continue
        if relative.startswith(('submission/source/', 'docs/team/')) or relative == 'submission/manifest.json':
            continue
        if name.startswith('.env') and name != '.env.example':
            continue
        # Generated Next type-reference files can contain machine build paths;
        # Next regenerates this file on first dev/build.
        if name == 'next-env.d.ts':
            continue
        data = path.read_bytes()
        if path.suffix in TEXT_SUFFIXES or name == '.env.example':
            text = data.decode('utf-8', errors='replace')
            if any(pattern.search(text) for pattern in KEY_PATTERNS):
                raise RuntimeError(f'Potential key found; refusing to share: {relative}')
        files['赛知行-队友学习包/project/' + relative] = data

for path in sorted((ROOT / 'docs/team').glob('*.md')):
    files['赛知行-队友学习包/' + path.name] = path.read_bytes()

history = ROOT / 'submission/source/development-history.bundle'
if history.exists():
    subprocess.run(['git', 'bundle', 'verify', str(history)], cwd=ROOT, check=True, capture_output=True)
    files['赛知行-队友学习包/history/development-history.bundle'] = history.read_bytes()

commit = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip()
manifest = {
    'packagedOn': '2026-11-15',
    'sourceCommit': commit,
    'purpose': '队友内部学习与接续开发，含本次新增队友说明，不是最终比赛提交包',
    'finalSubmissionReady': False,
    'missing': ['最终1080p MP4', '增强版完整浏览器回归', '远程评审仓库', '官方时间与提交入口核验'],
    'excluded': ['真实环境变量与密钥', 'node_modules', '.next', '本机浏览器资料', '缓存', 'Git内部控制目录'],
    'files': [{'path': name.split('/', 1)[1], 'bytes': len(data), 'sha256': digest(data)} for name, data in sorted(files.items())],
}
files['赛知行-队友学习包/MANIFEST.json'] = json.dumps(manifest, ensure_ascii=False, indent=2).encode('utf-8')
with zipfile.ZipFile(DEST, 'w', zipfile.ZIP_DEFLATED) as archive:
    for name, data in sorted(files.items()):
        archive.writestr(name, data)

with zipfile.ZipFile(DEST) as archive:
    if archive.testzip() is not None:
        raise RuntimeError('Archive integrity check failed')
    for item in manifest['files']:
        data = archive.read('赛知行-队友学习包/' + item['path'])
        if digest(data) != item['sha256']:
            raise RuntimeError('Manifest hash mismatch: ' + item['path'])
    for name in archive.namelist():
        parts = Path(name).parts
        if any(part in SKIP_DIRS for part in parts):
            raise RuntimeError('Excluded directory present: ' + name)
        if Path(name).name.startswith('.env') and Path(name).name != '.env.example':
            raise RuntimeError('Environment secret file present')
    required = ['project/package.json', 'project/pnpm-lock.yaml', 'project/.env.example', '00-从这里开始.md', '01-选题观点与比赛要求.md', '02-实现效果与缺失材料.md', '03-代码学习与协作路线.md', 'project/submission/technical-report.pdf']
    for name in required:
        if '赛知行-队友学习包/' + name not in archive.namelist():
            raise RuntimeError('Required file missing: ' + name)

result = {'path': str(DEST), 'bytes': DEST.stat().st_size, 'sha256': digest(DEST.read_bytes()), 'files': len(files), 'integrity': 'PASS', 'manifest': 'PASS', 'secretExclusions': 'PASS', 'sourceCommit': commit}
(OUT / '队友学习包-校验结果.json').write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')
print(json.dumps(result, ensure_ascii=False))
