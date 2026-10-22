# Furina DSH pack — theme + startup animation

This bundle installs both halves of the Furina DeepSeek Harness pack with one command:

| File | What it is |
| --- | --- |
| `furina-dsh-theme-1.1.1.tgz` | the Furina theme plugin (3 skins, wallpaper picker in Settings, per-skin sidebar/fonts, themed splash, themed file cards, 电力储备 billing panel, in-panel startup controls) |
| `dsh-startup-screen-1.1.0.tgz` | the startup animation plugin it drives and re-colours (upstream: 沈宏宏, MIT; vendored source also lives in the theme repo under `companion/`) |
| `install.ps1` / `install.cmd` | Windows installer for both |

## Windows — one click

Double-click **`install.cmd`**, or run:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\install.ps1
```

It installs both packages into the `web` profile with `dsh plugin --profile web add`,
in this order: theme first, then startup animation. After it finishes:

1. restart the DSH web process once (close the terminal that runs `dsh web`, start it
   again) so the host half and the plugin bundle list are reloaded;
2. refresh the browser page.

If `dsh` is not on PATH, the script falls back to `npx --yes @deepseek-ai/dsh`.

## Where the controls are

**设置 → 芙宁娜主题** (Settings → Furina theme) has the skin cards, wallpaper picker,
glass modes and — at the bottom — **启动动画 · Startup**: enable switch, play-mode
select and a link to the animation plugin's full 33-option page.

## Uninstall

```powershell
dsh plugin --profile web remove furina-dsh-theme
dsh plugin --profile web remove dsh-startup-screen
```

Then restart DSH web. Your profile's package.json / cordis.patch.yml are edited by
`dsh plugin` itself; keep a backup of both if you have local customisations.

## Notes

- Requires DSH 0.2.x (tested on 0.2.1-rc.2) and Node >= 22.
- The theme is MIT. The wallpapers are Furina fan art (© HoYoverse), personal
  non-commercial use only — see the theme repo's `NOTICE.md` / `CREDITS.md`.
- Startup animation is optional: if you only install the theme, the 启动动画 block
  disables itself and the rest of the theme works normally.
