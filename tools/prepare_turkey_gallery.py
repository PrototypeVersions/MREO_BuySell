"""Extract source-resolution stills from the user-supplied public property tour."""
import json
import math
import subprocess
import sys
import tempfile
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont, ImageOps

SOURCE = "https://www.youtube.com/watch?v=MUdBlpLWFEY"
DEST = Path(".media-review/turkey")
DEST.mkdir(parents=True, exist_ok=True)

def run(args):
    return subprocess.run(args, check=True, text=True, capture_output=True)

with tempfile.TemporaryDirectory(prefix="mreo-property-") as tmp:
    temp = Path(tmp)
    command = [
        sys.executable, "-m", "yt_dlp", "--ignore-config", "--no-playlist",
        "--js-runtimes", "node", "--no-progress", "--socket-timeout", "30",
        "--retries", "1", "--fragment-retries", "1",
        "--format", "bestvideo[height<=2160]/best[height<=2160]",
        "--write-info-json", "--output", str(temp / "property.%(ext)s"), SOURCE,
    ]
    result = subprocess.run(command, text=True, capture_output=True, timeout=360)
    print(result.stdout[-6000:])
    if result.returncode:
        print(result.stderr[-6000:], file=sys.stderr)
        raise SystemExit("The public video could not be retrieved; no gallery images were published.")
    metadata = json.loads((temp / "property.info.json").read_text())
    video = next(p for p in temp.glob("property.*") if p.suffix not in {".json", ".part", ".ytdl"})
    info = json.loads(run(["ffprobe", "-v", "error", "-show_format", "-show_streams", "-of", "json", str(video)]).stdout)
    stream = next(s for s in info["streams"] if s["codec_type"] == "video")
    duration = float(info["format"].get("duration") or metadata["duration"])
    print(json.dumps({"title": metadata.get("title"), "duration": duration, "width": stream["width"], "height": stream["height"]}))
    frames = []
    # Review the whole tour, excluding the first/last title and transition seconds.
    for i in range(24):
        timestamp = duration * (0.035 + i * 0.925 / 23)
        name = f"frame-{i + 1:02d}.jpg"
        output = DEST / name
        run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-ss", f"{timestamp:.3f}",
             "-i", str(video), "-frames:v", "1", "-q:v", "2", str(output)])
        with Image.open(output) as im:
            frames.append({"file": name, "timestamp": round(timestamp, 3), "width": im.width, "height": im.height})
    # A review contact sheet only; the extracted originals remain untouched.
    cell_w, cell_h, label_h = 360, 240, 24
    sheet = Image.new("RGB", (cell_w * 4, (cell_h + label_h) * 6), "#f6f3eb")
    draw = ImageDraw.Draw(sheet)
    font_path = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
    font = ImageFont.truetype(font_path, 18) if Path(font_path).exists() else ImageFont.load_default()
    for i, frame in enumerate(frames):
        x, y = (i % 4) * cell_w, (i // 4) * (cell_h + label_h)
        with Image.open(DEST / frame["file"]) as im:
            preview = ImageOps.contain(im.convert("RGB"), (cell_w, cell_h))
            sheet.paste(preview, (x + (cell_w - preview.width) // 2, y + (cell_h - preview.height) // 2))
        draw.text((x + 8, y + cell_h + 2), f'{i + 1:02d} | {frame["timestamp"]:.1f}s', fill="#151515", font=font)
    sheet.save(DEST / "contact-sheet.jpg", quality=90)
    summary = {"source": SOURCE, "title": metadata.get("title"), "duration": duration,
               "source_width": stream["width"], "source_height": stream["height"],
               "processing": "Original-resolution video frame extraction, high-quality JPEG encoding. No generative changes.",
               "frames": frames}
    (DEST / "frames.json").write_text(json.dumps(summary, indent=2) + "\n")
    print("Prepared 24 original-resolution stills and a contact sheet for selection.")
