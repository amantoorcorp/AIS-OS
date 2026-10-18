# Procedural sky backgrounds (original artwork, no third-party rights).
import sys, numpy as np
from PIL import Image, ImageEnhance, ImageFilter
W, H = 2560, 1440
out = sys.argv[1]

def noise(seed, octaves, stretch, tilt=-9):
    # Long horizontal streaks: many rows, few columns, then a slight diagonal tilt.
    rng = np.random.default_rng(seed)
    BW, BH = int(W * 1.35), int(H * 1.35)
    acc = np.zeros((BH, BW), np.float32); amp = 1.0; tot = 0
    for o in range(octaves):
        w = max(2, int(2 * 2**o)); h = max(2, int(2 * 2**o * stretch))
        n = rng.random((h, w)).astype(np.float32)
        img = Image.fromarray((n * 255).astype(np.uint8)).resize((BW, BH), Image.BICUBIC).filter(ImageFilter.GaussianBlur(2 + 30 / (o + 1)))
        acc += np.asarray(img, np.float32) / 255 * amp; tot += amp; amp *= 0.6
    acc /= tot
    big = Image.fromarray(((acc - acc.min()) / (acc.max() - acc.min()) * 255).astype(np.uint8)).rotate(tilt, resample=Image.BICUBIC)
    l, t = (BW - W) // 2, (BH - H) // 2
    a = np.asarray(big.crop((l, t, l + W, t + H)), np.float32) / 255
    return (a - a.min()) / (a.max() - a.min())

def grad(stops, t):
    t = np.clip(t, 0, 1); res = np.zeros(t.shape + (3,), np.float32)
    ps = [p for p, _ in stops]; cs = [np.array(c, np.float32) for _, c in stops]
    for i in range(3): res[..., i] = np.interp(t, ps, [c[i] for c in cs])
    return res

def hexc(h): return tuple(int(h[i:i+2], 16) for i in (1, 3, 5))

PRESETS = {
  'sunset':  dict(seed=7,  stops=[(0,'#1d2c7a'),(0.30,'#5a3a9a'),(0.52,'#e2435c'),(0.72,'#ff7a45'),(0.9,'#ffc062'),(1,'#ffe08a')], cloud='#ffd6c2', shade='#3a1f5c', stars=True),
  'dusk':    dict(seed=21, stops=[(0,'#0f1d4a'),(0.4,'#3b4f9c'),(0.7,'#c06c9a'),(1,'#f7b4a8')], cloud='#f3d1e6', shade='#1d2552', stars=True),
  'golden':  dict(seed=33, stops=[(0,'#6b3f7a'),(0.35,'#d9654b'),(0.65,'#f6a548'),(1,'#ffe3a0')], cloud='#fff1cf', shade='#7a3b3b', stars=False),
  'night':   dict(seed=48, stops=[(0,'#050a1f'),(0.5,'#12215a'),(0.85,'#3e2a6e'),(1,'#7a3d7c')], cloud='#8a7fc2', shade='#05081a', stars=True),
}
name = sys.argv[2]; p = PRESETS[name]
yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
diag = (xx / W * 0.55 + yy / H * 0.45)
n_warp = noise(p['seed'] + 1, 4, 1.5)
base = grad([(a, hexc(c)) for a, c in p['stops']], diag + (n_warp - 0.5) * 0.18)
clouds = noise(p['seed'], 7, 3.0)  # horizontally stretched streaks
lit = np.clip((clouds - 0.52) * 2.6, 0, 1)[..., None] ** 1.3
dark = np.clip((0.42 - clouds) * 2.5, 0, 1)[..., None]
img = base * (1 - lit * 0.55) + np.array(hexc(p['cloud']), np.float32) * lit * 0.55
img = img * (1 - dark * 0.35) + np.array(hexc(p['shade']), np.float32) * dark * 0.35
if p['stars']:
    rng = np.random.default_rng(p['seed'] + 99)
    k = 260
    sx = rng.integers(0, W, k); sy = rng.integers(0, H, k)
    mask = (diag[sy, sx] < 0.35) & (clouds[sy, sx] < 0.5)
    for x, y, b in zip(sx[mask], sy[mask], rng.random(k)[mask]):
        img[max(0,y-1):y+2, max(0,x-1):x+2] = img[max(0,y-1):y+2, max(0,x-1):x+2] * 0.4 + 255 * (0.35 + 0.5*b) * 0.6
im = Image.fromarray(np.clip(img, 0, 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(2.2))
im = ImageEnhance.Contrast(ImageEnhance.Color(im).enhance(1.3)).enhance(1.08)
im.save(out, quality=88)
