"""Prepare optimized web copies and a review sheet of the user's uploaded photos."""
import json
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont, ImageOps

sources=["assets/videoframe_117052.png","assets/videoframe_18959.png","assets/videoframe_25702.png","assets/videoframe_31960.png","assets/videoframe_53771.png","assets/videoframe_69284.png"]
dest=Path("assets/turkey/photos")
review=Path(".media-review/turkey-uploads")
dest.mkdir(parents=True,exist_ok=True)
review.mkdir(parents=True,exist_ok=True)
photos=[]
for source in sorted(sources,key=lambda p:int(Path(p).stem.split("_")[1])):
    original=Path(source)
    with Image.open(original) as opened:
        image=ImageOps.exif_transpose(opened).convert("RGB")
        width,height=image.size
        output=dest/(original.stem+".webp")
        image.save(output,format="WEBP",quality=95,method=6)
        photos.append({"source":source,"path":str(output),"width":width,"height":height,"bytes":output.stat().st_size})
sheet=Image.new("RGB",(1280,1170),"#f6f3eb")
draw=ImageDraw.Draw(sheet)
font=ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",20)
for i,photo in enumerate(photos):
    x,y=(i%2)*640,(i//2)*390
    with Image.open(photo["path"]) as image:
        preview=ImageOps.contain(image,(640,360))
        sheet.paste(preview,(x+(640-preview.width)//2,y+(360-preview.height)//2))
    draw.text((x+12,y+365),f'{Path(photo["source"]).name} | {photo["width"]}x{photo["height"]}',fill="#151515",font=font)
sheet.save(review/"contact-sheet.jpg",quality=92)
(review/"photos.json").write_text(json.dumps(photos,indent=2)+"\n")
print(json.dumps(photos,indent=2))
