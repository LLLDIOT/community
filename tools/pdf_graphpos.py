"""检查 PDF 内容流中的绘图操作符坐标，判断表格边框等图形是否超出右边距。"""
import re
import sys
import zlib

path = sys.argv[1] if len(sys.argv) > 1 else "tools/check.pdf"
data = open(path, "rb").read()

streams = []
for m in re.finditer(rb"stream\r?\n", data):
    start = m.end()
    end = data.find(b"endstream", start)
    if end == -1:
        continue
    try:
        streams.append(zlib.decompress(data[start:end]))
    except Exception:
        continue

xs = []
rects = 0
lines = 0
for s in streams:
    try:
        txt = s.decode("latin-1")
    except Exception:
        continue
    # 矩形： x y w h re
    for m in re.finditer(r"([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+re\b", txt):
        x, w = float(m.group(1)), float(m.group(3))
        xs.append(x)
        xs.append(x + w)
        rects += 1
    # 线段： x y m / x y l
    for m in re.finditer(r"([-\d.]+)\s+([-\d.]+)\s+[ml]\b", txt):
        xs.append(float(m.group(1)))
        lines += 1

LEFT = 65.2
RIGHT = 530.2
print("矩形数:", rects, " 线段点:", lines)
if xs:
    lo, hi = min(xs), max(xs)
    print("图形 x 范围: %.2f .. %.2f pt" % (lo, hi))
    print()
    print("期望区间: %.1f .. %.1f pt" % (LEFT, RIGHT))
    print("左边界偏差: %+.2f pt" % (lo - LEFT))
    print("右边界偏差: %+.2f pt" % (hi - RIGHT))
    if hi > RIGHT + 1:
        print("结论: 有图形超出右边距 %.2f pt" % (hi - RIGHT))
    else:
        print("结论: 全部图形位于正文区宽度内")
