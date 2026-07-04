from PIL import Image, ImageDraw, ImageFilter
import math, os
os.chdir(os.path.dirname(os.path.abspath(__file__)))

S = 1024
def hx(h): h=h.lstrip('#'); return tuple(int(h[i:i+2],16) for i in (0,2,4))
CYAN=hx('22D3EE'); VIOLET=hx('8B5CF6'); PURPLE=hx('A855F7'); MAGENTA=hx('EC4899'); CORAL=hx('FB7185')

def grad(size, stops, angle=20):
    """diagonal multi-stop gradient RGBA image"""
    w,h=size
    base=Image.new('RGB',(w,h))
    px=base.load()
    a=math.radians(angle)
    dx,dy=math.cos(a),math.sin(a)
    # projection range
    cs=[(0,0),(w,0),(0,h),(w,h)]
    ps=[x*dx+y*dy for x,y in cs]
    lo,hi=min(ps),max(ps)
    def lerp(c1,c2,t): return tuple(int(c1[i]+(c2[i]-c1[i])*t) for i in range(3))
    def colat(t):
        seg=t*(len(stops)-1); i=min(int(seg),len(stops)-2); f=seg-i
        return lerp(stops[i],stops[i+1],f)
    for y in range(h):
        for x in range(w):
            t=((x*dx+y*dy)-lo)/(hi-lo)
            px[x,y]=colat(t)
    base=base.convert('RGBA')
    return base

def fill_mask(mask, stops, angle=20):
    g=grad(mask.size, stops, angle)
    out=Image.new('RGBA', mask.size, (0,0,0,0))
    out=Image.composite(g, out, mask)
    return out

def star4(d, cx, cy, R, r=None):
    if r is None: r=R*0.34
    pts=[]
    for k in range(8):
        ang=math.radians(90+k*45)
        rad=R if k%2==0 else r
        pts.append((cx+rad*math.cos(ang), cy-rad*math.sin(ang)))
    d.polygon(pts, fill=255)

# ---- build mask (white = filled) ----
mask=Image.new('L',(S,S),0)
d=ImageDraw.Draw(mask)
cx,cy=512,500
outer=360; stroke=118; inner=outer-stroke
# ring (annulus) — leave a small gap at lower-left like a speech bubble opening
d.ellipse([cx-outer,cy-outer,cx+outer,cy+outer], fill=255)
# speech-bubble tail (small rounded triangle bottom-left)
d.polygon([(cx-250,cy+250),(cx-140,cy+250),(cx-205,cy+380)], fill=255)
# punch the hole
d2=Image.new('L',(S,S),0); ImageDraw.Draw(d2).ellipse([cx-inner,cy-inner,cx+inner,cy+inner], fill=255)
mask=Image.composite(Image.new('L',(S,S),0), mask, d2)
# eyes inside hole
d=ImageDraw.Draw(mask)
# left eye: round
le=(cx-92, cy-6); d.ellipse([le[0]-58,le[1]-58,le[0]+58,le[1]+58], fill=255)
# right eye: star
star4(d, cx+96, cy-6, 74, 26)
# external sparkle top-right
star4(d, cx+300, cy-330, 64, 20)

# soften edges a touch
mask=mask.filter(ImageFilter.GaussianBlur(1.2))

logo=fill_mask(mask, [CYAN,VIOLET,MAGENTA,CORAL], angle=18)
logo.save('logo_mark.png')
print('wrote logo_mark.png', logo.size)

# app-icon style: rounded dark square with the mark
ic=Image.new('RGBA',(S,S),(0,0,0,0))
sq=Image.new('L',(S,S),0); ImageDraw.Draw(sq).rounded_rectangle([40,40,S-40,S-40], radius=210, fill=255)
bg=Image.new('RGBA',(S,S),hx('0F0A1C')+(255,))
ic=Image.composite(bg, ic, sq)
m2=logo.resize((int(S*0.72),int(S*0.72)))
ic.alpha_composite(m2, (int(S*0.14), int(S*0.15)))
ic.save('logo_icon.png')
print('wrote logo_icon.png')
