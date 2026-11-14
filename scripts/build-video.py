"""Build a narrated 1080p demonstration from genuine application screenshots.

Dependencies (isolated in this repository):
  python -m pip install --target tmp/media/packages edge-tts imageio-ffmpeg
Usage:
  python scripts/build-video.py --test-voice
  python scripts/build-video.py --prepare-audio
  python scripts/build-video.py
The frame files must be genuine captures provided by the browser QA workflow.
"""
from __future__ import annotations
import argparse
import asyncio
import json
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tmp/media/packages"))
import edge_tts
import imageio_ffmpeg
from PIL import Image, ImageDraw, ImageFont

OUT = ROOT / "submission/video"
TMP = ROOT / "tmp/media"
VOICE = "zh-CN-XiaoxiaoNeural"
FONT = Path("C:/Windows/Fonts/msyh.ttc")


def run(args: list[str], **kwargs):
    return subprocess.run(args, check=True, capture_output=True, text=True, encoding="utf-8", errors="replace", **kwargs)


async def synthesize(text: str, audio: Path, srt: Path):
    maker = edge_tts.SubMaker()
    communicate = edge_tts.Communicate(text, VOICE, rate="-5%", boundary="SentenceBoundary")
    with audio.open("wb") as handle:
        async for chunk in communicate.stream():
            if chunk["type"] == "audio":
                handle.write(chunk["data"])
            elif chunk["type"] in ("SentenceBoundary", "WordBoundary"):
                maker.feed(chunk)
    srt.write_text(maker.get_srt(), encoding="utf-8")
    if audio.stat().st_size < 1000:
        raise RuntimeError("Speech synthesis returned no usable audio")


def duration(path: Path) -> float:
    process = subprocess.run([imageio_ffmpeg.get_ffmpeg_exe(), "-hide_banner", "-i", str(path)], capture_output=True, text=True, encoding="utf-8", errors="replace")
    match = re.search(r"Duration: (\d+):(\d+):(\d+\.\d+)", process.stderr)
    if not match:
        raise RuntimeError(f"Cannot inspect duration: {path}")
    return int(match[1]) * 3600 + int(match[2]) * 60 + float(match[3])


def frame(source: Path, title: str, subtitle: str, target: Path, number: int):
    canvas = Image.new("RGB", (1920, 1080), "#f2f5fc")
    draw = ImageDraw.Draw(canvas)
    draw.rectangle((0, 0, 1920, 116), fill="#14213b")
    draw.text((60, 26), "赛知行", font=ImageFont.truetype(str(FONT), 40), fill="white")
    draw.text((250, 38), title, font=ImageFont.truetype(str(FONT), 28), fill="#dbe5ff")
    draw.text((1770, 40), f"{number:02d} / 12", font=ImageFont.truetype(str(FONT), 22), fill="#9eb1db")
    image = Image.open(source).convert("RGB")
    image.thumbnail((1800, 780), Image.Resampling.LANCZOS)
    x, y = (1920 - image.width) // 2, 135 + (780 - image.height) // 2
    canvas.paste(image, (x, y))
    draw.rectangle((0, 927, 1920, 1080), fill="#14213b")
    draw.text((60, 942), subtitle, font=ImageFont.truetype(str(FONT), 19), fill="#9cadce")
    canvas.save(target)


