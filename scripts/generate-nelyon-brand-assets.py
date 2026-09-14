from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
BRAND = ROOT / "assets" / "branding" / "nelyon" / "v1"
RESAMPLING = Image.Resampling.LANCZOS


def save_png(image: Image.Image, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    image.save(path, format="PNG", optimize=True)


def resize_contain(image: Image.Image, size: tuple[int, int], background=None) -> Image.Image:
    source = image.copy()
    source.thumbnail(size, RESAMPLING)
    mode = "RGBA" if background is None else "RGB"
    canvas = Image.new(mode, size, (0, 0, 0, 0) if background is None else background)
    x = (size[0] - source.width) // 2
    y = (size[1] - source.height) // 2
    if mode == "RGB" and source.mode == "RGBA":
        canvas.paste(source, (x, y), source)
    else:
        canvas.paste(source.convert(mode), (x, y))
    return canvas


def crop_official_variants() -> tuple[Image.Image, Image.Image, Image.Image]:
    horizontal = Image.open(BRAND / "nelyon-logo-horizontal.png").convert("RGBA")
    # Thresholding removes only the nearly transparent export glow. The official
    # logo geometry and pixels remain unchanged inside the padded alpha bounds.
    alpha = horizontal.getchannel("A").point(lambda value: 255 if value >= 8 else 0)
    bounds = alpha.getbbox()
    if bounds is None:
        raise RuntimeError("The official horizontal logo has no visible pixels")
    left, top, right, bottom = bounds
    wordmark = horizontal.crop((max(0, left - 20), max(0, top - 20), min(horizontal.width, right + 20), min(horizontal.height, bottom + 20)))

    # The dark header variant must stay transparent. The previous implementation
    # cropped the RGB presentation board, which baked a navy rectangle into every
    # in-app header. Keep the approved symbol pixels and turn only the wordmark
    # portion white for contrast on Nelyon's dark surfaces.
    wordmark_on_dark = wordmark.copy()
    pixels = wordmark_on_dark.load()
    for y in range(wordmark_on_dark.height):
        for x in range(480, wordmark_on_dark.width):
            red, green, blue, alpha_value = pixels[x, y]
            if alpha_value:
                luminance = max(red, green, blue)
                white = max(238, luminance)
                pixels[x, y] = (white, white, white, alpha_value)

    transparent = Image.open(BRAND / "nelyon-transparent-assets.png").convert("RGBA")
    symbol = transparent.crop((150, 490, 770, 860))
    return wordmark, wordmark_on_dark, symbol


def create_full_bleed_app_icon(symbol: Image.Image) -> Image.Image:
    visible_bounds = symbol.getchannel("A").getbbox()
    if visible_bounds is None:
        raise RuntimeError("The official Nelyon symbol has no visible pixels")
    visible_symbol = symbol.crop(visible_bounds)
    fitted_symbol = resize_contain(visible_symbol, (820, 620))
    icon = Image.new("RGB", (1024, 1024), (12, 31, 79))
    icon.paste(
        fitted_symbol,
        ((icon.width - fitted_symbol.width) // 2, (icon.height - fitted_symbol.height) // 2),
        fitted_symbol,
    )
    return icon


def main() -> None:
    wordmark, wordmark_on_dark, symbol = crop_official_variants()
    save_png(wordmark, BRAND / "nelyon-wordmark.png")
    save_png(wordmark_on_dark, BRAND / "nelyon-wordmark-on-dark.png")

    adaptive = resize_contain(symbol, (720, 720))
    adaptive_canvas = Image.new("RGBA", (1024, 1024), (0, 0, 0, 0))
    adaptive_canvas.paste(adaptive, ((1024 - adaptive.width) // 2, (1024 - adaptive.height) // 2), adaptive)
    save_png(adaptive_canvas, BRAND / "nelyon-adaptive-foreground.png")

    notification_symbol = resize_contain(symbol, (72, 72))
    notification_glyph = Image.new("RGBA", notification_symbol.size, (255, 255, 255, 255))
    notification_glyph.putalpha(notification_symbol.getchannel("A"))
    notification = Image.new("RGBA", (96, 96), (255, 255, 255, 0))
    notification.alpha_composite(notification_glyph, ((96 - notification_glyph.width) // 2, (96 - notification_glyph.height) // 2))
    save_png(notification, BRAND / "nelyon-notification-icon.png")

    app_icon = create_full_bleed_app_icon(symbol)
    save_png(app_icon, BRAND / "nelyon-app-icon.png")
    favicon = app_icon.resize((256, 256), RESAMPLING)
    save_png(favicon, BRAND / "nelyon-favicon.png")

    ios_icon = app_icon.resize((1024, 1024), RESAMPLING)
    save_png(ios_icon, ROOT / "ios" / "onspaceapp" / "Images.xcassets" / "AppIcon.appiconset" / "App-Icon-1024x1024@1x.png")

    ios_splash_sizes = {"image.png": 200, "image@2x.png": 400, "image@3x.png": 600}
    for filename, size in ios_splash_sizes.items():
        save_png(resize_contain(wordmark, (int(size * 0.9), int(size * 0.9))), ROOT / "ios" / "onspaceapp" / "Images.xcassets" / "SplashScreenLogo.imageset" / filename)

    density_scale = {"mdpi": 1.0, "hdpi": 1.5, "xhdpi": 2.0, "xxhdpi": 3.0, "xxxhdpi": 4.0}
    for density, scale in density_scale.items():
        mipmap = ROOT / "android" / "app" / "src" / "main" / "res" / f"mipmap-{density}"
        launcher_size = round(48 * scale)
        foreground_size = round(108 * scale)
        app_icon.resize((launcher_size, launcher_size), RESAMPLING).save(mipmap / "ic_launcher.webp", format="WEBP", lossless=True)
        app_icon.resize((launcher_size, launcher_size), RESAMPLING).save(mipmap / "ic_launcher_round.webp", format="WEBP", lossless=True)
        adaptive_canvas.resize((foreground_size, foreground_size), RESAMPLING).save(mipmap / "ic_launcher_foreground.webp", format="WEBP", lossless=True)

        drawable = ROOT / "android" / "app" / "src" / "main" / "res" / f"drawable-{density}"
        splash_size = round(288 * scale)
        save_png(resize_contain(wordmark, (int(splash_size * 0.9), int(splash_size * 0.9))), drawable / "splashscreen_logo.png")
        notification_size = round(24 * scale)
        save_png(notification.resize((notification_size, notification_size), RESAMPLING), drawable / "notification_icon.png")


if __name__ == "__main__":
    main()
