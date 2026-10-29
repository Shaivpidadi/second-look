#!/usr/bin/env python3
"""Render synthetic logistics paperwork as handheld POV video clips.

Reads a JSON job list on stdin: [{"out": "x.mp4", "type": "bol", "fields": {...},
"degrade": "normal"|"heavy", "framing": "normal"|"tight", "seed": 1, "seconds": 3, "fps": 10}].
Each clip is a printed page on a desk, seen through a head-mounted camera
(720x1280 portrait): perspective tilt, slow handheld drift, partial framing,
lens blur, a glare spot, sensor noise, then H.264. All data is synthetic.
"""
import json
import math
import os
import random
import subprocess
import sys
import tempfile

from PIL import Image, ImageDraw, ImageFilter, ImageFont

FONT_DIR = "/System/Library/Fonts/Supplemental"
FFMPEG = os.environ.get("FFMPEG_BIN", "/opt/homebrew/bin/ffmpeg")
FRAME_W, FRAME_H = 720, 1280
PAGE_W, PAGE_H = 1275, 1650  # letter at 150 dpi


def font(name, size):
    for candidate in (os.path.join(FONT_DIR, name), os.path.join("/System/Library/Fonts", name)):
        if os.path.exists(candidate):
            return ImageFont.truetype(candidate, size)
    return ImageFont.load_default()


SANS = lambda s: font("Arial.ttf", s)
BOLD = lambda s: font("Arial Bold.ttf", s)
MONO = lambda s: font("Courier New Bold.ttf", s)
HAND = lambda s: font("Bradley Hand Bold.ttf", s)


class Page:
    def __init__(self):
        self.img = Image.new("RGB", (PAGE_W, PAGE_H), (250, 249, 244))
        self.d = ImageDraw.Draw(self.img)
        self.y = 60

    def title(self, text, sub=""):
        self.d.rectangle([50, 40, PAGE_W - 50, 150], outline=(20, 20, 20), width=4)
        self.d.text((75, 58), text, font=BOLD(54), fill=(15, 15, 15))
        if sub:
            self.d.text((78, 118), sub, font=SANS(22), fill=(70, 70, 70))
        self.y = 180

    def box(self, label, value, x, w, h=100, mono=True, size=40):
        y = self.y
        self.d.rectangle([x, y, x + w, y + h], outline=(30, 30, 30), width=2)
        self.d.text((x + 12, y + 8), label.upper(), font=SANS(19), fill=(80, 80, 80))
        self.d.text((x + 14, y + 40), value, font=MONO(size) if mono else BOLD(size - 6), fill=(10, 10, 10))

    def row(self, cells, h=100):
        x = 50
        total = PAGE_W - 100
        for label, value, frac, *rest in cells:
            w = int(total * frac)
            mono = rest[0] if rest else True
            self.box(label, value, x, w, h, mono=mono)
            x += w
        self.y += h

    def block(self, label, lines, h=150):
        y = self.y
        self.d.rectangle([50, y, PAGE_W - 50, y + h], outline=(30, 30, 30), width=2)
        self.d.text((62, y + 8), label.upper(), font=SANS(19), fill=(80, 80, 80))
        for i, line in enumerate(lines):
            self.d.text((64, y + 38 + i * 32), line, font=SANS(27), fill=(20, 20, 20))
        self.y += h

    def table(self, headers, rows, widths, total_row=None):
        y = self.y + 20
        x0 = 50
        xs = [x0]
        for w in widths:
            xs.append(xs[-1] + int((PAGE_W - 100) * w))
        self.d.rectangle([x0, y, PAGE_W - 50, y + 46], fill=(225, 225, 220), outline=(30, 30, 30), width=2)
        for i, hd in enumerate(headers):
            self.d.text((xs[i] + 10, y + 12), hd, font=BOLD(22), fill=(20, 20, 20))
        y += 46
        for r in rows + ([total_row] if total_row else []):
            self.d.rectangle([x0, y, PAGE_W - 50, y + 48], outline=(60, 60, 60), width=1)
            bold = r is total_row
            for i, cell in enumerate(r):
                self.d.text((xs[i] + 10, y + 10), str(cell), font=BOLD(26) if bold else SANS(26), fill=(15, 15, 15))
            y += 48
        self.y = y + 10

    def signature(self, label, name, signed=True):
        y = self.y + 30
        self.d.line([70, y + 90, 600, y + 90], fill=(30, 30, 30), width=2)
        self.d.text((70, y + 98), label, font=SANS(20), fill=(80, 80, 80))
        if signed and name:
            self.d.text((90, y + 20), name, font=HAND(58), fill=(20, 30, 110))
        self.y = y + 140

    def handwritten(self, text, color=(25, 35, 120)):
        if not text:
            return
        y = self.y + 10
        self.d.text((80, y), text, font=HAND(52), fill=color)
        self.y = y + 80


