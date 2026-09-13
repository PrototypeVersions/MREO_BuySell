"""Save the highest-resolution public previews available for the supplied video."""
import concurrent.futures
import io
import json
from pathlib import Path
import urllib.error
import urllib.request
from PIL import Image, ImageDraw, ImageFont, ImageOps

DEST=Path(".media-review/turkey")
DEST.mkdir(parents=True,exist_ok=True)
groups={
 "default":["maxresdefault","sddefault","hqdefault"],
 "1":["maxres1","sd1","hq1","1"],
 "2":["maxres2","sd2","hq2","2"],
 "3":["maxres3","sd3","hq3","3"],
}
def fetch_preview(item):
    group,name=item
    url=f"https://i.ytimg.com/vi/MUdBlpLWFEY/{name}.jpg"
    try:
        with urllib.request.urlopen(url,timeout=20) as response:
            content=response.read()
        with Image.open(io.BytesIO(content)) as image:
            width,height=image.size
        if width<120 or height<90:return None
        return {"group":group,"name":name,"url":url,"width":width,"height":height,"content":content}
    except (urllib.error.URLError,OSError):
        return None
items=[(group,name) for group,names in groups.items() for name in names]
with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
    available=[r for r in pool.map(fetch_preview,items) if r]
frames=[]
for index,group in enumerate(groups):
    candidates=[r for r in available if r["group"]==group]
    if not candidates:continue
    best=max(candidates,key=lambda r:r["width"]*r["height"])
    file=f"frame-{index+1:02d}.jpg"
    (DEST/file).write_bytes(best.pop("content"))
    frames.append({**best,"file":file})
if not frames:raise SystemExit("No public video previews were available.")
sheet=Image.new("RGB",(1280,1000),"#f6f3eb")
draw=ImageDraw.Draw(sheet)
font=ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",20)
for i,frame in enumerate(frames):
    x,y=(i%2)*640,(i//2)*500
    with Image.open(DEST/frame["file"]) as image:
        preview=ImageOps.contain(image.convert("RGB"),(640,460))
        sheet.paste(preview,(x+(640-preview.width)//2,y+(460-preview.height)//2))
    draw.text((x+12,y+466),f'{frame["file"]} | {frame["name"]} | {frame["width"]}x{frame["height"]}',font=font,fill="#151515")
sheet.save(DEST/"contact-sheet.jpg",quality=94)
summary={"source":"https://www.youtube.com/watch?v=MUdBlpLWFEY","processing":"Highest-resolution public YouTube video previews. Original downloaded JPEGs, without generative editing.","frames":frames}
(DEST/"frames.json").write_text(json.dumps(summary,indent=2)+"\n")
print(json.dumps(summary,indent=2))
