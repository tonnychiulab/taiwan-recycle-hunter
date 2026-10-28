import os
import math
from PIL import Image, ImageDraw

def create_icon(size: int) -> Image.Image:
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    
    pad = int(size * 0.04)
    r_outer = size - pad * 2
    draw.ellipse([pad, pad, pad + r_outer, pad + r_outer], fill=(20, 29, 24, 255), outline=(245, 158, 11, 255), width=max(2, int(size * 0.035)))
    
    in_pad = int(size * 0.12)
    r_inner = size - in_pad * 2
    draw.ellipse([in_pad, in_pad, in_pad + r_inner, in_pad + r_inner], fill=(6, 78, 59, 255))
    
    cx, cy = size / 2, size / 2
    arm_len = size * 0.26
    thick = size * 0.085
    arrow_w = size * 0.15
    arrow_h = size * 0.13
    
    for angle in [0, 90, 180, 270]:
        rad = math.radians(angle)
        cos_a, sin_a = math.cos(rad), math.sin(rad)
        
        def rot(x: float, y: float):
            return (cx + x * cos_a - y * sin_a, cy + x * sin_a + y * cos_a)
        
        pts = [
            rot(size * 0.06, -thick / 2),
            rot(arm_len, -thick / 2),
            rot(arm_len, -arrow_w / 2),
            rot(arm_len + arrow_h, 0),
            rot(arm_len, arrow_w / 2),
            rot(arm_len, thick / 2),
            rot(size * 0.06, thick / 2),
        ]
        draw.polygon(pts, fill=(52, 211, 153, 255))
        
    center_s = int(size * 0.09)
    draw.rectangle([cx - center_s, cy - center_s, cx + center_s, cy + center_s], fill=(254, 240, 138, 255))
    return img

def main():
    out_dir = os.path.join(os.path.dirname(__file__), "..", "public")
    sizes = {
        "favicon-32.png": 32,
        "apple-touch-icon.png": 180,
        "favicon-192.png": 192,
        "favicon-512.png": 512,
    }
    for filename, s in sizes.items():
        icon = create_icon(s)
        icon.save(os.path.join(out_dir, filename), "PNG")
        
    svg_content = """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <circle cx="50" cy="50" r="46" fill="#141D18" stroke="#F59E0B" stroke-width="3"/>
  <circle cx="50" cy="50" r="38" fill="#064E3B"/>
  <g fill="#34D399" transform="translate(50,50)">
    <path d="M 6,-4.25 L 26,-4.25 L 26,-7.5 L 39,0 L 26,7.5 L 26,4.25 L 6,4.25 Z"/>
    <path d="M 6,-4.25 L 26,-4.25 L 26,-7.5 L 39,0 L 26,7.5 L 26,4.25 L 6,4.25 Z" transform="rotate(90)"/>
    <path d="M 6,-4.25 L 26,-4.25 L 26,-7.5 L 39,0 L 26,7.5 L 26,4.25 L 6,4.25 Z" transform="rotate(180)"/>
    <path d="M 6,-4.25 L 26,-4.25 L 26,-7.5 L 39,0 L 26,7.5 L 26,4.25 L 6,4.25 Z" transform="rotate(270)"/>
    <rect x="-9" y="-9" width="18" height="18" fill="#FEF08A"/>
  </g>
</svg>"""
    with open(os.path.join(out_dir, "favicon.svg"), "w", encoding="utf-8") as f:
        f.write(svg_content)
    print("FAVICONS_GENERATED")

if __name__ == "__main__":
    main()
