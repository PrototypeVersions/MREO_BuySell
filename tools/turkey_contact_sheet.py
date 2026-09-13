from pathlib import Path
import json
from PIL import Image, ImageOps, ImageDraw, ImageFont
dest=Path(".media-review/turkey")
data=json.loads((dest/"frames.json").read_text())
sheet=Image.new("RGB",(1440,1584),"#f6f3eb")
draw=ImageDraw.Draw(sheet)
font=ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",18)
for i,frame in enumerate(data["frames"]):
    x,y=(i%4)*360,(i//4)*264
    with Image.open(dest/frame["file"]) as image:
        frame["width"],frame["height"]=image.size
        preview=ImageOps.contain(image.convert("RGB"),(360,240))
        sheet.paste(preview,(x+(360-preview.width)//2,y+(240-preview.height)//2))
    draw.text((x+8,y+242),f'{i+1:02d} | {frame["timestamp"]:.1f}s',font=font,fill="#151515")
sheet.save(dest/"contact-sheet.jpg",quality=90)
(dest/"frames.json").write_text(json.dumps(data,indent=2)+"\n")