def fmt_awb(n):
    n = "".join(ch for ch in n if ch.isdigit())
    return f"{n[:3]}-{n[3:7]} {n[7:]}" if len(n) == 11 else n


def render_bol(f):
    p = Page()
    p.title("STRAIGHT BILL OF LADING", "Short form - original - not negotiable")
    p.row([("B/L number", f["bolNumber"], 0.5), ("Date", f.get("date", "2026-10-26"), 0.5)])
    p.row([("Carrier", f["carrier"], 0.6, False), ("SCAC", f.get("scac", "HLGD"), 0.4)])
    p.block("Shipper", [f.get("shipper", "NORTHWIND COMPONENTS LTD"), f.get("shipperAddr", "14 Quay Road, Felixstowe IP11 3QX, UK")], 120)
    p.block("Consignee", [f.get("consignee", "BLUE RIVER DISTRIBUTION"), f.get("consigneeAddr", "2200 Dock Street, Newark NJ 07105")], 120)
    p.row([("Container no.", f["containerNumber"], 0.5), ("Seal", f.get("seal", "SL-448210"), 0.5)])
    p.table(["Pkgs", "Description", "Weight (kg)"],
            [[f"{f['cartons']} CTNS", f.get("description", "Brake assemblies, boxed"), f"{f['weightKg']}"]],
            [0.2, 0.55, 0.25],
            total_row=[f"TOTAL {f['cartons']} CTNS", "", f"{f['weightKg']} KG"])
    p.signature("Shipper signature", f.get("shipperSign", "R. Hale"), f.get("signed", True))
    return p.img


def render_awb(f):
    p = Page()
    p.title("AIR WAYBILL", "Not negotiable - issued by Lufthansa Cargo (synthetic)")
    p.row([("AWB number", fmt_awb(f["awbNumber"]), 0.6), ("Origin / Dest", f.get("route", "FRA / EWR"), 0.4)])
    p.block("Shipper", [f.get("shipper", "NORTHWIND COMPONENTS LTD"), "Felixstowe, UK"], 110)
    p.block("Consignee", [f.get("consignee", "BLUE RIVER DISTRIBUTION"), "Newark NJ, USA"], 110)
    p.row([("No. of pieces", f["pieces"], 0.33), ("Gross weight kg", f["weightKg"], 0.33), ("Chargeable kg", f.get("chargeable", f["weightKg"]), 0.34)])
    p.block("Nature and quantity of goods", [f.get("description", "BRAKE ASSEMBLIES - CONSOLIDATED")], 100)
    p.signature("Signature of issuing carrier", f.get("sign", "K. Brandt"), True)
    return p.img


