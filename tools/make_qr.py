# -*- coding: utf-8 -*-
"""生成分享二维码（指向线上链接），给朋友扫码用。

依赖：pip install qrcode[pil]
用法：python tools/make_qr.py
      python tools/make_qr.py "https://example.com/" 输出.png
"""
import os
import sys

import qrcode
from PIL import Image, ImageDraw, ImageFont

DEFAULT_URL = "https://timetable-calendar-40050.app.workbuddy.host/"
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# Windows 中文字体候选；找不到就退回拉丁字体（中文会显示成方块，但不影响扫码）
FONT_CANDIDATES = [
    r"C:\Windows\Fonts\msyh.ttc",
    r"C:\Windows\Fonts\msyhbd.ttc",
    r"C:\Windows\Fonts\simhei.ttf",
    "/System/Library/Fonts/PingFang.ttc",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
]


def load_font(size):
    for p in FONT_CANDIDATES:
        if os.path.exists(p):
            try:
                return ImageFont.truetype(p, size)
            except Exception:
                continue
    return ImageFont.load_default()


def build(url, out_path, title="课表日历", subtitle="扫码打开 · 添加到主屏幕即可当 App 用"):
    qr = qrcode.QRCode(
        version=None,
        error_correction=qrcode.constants.ERROR_CORRECT_M,
        box_size=12,
        border=4,
    )
    qr.add_data(url)
    qr.make(fit=True)
    img = qr.make_image(fill_color="black", back_color="white").convert("RGB")

    pad = 56
    cap_h = 132
    W = img.width + pad * 2
    H = img.height + cap_h + pad

    canvas = Image.new("RGB", (W, H), "white")
    canvas.paste(img, (pad, pad))

    d = ImageDraw.Draw(canvas)
    f_title = load_font(40)
    f_sub = load_font(24)
    f_url = load_font(21)

    y = img.height + pad + 12
    for text, font, fill in (
        (title, f_title, (26, 29, 33)),
        (subtitle, f_sub, (107, 114, 128)),
        (url.replace("https://", ""), f_url, (154, 161, 171)),
    ):
        w = d.textlength(text, font=font)
        d.text(((W - w) / 2, y), text, font=font, fill=fill)
        y += (font.size + 14) if hasattr(font, "size") else 34

    canvas.save(out_path)
    return out_path


if __name__ == "__main__":
    url = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_URL
    out = sys.argv[2] if len(sys.argv) > 2 else os.path.join(ROOT, "分享二维码.png")
    p = build(url, out)
    print("已生成:", p)
    print("指向  :", url)
