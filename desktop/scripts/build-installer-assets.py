"""สร้างภาพและไอคอนสำหรับ NSIS installer จากโลโก้ KY และพื้นหลังแบรนด์"""

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont, ImageOps


ROOT = Path(__file__).resolve().parents[2]
BUILD_DIR = ROOT / "desktop" / "build"
SOURCE_DIR = BUILD_DIR / "source"
APPX_DIR = BUILD_DIR / "appx"
LOGO_PATH = SOURCE_DIR / "ky-logo.jpg"
BACKGROUND_PATH = SOURCE_DIR / "installer-background.png"


def load_font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    candidates = [
        Path(r"C:\Windows\Fonts\leelawui.ttf"),
        Path(r"C:\Windows\Fonts\tahoma.ttf"),
        Path(r"C:\Windows\Fonts\arial.ttf"),
    ]
    if bold:
        candidates = [
            Path(r"C:\Windows\Fonts\leelauib.ttf"),
            Path(r"C:\Windows\Fonts\tahomabd.ttf"),
            *candidates,
        ]
    for candidate in candidates:
        if candidate.exists():
            return ImageFont.truetype(str(candidate), size=size)
    return ImageFont.load_default()


def cover(image: Image.Image, size: tuple[int, int]) -> Image.Image:
    return ImageOps.fit(image.convert("RGB"), size, method=Image.Resampling.LANCZOS)


def logo_tile(logo: Image.Image, size: int) -> Image.Image:
    tile = Image.new("RGBA", (size, size), (255, 255, 255, 255))
    fitted = ImageOps.contain(logo.convert("RGB"), (size - 14, size - 14), Image.Resampling.LANCZOS)
    tile.alpha_composite(fitted.convert("RGBA"), ((size - fitted.width) // 2, (size - fitted.height) // 2))
    return tile


def centered_text(
    draw: ImageDraw.ImageDraw,
    xy: tuple[int, int],
    text: str,
    font: ImageFont.FreeTypeFont | ImageFont.ImageFont,
    fill: tuple[int, int, int],
) -> None:
    box = draw.textbbox((0, 0), text, font=font)
    draw.text((xy[0] - (box[2] - box[0]) / 2, xy[1]), text, font=font, fill=fill)


def build_sidebar(logo: Image.Image, background: Image.Image) -> Image.Image:
    sidebar = cover(background, (164, 314)).convert("RGBA")
    draw = ImageDraw.Draw(sidebar)

    # แผ่นขาวช่วยให้โลโก้ต้นฉบับอ่านง่ายแม้พื้นหลังเข้ม
    draw.rounded_rectangle((14, 25, 150, 161), radius=18, fill=(255, 255, 255, 246), outline=(108, 176, 255, 230), width=2)
    tile = logo_tile(logo, 124)
    sidebar.alpha_composite(tile, (20, 31))

    centered_text(draw, (82, 181), "KY PUMP POS", load_font(17, bold=True), (255, 255, 255))
    centered_text(draw, (82, 207), "ระบบ POS ปั๊มน้ำมัน", load_font(12, bold=True), (225, 239, 255))
    centered_text(draw, (82, 229), "ติดตั้งง่าย  ใช้งานมั่นใจ", load_font(10), (187, 218, 255))

    # เส้น accent ด้านล่างช่วยผูกสีน้ำเงิน/แดงจากโลโก้
    draw.rounded_rectangle((27, 274, 98, 278), radius=2, fill=(56, 151, 255))
    draw.rounded_rectangle((101, 274, 137, 278), radius=2, fill=(230, 35, 45))
    return sidebar.convert("RGB")


def build_header(logo: Image.Image) -> Image.Image:
    header = Image.new("RGB", (150, 57), (255, 255, 255))
    draw = ImageDraw.Draw(header)
    draw.rectangle((0, 0, 5, 56), fill=(18, 74, 170))
    draw.rectangle((5, 0, 8, 56), fill=(222, 31, 45))
    tile = logo_tile(logo, 52).convert("RGB")
    header.paste(tile, (94, 2))
    return header


def build_icon_source(logo: Image.Image) -> Image.Image:
    canvas = Image.new("RGBA", (512, 512), (255, 255, 255, 255))
    fitted = ImageOps.contain(logo.convert("RGB"), (480, 480), Image.Resampling.LANCZOS)
    canvas.alpha_composite(fitted.convert("RGBA"), ((512 - fitted.width) // 2, (512 - fitted.height) // 2))
    return canvas


def build_appx_assets(logo: Image.Image) -> None:
    APPX_DIR.mkdir(parents=True, exist_ok=True)
    square_assets = {
        "StoreLogo.png": 50,
        "Square44x44Logo.png": 44,
        "Square150x150Logo.png": 150,
    }
    for name, size in square_assets.items():
        logo_tile(logo, size).save(APPX_DIR / name, format="PNG")

    wide = Image.new("RGBA", (310, 150), (255, 255, 255, 255))
    fitted = ImageOps.contain(
        logo.convert("RGB"), (136, 136), Image.Resampling.LANCZOS
    )
    wide.alpha_composite(
        fitted.convert("RGBA"),
        ((wide.width - fitted.width) // 2, (wide.height - fitted.height) // 2),
    )
    wide.save(APPX_DIR / "Wide310x150Logo.png", format="PNG")


def main() -> None:
    BUILD_DIR.mkdir(parents=True, exist_ok=True)
    logo = Image.open(LOGO_PATH)
    background = Image.open(BACKGROUND_PATH)

    sidebar = build_sidebar(logo, background)
    header = build_header(logo)
    icon = build_icon_source(logo)

    sidebar.save(BUILD_DIR / "installerSidebar.bmp", format="BMP")
    sidebar.save(BUILD_DIR / "uninstallerSidebar.bmp", format="BMP")
    sidebar.save(BUILD_DIR / "installerSidebar-preview.png", format="PNG")
    header.save(BUILD_DIR / "installerHeader.bmp", format="BMP")
    icon.save(BUILD_DIR / "brand-logo.png", format="PNG")

    icon_sizes = [(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)]
    for name in ("app.ico", "installerIcon.ico", "uninstallerIcon.ico"):
        icon.save(BUILD_DIR / name, format="ICO", sizes=icon_sizes)

    build_appx_assets(logo)

    print(f"สร้าง installer assets ที่ {BUILD_DIR}")


if __name__ == "__main__":
    main()
