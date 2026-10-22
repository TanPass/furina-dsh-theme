# NOTICE

`furina-dsh-theme` (code) is MIT-licensed — see [LICENSE](LICENSE).

## Character artwork is **not** MIT

The wallpapers, thumbnails and emblem under `client/assets/` are fan-art / fan-made
assets themed after **Furina (芙宁娜)** from *Genshin Impact* (《原神》). The character
and the setting are © HoYoverse / miHoYo. These image files are included **for
personal, non-commercial theming of a local DeepSeek Harness installation only**.

They are **not** covered by the MIT grant above. If you redistribute this repository
or publish it as a package/theme, you are responsible for the artwork: either keep the
repository private/personal, or replace `client/assets/wallpapers/*.jpg`,
`client/assets/thumbs/*.jpg` and `client/assets/emblem.svg` with assets you have the
right to redistribute (original art, commissioned art with distribution rights, or
CC-licensed art with attribution). The theme works with any images — see the
*Custom wallpapers* section of the README.

No affiliation with, endorsement by, or sponsorship from HoYoverse is claimed.

## Non-image third-party material

* The DSH host-plugin shape (`dsh.bundle.patch` in `package.json`, a `cordis.patch.yml`
  row, a prefix route plus injection rows) follows the public DeepSeek Harness plugin
  contract and was informed by studying the installed reference theme
  `dsh-endfield-theme`. No source code from that theme is copied here; `lib/index.js`,
  `client/theme.js` and `client/theme.css` are original to this project.
* Nothing else is vendored: the package has **zero runtime dependencies** and the
  browser half is plain DOM/CSS with no framework and no build step.
