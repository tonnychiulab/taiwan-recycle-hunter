#!/usr/bin/env python3
from __future__ import annotations
import collections
import pathlib
import sys
from PIL import Image

ARTIFACT_DIR = pathlib.Path(
    "/Users/tonny/.gemini/antigravity-cli/brain/55a1a5e1-f68c-468e-b68c-eb2c7ba3cbdf"
)
OUT_DIR = pathlib.Path("/Users/tonny/agy/garbage/public/assets/street")


def find_latest(prefix: str) -> pathlib.Path | None:
    matches = sorted(ARTIFACT_DIR.glob(f"{prefix}_*.jpg"))
    return matches[-1] if matches else None


def remove_white_border_floodfill(img: Image.Image, threshold: int = 238) -> Image.Image:
    rgba = img.convert("RGBA")
    w, h = rgba.size
    px = rgba.load()
    visited = bytearray(w * h)
    q = collections.deque()

    def is_bg(r: int, g: int, b: int) -> bool:
        return r >= threshold and g >= threshold and b >= threshold and max(r, g, b) - min(r, g, b) <= 22

    for x in range(w):
        for y in (0, h - 1):
            idx = y * w + x
            r, g, b, _ = px[x, y]
            if not visited[idx] and is_bg(r, g, b):
                visited[idx] = 1
                q.append((x, y))
    for y in range(h):
        for x in (0, w - 1):
            idx = y * w + x
            r, g, b, _ = px[x, y]
            if not visited[idx] and is_bg(r, g, b):
                visited[idx] = 1
                q.append((x, y))

    while q:
        cx, cy = q.popleft()
        px[cx, cy] = (255, 255, 255, 0)
        for nx, ny in ((cx - 1, cy), (cx + 1, cy), (cx, cy - 1), (cx, cy + 1)):
            if 0 <= nx < w and 0 <= ny < h:
                nidx = ny * w + nx
                if not visited[nidx]:
                    r, g, b, _ = px[nx, ny]
                    if is_bg(r, g, b):
                        visited[nidx] = 1
                        q.append((nx, ny))

    for y in range(1, h - 1):
        for x in range(1, w - 1):
            r, g, b, a = px[x, y]
            if a > 0 and r > 215 and g > 215 and b > 215:
                transparent_neighbors = sum(
                    1
                    for nx, ny in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1))
                    if px[nx, ny][3] == 0
                )
                if transparent_neighbors >= 2:
                    px[x, y] = (r, g, b, 90)

    bbox = rgba.getbbox()
    if bbox:
        pad = 6
        crop_box = (
            max(0, bbox[0] - pad),
            max(0, bbox[1] - pad),
            min(w, bbox[2] + pad),
            min(h, bbox[3] + pad),
        )
        rgba = rgba.crop(crop_box)
    return rgba


def save_resized_sprite(prefix: str, out_name: str, max_dim: int) -> bool:
    src = find_latest(prefix)
    if not src:
        return False
    img = Image.open(src)
    cutout = remove_white_border_floodfill(img)
    cutout.thumbnail((max_dim, max_dim), Image.Resampling.LANCZOS)
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    out_path = OUT_DIR / out_name
    cutout.save(out_path, format="PNG", optimize=True)
    print(f"saved sprite: {out_path.name} ({cutout.size[0]}x{cutout.size[1]})")
    return True


def save_tile_or_banner(prefix: str, out_name: str, size: tuple[int, int], quality: int = 84) -> bool:
    src = find_latest(prefix)
    if not src:
        return False
    img = Image.open(src).convert("RGB")
    img = img.resize(size, Image.Resampling.LANCZOS)
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    out_path = OUT_DIR / out_name
    img.save(out_path, format="JPEG", quality=quality, optimize=True)
    print(f"saved texture: {out_path.name} ({img.size[0]}x{img.size[1]})")
    return True


def main() -> int:
    save_tile_or_banner("hero_taiwan_alley", "hero-taiwan-alley.jpg", (1280, 720), quality=86)
    save_tile_or_banner("tile_asphalt_arcade", "tile-asphalt.jpg", (512, 512), quality=84)
    save_tile_or_banner("tile_terrazzo_arcade", "tile-terrazzo.jpg", (512, 512), quality=84)

    save_resized_sprite("prop_telecom_box", "prop-telecom-box.png", 256)
    save_resized_sprite("prop_fire_hydrant", "prop-fire-hydrant.png", 192)
    save_resized_sprite("sprite_recycler_hero", "sprite-recycler-cart.png", 240)
    save_resized_sprite("sprite_recycler_onfoot", "sprite-recycler-onfoot.png", 200)
    save_resized_sprite("prop_pushcart_parked", "prop-pushcart-parked.png", 210)
    save_resized_sprite("prop_taiwan_scooter", "prop-taiwan-scooter.png", 220)
    return 0


if __name__ == "__main__":
    sys.exit(main())
