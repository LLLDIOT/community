"""从 PDF 内容流中提取文字定位操作符的 x 坐标，用于确认真实版面位置。"""
import re
import sys
import zlib

path = sys.argv[1] if len(sys.argv) > 1 else "tools/check.pdf"
data = open(path, "rb").read()

print("PDF 大小:", len(data), "字节")

# 找所有 stream ... endstream 并尝试解压
streams = []
for m in re.finditer(rb"stream\r?\n", data):
    start = m.end()
    end = data.find(b"endstream", start)
    if end == -1:
        continue
    raw = data[start:end]
    try:
        streams.append(zlib.decompress(raw))
    except Exception:
        continue

print("可解压内容流:", len(streams))

xs = []
ys = []
text_ops = 0
for s in streams:
    try:
        txt = s.decode("latin-1")
    except Exception:
        continue
    # 定位操作符：  x y Td   /  a b c d e f Tm
    for m in re.finditer(r"([-\d.]+)\s+([-\d.]+)\s+Td\b", txt):
        xs.append(float(m.group(1)))
        ys.append(float(m.group(2)))
        text_ops += 1
    for m in re.finditer(r"([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+Tm\b", txt):
        xs.append(float(m.group(5)))
        ys.append(float(m.group(6)))
        text_ops += 1

print("定位操作符数量:", text_ops)
if xs:
    print("x 范围: %.2f .. %.2f pt" % (min(xs), max(xs)))
    print("y 范围: %.2f .. %.2f pt" % (min(ys), max(ys)))
    print()
    print("期望（A4，左边距 2.3cm = 65.2pt，正文宽 16.4cm = 465pt）:")
    print("  文字起点应约为 65.2pt，右边界不应超过 65.2+465 = 530.2pt")
    near = sorted({round(v, 1) for v in xs})[:12]
    print("  出现最多的 x 值（前 12 个不同值）:", near)
