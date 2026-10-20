# Procedural scene backgrounds (original artwork, no third-party rights): skies plus silhouettes.
# Usage: python3 scripts/make-scenes.py <out_dir> [name ...]   (3840x2160 JPEG, quality 90)
import sys, os, math, numpy as np
from PIL import Image, ImageDraw, ImageEnhance, ImageFilter

W, H = 3840, 2160

def hexc(h): return tuple(int(h[i:i+2], 16) for i in (1, 3, 5))

def noise(seed, octaves, stretch=1.0, w_out=W, h_out=H, blur=30):
    rng = np.random.default_rng(seed)
    acc = np.zeros((h_out, w_out), np.float32); amp = 1.0; tot = 0
    for o in range(octaves):
        w = max(2, int(2 * 2**o)); h = max(2, int(2 * 2**o * stretch))
        n = rng.random((h, w)).astype(np.float32)
        img = Image.fromarray((n * 255).astype(np.uint8)).resize((w_out, h_out), Image.BICUBIC).filter(ImageFilter.GaussianBlur(2 + blur / (o + 1)))
        acc += np.asarray(img, np.float32) / 255 * amp; tot += amp; amp *= 0.6
    acc /= tot
    return (acc - acc.min()) / (acc.max() - acc.min())

def grad(stops, t):
    t = np.clip(t, 0, 1); res = np.zeros(t.shape + (3,), np.float32)
    ps = [p for p, _ in stops]; cs = [np.array(hexc(c), np.float32) for _, c in stops]
    for i in range(3): res[..., i] = np.interp(t, ps, [c[i] for c in cs])
    return res

def sky(stops, seed, cloud, shade, stars=False, strength=0.5):
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
    diag = xx / W * 0.30 + yy / H * 0.70
    base = grad(stops, diag + (noise(seed + 1, 4, 1.5) - 0.5) * 0.14)
    c = noise(seed, 7, 3.0)
    lit = np.clip((c - 0.52) * 2.6, 0, 1)[..., None] ** 1.3
    dark = np.clip((0.42 - c) * 2.5, 0, 1)[..., None]
    img = base * (1 - lit * strength) + np.array(hexc(cloud), np.float32) * lit * strength
    img = img * (1 - dark * 0.3) + np.array(hexc(shade), np.float32) * dark * 0.3
    if stars:
        rng = np.random.default_rng(seed + 99)
        for x, y, b in zip(rng.integers(0, W, 420), rng.integers(0, int(H * 0.55), 420), rng.random(420)):
            if c[y, x] < 0.5:
                img[max(0, y-1):y+2, max(0, x-1):x+2] = img[max(0, y-1):y+2, max(0, x-1):x+2] * 0.4 + 255 * (0.35 + 0.5 * b) * 0.6
    return img

def ridge(seed, base_y, amp, rough=5, sharp=1.0):
    rng = np.random.default_rng(seed)
    x = np.linspace(0, 1, W)
    y = np.zeros(W, np.float32)
    for o in range(rough):
        f = 2 ** o * 1.3
        y += np.sin(x * math.tau * f + rng.random() * 6.28) * (amp / (1.9 ** o))
    y = np.abs(y) * sharp if sharp != 1.0 else y
    return base_y + y