def shift_srt(text: str, offset: float, starting_index: int):
    def shift(match):
        h, m, s, ms = map(int, match.groups())
        total = int(round((h * 3600 + m * 60 + s + ms / 1000 + offset) * 1000))
        return f"{total//3600000:02d}:{total//60000%60:02d}:{total//1000%60:02d},{total%1000:03d}"
    blocks = []
    for block in text.strip().split("\n\n"):
        if not block.strip():
            continue
        lines = block.splitlines()
        if len(lines) < 3:
            continue
        starting_index += 1
        lines[0] = str(starting_index)
        lines[1] = re.sub(r"(\d{2}):(\d{2}):(\d{2}),(\d{3})", shift, lines[1])
        blocks.append("\n".join(lines))
    return "\n\n".join(blocks), starting_index


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--test-voice", action="store_true")
    parser.add_argument("--prepare-audio", action="store_true")
    args = parser.parse_args()
    OUT.mkdir(parents=True, exist_ok=True)
    TMP.mkdir(parents=True, exist_ok=True)
    (OUT / "audio").mkdir(exist_ok=True)
    if args.test_voice:
        asyncio.run(synthesize("你好，这里是赛知行。每一个结论，都能找到原文依据。本段使用普通话合成配音。", TMP / "voice-test.mp3", TMP / "voice-test.srt"))
        print(json.dumps({"voice": VOICE, "duration": duration(TMP / "voice-test.mp3"), "bytes": (TMP / "voice-test.mp3").stat().st_size}, ensure_ascii=False))
        return
    storyboard = json.loads((OUT / "storyboard.json").read_text(encoding="utf-8"))
    for index, scene in enumerate(storyboard, 1):
        audio = OUT / "audio" / f"scene-{index:02d}.mp3"
        srt = OUT / "audio" / f"scene-{index:02d}.srt"
        if not audio.exists() or not srt.exists():
            asyncio.run(synthesize(scene["narration"], audio, srt))
        print(f"Audio {index:02d}: {duration(audio):.2f}s", flush=True)
    if args.prepare_audio:
        return
    ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()
    clips = []
    total = 0.0
    subtitles = []
    subindex = 0
    evidence = []
    for index, scene in enumerate(storyboard, 1):
        source = OUT / "frames" / scene["frame"]
        if not source.is_file():
            raise RuntimeError(f"Missing genuine application capture: {source}")
        audio = OUT / "audio" / f"scene-{index:02d}.mp3"
        srt = OUT / "audio" / f"scene-{index:02d}.srt"
        seconds = max(25.0, duration(audio) + 1.0)
        poster = TMP / f"poster-{index:02d}.png"
        frame(source, scene["title"], scene["footer"], poster, index)
        clip = TMP / f"clip-{index:02d}.mp4"
        # Relative subtitle filename avoids Windows drive escaping in libass filters.
        (TMP / f"scene-{index:02d}.srt").write_text(srt.read_text(encoding="utf-8"), encoding="utf-8")
        filter_expression = f"subtitles=scene-{index:02d}.srt:force_style='FontName=Microsoft YaHei,FontSize=9,PrimaryColour=&HFFFFFF,OutlineColour=&H3B2114,BorderStyle=1,Outline=1,Alignment=2,MarginV=8'"
        run([ffmpeg, "-y", "-hide_banner", "-loglevel", "error", "-loop", "1", "-framerate", "24", "-i", str(poster), "-i", str(audio), "-vf", filter_expression, "-af", "apad", "-t", str(seconds), "-c:v", "libx264", "-preset", "veryfast", "-crf", "22", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "128k", str(clip)], cwd=TMP)
        shifted, subindex = shift_srt(srt.read_text(encoding="utf-8"), total, subindex)
        subtitles.append(shifted)
        clips.append(clip)
        evidence.append({"title": scene["title"], "capture": str(source.relative_to(ROOT)), "start": round(total, 3), "duration": round(seconds, 3)})
        total += seconds
        print(f"Encoded scene {index:02d}, total {total:.2f}s", flush=True)
    if not 300 <= total <= 480:
        raise RuntimeError(f"Video duration must be 300-480 seconds, calculated {total}")
    playlist = TMP / "clips.txt"
    playlist.write_text("\n".join(f"file '{p.as_posix()}'" for p in clips), encoding="utf-8")
    final = OUT / "赛知行-参赛演示.mp4"
    run([ffmpeg, "-y", "-hide_banner", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", str(playlist), "-c", "copy", "-movflags", "+faststart", str(final)])
    (OUT / "赛知行-中文字幕.srt").write_text("\n\n".join(subtitles), encoding="utf-8")
    # Decode whole output: this catches truncation and broken media, rather than only checking a file extension.
    run([ffmpeg, "-hide_banner", "-v", "error", "-i", str(final), "-f", "null", "-"])
    inspection = subprocess.run([ffmpeg, "-hide_banner", "-i", str(final)], capture_output=True, text=True, encoding="utf-8", errors="replace").stderr
    report = {"file": final.name, "voice": VOICE, "synthetic_voice_disclosed": True, "duration_seconds": duration(final), "resolution_verified": "1920x1080" in inspection, "audio_verified": "Audio: aac" in inspection, "full_decode_passed": True, "captures": evidence, "technical_output": inspection}
    (OUT / "verification.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    if not report["resolution_verified"] or not report["audio_verified"]:
        raise RuntimeError("Resolution or audio verification failed")
    print(json.dumps({k:v for k,v in report.items() if k not in ('technical_output', 'captures')}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
