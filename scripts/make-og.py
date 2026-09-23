"""OGP画像（1200x630）をドット絵風に生成する。

小さいサイズで2値描画した文字を1ピクセル=1ドットとして拡大する。
使い方: python scripts/make-og.py
"""
import math
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

W, H = 1200, 630
CELL = 6          # 1ドットの間隔(px)
SS = 3            # 描画時のスーパーサンプリング倍率
COLS, ROWS = W // CELL, H // CELL

BG = (255, 251, 234)
GRID = (243, 232, 190)
INK = (36, 39, 46)
RED = (224, 49, 49)
WHITE = (255, 255, 255)
YELLOW = (250, 204, 21)

FONT = "C:/Windows/Fonts/BIZ-UDGothicB.ttc"
FONT_R = "C:/Windows/Fonts/BIZ-UDGothicR.ttc"
ROOT = Path(__file__).resolve().parent.parent

# cells[(x, y)] = color
cells = {}


def put_text(text, color, x0, y0, size, stroke=0, bold=False, font=FONT):
    """文字列を2値でラスタライズし、ドットとして配置する。返り値は右端x。"""
    font = ImageFont.truetype(font, size)
    l, t, r, b = font.getbbox(text, stroke_width=stroke)
    img = Image.new("1", (r, b), 0)
    d = ImageDraw.Draw(img)
    d.fontmode = "1"
    d.text((0, 0), text, font=font, fill=1, stroke_width=stroke, stroke_fill=1)
    for y in range(b):
        for x in range(r + (1 if bold else 0)):
            on = x < r and img.getpixel((x, y))
            if on or (bold and x > 0 and img.getpixel((x - 1, y))):
                cells[(x0 + x, y0 + y - t)] = color
    return x0 + r + (1 if bold else 0)


def text_size(text, size, stroke=0, font=FONT):
    l, t, r, b = ImageFont.truetype(font, size).getbbox(text, stroke_width=stroke)
    return r, b - t


def put_ball(x0, y0, n=17):
    """ドット絵のモンスターボール。"""
    c = (n - 1) / 2
    for y in range(n):
        for x in range(n):
            dx, dy = x - c, y - c
            d = math.hypot(dx, dy)
            if d > c + 0.45:
                continue
            if d > c - 0.6:
                col = INK
            elif abs(dy) <= 1.1:
                col = INK
            else:
                col = RED if dy < 0 else WHITE
            if d <= 3.4:
                col = INK
            if d <= 2.1:
                col = WHITE
            cells[(x0 + x, y0 + y)] = col
    # ハイライト
    for hx, hy in ((4, 5), (5, 4), (4, 4)):
        cells[(x0 + hx, y0 + hy)] = WHITE


def put_spark(cx, cy, color, arm=3):
    for i in range(-arm, arm + 1):
        cells[(cx + i, cy)] = color
        cells[(cx, cy + i)] = color
    for dx in (-1, 1):
        for dy in (-1, 1):
            cells[(cx + dx, cy + dy)] = color


# --- レイアウト（単位はドット） ---
TITLE_SIZE = 26
BALL = 19
GAP = 4
w1, h1 = text_size("ポケモン", TITLE_SIZE)
w2, _ = text_size("速報", TITLE_SIZE)
total = BALL + GAP + w1 + w2 + 1
x = (COLS - total) // 2
ty = (ROWS - h1) // 2

put_ball(x, ty + (h1 - BALL) // 2, BALL)
x = put_text("ポケモン", INK, x + BALL + GAP, ty, TITLE_SIZE, bold=True) - 1
x_end = put_text("速報", RED, x, ty, TITLE_SIZE, bold=True)

# 右上にきらり
put_spark(x_end - 1, ty - 5, YELLOW, 3)
put_spark(x_end + 4, ty + 1, YELLOW, 2)

# 下部のURL
url = "pokematome.gamelab.website"
uw, uh = text_size(url, 12, font=FONT_R)
put_text(url, (150, 138, 90), (COLS - uw) // 2, ROWS - uh - 8, 12, font=FONT_R)

# --- 描画 ---
img = Image.new("RGB", (W * SS, H * SS), BG)
d = ImageDraw.Draw(img)
off_x = (W - COLS * CELL) / 2
off_y = (H - ROWS * CELL) / 2
for gy in range(ROWS):
    for gx in range(COLS):
        col = cells.get((gx, gy))
        r = CELL * (0.5 if col else 0.2)
        cx = (off_x + gx * CELL + CELL / 2) * SS
        cy = (off_y + gy * CELL + CELL / 2) * SS
        d.ellipse((cx - r * SS, cy - r * SS, cx + r * SS, cy + r * SS), fill=col or GRID)

# 下端の赤ライン
d.rectangle((0, (H - 12) * SS, W * SS, H * SS), fill=RED)

img = img.resize((W, H), Image.LANCZOS)
for p in ("site/assets/og.png", "docs/assets/og.png"):
    img.save(ROOT / p, optimize=True)
print("saved")
