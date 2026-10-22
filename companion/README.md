# Companion plugins / 随附插件

This folder keeps third-party plugins that the theme *supports* but does not own,
vendored unmodified so the pack is reproducible offline. Author, upstream URL and
licence for each one are recorded in [`../CREDITS.md`](../CREDITS.md).

## dsh-startup-screen (MIT, 沈宏宏)

Upstream: https://github.com/6shenhonghong9/dsh-startup-screen · version 1.1.0 ·
original licence in [`dsh-startup-screen/LICENSE`](dsh-startup-screen/LICENSE).

The theme's startup-splash support is written against this plugin: it injects one
`<style id="furina-startup-skin">` block that re-declares the plugin's `--dsu-*`
custom properties per skin (plus a wallpaper plate, wordmark, veil and bloom). The
plugin itself is **not modified** in this folder.

### Install the vendored copy

```bash
# from a clone of this repository
dsh plugin --profile web add file:<path-to-repo>/companion/dsh-startup-screen
```

Or install the upstream package, which is identical:

```bash
dsh plugin --profile web add github:6shenhonghong9/dsh-startup-screen
```

> **Do not install it twice.** `dsh-startup-screen` already mounts its own row
> (`id: dsh-startup-screen`). If it is already present in your profile, adding this
> copy again will mount the splash a second time. This theme never adds that row to
> `cordis.patch.yml` on purpose.

### Sync with upstream

The vendored copy is byte-identical to the published package at version 1.1.0.
To update, replace the folder with a fresh `npm pack dsh-startup-screen` extraction
(keep `LICENSE` and add the new version to this file and `../CREDITS.md`).

## Other referenced plugins

`dsh-cost-meter` is a real runtime dependency of the theme and is installed by npm
from the official registry — do not vendor it here. `dsh-theme-endfield` and
`dsh-endfield-theme` were read as references only; no source is copied.
