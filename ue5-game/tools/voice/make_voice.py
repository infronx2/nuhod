"""Generates Mu'in's in-game voice lines from lines.json.

Each line becomes Content/Nuhoud/Voice/<event>_<n>.wav (24 kHz mono 16-bit PCM, what
ANuhoudVoice reads). Uses Microsoft's Omani neural voices through edge-tts and ffmpeg for the
conversion.

    pip install edge-tts
    python make_voice.py                       # male voice (ar-OM-AbdullahNeural)
    python make_voice.py --voice ar-OM-AyshaNeural
    python make_voice.py --only task_done      # regenerate one event

Existing files are replaced; files for lines removed from lines.json are deleted.
"""
import argparse
import asyncio
import json
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
OUT = HERE.parent.parent / "Content" / "Nuhoud" / "Voice"


async def main() -> int:
    sys.stdout.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser()
    ap.add_argument("--voice", default="ar-OM-AbdullahNeural")
    ap.add_argument("--rate", default="-8%", help="speaking rate, slower is clearer for patients")
    ap.add_argument("--only", help="regenerate only this event")
    args = ap.parse_args()

    try:
        import edge_tts
    except ImportError:
        print("edge-tts is not installed: pip install edge-tts", file=sys.stderr)
        return 1
    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        print("ffmpeg is not on PATH", file=sys.stderr)
        return 1

    lines = {k: v for k, v in json.loads((HERE / "lines.json").read_text(encoding="utf-8")).items() if not k.startswith("_")}
    OUT.mkdir(parents=True, exist_ok=True)
    wanted = set()
    with tempfile.TemporaryDirectory() as tmp:
        for event, texts in lines.items():
            for i, text in enumerate(texts, start=1):
                wav = OUT / f"{event}_{i}.wav"
                wanted.add(wav.name)
                if args.only and event != args.only:
                    continue
                mp3 = Path(tmp) / f"{event}_{i}.mp3"
                await edge_tts.Communicate(text, args.voice, rate=args.rate).save(str(mp3))
                subprocess.run([ffmpeg, "-v", "error", "-y", "-i", str(mp3), "-ar", "24000", "-ac", "1", "-c:a", "pcm_s16le", str(wav)], check=True)
                print(f"{wav.name}  {text}")
    if not args.only:
        for old in OUT.glob("*.wav"):
            if old.name not in wanted:
                old.unlink()
                print(f"removed {old.name}")
    print(f"{len(wanted)} line(s) in {OUT}")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
