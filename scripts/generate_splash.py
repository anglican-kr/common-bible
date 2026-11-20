#!/usr/bin/env python3
"""Generate iOS PWA splash screens and maskable app icon.

Usage: python scripts/generate_splash.py
Output:
  assets/splash/dark-{device}.png   — iOS apple-touch-startup-image (22 screen sizes)
  assets/icons/icon-512-maskable.png — Android maskable icon / iOS Media Session artwork

The splash images draw the launch screen's own cross (the inline SVG in index.html's #launch-screen) at the launch
screen's size (the width in vmin and the aspect-ratio of css/style.css `#launch-screen svg`), centered. iOS shows the image
until the page paints #launch-screen over it, so any difference shows as the cross jumping at the handoff (ADR-007).
"""

import io
import re
from pathlib import Path

import cairosvg
from PIL import Image

# ── Colors ──────────────────────────────────────────────────────────────────
# Background matches icon-512.png; cross is the light cream color from the icon.
DARK_BG        = (26, 26, 46)    # #1a1a2e
LIGHT_CROSS_HEX = "#faf8f5"      # cross color on dark splash

# ── Device targets ──────────────────────────────────────────────────────────
# (px_w, px_h, css_w, css_h, dpr, label). Sizes in points from Apple's Human Interface Guidelines, Layout,
# "iOS, iPadOS device screen dimensions" (the table was dropped on 2026-09-09; read from the 2026-06 copy).
DEVICES = [
    (750,  1334, 375, 667,  2, "iphone-8"),
    (1242, 2208, 414, 736,  3, "iphone-8plus"),
    (1125, 2436, 375, 812,  3, "iphone-x"),
    (828,  1792, 414, 896,  2, "iphone-xr"),
    (1242, 2688, 414, 896,  3, "iphone-xsmax"),
    (1080, 2340, 360, 780,  3, "iphone-12mini"),    # 12 mini, 13 mini (HIG). If one reports 375×812, iphone-x
    (1170, 2532, 390, 844,  3, "iphone-12"),
    (1284, 2778, 428, 926,  3, "iphone-12promax"),
    (1179, 2556, 393, 852,  3, "iphone-14pro"),
    (1290, 2796, 430, 932,  3, "iphone-14promax"),
    (1206, 2622, 402, 874,  3, "iphone-16pro"),     # 16 Pro, 17, 17 Pro
    (1260, 2736, 420, 912,  3, "iphone-air"),
    (1320, 2868, 440, 956,  3, "iphone-16promax"),  # 16 Pro Max, 17 Pro Max
    (1536, 2048, 768, 1024, 2, "ipad-mini"),         # mini 7.9", 9.7"
    (1488, 2266, 744, 1133, 2, "ipad-mini-83"),      # mini 8.3"
    (1620, 2160, 810, 1080, 2, "ipad-102"),          # iPad 10.2"
    (1640, 2360, 820, 1180, 2, "ipad-air-11"),       # Air 10.9", Air 11", iPad 11"
    (1668, 2224, 834, 1112, 2, "ipad-pro-105"),      # Pro 10.5", Air 10.5"
    (1668, 2388, 834, 1194, 2, "ipad-pro-11"),       # Pro 11" 1st-4th generation
    (1668, 2420, 834, 1210, 2, "ipad-pro-11-m4"),    # Pro 11" 5th, 6th generation
    (2048, 2732, 1024, 1366, 2, "ipad-pro-129"),     # Pro 12.9", Air 13"
    (2064, 2752, 1032, 1376, 2, "ipad-pro-13"),      # Pro 13"
]

# ── SVG source ───────────────────────────────────────────────────────────────
ROOT = Path(__file__).parent.parent
SVG_PATH = ROOT / "assets" / "icons" / "skh-cross.svg"  # the maskable icon's cross
SVG_NATURAL_W = 494  # px (from SVG width attribute)
SVG_NATURAL_H = 671  # px (from SVG height attribute)

# Bumped whenever the images change, so a phone that cached the old image (max-age one day) fetches the new one
SPLASH_VERSION = 2


def launch_box() -> tuple[float, float]:
    """The launch screen's cross box, read from css/style.css `#launch-screen svg`: (width as a fraction of the
    screen's short side, width / height). Read rather than copied, so the images follow the page's size."""
    css = (ROOT / "css" / "style.css").read_text(encoding="utf-8")
    rule = re.search(r"#launch-screen svg\s*\{([^}]*)\}", css)
    width = rule and re.search(r"\bwidth:\s*([\d.]+)vmin", rule.group(1))
    aspect = rule and re.search(r"aspect-ratio:\s*([\d.]+)\s*/\s*([\d.]+)", rule.group(1))
    if not (width and aspect):
        raise SystemExit("css/style.css: #launch-screen svg needs width in vmin and aspect-ratio")
    return float(width.group(1)) / 100, float(aspect.group(1)) / float(aspect.group(2))


