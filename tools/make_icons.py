"""生成 PWA 图标（纯标准库，不依赖 Pillow）。
画一个圆角蓝色的"日历"图形，带白色网格与一个红色标记点。
"""
import zlib, struct, os

BRAND = (76, 110, 245)
WHITE = (255, 255, 255)
RED   = (224, 49, 49)
LIGHT = (237, 242, 255)


def make_png(path, size):
    # 反走样：4x 超采样后降采样
    SS = 4
    W = size * SS
    H = size * SS

    # 画布：透明
    px = [[(0, 0, 0, 0) for _ in range(W)] for _ in range(H)]

    radius = int(W * 0.22)          # 圆角半径
    pad = int(W * 0.06)
    left, top = pad, pad
    right, bottom = W - pad, H - pad

    def in_round_rect(x, y):
        if x < left or x >= right or y < top or y >= bottom:
            return False
        # 四角圆角判断
        cx = min(max(x, left + radius), right - radius)
        cy = min(max(y, top + radius), bottom - radius)
        dx, dy = x - cx, y - cy
        return dx * dx + dy * dy <= radius * radius

    # 1) 蓝色圆角底
    for y in range(H):
        for x in range(W):
            if in_round_rect(x, y):
                px[y][x] = BRAND + (255,)

    # 2) 顶部白色标题条
    bar_h = int(H * 0.20)
    bar_r = radius
    for y in range(top, top + bar_h):
        for x in range(left, right):
            # 保持圆角
            cx = min(max(x, left + bar_r), right - bar_r)
            cy = min(max(y, top + bar_r), top + bar_h)
            dx, dy = x - cx, y - cy
            inside = (y <= top + bar_h)
            if inside and dx * dx + dy * dy <= bar_r * bar_r:
                px[y][x] = WHITE + (255,)

    # 3) 日历网格：3 行 3 列白色小方块
    gx0 = left + int((right - left) * 0.16)
    gx1 = right - int((right - left) * 0.16)
    gy0 = top + bar_h + int((bottom - top - bar_h) * 0.22)
    gy1 = bottom - int((bottom - top) * 0.16)

    cols, rows = 3, 3
    cw = (gx1 - gx0) / cols
    ch = (gy1 - gy0) / rows
    dot_w = int(cw * 0.52)
    dot_h = int(ch * 0.40)

    for r in range(rows):
        for c in range(cols):
            cx0 = int(gx0 + c * cw + (cw - dot_w) / 2)
            cy0 = int(gy0 + r * ch + (ch - dot_h) / 2)
            color = RED if (r == 0 and c == 1) else WHITE   # 中间那颗标红=考试
            for y in range(cy0, cy0 + dot_h):
                for x in range(cx0, cx0 + dot_w):
                    if 0 <= y < H and 0 <= x < W and px[y][x][3] > 0:
                        px[y][x] = color + (255,)

    # 4) 降采样（盒式滤波）
    out = [[(0, 0, 0, 0) for _ in range(size)] for _ in range(size)]
    n = SS * SS
    for y in range(size):
        for x in range(size):
            rs = gs = bs = as_ = 0
            for dy in range(SS):
                for dx in range(SS):
                    r0, g0, b0, a0 = px[y * SS + dy][x * SS + dx]
                    # 预乘 alpha 再平均，避免边缘发黑
                    rs += r0 * a0; gs += g0 * a0; bs += b0 * a0; as_ += a0
            if as_ == 0:
                out[y][x] = (0, 0, 0, 0)
            else:
                out[y][x] = (rs // as_, gs // as_, bs // as_, as_ // n)

    # 5) 编码 PNG
    raw = bytearray()
    for y in range(size):
        raw.append(0)
        for x in range(size):
            r, g, b, a = out[y][x]
            raw += bytes((r, g, b, a))

    def chunk(tag, data):
        c = struct.pack('>I', len(data)) + tag + data
        return c + struct.pack('>I', zlib.crc32(tag + data) & 0xffffffff)

    png = b'\x89PNG\r\n\x1a\n'
    png += chunk(b'IHDR', struct.pack('>IIBBBBB', size, size, 8, 6, 0, 0, 0))
    png += chunk(b'IDAT', zlib.compress(bytes(raw), 9))
    png += chunk(b'IEND', b'')

    with open(path, 'wb') as f:
        f.write(png)
    return len(png)


if __name__ == '__main__':
    here = os.path.dirname(os.path.abspath(__file__))
    for s in (192, 512):
        p = os.path.join(here, 'icon-%d.png' % s)
        n = make_png(p, s)
        print('wrote %s (%d bytes)' % (p, n))
