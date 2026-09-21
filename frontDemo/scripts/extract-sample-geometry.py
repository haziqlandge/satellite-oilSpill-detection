"""Trace the dominant oil ribbon from the supplied clean images (Pillow only).

Outputs normalized image coordinates, retaining bends and width changes. The
demo assigns an illustrative scale/location; these images are not georeferenced.
"""
import json
from pathlib import Path
from PIL import Image

root = Path(__file__).resolve().parents[1]
result = {}
for n in range(1, 4):
    im = Image.open(root / f"public/data_sample/clean{n}.jpg").convert("L")
    w, h = im.size
    points = {(x, y) for y in range(4, h - 4) for x in range(w)
              if im.getpixel((x, y)) < 100}
    components = []
    while points:
        todo = [points.pop()]
        component = []
        while todo:
            x, y = todo.pop()
            component.append((x, y))
            for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                q = x + dx, y + dy
                if q in points:
                    points.remove(q)
                    todo.append(q)
        components.append(component)
    oil = max(components, key=len)
    vertical = n == 3
    rows = {}
    for x, y in oil:
        a, b = (y, x) if vertical else (x, y)
        rows.setdefault(a, []).append(b)
    lo, hi, axis = [], [], []
    def point(a, b):
        x, y = (b, a) if vertical else (a, b)
        return [round(x / w, 5), round(y / w, 5)]
    for a in sorted(rows):
        if a % 2 and a not in (min(rows), max(rows)):
            continue
        bs = rows[a]
        lo.append(point(a, min(bs)))
        hi.append(point(a, max(bs) + 1))
        axis.append(point(a, sum(bs) / len(bs)))
    ring = lo + hi[::-1] + [lo[0]]
    result[f"sample{n}"] = {"ring": ring, "axis": axis[::2] + [axis[-1]]}
print(json.dumps(result, separators=(",", ":")))
