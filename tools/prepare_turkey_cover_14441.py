"""Prepare a full-resolution web copy of the newly uploaded property photo."""
import json
from pathlib import Path
from PIL import Image, ImageOps

source=Path("assets/videoframe_14441.png")
output=Path("assets/turkey/photos/videoframe_14441.webp")
review=Path(".media-review/turkey-cover-14441")
review.mkdir(parents=True,exist_ok=True)
output.parent.mkdir(parents=True,exist_ok=True)
with Image.open(source) as original:
    photo=ImageOps.exif_transpose(original).convert("RGB")
    photo.save(output,format="WEBP",quality=95,method=6)
    preview=ImageOps.contain(photo,(1280,720))
    preview.save(review/"preview.jpg",quality=90)
    meta={"original":str(source),"webImage":str(output),"width":photo.width,"height":photo.height,"bytes":output.stat().st_size}
(review/"photo.json").write_text(json.dumps(meta,indent=2)+"\n")
print(json.dumps(meta))