def render_invoice(f):
    p = Page()
    p.title("COMMERCIAL INVOICE", f.get("seller", "Northwind Components Ltd") + " - synthetic")
    p.row([("Invoice no.", f.get("invoiceNumber", "INV-55120"), 0.5), ("Date", "2026-10-24", 0.5)])
    p.block("Bill to", [f.get("consignee", "BLUE RIVER DISTRIBUTION"), "2200 Dock Street, Newark NJ 07105"], 110)
    lines = f.get("lines", [["BRK-200", "Front brake assembly", 120, "38.00"], ["BRK-210", "Rear brake assembly", 120, "34.50"], ["PAD-090", "Pad set", 120, "9.75"]])
    total = f.get("totalQty", str(sum(int(l[2]) for l in lines)))
    p.table(["SKU", "Description", "Qty", "Unit USD"], lines, [0.18, 0.5, 0.14, 0.18], total_row=["", "TOTAL QTY", total, ""])
    return p.img


def render_packing(f):
    p = Page()
    p.title("PACKING LIST", "Ref " + f.get("invoiceNumber", "INV-55120") + " - synthetic")
    p.row([("Cartons", f.get("cartons", "120"), 0.5), ("Gross weight kg", f.get("weightKg", "2064"), 0.5)])
    lines = f.get("lines", [["BRK-200", "40 CTNS", 120], ["BRK-210", "40 CTNS", 120], ["PAD-090", "40 CTNS", 120]])
    total = f.get("totalQty", str(sum(int(l[2]) for l in lines)))
    p.table(["SKU", "Cartons", "Units"], lines, [0.35, 0.35, 0.3], total_row=["TOTAL UNITS", "", total])
    return p.img


def render_pod(f):
    p = Page()
    p.title("DELIVERY RECEIPT / PROOF OF DELIVERY", "Blue River Distribution - receiving dock 4")
    p.row([("B/L number", f.get("bolNumber", "BOL-00421307"), 0.5), ("Delivered", "2026-10-28 09:40", 0.5)])
    p.row([("Shipped cartons", f.get("shipped", "120"), 0.5), ("Received cartons", f["receivedCartons"], 0.5)])
    y = p.y + 10
    p.d.text((62, y), "EXCEPTIONS / REMARKS", font=SANS(19), fill=(80, 80, 80))
    p.y = y + 30
    p.handwritten(f.get("exceptionNote", ""))
    p.y = max(p.y, y + 120)
    sig_top = p.y
    p.signature("Received by (signature)", f.get("receiver", "J. Ortiz"), f.get("signed", True))
    if f.get("signatureCover"):
        # A sticky note slapped over the signature line: signed or not is unknowable.
        p.d.rectangle([40, sig_top + 5, 660, sig_top + 124], fill=(250, 226, 92), outline=(205, 180, 60), width=3)
        p.d.text((70, sig_top + 40), "see driver", font=HAND(52), fill=(40, 40, 40))
    return p.img


def render_label(f):
    p = Page()
    p.title("PALLET LABEL", "GS1-128 logistics label - synthetic")
    p.row([("Ship from", "NORTHWIND COMPONENTS", 0.5, False), ("Ship to", "BLUE RIVER DIST.", 0.5, False)])
    p.row([("Cartons on pallet", f.get("cartons", "40"), 0.5), ("Pallet", f.get("pallet", "1 of 3"), 0.5)])
    sscc = f["sscc"]
    y = p.y + 40
    p.d.text((60, y), "SSCC", font=SANS(22), fill=(80, 80, 80))
    p.d.text((60, y + 34), f"(00) {sscc}", font=MONO(56), fill=(10, 10, 10))
    rnd = random.Random(sscc)
    x = 60
    while x < PAGE_W - 80:
        w = rnd.choice([3, 3, 5, 7, 9])
        p.d.rectangle([x, y + 120, x + w, y + 330], fill=(0, 0, 0))
        x += w + rnd.choice([3, 5, 7])
    p.d.text((60, y + 345), f"(00){sscc}", font=MONO(30), fill=(10, 10, 10))
    return p.img


