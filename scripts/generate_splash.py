#!/usr/bin/env python3
"""Generate iOS PWA splash screens and maskable app icon.

Usage: python src/generate_splash.py
Output:
  assets/splash/dark-{device}.png   — iOS apple-touch-startup-image (13 devices)
  assets/icons/icon-512-maskable.png — Android maskable icon / iOS Media Session artwork
"""

import io
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
    (1536, 2048, 768, 1024, 2, "ipad-mini"),
    (1668, 2388, 834, 1194, 2, "ipad-pro-11"),
    (2048, 2732, 1024, 1366, 2, "ipad-pro-129"),
]

# ── SVG source ───────────────────────────────────────────────────────────────
SVG_PATH = Path(__file__).parent.parent / "assets" / "icons" / "skh-cross.svg"
SVG_NATURAL_W = 494  # px (from SVG width attribute)
SVG_NATURAL_H = 671  # px (from SVG height attribute)


def make_splash(px_w: int, px_h: int, bg: tuple, cross_hex: str,
                svg_src: str, out_path: Path) -> None:
    # Cross rendered at ~25 % of the shorter screen dimension
    cross_px = int(min(px_w, px_h) * 0.25)
    cross_h  = int(cross_px * SVG_NATURAL_H / SVG_NATURAL_W)

    modified_svg = svg_src.replace('fill="#000000"', f'fill="{cross_hex}"')

    png_data = cairosvg.svg2png(
        bytestring=modified_svg.encode(),
        output_width=cross_px,
        output_height=cross_h,
    )

    bg_img    = Image.new("RGB", (px_w, px_h), bg)
    cross_img = Image.open(io.BytesIO(png_data)).convert("RGBA")

    x = (px_w - cross_px) // 2
    y = (px_h - cross_h)  // 2

    bg_img.paste(cross_img, (x, y), cross_img)
    bg_img.save(out_path, "PNG", optimize=True)


def generate_html_tags() -> str:
    lines = ["  <!-- iOS splash screens (apple-touch-startup-image) -->"]
    for px_w, px_h, css_w, css_h, dpr, label in DEVICES:
        media = (
            f"(device-width: {css_w}px) and (device-height: {css_h}px)"
            f" and (-webkit-device-pixel-ratio: {dpr}) and (orientation: portrait)"
        )
        href = f"/assets/splash/dark-{label}.png"
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

    themes = [
        ("dark", DARK_BG, LIGHT_CROSS_HEX),
    ]

    total = len(DEVICES) * len(themes)
    done  = 0

    for px_w, px_h, _css_w, _css_h, _dpr, label in DEVICES:
        for scheme, bg, cross_hex in themes:
            out_path = out_dir / f"{scheme}-{label}.png"
            make_splash(px_w, px_h, bg, cross_hex, svg_src, out_path)
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
