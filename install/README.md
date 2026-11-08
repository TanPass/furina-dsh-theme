# Furina DSH pack — theme + startup animation

This bundle installs both halves of the Furina DeepSeek Harness pack with one command:

| File | What it is |
| --- | --- |
| `furina-dsh-theme-1.2.8.tgz` | the Furina theme plugin (3 skins, wallpaper picker in Settings, per-skin sidebar/fonts, themed splash, themed file cards, 电力储备 billing panel, in-panel startup controls) |
| `dsh-startup-screen-1.1.0.tgz` | the startup animation plugin it drives and re-colours (upstream: 沈宏宏, MIT; vendored source also lives in the theme repo under `companion/`) |
| `install.ps1` / `install.cmd` | Windows installer for both, plus the shipped-preset check below |

## Windows — one click

Double-click **`install.cmd`**, or run:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\install.ps1
```

It installs both packages into the `web` profile with `dsh plugin --profile web add`,
in this order: theme first, then startup animation, then the shipped-preset check
described below. After it finishes:

1. restart the DSH web process once (close the terminal that runs `dsh web`, start it
   again) so the host half and the plugin bundle list are reloaded;
2. refresh the browser page.

If `dsh` is not on PATH, the script falls back to `npx --yes @deepseek-ai/dsh`.

## Shipped agent presets (standard / PTC / minimal / creator)

The four presets DSH ships come from the `@deepseek-ai/dsh-web-app` bundle. On
DSH 0.2.2 they can disappear from the new-session picker when the profile also
bundles **billion-context**: that bundle's patch makes the four preset rows wait
for the `biliBasicCompactionPolicy` service, and on 0.2.2 the service never
reaches the preset scope, so the rows stay `pending` and only custom presets are
listed.

Step 3 of the installer detects exactly that profile shape (billion-context plus
dsh-web-app in `dsh.profile.bundles`) and appends a marked block to the profile's
`cordis.patch.yml` that clears `inject` on those four rows:

```yaml
# [furina-dsh-pack] shipped preset compatibility - begin
- id: preset-standard
  inject: []
# … ptc / minimal / cordis …
# [furina-dsh-pack] shipped preset compatibility - end
```

It backs the patch file up first, is idempotent (re-running changes nothing), and
does nothing when billion-context is not bundled. The profile patch is applied
after every bundle layer, so these rows win over billion-context's inject.
billion-context itself stays installed and untouched. To undo, delete the marked
block and restart `dsh web`.

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

- Requires DSH 0.2.x (tested on 0.2.2-rc.1) and Node >= 22.
- The theme is MIT. The wallpapers are Furina fan art (© HoYoverse), personal
  non-commercial use only — see the theme repo's `NOTICE.md` / `CREDITS.md`.
- Startup animation is optional: if you only install the theme, the 启动动画 block
  disables itself and the rest of the theme works normally.
