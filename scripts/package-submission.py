"""Package the real source, evidence and incomplete media assets without secrets/caches."""
from pathlib import Path
import hashlib
import json
import subprocess
import zipfile

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'submission'
SOURCE = OUT / 'source'
SOURCE.mkdir(parents=True, exist_ok=True)
files = subprocess.check_output(['git', 'ls-files', '--cached', '--others', '--exclude-standard', '-z'], cwd=ROOT).decode('utf-8').split('\0')
archive = SOURCE / 'saizhixing-source.zip'
with zipfile.ZipFile(archive, 'w', zipfile.ZIP_DEFLATED) as package:
    for name in files:
        if not name or name.startswith('submission/source/') or name.endswith('.zip') or name == '.env.local' or '/__pycache__/' in name:
            continue
        path = ROOT / name
        if path.is_file():
            package.write(path, name)
bundle = SOURCE / 'development-history.bundle'
subprocess.run(['git', 'bundle', 'create', str(bundle), '--all'], cwd=ROOT, check=True)
manifest = []
for path in sorted(OUT.rglob('*')):
    if path.is_file() and path.suffix != '.zip' and path.name != 'manifest.json':
        manifest.append({'file': path.relative_to(OUT).as_posix(), 'bytes': path.stat().st_size, 'sha256': hashlib.sha256(path.read_bytes()).hexdigest()})
manifest.append({'file': archive.relative_to(OUT).as_posix(), 'bytes': archive.stat().st_size, 'sha256': hashlib.sha256(archive.read_bytes()).hexdigest()})
(OUT / 'manifest.json').write_text(json.dumps({'finalSubmissionReady': False, 'remaining': ['完整浏览器回归', '真实画面1080p MP4', '远程评审仓库'], 'files': manifest}, ensure_ascii=False, indent=2), encoding='utf-8')
final = OUT / '赛知行-技术包-待补视频与仓库.zip'
with zipfile.ZipFile(final, 'w', zipfile.ZIP_DEFLATED) as package:
    for path in sorted(OUT.rglob('*')):
        if path.is_file() and path != final:
            package.write(path, '赛知行/' + path.relative_to(OUT).as_posix())
print(json.dumps({'source': str(archive), 'package': str(final), 'files': len(manifest), 'finalSubmissionReady': False}, ensure_ascii=False))