def render_screen(f):
    """The receiving form on a monitor (glasses glance at the screen)."""
    img = Image.new("RGB", (1600, 1000), (246, 247, 249))
    d = ImageDraw.Draw(img)
    d.rectangle([0, 0, 1600, 70], fill=(17, 24, 39))
    d.text((30, 18), "Second Look  |  Receiving form", font=BOLD(30), fill=(255, 255, 255))
    labels = [("AWB number", "awb.awbNumber"), ("BOL number", "bol.bolNumber"), ("Carrier", "bol.carrier"), ("Consignee", "bol.consignee"),
              ("Container number", "bol.containerNumber"), ("SSCC (pallet label)", "label.sscc"),
              ("Shipped cartons", "bol.cartons"), ("Received cartons", "pod.receivedCartons")]
    for i, (label, key) in enumerate(labels):
        x = 60 + (i % 2) * 770
        y = 110 + (i // 2) * 200
        d.text((x, y), label, font=SANS(26), fill=(60, 60, 70))
        d.rounded_rectangle([x, y + 40, x + 700, y + 110], radius=10, fill=(255, 255, 255), outline=(200, 200, 210), width=2)
        d.text((x + 20, y + 55), f.get(key, ""), font=MONO(36), fill=(20, 20, 30))
    d.rounded_rectangle([1300, 900, 1560, 970], radius=10, fill=(37, 99, 235))
    d.text((1370, 915), "Submit", font=BOLD(32), fill=(255, 255, 255))
    return img


RENDERERS = {"bol": render_bol, "awb": render_awb, "invoice": render_invoice, "packing": render_packing,
             "pod": render_pod, "label": render_label, "screen": render_screen}


def perspective_coeffs(src, dst):
    """Solve the 8 PIL perspective coefficients mapping dst -> src."""
    import itertools  # noqa: F401
    a = []
    b = []
    for (x, y), (u, v) in zip(dst, src):
        a.append([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.append(u)
        a.append([0, 0, 0, x, y, 1, -v * x, -v * y]); b.append(v)
    n = 8
    m = [row[:] + [b[i]] for i, row in enumerate(a)]
    for col in range(n):
        piv = max(range(col, n), key=lambda r: abs(m[r][col]))
        m[col], m[piv] = m[piv], m[col]
        for r in range(n):
            if r != col:
                factor = m[r][col] / m[col][col]
                for c in range(col, n + 1):
                    m[r][c] -= factor * m[col][c]
    return [m[i][n] / m[i][i] for i in range(n)]


def desk(rnd):
    base = (rnd.randint(95, 120), rnd.randint(80, 95), rnd.randint(60, 75))
    img = Image.new("RGB", (FRAME_W, FRAME_H), base)
    d = ImageDraw.Draw(img)
    for _ in range(140):
        y = rnd.randint(0, FRAME_H)
        shade = rnd.randint(-12, 12)
        d.line([0, y, FRAME_W, y + rnd.randint(-20, 20)], fill=tuple(max(0, min(255, c + shade)) for c in base), width=rnd.randint(1, 4))
    return img.filter(ImageFilter.GaussianBlur(2))


def glare(frame, cx, cy, radius, strength):
    mask = Image.new("L", frame.size, 0)
    md = ImageDraw.Draw(mask)
    for r in range(radius, 0, -6):
        level = int(strength * (1 - r / radius) ** 1.6)
        md.ellipse([cx - r, cy - r * 0.7, cx + r, cy + r * 0.7], fill=level)
    white = Image.new("RGB", frame.size, (255, 255, 250))
    return Image.composite(white, frame, mask)


def noise(frame, rnd, amount):
    if amount <= 0:
        return frame
    n = Image.effect_noise(frame.size, amount).convert("RGB")
    return Image.blend(frame, n, 0.06)


def camera_frames(page, rnd, count, degrade, fps, framing="normal"):
    if page.width > page.height:  # screen: landscape monitor
        page_scale = FRAME_W * 1.05 / page.width
    elif framing == "tight":
        page_scale = FRAME_W * rnd.uniform(1.13, 1.17) / page.width  # leans in: field values clipped
    else:
        page_scale = FRAME_W * rnd.uniform(0.98, 1.04) / page.width  # page margins touch the frame edge
    pw, ph = page.width * page_scale, page.height * page_scale
    tilt = rnd.uniform(-0.09, 0.09)
    keystone = rnd.uniform(0.06, 0.11)
    base_dx = -45 if framing == "tight" else rnd.uniform(-12, 12)
    base_dy = rnd.uniform(60, 160)  # page sits low: worker looks down
    bg = desk(rnd)
    blur = 0.6 if degrade == "normal" else 2.2
    glare_strength = 150 if degrade == "normal" else 235
    gx, gy = rnd.randint(150, FRAME_W - 150), rnd.randint(250, FRAME_H - 250)
    phase = rnd.uniform(0, 6.28)
    frames = []
    for i in range(count):
        t = i / fps
        dx = base_dx + 5 * math.sin(0.9 * t + phase)
        dy = base_dy + 4 * math.cos(0.7 * t + phase)
        ang = tilt + 0.006 * math.sin(1.3 * t)
        cx, cy = FRAME_W / 2 + dx, FRAME_H / 2 + dy
        corners = []
        for sx, sy in [(-1, -1), (1, -1), (1, 1), (-1, 1)]:
            x = sx * pw / 2 * (1 - keystone if sy < 0 else 1)
            y = sy * ph / 2
            corners.append((cx + x * math.cos(ang) - y * math.sin(ang), cy + x * math.sin(ang) + y * math.cos(ang)))
        src = [(0, 0), (page.width, 0), (page.width, page.height), (0, page.height)]
        coeffs = perspective_coeffs(src, corners)
        warped = page.transform((FRAME_W, FRAME_H), Image.PERSPECTIVE, coeffs, Image.BICUBIC, fillcolor=None)
        mask = Image.new("L", page.size, 255).transform((FRAME_W, FRAME_H), Image.PERSPECTIVE, coeffs, Image.BILINEAR)
        frame = Image.composite(warped, bg, mask)
        shade = Image.new("RGB", frame.size, (0, 0, 0))
        vign = Image.radial_gradient("L").resize(frame.size).point(lambda v: int(v * 0.35))
        frame = Image.composite(shade, frame, vign)
        frame = glare(frame, gx + int(3 * math.sin(t)), gy, 260 if degrade == "normal" else 380, glare_strength)
        frame = Image.blend(frame, Image.new("RGB", frame.size, (255, 236, 200)), 0.07)  # warm indoor cast
        frame = frame.filter(ImageFilter.GaussianBlur(blur + 0.3 * abs(math.sin(2.1 * t))))
        frame = noise(frame, rnd, 40 if degrade == "normal" else 90)
        frames.append(frame)
    return frames


def render_clip(job):
    rnd = random.Random(job.get("seed", 1))
    page = RENDERERS[job["type"]](job.get("fields", {}))
    fps = job.get("fps", 10)
    count = int(job.get("seconds", 3) * fps)
    frames = camera_frames(page, rnd, count, job.get("degrade", "normal"), fps, job.get("framing", "normal"))
    os.makedirs(os.path.dirname(os.path.abspath(job["out"])), exist_ok=True)
    with tempfile.TemporaryDirectory() as tmp:
        for i, frame in enumerate(frames):
            frame.save(os.path.join(tmp, f"f{i:04d}.png"))
        subprocess.run([FFMPEG, "-y", "-loglevel", "error", "-framerate", str(fps), "-i", os.path.join(tmp, "f%04d.png"),
                        "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "20", job["out"]], check=True)
    if job.get("still"):
        page.save(job["still"])


def main():
    jobs = json.load(sys.stdin)
    for job in jobs:
        render_clip(job)
        print(job["out"], flush=True)


if __name__ == "__main__":
    main()