def launch_svg() -> str:
    """The inline SVG of index.html's #launch-screen."""
    html = (ROOT / "index.html").read_text(encoding="utf-8")
    m = re.search(r'<div id="launch-screen"[^>]*>\s*(<svg\b.*?</svg>)', html, re.S)
    if not m:
        raise SystemExit("index.html: no <svg> in #launch-screen")
    return m.group(1)


def make_splash(px_w: int, px_h: int, css_w: int, css_h: int, dpr: int, bg: tuple,
                svg: str, box: tuple[float, float], out_path: Path) -> None:
    # The launch screen's box (launch_box) in device pixels, centered on the screen. The viewBox is fit
    # inside it and centered (preserveAspectRatio's default, xMidYMid meet). Drawn at the whole box, not the viewBox
    # alone: the cross reaches a little past the viewBox's sides, and the page paints that part inside the box.
    vmin, aspect = box
    cross_w = round(vmin * min(css_w, css_h) * dpr)
    cross_h = round(cross_w / aspect)

    png_data = cairosvg.svg2png(
        bytestring=svg.encode(),
        output_width=cross_w,
        output_height=cross_h,
    )

    bg_img    = Image.new("RGB", (px_w, px_h), bg)
    cross_img = Image.open(io.BytesIO(png_data)).convert("RGBA")

    x = (px_w - cross_w) // 2
    y = (px_h - cross_h) // 2

    bg_img.paste(cross_img, (x, y), cross_img)
    bg_img.save(out_path, "PNG", optimize=True)


def generate_html_tags() -> str:
    lines = ["  <!-- iOS splash screens (apple-touch-startup-image) -->"]
    for px_w, px_h, css_w, css_h, dpr, label in DEVICES:
        media = (
            f"(device-width: {css_w}px) and (device-height: {css_h}px)"
            f" and (-webkit-device-pixel-ratio: {dpr}) and (orientation: portrait)"
        )
        href = f"/assets/splash/dark-{label}.png?v={SPLASH_VERSION}"
        lines.append(f'  <link rel="apple-touch-startup-image" media="{media}" href="{href}">')
    return "\n".join(lines)


def make_maskable_icon(svg_src: str, out_path: Path, size: int = 512) -> None:
    """Square icon with no rounded corners for Android maskable / iOS Media Session.

    Cross is centered within the safe zone (center 80 % of image) at 65 % of
    safe zone height, matching the visual weight of the existing icon-512.png.
    """
    safe_zone = int(size * 0.8)           # 410 px for 512
    cross_h   = int(safe_zone * 0.65)     # 266 px
    cross_w   = int(cross_h * SVG_NATURAL_W / SVG_NATURAL_H)  # ≈ 196 px

    modified_svg = svg_src.replace('fill="#000000"', f'fill="{LIGHT_CROSS_HEX}"')
    png_data = cairosvg.svg2png(
        bytestring=modified_svg.encode(),
        output_width=cross_w,
        output_height=cross_h,
    )

    bg    = Image.new("RGB", (size, size), DARK_BG)
    cross = Image.open(io.BytesIO(png_data)).convert("RGBA")
    x = (size - cross_w) // 2
    y = (size - cross_h) // 2
    bg.paste(cross, (x, y), cross)
    bg.save(out_path, "PNG", optimize=True)


def main():
    out_dir = Path(__file__).parent.parent / "assets" / "splash"
    out_dir.mkdir(parents=True, exist_ok=True)

    svg_src = SVG_PATH.read_text(encoding="utf-8")
    svg = launch_svg()
    box = launch_box()

    # The inline SVG carries its own fill (the cream of LIGHT_CROSS_HEX)
    themes = [
        ("dark", DARK_BG),
    ]

    total = len(DEVICES) * len(themes)
    done  = 0

    for px_w, px_h, css_w, css_h, dpr, label in DEVICES:
        for scheme, bg in themes:
            out_path = out_dir / f"{scheme}-{label}.png"
            make_splash(px_w, px_h, css_w, css_h, dpr, bg, svg, box, out_path)
            done += 1
            print(f"[{done:>2}/{total}] {out_path.name}  ({px_w}×{px_h})")

    maskable_path = Path(__file__).parent.parent / "assets" / "icons" / "icon-512-maskable.png"
    make_maskable_icon(svg_src, maskable_path)
    print(f"\n[  ] {maskable_path.name}  (512×512, maskable)")

    print("\n── HTML tags to add to <head> ──────────────────────────────────")
    print(generate_html_tags())
    print("────────────────────────────────────────────────────────────────")


if __name__ == "__main__":
    main()
