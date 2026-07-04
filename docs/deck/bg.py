from PIL import Image, ImageDraw, ImageFilter
import os

W, H = 2000, 1125
BASE = (8, 5, 16)  # #080510

def hex2rgb(h):
    h = h.lstrip('#')
    return tuple(int(h[i:i+2], 16) for i in (0, 2, 4))

def glow(img, cx, cy, radius, color, strength=1.0):
    """Add a soft radial glow centered at (cx,cy)."""
    layer = Image.new('RGB', (W, H), (0, 0, 0))
    mask = Image.new('L', (W, H), 0)
    d = ImageDraw.Draw(mask)
    d.ellipse([cx - radius, cy - radius, cx + radius, cy + radius], fill=int(255 * strength))
    mask = mask.filter(ImageFilter.GaussianBlur(radius * 0.55))
    solid = Image.new('RGB', (W, H), color)
    img = Image.composite(solid, img, mask.point(lambda p: int(p * 0.85)))
    return img

def make(name, glows, vignette=True):
    img = Image.new('RGB', (W, H), BASE)
    for (xr, yr, rr, col, st) in glows:
        img = glow(img, int(W * xr), int(H * yr), int(W * rr), hex2rgb(col), st)
    # subtle vignette to keep edges dark so text pops
    if vignette:
        vmask = Image.new('L', (W, H), 0)
        vd = ImageDraw.Draw(vmask)
        vd.ellipse([-W*0.25, -H*0.25, W*1.25, H*1.25], fill=255)
        vmask = vmask.filter(ImageFilter.GaussianBlur(300))
        dark = Image.new('RGB', (W, H), BASE)
        img = Image.composite(img, dark, vmask)
    img.save(name, 'PNG')
    print('wrote', name)

# Cover / closing — rich neon glow, brand gradient sweep
make('bg_cover.png', [
    (0.18, 0.22, 0.30, '#22D3EE', 0.55),   # cyan top-left
    (0.50, 0.85, 0.34, '#8B5CF6', 0.55),   # violet bottom
    (0.82, 0.30, 0.30, '#EC4899', 0.50),   # magenta top-right
    (0.90, 0.80, 0.24, '#FB7185', 0.40),   # coral bottom-right
])

# Content — calm, dark, faint glow in corners only
make('bg_content.png', [
    (0.06, 0.10, 0.26, '#8B5CF6', 0.26),
    (0.96, 0.92, 0.26, '#22D3EE', 0.22),
])

# Section / transition — deeper, centered glow
make('bg_section.png', [
    (0.30, 0.40, 0.34, '#A855F7', 0.42),
    (0.78, 0.70, 0.30, '#EC4899', 0.38),
])