def fill_below(img, profile, color, haze=0.0, haze_color=None):
    yy = np.arange(H, dtype=np.float32)[:, None]
    mask = (yy >= profile[None, :]).astype(np.float32)
    mask = np.asarray(Image.fromarray((mask * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(1.6)), np.float32)[..., None] / 255
    col = np.array(hexc(color), np.float32)
    if haze and haze_color:
        t = np.clip((yy - profile.min()) / max(1, (H - profile.min())), 0, 1)
        col = col * (1 - haze * (1 - t))[..., None] + np.array(hexc(haze_color), np.float32) * (haze * (1 - t))[..., None]
    return img * (1 - mask) + col * mask

def finish(img, color=1.25, contrast=1.06, blur=1.6):
    im = Image.fromarray(np.clip(img, 0, 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(blur))
    return ImageEnhance.Contrast(ImageEnhance.Color(im).enhance(color)).enhance(contrast)

# ---------- scenes ----------

def coral():
    return finish(sky([(0, '#5b4a9c'), (0.35, '#e8708a'), (0.65, '#ff9a6a'), (1, '#ffd9a0')], 5, '#ffe6d6', '#6a3a7a', strength=0.6))

def mountains():
    img = sky([(0, '#2b2a6e'), (0.35, '#b24a7a'), (0.65, '#ff8a52'), (1, '#ffd27a')], 11, '#ffd9c0', '#4a2a6a')
    for i, (c, ba, am, hz) in enumerate([('#8a5a86', 0.62, 70, 0.55), ('#5e3a6c', 0.70, 110, 0.35), ('#3a2354', 0.80, 150, 0.2), ('#1c1030', 0.92, 120, 0.0)]):
        img = fill_below(img, ridge(100 + i, H * ba, am, 6), c, hz, '#ffb48a')
    return finish(img)

def city():
    img = sky([(0, '#14194f'), (0.4, '#5a3f9a'), (0.72, '#e2607a'), (1, '#ffb070')], 21, '#f5c0d6', '#1d2050', stars=True)
    rng = np.random.default_rng(31)
    pil = Image.fromarray(np.clip(img, 0, 255).astype(np.uint8))
    d = ImageDraw.Draw(pil)
    for layer, (col, base, hmin, hmax, windows) in enumerate([((70, 50, 100), 0.80, 120, 520, False), ((38, 28, 66), 0.86, 160, 760, False), ((16, 12, 30), 1.0, 220, 980, True)]):
        x = -40
        while x < W:
            bw = int(rng.integers(90, 260)); bh = int(rng.integers(hmin, hmax))
            top = int(H * base) - bh if base < 1 else H - bh
            d.rectangle([x, top, x + bw, H], fill=col)
            if windows:
                for wy in range(top + 24, H - 40, 36):
                    for wx in range(x + 14, x + bw - 24, 30):
                        if rng.random() < 0.28:
                            lit = (255, int(190 + rng.random() * 50), int(110 + rng.random() * 60))
                            d.rectangle([wx, wy, wx + 12, wy + 18], fill=lit)
            x += bw + int(rng.integers(0, 24))
    return finish(np.asarray(pil, np.float32), blur=1.2)

def ocean():
    horizon = int(H * 0.60)
    img = sky([(0, '#3a2a7a'), (0.4, '#d25a6a'), (0.75, '#ff9a4a'), (1, '#ffe49a')], 41, '#ffe6c8', '#6a3070')
    top = img[:horizon].copy()
    yy = np.arange(H - horizon, dtype=np.float32)[:, None]
    sea = np.zeros((H - horizon, W, 3), np.float32)
    t = (yy / (H - horizon))
    sea = (grad([(0, '#f2a060'), (0.25, '#a8505a'), (1, '#2a1a4a')], t[:, 0]))[:, None, :].repeat(W, axis=1)
    streak = noise(43, 6, 0.08, W, H - horizon, 8)[..., None]
    sea = sea * (0.82 + streak * 0.36)
    # glittering sun path
    rng = np.random.default_rng(47)
    sx = int(W * 0.30)
    pil = Image.fromarray(np.clip(sea, 0, 255).astype(np.uint8)); d = ImageDraw.Draw(pil)
    for k in range(900):
        yv = int((rng.random() ** 1.7) * (H - horizon - 10)); spread = 40 + yv * 0.9
        xv = int(sx + rng.normal(0, spread)); ln = int(20 + rng.random() * (30 + yv * 0.25))
        a = int(120 + rng.random() * 135)
        d.line([xv - ln, yv, xv + ln, yv], fill=(255, min(255, 200 + a // 5), 150), width=int(2 + yv / 260))
    sea = np.asarray(pil.filter(ImageFilter.GaussianBlur(1.4)), np.float32)
    img = np.concatenate([top, sea], axis=0)
    yy2, xx2 = np.mgrid[0:H, 0:W].astype(np.float32)
    glow = np.exp(-(((xx2 - sx) / 520) ** 2 + ((yy2 - horizon) / 300) ** 2))[..., None]
    img = img + glow * np.array([255, 210, 130], np.float32) * 0.75
    return finish(img)

def palms():
    img = sky([(0, '#3b2c7e'), (0.35, '#e2487a'), (0.65, '#ff8f4a'), (1, '#ffe08a')], 51, '#ffd6c8', '#52286a')
    pil = Image.fromarray(np.clip(img, 0, 255).astype(np.uint8)); S = 2
    mask = Image.new('L', (W * S, H * S), 0); d = ImageDraw.Draw(mask)
    rng = np.random.default_rng(53)
    def palm(x0, y0, lean, height, size):
        pts = []
        for i in range(31):
            t = i / 30
            pts.append(((x0 + lean * t * t + math.sin(t * 2) * 12) * S, (y0 - height * t) * S))
        for i in range(30):
            wdt = (1 - i / 30) * size * 0.075 + size * 0.02
            d.line([pts[i], pts[i + 1]], fill=255, width=int(wdt * S))
        tx, ty = pts[-1]
        for k in range(12):
            ang = -math.pi * (0.02 + k * 0.083) + rng.normal(0, 0.05)
            length = size * (0.7 + rng.random() * 0.4) * S
            droop = 0.55 + rng.random() * 0.5
            prev = (tx, ty)
            for j in range(1, 17):
                t = j / 16
                px = tx + math.cos(ang) * length * t
                py = ty + math.sin(ang) * length * t + droop * length * t * t * (1 if math.cos(ang) > -2 else 1)
                d.line([prev, (px, py)], fill=255, width=int((1 - t) * size * 0.04 * S + 3))
                nx, ny = -math.sin(ang), math.cos(ang)
                for side in (-1, 1):
                    ln = (1 - t * 0.5) * size * 0.2 * S
                    d.line([(px, py), (px + side * nx * ln + math.cos(ang) * ln * 0.5, py + side * ny * ln * 0.8 + ln * 0.5)], fill=255, width=int(max(3, size * 0.011 * S)))
                prev = (px, py)
    palm(W * 0.78, H * 1.02, -160, H * 0.62, 520)
    palm(W * 0.90, H * 1.02, -60, H * 0.50, 420)
    palm(W * 0.12, H * 1.02, 140, H * 0.56, 470)
    ground = ridge(57, H * 0.94, 26, 4)
    gy = np.arange(H)[:, None]; gmask = (gy >= ground[None, :]).astype(np.uint8) * 255
    mask = mask.resize((W, H), Image.LANCZOS)
    m = np.maximum(np.asarray(mask, np.float32), gmask.astype(np.float32))[..., None] / 255
    out = np.asarray(pil, np.float32) * (1 - m) + np.array([22, 12, 30], np.float32) * m
    return finish(out, blur=1.0)

def neon():
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
    base = grad([(0, '#0a0520'), (0.5, '#1d0f4a'), (1, '#3a0f5a')], yy / H * 0.8 + xx / W * 0.2)
    rng = np.random.default_rng(61); img = base.copy()
    pil = Image.new('RGB', (W, H), (0, 0, 0)); d = ImageDraw.Draw(pil)
    cols = [(255, 60, 170), (60, 200, 255), (150, 90, 255), (255, 150, 60), (40, 255, 200)]
    for k in range(70):
        r = int(rng.integers(40, 260)); x = int(rng.integers(0, W)); y = int(rng.integers(int(H * 0.15), H))
        c = cols[int(rng.integers(0, len(cols)))]; a = 0.25 + rng.random() * 0.5
        d.ellipse([x - r, y - r, x + r, y + r], fill=tuple(int(v * a) for v in c))
    glow = np.asarray(pil.filter(ImageFilter.GaussianBlur(70)), np.float32)
    bokeh = np.asarray(pil.filter(ImageFilter.GaussianBlur(10)), np.float32)
    img = img + glow * 0.9 + bokeh * 0.25
    return finish(img, color=1.15)

def aurora():
    img = sky([(0, '#02060f'), (0.6, '#071a36'), (1, '#10305a')], 71, '#2a4a8a', '#02060f', stars=True, strength=0.25)
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
    rng = np.random.default_rng(73)
    for k, (col, base, width) in enumerate([((60, 255, 160), 0.30, 150), ((90, 200, 255), 0.36, 130), ((190, 90, 255), 0.24, 110)]):
        centre = H * base + np.sin(np.linspace(0, math.tau * (1.2 + k * 0.4), W) + rng.random() * 6) * 160 + np.sin(np.linspace(0, math.tau * 3.1, W) + k) * 40
        streak = noise(80 + k, 5, 0.04, W, 1, 3)[0] * 0.8 + 0.4
        streak2 = np.asarray(Image.fromarray((noise(90 + k, 3, 1, W, 8, 40)[0:8] * 255).astype(np.uint8)).resize((W, 1)), np.float32)[0] / 255 * 0.6 + 0.6
        rays = noise(110 + k, 6, 0.01, W, 1, 1.5)[0]
        inten = np.exp(-(((yy - centre[None, :]) / width) ** 2)) * (streak * streak2 * (0.25 + 1.1 * rays))[None, :]
        inten = np.where(yy < centre[None, :], inten, inten * np.exp(-(yy - centre[None, :]) / 220))
        img = img + inten[..., None] * np.array(col, np.float32) * 0.9
    for i, (c, ba, am) in enumerate([('#0b1830', 0.84, 90), ('#050a14', 0.93, 70)]):
        img = fill_below(img, ridge(120 + i, H * ba, am, 6), c)
    return finish(img, color=1.1)

def desert():
    img = sky([(0, '#4a2a70'), (0.3, '#c8506a'), (0.6, '#ff8f55'), (1, '#ffd49a')], 81, '#ffe2c8', '#5a2a64')
    for i, (c, ba, am, hz) in enumerate([('#d8805a', 0.64, 40, 0.5), ('#a84e52', 0.74, 55, 0.3), ('#6a2f4a', 0.84, 70, 0.15), ('#2c1530', 0.94, 60, 0.0)]):
        x = np.linspace(0, 1, W)
        prof = H * ba + np.sin(x * math.tau * (1.1 + i * 0.5) + i) * am + np.sin(x * math.tau * (2.7 + i) + i * 2) * am * 0.4
        img = fill_below(img, prof.astype(np.float32), c, hz, '#ffb078')
    return finish(img)

SCENES = dict(coral=coral, mountains=mountains, city=city, ocean=ocean, palms=palms, neon=neon, aurora=aurora, desert=desert)

if __name__ == '__main__':
    out = sys.argv[1]; names = sys.argv[2:] or list(SCENES)
    os.makedirs(out, exist_ok=True)
    for n in names:
        SCENES[n]().save(os.path.join(out, f'{n}.jpg'), quality=90)
        print('made', n, flush=True)
