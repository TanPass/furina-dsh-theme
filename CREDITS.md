# Credits / 来源与致谢

This file records where every borrowed asset and every referenced plugin comes from,
who made it, and under which licence it is used. Code written for this theme is MIT
(see `LICENSE`); the fan-art wallpapers are **not** MIT (see `NOTICE.md`).

## Wallpapers / 壁纸

The three wallpapers shipped in `client/assets/wallpapers/` are fan-made *Genshin
Impact* illustrations of **Furina**. The repository ships 2560×1440 sRGB JPEG
re-encodes (quality 92) of the originals below; the source pages serve the full
3840×2160 files.

| File in this repo | Scene | Creator / credit | Source | Notes |
| --- | --- | --- | --- | --- |
| `furina-03-salon-solitude.jpg` | 沙龙独处 — Furina resting her cheek on her hand | original artist not named on the wallpaper page | [Wallpaper Abyss #1353872](https://wall.alphacoders.com/big.php?i=1353872) | the page title is sometimes mis-labelled "Eula"; the upload is the Furina salon close-up |
| `furina-02-hydro-iris.jpg` | 水镜鸢尾 — shattered-glass eye close-up | **58\_(opal_00_58)** (画师) | [Danbooru post 5837276](https://danbooru.donmai.us/posts/5837276) | also circulated as a Wallpaper Engine workshop wallpaper |
| `furina-01-city-noir.jpg` | 雨夜枫丹 — cyberpunk Fontaine neon street with "FURINA" / "FONTAINE" signs | **rotvirtue** | [Wallpaper Abyss #1409444](https://wall.alphacoders.com/big.php?i=1409444) | 4K cyberpunk wallpaper |

`client/assets/thumbs/*.jpg` are downscaled (640 px wide) derivatives of the same
three files, used only by the settings-page wallpaper picker.

**Rights.** Furina, Fontaine and *Genshin Impact* are © HoYoverse / COGNOSPHERE.
These images are included for personal, non-commercial theming of a local DeepSeek
Harness installation. They are not covered by the MIT licence of this repository.
If you fork or republish the pack, either keep it personal or replace the images
with art you have the right to redistribute (the theme works with any image — see
*Custom wallpapers* in `README.md`).

## Companion and reference plugins / 相关插件

This theme was built on top of the public DSH plugin contract and studied the
following MIT-licensed community plugins. Authors, URLs and licences are listed
here; only `dsh-startup-screen` is vendored in this repository.

| Plugin | Author / 原作者 | Upstream | Licence | Role in this project | Distribution |
| --- | --- | --- | --- | --- | --- |
| `dsh-startup-screen` 1.1.0 | **沈宏宏** | https://github.com/6shenhonghong9/dsh-startup-screen | MIT | startup animation / splash screen; this theme re-colours it per skin with `--dsu-*` overrides and a wallpaper plate | **vendored unmodified** in [`companion/dsh-startup-screen/`](companion/dsh-startup-screen/) with its original `LICENSE` and an `ATTRIBUTION.md` |
| `dsh-cost-meter` 1.8.24 | **Han-1413141** | https://github.com/Han-1413141/dsh-cost-meter | MIT | owns the local usage ledger; the 电力储备 panel reads balance/today/per-turn data through its `costMeter` service | declared as an npm dependency in `package.json` (not copied) |
| `dsh-theme-endfield` 1.2.3 | **ymh0000123** | https://github.com/ymh0000123/dsh-theme-endfield | MIT | reference for the balance / "power reserve" presentation | not vendored, no source copied |
| `dsh-endfield-theme` 1.6.0 | **Longxiangjunlin** | https://github.com/Longxiangjunlin/dsh-endfield-theme | MIT | reference for the host-plugin shape (prefix route + injection rows + backdrop transport) | not vendored, no source copied |

The optional startup-splash plugin is **not** a runtime dependency of the theme and
is **not** added to `cordis.patch.yml`; installing it is a separate choice. See
[`companion/README.md`](companion/README.md) for the exact command and the warning
about running it twice.

## Other acknowledgements

* DeepSeek Harness and its Web GUI (host plugin contract, slots, theme tokens):
  https://github.com/deepseek-ai/dsh
* All screenshots in `docs/` were captured from a local, isolated DSH instance with
  headless Microsoft Edge over CDP. No screenshot service was used.
