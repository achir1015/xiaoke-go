# 產生程式圖示：立體圍棋棋盤（黑白棋子）＋小柯機器人
import os
from PIL import Image, ImageDraw, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
S = 1024


def layer():
    return Image.new('RGBA', (S, S), (0, 0, 0, 0))


def stone(d, cx, cy, r, black):
    # 有立體感的棋子：底色＋左上高光
    if black:
        d.ellipse((cx - r, cy - r, cx + r, cy + r), fill=(22, 22, 26, 255))
        d.ellipse((cx - r * 0.62, cy - r * 0.72, cx - r * 0.05, cy - r * 0.22), fill=(90, 92, 100, 255))
        d.ellipse((cx - r * 0.5, cy - r * 0.62, cx - r * 0.2, cy - r * 0.38), fill=(150, 152, 160, 255))
    else:
        d.ellipse((cx - r, cy - r, cx + r, cy + r), fill=(205, 205, 200, 255))
        d.ellipse((cx - r * 0.94, cy - r * 0.96, cx + r * 0.9, cy + r * 0.86), fill=(250, 250, 246, 255))
        d.ellipse((cx - r * 0.55, cy - r * 0.66, cx - r * 0.1, cy - r * 0.3), fill=(255, 255, 255, 255))


img = layer()
# 陰影
sh = layer()
ImageDraw.Draw(sh).rounded_rectangle((110, 150, 760, 900), 60, fill=(0, 0, 0, 150))
img = Image.alpha_composite(img, sh.filter(ImageFilter.GaussianBlur(30)))

# 棋盤（榧木色、帶厚度），略為傾斜
bd = layer()
d = ImageDraw.Draw(bd)
x0, y0, x1, y1 = 96, 96, 716, 716
d.rounded_rectangle((x0, y0 + 40, x1, y1 + 70), 44, fill=(150, 98, 44, 255))     # 側面
d.rounded_rectangle((x0, y0, x1, y1), 44, fill=(232, 184, 112, 255))            # 盤面
for i in range(18):                                                                # 木紋
    yy = y0 + 20 + i * 34
    d.line((x0 + 20, yy, x1 - 20, yy + 6), fill=(214, 160, 92, 90), width=3)
n, pad = 9, 66
step = (x1 - x0 - 2 * pad) / (n - 1)
for i in range(n):
    p = x0 + pad + i * step
    d.line((p, y0 + pad, p, y1 - pad), fill=(60, 36, 16, 255), width=7)
    d.line((x0 + pad, p, x1 - pad, p), fill=(60, 36, 16, 255), width=7)
for (a, b) in ((2, 2), (2, 6), (6, 2), (6, 6), (4, 4)):
    cx, cy = x0 + pad + a * step, y0 + pad + b * step
    d.ellipse((cx - 13, cy - 13, cx + 13, cy + 13), fill=(60, 36, 16, 255))
P = lambda a, b: (x0 + pad + a * step, y0 + pad + b * step)
for (a, b, black) in ((2, 2, True), (6, 2, False), (2, 6, False), (3, 3, False), (4, 4, True), (5, 3, True), (3, 5, True), (6, 6, False)):
    cx, cy = P(a, b)
    sd = ImageDraw.Draw(bd)
    sd.ellipse((cx - 30, cy - 22, cx + 38, cy + 40), fill=(60, 30, 10, 110))
    stone(sd, cx, cy, 33, black)
bd = bd.rotate(-6, resample=Image.BICUBIC, center=(406, 420))
img = Image.alpha_composite(img, bd)

# 小柯機器人（頭盔造型，與其他小柯系列一致）
rb = layer()
r = ImageDraw.Draw(rb)
cx, cy = 720, 650
r.line((cx, cy - 250, cx, cy - 190), fill=(90, 100, 120, 255), width=18)
r.ellipse((cx - 34, cy - 290, cx + 34, cy - 222), fill=(255, 196, 40, 255))
r.rounded_rectangle((cx - 262, cy - 70, cx - 210, cy + 80), 22, fill=(40, 120, 220, 255))
r.rounded_rectangle((cx + 210, cy - 70, cx + 262, cy + 80), 22, fill=(40, 120, 220, 255))
r.ellipse((cx - 230, cy - 210, cx + 230, cy + 220), fill=(70, 150, 240, 255))
r.ellipse((cx - 214, cy - 196, cx + 214, cy + 200), fill=(240, 246, 255, 255))
r.rounded_rectangle((cx - 170, cy - 110, cx + 170, cy + 90), 90, fill=(24, 36, 64, 255))
for ex in (cx - 72, cx + 72):
    r.arc((ex - 46, cy - 50, ex + 46, cy + 30), 200, 340, fill=(90, 230, 255, 255), width=22)
r.arc((cx - 50, cy + 10, cx + 50, cy + 70), 20, 160, fill=(90, 230, 255, 255), width=14)
r.ellipse((cx - 160, cy + 40, cx - 110, cy + 80), fill=(255, 140, 160, 200))
r.ellipse((cx + 110, cy + 40, cx + 160, cy + 80), fill=(255, 140, 160, 200))
# 手上拿著一顆白子、一顆黑子
r.ellipse((cx + 130, cy + 180, cx + 230, cy + 275), fill=(0, 0, 0, 90))
stone(r, cx + 175, cy + 215, 48, False)
stone(r, cx + 240, cy + 140, 42, True)
sh2 = layer()
ImageDraw.Draw(sh2).ellipse((cx - 230, cy - 180, cx + 250, cy + 260), fill=(0, 0, 0, 120))
img = Image.alpha_composite(img, sh2.filter(ImageFilter.GaussianBlur(24)))
img = Image.alpha_composite(img, rb)

os.makedirs(os.path.join(ROOT, 'build'), exist_ok=True)
img.save(os.path.join(ROOT, 'build', 'icon.png'))
img.save(os.path.join(ROOT, 'build', 'icon.ico'), sizes=[(256, 256), (128, 128), (64, 64), (48, 48), (32, 32), (16, 16)])
print('ok')
