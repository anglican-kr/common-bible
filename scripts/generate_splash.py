#!/usr/bin/env python3
"""Generate iOS PWA splash screens and maskable app icon.

Usage: python scripts/generate_splash.py
Output:
  assets/splash/dark-{device}.png   — iOS apple-touch-startup-image (16 devices)
  assets/icons/icon-512-maskable.png — Android maskable icon / iOS Media Session artwork

The splash images draw the launch screen's own cross (the inline SVG in index.html's #launch-screen) at the launch
screen's size (css/style.css `#launch-screen svg`: 30vmin wide, aspect-ratio 494 / 671), centered. iOS shows the image
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
# (px_w, px_h, css_w, css_h, dpr, label)
DEVICES = [
    (750,  1334, 375, 667,  2, "iphone-8"),
    (1242, 2208, 414, 736,  3, "iphone-8plus"),
    (1125, 2436, 375, 812,  3, "iphone-x"),
    (828,  1792, 414, 896,  2, "iphone-xr"),
    (1242, 2688, 414, 896,  3, "iphone-xsmax"),
    (1080, 2340, 360, 780,  3, "iphone-12mini"),
    (1170, 2532, 390, 844,  3, "iphone-12"),
    (1284, 2778, 428, 926,  3, "iphone-12promax"),
    (1179, 2556, 393, 852,  3, "iphone-14pro"),
    (1290, 2796, 430, 932,  3, "iphone-14promax"),
    (1206, 2622, 402, 874,  3, "iphone-16pro"),     # 16 Pro, 17, 17 Pro
    (1260, 2736, 420, 912,  3, "iphone-air"),
    (1320, 2868, 440, 956,  3, "iphone-16promax"),  # 16 Pro Max, 17 Pro Max
    (1536, 2048, 768, 1024, 2, "ipad-mini"),
    (1668, 2388, 834, 1194, 2, "ipad-pro-11"),
    (2048, 2732, 1024, 1366, 2, "ipad-pro-129"),
]

# ── SVG source ───────────────────────────────────────────────────────────────
ROOT = Path(__file__).parent.parent
SVG_PATH = ROOT / "assets" / "icons" / "skh-cross.svg"  # the maskable icon's cross
SVG_NATURAL_W = 494  # px (from SVG width attribute)
SVG_NATURAL_H = 671  # px (from SVG height attribute)

# Bumped whenever the images change, so a phone that cached the old image (max-age one day) fetches the new one
SPLASH_VERSION = 2

# The launch screen's cross box: css/style.css `#launch-screen svg { width: 30vmin; aspect-ratio: 494 / 671 }`.
LAUNCH_VMIN = 0.30
LAUNCH_ASPECT = 494 / 671


def launch_svg() -> str:
    """The inline SVG of index.html's #launch-screen."""
    html = (ROOT / "index.html").read_text(encoding="utf-8")
    m = re.search(r'<div id="launch-screen"[^>]*>\s*(<svg\b.*?</svg>)', html, re.S)
    if not m:
        raise SystemExit("index.html: no <svg> in #launch-screen")
    return m.group(1)


def make_splash(px_w: int, px_h: int, css_w: int, css_h: int, bg: tuple,
                svg: str, out_path: Path) -> None:
    # The launch screen's box (30vmin wide, 494:671) in device pixels, centered on the screen. The viewBox is fit
    # inside it and centered (preserveAspectRatio's default, xMidYMid meet). Drawn at the whole box, not the viewBox
    # alone: the cross reaches a little past the viewBox's sides, and the page paints that part inside the box.
    dpr = px_w / css_w
    cross_w = round(LAUNCH_VMIN * min(css_w, css_h) * dpr)
    cross_h = round(cross_w / LAUNCH_ASPECT)

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

    # The inline SVG carries its own fill (the cream of LIGHT_CROSS_HEX)
    themes = [
        ("dark", DARK_BG),
    ]

    total = len(DEVICES) * len(themes)
    done  = 0

    for px_w, px_h, css_w, css_h, _dpr, label in DEVICES:
        for scheme, bg in themes:
            out_path = out_dir / f"{scheme}-{label}.png"
            make_splash(px_w, px_h, css_w, css_h, bg, svg, out_path)
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
