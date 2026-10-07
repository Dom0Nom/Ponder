import sys
import numpy as np
from PIL import Image, ImageDraw
mark_path, out = sys.argv[1], sys.argv[2]
S, tile, radius = 1024, 824, 185
mark = Image.open(mark_path).convert("RGBA")
a = np.asarray(mark)[..., 3]
ys, xs = np.nonzero(a > 0)
mark = mark.crop((xs.min(), ys.min(), xs.max() + 1, ys.max() + 1))
h = round(tile * 0.62)
w = round(mark.width * h / mark.height)
mark = mark.resize((w, h), Image.LANCZOS)
canvas = Image.new("RGBA", (S, S), (0, 0, 0, 0))
mask = Image.new("L", (S, S), 0)
off = (S - tile) // 2
ImageDraw.Draw(mask).rounded_rectangle((off, off, off + tile - 1, off + tile - 1), radius, fill=255)
canvas.paste(Image.new("RGBA", (S, S), (255, 255, 255, 255)), (0, 0), mask)
canvas.alpha_composite(mark, ((S - w) // 2, (S - h) // 2))
canvas.save(out)
print(w, h)
