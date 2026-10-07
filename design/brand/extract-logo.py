import sys
import numpy as np
from PIL import Image
src, out = sys.argv[1], sys.argv[2]
im = np.asarray(Image.open(src).convert("L")).astype(np.float32)
bg = np.median(np.concatenate([im[:40].ravel(), im[-40:].ravel()]))
alpha = np.clip((bg - im) / bg, 0, 1)
alpha[alpha < 0.035] = 0  # paper texture noise
def save(name, box, ink):
    x0,y0,x1,y1 = box
    a = alpha[y0:y1, x0:x1]
    ys, xs = np.nonzero(a > 0.02)
    a = a[ys.min():ys.max()+1, xs.min():xs.max()+1]
    pad = 8
    a = np.pad(a, pad)
    rgba = np.zeros(a.shape + (4,), np.uint8)
    rgba[..., :3] = ink
    rgba[..., 3] = (a * 255).round().astype(np.uint8)
    Image.fromarray(rgba, "RGBA").save(f"{out}/{name}.png")
    print(name, rgba.shape[1], "x", rgba.shape[0])
print("bg", bg)
boxes = {"mark": (270, 290, 520, 592), "lockup": (190, 290, 590, 705), "wordmark": (900, 400, 1410, 575)}
for k, b in boxes.items():
    save(f"ponder-{k}-light", b, (17, 17, 17))
    save(f"ponder-{k}-dark", b, (245, 245, 245))
