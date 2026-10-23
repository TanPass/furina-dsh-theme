/**
 * furina-dsh-theme — browser half.
 *
 * Everything the user sees lives here; the host (`lib/index.js`) only serves
 * these files and gets this script into the page.
 *
 * Layering, from back to front:
 *
 *   #furina-backdrop   fixed, z-index -1 — two crossfading wallpaper layers,
 *                      a legibility veil, the accent glow, wave lines and the
 *                      Fontaine crest watermark;
 *   the application    its own opaque grounds are neutralised by theme.css, so
 *                      whatever the shell paints sits on the wallpaper as
 *                      translucent glass;
 *   the settings page  a "芙宁娜主题 / Furina theme" row injected into the DSH
 *                      settings modal (nav cell + pane in a shadow root);
 *   #furina-switcher   the original floating panel, kept intact as the fallback
 *                      when the settings modal never shows up.
 *
 * State is a few strings in localStorage. Nothing here talks to the host at
 * runtime except one optional fetch of the user's own wallpaper folder, and
 * that fetch failing only costs the custom entries.
 */
(function () {
  'use strict'

  if (window.__furinaTheme) return

  var doc = document
  var VERSION = '1.2.3'
  var ROUTE = '/furina-theme'
  var STORAGE_KEY = 'furina-theme.settings.v1'
  var SCRIPT_TAG = 'data-furina-theme'

  // The shell picks its token branch from these two attributes. Its default is
  // the *light* branch (data-ds-theme-source="system", color-scheme: light, no
  // body attribute), which leaves plugin surfaces such as the file-change card
  // painted from the light neutral ramp — white card, white text. The whole skin
  // is a dark design, so we declare the dark branch instead of chasing every
  // component that reads a light-branch token.
  var DARK_ATTRIBUTE = 'data-ds-dark-theme'
  var SOURCE_ATTRIBUTE = 'data-ds-theme-source'

  /* ------------------------------------------------------------------ model */

  var SKINS = [
    {
      id: 'fontaine-nocturne',
      zh: '雨夜枫丹',
      en: 'Fontaine Nocturne',
      wallpaper: 'city-noir',
      swatches: ['#04060f', '#2d3c81', '#4ea4ef', '#f26d78'],
      blurb: '霓虹倒影，湿润的靛蓝夜色',
    },
    {
      id: 'hydro-iris',
      zh: '水镜鸢尾',
      en: 'Hydro Iris',
      wallpaper: 'hydro-iris',
      swatches: ['#03050e', '#243a86', '#5fb4ff', '#8fe8ff'],
      blurb: '晶蓝水光，近黑的冰玻璃',
    },
    {
      id: 'salon-solitude',
      zh: '沙龙独处',
      en: 'Salon Solitude',
      wallpaper: 'salon-solitude',
      swatches: ['#0c0f1b', '#3a3f63', '#dea998', '#c79bd6'],
      blurb: '玫瑰金与薰衣草，安静的午后',
    },
  ]

  var WALLPAPERS = [
    {
      id: 'city-noir',
      zh: '雨夜霓虹',
      src: ROUTE + '/assets/wallpapers/furina-01-city-noir.jpg',
      thumb: ROUTE + '/assets/thumbs/furina-01-city-noir-640.jpg',
    },
    {
      id: 'hydro-iris',
      zh: '水镜鸢尾',
      src: ROUTE + '/assets/wallpapers/furina-02-hydro-iris.jpg',
      thumb: ROUTE + '/assets/thumbs/furina-02-hydro-iris-640.jpg',
    },
    {
      id: 'salon-solitude',
      zh: '沙龙独处',
      src: ROUTE + '/assets/wallpapers/furina-03-salon-solitude.jpg',
      thumb: ROUTE + '/assets/thumbs/furina-03-salon-solitude-640.jpg',
    },
  ]

  var GLASS_MODES = [
    { id: 'soft', zh: '轻柔', en: 'Soft' },
    { id: 'standard', zh: '标准', en: 'Standard' },
    { id: 'rich', zh: '浓郁', en: 'Rich' },
  ]

  var DEFAULTS = {
    skin: 'fontaine-nocturne',
    wallpaper: 'auto',
    glass: 'standard',
    grain: 'texture',
    customSrc: null,
  }

  // 'texture' keeps the faint scanline film; 'clean' removes it for users who
  // find the lines distracting. Stored with the rest of the skin settings.
  var GRAIN_MODES = [
    { id: 'texture', zh: '细纹质感' },
    { id: 'clean', zh: '纯净无纹' },
  ]

  function byId(list, id) {
    for (var i = 0; i < list.length; i += 1) if (list[i].id === id) return list[i]
    return null
  }

  function readSettings() {
    var next = {
      skin: DEFAULTS.skin,
      wallpaper: DEFAULTS.wallpaper,
      glass: DEFAULTS.glass,
      grain: DEFAULTS.grain,
      customSrc: DEFAULTS.customSrc,
    }
    try {
      var raw = window.localStorage.getItem(STORAGE_KEY)
      if (raw === null) return next
      var parsed = JSON.parse(raw)
      if (parsed === null || typeof parsed !== 'object') return next
      if (typeof parsed.skin === 'string' && byId(SKINS, parsed.skin) !== null) next.skin = parsed.skin
      if (typeof parsed.wallpaper === 'string' && parsed.wallpaper !== '') next.wallpaper = parsed.wallpaper
      if (typeof parsed.glass === 'string' && byId(GLASS_MODES, parsed.glass) !== null) next.glass = parsed.glass
      if (typeof parsed.grain === 'string' && byId(GRAIN_MODES, parsed.grain) !== null) next.grain = parsed.grain
      // A user-picked picture travels as a data URL. Anything else in that slot
      // (older builds, hand-edited storage) is ignored rather than executed.
      if (typeof parsed.customSrc === 'string' && parsed.customSrc.indexOf('data:image/') === 0) {
        next.customSrc = parsed.customSrc
      }
    } catch (error) {
      /* corrupt or unavailable storage: defaults are a valid answer */
    }
    return next
  }

  function writeSettings(settings) {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
    } catch (error) {
      // Private mode, or a picture larger than the 5 MB quota: the theme still
      // works for this page load, it just will not survive a reload.
    }
  }

  var state = readSettings()
  var customWallpapers = []

  /* ------------------------------------------------------------- stylesheet */

  function sheetHref() {
    return ROUTE + '/theme.css'
  }

  function ensureSheet() {
    var head = doc.head || doc.documentElement
    if (doc.querySelector('link[data-furina-theme]') !== null) return
    var link = doc.createElement('link')
    link.rel = 'stylesheet'
    link.type = 'text/css'
    link.href = sheetHref()
    link.setAttribute('data-furina-theme', '1')
    head.appendChild(link)
  }

  /* --------------------------------------------------------------- backdrop */

  var backdrop = null
  var layers = []
  var activeLayer = 0
  var wallpaperToken = 0

  function ensureBackdrop() {
    if (backdrop !== null && backdrop.isConnected) return backdrop
    backdrop = doc.createElement('div')
    backdrop.id = 'furina-backdrop'
    backdrop.setAttribute('aria-hidden', 'true')
    backdrop.innerHTML = ''
      + '<div class="fr-wp fr-wp-a"></div>'
      + '<div class="fr-wp fr-wp-b"></div>'
      + '<div class="fr-veil"></div>'
      + '<div class="fr-glow"></div>'
      + '<div class="fr-waves"></div>'
      + '<div class="fr-crest-mark"></div>'
      + '<div class="fr-grain"></div>'
    // First child of <body>: the shell's own nodes are all later in paint
    // order, and z-index -1 keeps it behind them anyway.
    if (doc.body !== null) doc.body.insertBefore(backdrop, doc.body.firstChild)
    layers = [
      backdrop.querySelector('.fr-wp-a'),
      backdrop.querySelector('.fr-wp-b'),
    ]
    activeLayer = 0
    return backdrop
  }

  function resolvedWallpaper() {
    if (state.wallpaper === 'none') return null
    if (state.wallpaper === 'custom') {
      if (state.customSrc === null) return null
      return { src: state.customSrc }
    }
    if (state.wallpaper === 'auto') {
      var skin = byId(SKINS, state.skin)
      var target = skin === null ? null : byId(WALLPAPERS, skin.wallpaper)
      return target === null ? null : { src: target.src }
    }
    if (state.wallpaper.indexOf('user:') === 0) {
      var name = state.wallpaper.slice(5)
      return { src: ROUTE + '/user-wallpaper/' + encodeURIComponent(name) }
    }
    var found = byId(WALLPAPERS, state.wallpaper)
    return found === null ? null : { src: found.src }
  }

  function paintWallpaper() {
    var container = ensureBackdrop()
    var resolved = resolvedWallpaper()
    var token = (wallpaperToken += 1)

    if (resolved === null) {
      container.classList.add('fr-flat')
      for (var i = 0; i < layers.length; i += 1) layers[i].classList.remove('fr-on')
      return
    }

    var next = (activeLayer + 1) % layers.length
    var previous = activeLayer
    var target = layers[next]

    var commit = function commit() {
      if (token !== wallpaperToken) return
      container.classList.remove('fr-flat')
      target.style.backgroundImage = 'url("' + resolved.src.replace(/"/g, '%22') + '")'
      target.classList.add('fr-on')
      if (layers[previous] !== undefined) layers[previous].classList.remove('fr-on')
      activeLayer = next
    }

    var probe = new Image()
    probe.onload = commit
    probe.onerror = function onerror() {
      /* a wallpaper that will not load is not worth breaking the paint order */
    }
    probe.src = resolved.src
    // Cached images may already be complete and emit no load event.
    if (probe.complete && probe.naturalWidth > 0) commit()
  }

  /* ------------------------------------------------------- switcher stylesheet */

  var switcherHost = null
  var shadow = null
  var panel = null
  var panelOpen = false
  var fallbackRevealed = false

  var SWITCHER_CSS = ''
    + ':host{all:initial}'
    + '*,*::before,*::after{box-sizing:border-box}'
    // The launcher is only a fallback now: theme settings live in the DSH
    // settings modal, so the pill stays hidden unless that modal never appears.
    + ':host(:not([data-furina-fallback="1"])) .fl{display:none!important}'
    // Bottom-right, but lifted clear of the pet widget's corner so neither covers the
    // other; the composer's send button sits further left and is never touched.
    + '.fl{position:fixed;right:20px;bottom:196px;z-index:2147481200;width:52px;height:52px;'
    + 'padding:0;border-radius:50%;border:1px solid var(--fr-line-strong,rgba(255,255,255,.22));'
    + 'background:linear-gradient(155deg,rgba(20,34,66,.92),rgba(6,10,24,.94));'
    + 'box-shadow:0 10px 30px rgba(0,0,0,.55),0 0 0 1px rgba(255,255,255,.05) inset,0 0 22px var(--fr-glow-soft,rgba(78,164,239,.28));'
    + 'cursor:pointer;display:grid;place-items:center;transition:transform .22s cubic-bezier(.22,.9,.16,1),box-shadow .22s;'
    + 'backdrop-filter:blur(14px) saturate(130%)}'
    + '.fl:hover{transform:translateY(-3px) scale(1.05);box-shadow:0 14px 36px rgba(0,0,0,.6),0 0 26px var(--fr-accent,#4ea4ef)}'
    + '.fl:focus-visible{outline:2px solid var(--fr-accent,#4ea4ef);outline-offset:3px}'
    + '.fl img{width:30px;height:30px;display:block;filter:drop-shadow(0 0 6px var(--fr-glow-soft,rgba(78,164,239,.5)))}'
    + '.dual{position:fixed;inset:0;z-index:2147481300;display:none}'
    + '.dual.on{display:block}'
    + '.panel{position:absolute;right:22px;bottom:88px;width:342px;max-height:min(78vh,720px);overflow:auto;'
    + 'border-radius:18px;padding:16px 16px 12px;color:var(--fr-text,#e6eefb);'
    + 'background:linear-gradient(165deg,rgba(18,29,58,.94),rgba(7,11,24,.96));'
    + 'border:1px solid var(--fr-line-strong,rgba(255,255,255,.16));'
    + 'box-shadow:0 24px 60px rgba(0,0,0,.62),0 0 0 1px rgba(255,255,255,.04) inset;'
    + 'backdrop-filter:blur(22px) saturate(140%);font:13px/1.45 "Segoe UI","Microsoft YaHei",system-ui,sans-serif}'
    + '.panel::-webkit-scrollbar{width:8px}'
    + '.panel::-webkit-scrollbar-thumb{border-radius:8px;background:var(--fr-scrollbar,rgba(78,164,239,.28))}'
    // Inside the settings modal the panel is just a column of controls: the
    // dialog already owns the surface, so no card chrome here.
    + '.panel.embed{position:static;inset:auto;width:auto;max-width:none;max-height:none;height:auto;'
    + 'overflow:visible;border-radius:0;padding:0 10px 20px 2px;background:transparent;border:0;'
    + 'box-shadow:none;backdrop-filter:none}'
    + '.hd{display:flex;align-items:center;gap:10px;padding-bottom:12px;border-bottom:1px solid var(--fr-line,rgba(255,255,255,.1))}'
    + '.hd img{width:34px;height:34px;flex:0 0 auto;filter:drop-shadow(0 0 8px var(--fr-glow-soft,rgba(78,164,239,.45)))}'
    + '.hd .tt{flex:1 1 auto;min-width:0}'
    + '.hd h1{margin:0;font:600 17px/1.15 "Candara","Optima","Palatino Linotype","Noto Serif SC",serif;letter-spacing:.10em}'
    + '.hd p{margin:3px 0 0;font-size:11px;letter-spacing:.16em;text-transform:uppercase;opacity:.62}'
    + '.x{flex:0 0 auto;width:26px;height:26px;border-radius:8px;border:1px solid transparent;background:transparent;'
    + 'color:inherit;font-size:16px;line-height:1;cursor:pointer;opacity:.7}'
    + '.x:hover{opacity:1;background:rgba(255,255,255,.08);border-color:var(--fr-line,rgba(255,255,255,.12))}'
    + 'h2{margin:15px 0 8px;font:600 10.5px/1 "Segoe UI",sans-serif;letter-spacing:.2em;opacity:.55;text-transform:uppercase}'
    + '.skins{display:grid;gap:8px}'
    + '.skin{display:grid;grid-template-columns:44px 1fr;gap:10px;align-items:center;text-align:left;width:100%;'
    + 'padding:8px 10px;border-radius:12px;cursor:pointer;color:inherit;'
    + 'background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.08);transition:all .18s}'
    + '.skin:hover{background:rgba(255,255,255,.07);transform:translateX(1px)}'
    + '.skin[aria-pressed="true"]{border-color:var(--fr-accent,#4ea4ef);background:var(--fr-accent-14,rgba(78,164,239,.14));'
    + 'box-shadow:0 0 0 1px var(--fr-accent-45,rgba(78,164,239,.45)) inset}'
    + '.sw{width:44px;height:34px;border-radius:8px;overflow:hidden;display:grid;grid-template-columns:repeat(4,1fr);'
    + 'border:1px solid rgba(255,255,255,.16);box-shadow:0 2px 8px rgba(0,0,0,.35)}'
    + '.skin b{display:block;font-size:13px;font-weight:600;letter-spacing:.02em}'
    + '.skin small{display:block;font-size:10.5px;opacity:.55;letter-spacing:.04em}'
    + '.skin .zh{font-size:11px;opacity:.72}'
    + '.walls{display:grid;grid-template-columns:repeat(4,1fr);gap:7px}'
    + '.wall{position:relative;aspect-ratio:16/10;border-radius:9px;overflow:hidden;cursor:pointer;padding:0;'
    + 'border:1px solid rgba(255,255,255,.1);background:rgba(255,255,255,.04);color:inherit}'
    + '.wall img{width:100%;height:100%;object-fit:cover;display:block;opacity:.9;transition:opacity .18s,transform .3s}'
    + '.wall:hover img{opacity:1;transform:scale(1.05)}'
    + '.wall[aria-pressed="true"]{border-color:var(--fr-accent,#4ea4ef);box-shadow:0 0 0 1px var(--fr-accent,#4ea4ef)}'
    + '.wall[aria-pressed="true"] img{opacity:1}'
    + '.wall .lb{position:absolute;left:0;right:0;bottom:0;padding:2px 4px 3px;font-size:9.5px;letter-spacing:.02em;'
    + 'background:linear-gradient(0deg,rgba(0,0,0,.78),rgba(0,0,0,0));text-align:center;white-space:nowrap;'
    + 'overflow:hidden;text-overflow:ellipsis}'
    + '.wall.flat{display:grid;place-items:center;font-size:17px;opacity:.85}'
    + '.wall.flat .lb{position:static;background:none;font-size:9.5px;opacity:.7}'
    // "any picture" tile: opens the file picker and paints whatever the user
    // chooses (downscaled to a JPEG data URL before it is stored and painted).
    + '.wall.custom{display:grid;place-items:center;border-style:dashed;'
    + 'border-color:var(--fr-accent-45,rgba(78,164,239,.45));background:rgba(255,255,255,.02)}'
    + '.wall.custom .plus{font-size:18px;line-height:1;opacity:.85}'
    + '.wall.custom .lb{position:static;background:none;font-size:9.5px;opacity:.72}'
    + '.filepick{display:none!important}'
    + '.glass{display:grid;grid-template-columns:repeat(3,1fr);gap:7px}'
    + '.glass button{padding:7px 4px;border-radius:9px;cursor:pointer;color:inherit;font-size:11.5px;letter-spacing:.04em;'
    + 'background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.1);transition:all .18s}'
    + '.glass button:hover{background:rgba(255,255,255,.08)}'
    + '.glass button[aria-pressed="true"]{border-color:var(--fr-accent,#4ea4ef);background:var(--fr-accent-14,rgba(78,164,239,.16));'
    + 'box-shadow:0 0 0 1px var(--fr-accent-45,rgba(78,164,239,.45)) inset}'
    // Startup-animation block: drives the companion dsh-startup-screen plugin.
    + '.startup{display:grid;gap:8px}'
    + '.swrow{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:8px 10px;'
    + 'border-radius:10px;background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.08)}'
    + '.swlbl{display:grid;gap:2px;line-height:1.35}'
    + '.swlbl b{font-size:12.5px;font-weight:600}'
    + '.swlbl small{font-size:10.5px;opacity:.55}'
    + '.tgl{min-width:58px;padding:5px 10px;border-radius:999px;font-size:11.5px;cursor:pointer;color:inherit;'
    + 'background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.16);transition:all .18s}'
    + '.tgl[aria-pressed="true"]{background:var(--fr-accent-14,rgba(78,164,239,.18));'
    + 'border-color:var(--fr-accent,#4ea4ef);color:var(--fr-accent,#4ea4ef)}'
    + '.tgl:disabled{opacity:.4;cursor:not-allowed}'
    + '.selsm{padding:5px 8px;border-radius:8px;font:inherit;font-size:11.5px;color:inherit;'
    + 'background:rgba(12,16,28,.8);border:1px solid rgba(255,255,255,.16)}'
    + '.selsm:disabled{opacity:.4}'
    + '.hint{display:flex;align-items:center;gap:6px;margin:0;font-size:10.5px;opacity:.6}'
    + '.lnk{padding:0;border:0;background:none;color:var(--fr-accent,#4ea4ef);font:inherit;font-size:10.5px;'
    + 'cursor:pointer;text-decoration:underline}'
    + '.ft{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:14px;'
    + 'padding-top:10px;border-top:1px solid var(--fr-line,rgba(255,255,255,.1));font-size:10.5px;opacity:.6}'
    + '.rst{padding:4px 9px;border-radius:8px;cursor:pointer;color:inherit;font-size:10.5px;'
    + 'background:transparent;border:1px solid var(--fr-line,rgba(255,255,255,.16));opacity:.85}'
    + '.rst:hover{opacity:1;background:rgba(255,255,255,.08)}'
    + 'kbd{font:inherit;font-size:10px;padding:1px 4px;border-radius:4px;border:1px solid rgba(255,255,255,.2);'
    + 'background:rgba(255,255,255,.06)}'
    + '@media (prefers-reduced-motion:reduce){.fl,.panel,.skin,.wall img{transition:none!important}}'

  /* --------------------------------------------------------------- markup */

  function esc(text) {
    return String(text).replace(/[&<>"']/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]
    })
  }

  function wallpaperList() {
    var list = [{ id: 'auto', zh: '跟随皮肤' }, { id: 'none', zh: '无壁纸' }]
    for (var i = 0; i < WALLPAPERS.length; i += 1) {
      list.push({ id: WALLPAPERS[i].id, zh: WALLPAPERS[i].zh, thumb: WALLPAPERS[i].thumb })
    }
    if (state.customSrc !== null) {
      list.push({ id: 'custom', zh: '自定义图片', thumb: state.customSrc })
    }
    for (var j = 0; j < customWallpapers.length; j += 1) {
      var name = customWallpapers[j]
      list.push({
        id: 'user:' + name,
        zh: name.replace(/\.[^.]+$/, ''),
        thumb: ROUTE + '/user-wallpaper/' + encodeURIComponent(name),
      })
    }
    return list
  }

  function skinMarkup() {
    var out = ''
    for (var i = 0; i < SKINS.length; i += 1) {
      var skin = SKINS[i]
      out += '<button class="skin" data-skin="' + esc(skin.id) + '" aria-pressed="' + (skin.id === state.skin) + '">'
        + '<span class="sw">'
        + skin.swatches.map(function (color) { return '<i style="background:' + color + '"></i>' }).join('')
        + '</span>'
        + '<span><b>' + esc(skin.zh) + '</b><small>' + esc(skin.en) + '</small>'
        + '<span class="zh">' + esc(skin.blurb) + '</span></span>'
        + '</button>'
    }
    return out
  }

  function wallpaperMarkup() {
    var list = wallpaperList()
    var out = ''
    for (var i = 0; i < list.length; i += 1) {
      var entry = list[i]
      var pressed = entry.id === state.wallpaper
      if (entry.thumb !== undefined) {
        out += '<button class="wall" data-wall="' + esc(entry.id) + '" aria-pressed="' + pressed + '" title="' + esc(entry.zh) + '">'
          + '<img src="' + esc(entry.thumb) + '" alt="" loading="lazy">'
          + '<span class="lb">' + esc(entry.zh) + '</span></button>'
      } else {
        out += '<button class="wall flat" data-wall="' + esc(entry.id) + '" aria-pressed="' + pressed + '" title="' + esc(entry.zh) + '">'
          + '<span>' + (entry.id === 'none' ? '∅' : '✧') + '</span>'
          + '<span class="lb">' + esc(entry.zh) + '</span></button>'
      }
    }
    out += '<button class="wall custom" data-custom-wall="1" aria-pressed="' + (state.wallpaper === 'custom') + '"'
      + ' title="任意壁纸：从本机选择一张图片">'
      + '<span class="plus">+</span><span class="lb">任意壁纸</span></button>'
    out += '<input class="filepick" type="file" accept="image/*" aria-label="选择任意壁纸图片">'
    return out
  }

  function glassMarkup() {
    var out = ''
    for (var i = 0; i < GLASS_MODES.length; i += 1) {
      var mode = GLASS_MODES[i]
      out += '<button data-glass="' + esc(mode.id) + '" aria-pressed="' + (mode.id === state.glass) + '">'
        + esc(mode.zh) + '</button>'
    }
    return out
  }

  function grainMarkup() {
    var out = ''
    for (var i = 0; i < GRAIN_MODES.length; i += 1) {
      var mode = GRAIN_MODES[i]
      out += '<button data-grain="' + esc(mode.id) + '" aria-pressed="' + (mode.id === state.grain) + '">'
        + esc(mode.zh) + '</button>'
    }
    return out
  }

  // One markup source for both surfaces: the fallback pill's panel and the
  // settings-modal pane. Keeping it single-source is what lets the fallback
  // stay a working copy of the same controls instead of a second implementation.
  function controlsMarkup() {
    return ''
      + '<div class="hd"><img src="' + ROUTE + '/assets/emblem.svg" alt="">'
      + '<div class="tt"><h1>芙宁娜</h1><p>Furina · Fontaine</p></div>'
      + '<button class="x" data-close aria-label="关闭" title="关闭">×</button></div>'
      + '<h2>皮肤 · Skin</h2><div class="skins">' + skinMarkup() + '</div>'
      + '<h2>壁纸 · Wallpaper</h2><div class="walls">' + wallpaperMarkup() + '</div>'
      + '<h2>玻璃 · Glass</h2><div class="glass">' + glassMarkup() + '</div>'
      + '<h2>画面 · Surface</h2><div class="glass">' + grainMarkup() + '</div>'
      // The companion dsh-startup-screen plugin keeps its 30+ options in its own
      // section; the two controls that matter most live here, next to the skin
      // they are coloured from, and the full panel is one click away.
      + '<h2>启动动画 · Startup</h2>'
      + '<div class="startup" data-startup-block>'
      + '<div class="swrow"><span class="swlbl"><b>启用启动动画</b>'
      + '<small>启动时播放芙宁娜配色的开机序列</small></span>'
      + '<button class="tgl" data-startup-toggle aria-pressed="false" disabled>检测中</button></div>'
      + '<div class="swrow"><span class="swlbl"><b>播放模式</b>'
      + '<small>每次会话 / 总是 / 每天</small></span>'
      + '<select class="selsm" data-startup-mode disabled>'
      + '<option value="session">每次会话</option><option value="always">总是</option>'
      + '<option value="daily">每天</option></select></div>'
      + '<p class="hint" data-startup-hint>正在检测 dsh-startup-screen…</p>'
      + '</div>'
      + '<div class="ft"><button class="rst" data-reset>恢复默认</button>'
      + '<span>v' + VERSION + ' · <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>U</kbd></span></div>'
  }

  /* ---------------------------------------------------------- picture picker */

  var CUSTOM_MAX_EDGE = 1920

  // A raw phone photo is often >5 MB and localStorage holds ~5 MB total, so the
  // picture is downscaled and re-encoded before it becomes the wallpaper.
  function shrinkImage(file, done) {
    var reader = new FileReader()
    reader.onload = function onload() {
      var image = new Image()
      image.onload = function onimage() {
        var width = image.naturalWidth
        var height = image.naturalHeight
        if (width < 1 || height < 1) {
          done(null)
          return
        }
        var scale = Math.min(1, CUSTOM_MAX_EDGE / Math.max(width, height))
        var canvas = doc.createElement('canvas')
        canvas.width = Math.max(1, Math.round(width * scale))
        canvas.height = Math.max(1, Math.round(height * scale))
        var context = canvas.getContext('2d')
        var data = null
        if (context !== null) {
          context.drawImage(image, 0, 0, canvas.width, canvas.height)
          try {
            data = canvas.toDataURL('image/jpeg', 0.84)
          } catch (error) {
            data = null
          }
        }
        done(data !== null ? data : String(image.src))
      }
      image.onerror = function onerror() { done(null) }
      image.src = String(reader.result)
    }
    reader.onerror = function onerror() { done(null) }
    try {
      reader.readAsDataURL(file)
    } catch (error) {
      done(null)
    }
  }

  function onPickFile(input) {
    var file = input.files === null || input.files === undefined ? undefined : input.files[0]
    if (file === undefined || file === null) return
    shrinkImage(file, function onshrunk(data) {
      if (data === null || typeof data !== 'string') return
      state = { skin: state.skin, wallpaper: 'custom', glass: state.glass, grain: state.grain, customSrc: data }
      writeSettings(state)
      render()
      paintWallpaper()
      refreshWallpapers()
      input.value = ''
    })
  }

  // Wires one `.panel` subtree. The two surfaces differ only in what "close"
  // means: the pill closes its overlay, the settings pane hands the dialog back.
  function wireControls(root, onClose) {
    if (root === null) return
    var scope = root.querySelector('.panel')
    if (scope === null) return
    if (scope.getAttribute('data-furina-wired') === '1') return
    scope.setAttribute('data-furina-wired', '1')

    scope.addEventListener('click', function onpanelclick(event) {
      var target = event.target
      if (target === null || target.closest === undefined) return
      var button = target.closest('button')
      if (button === null) return
      if (button.getAttribute('data-skin') !== null) {
        setSkin(button.getAttribute('data-skin'))
        return
      }
      if (button.getAttribute('data-wall') !== null) {
        setWallpaper(button.getAttribute('data-wall'))
        return
      }
      if (button.getAttribute('data-glass') !== null) {
        setGlass(button.getAttribute('data-glass'))
        return
      }
      if (button.getAttribute('data-grain') !== null) {
        setGrain(button.getAttribute('data-grain'))
        return
      }
      if (button.getAttribute('data-custom-wall') !== null) {
        var picker = scope.querySelector('.filepick')
        if (picker !== null) picker.click()
        return
      }
      if (button.getAttribute('data-reset') !== null) {
        state = { skin: DEFAULTS.skin, wallpaper: DEFAULTS.wallpaper, glass: DEFAULTS.glass, grain: DEFAULTS.grain, customSrc: null }
        writeSettings(state)
        render()
        paintWallpaper()
        refreshWallpapers()
        return
      }
      if (button.getAttribute('data-close') !== null && onClose !== undefined) onClose()
    })

    var input = scope.querySelector('.filepick')
    if (input !== null) input.addEventListener('change', function onchange() { onPickFile(input) })

    wireStartup(scope)
  }

  /* ------------------------------------------------- startup animation block */

  var STARTUP_API = '/dsh-startup/config'

  // Reads and writes the companion plugin's own config file through its JSON
  // endpoint (the plugin owns the schema, so this stays forward compatible).
  // When the plugin is absent the block stays visible but disabled, with the
  // install hint — the theme must never hard-depend on it.
  function wireStartup(scope) {
    var toggle = scope.querySelector('[data-startup-toggle]')
    var mode = scope.querySelector('[data-startup-mode]')
    var hint = scope.querySelector('[data-startup-hint]')
    if (toggle === null || mode === null || hint === null) return
    var config = null
    var busy = false

    function paint() {
      var on = config !== null && config.enabled !== false
      toggle.disabled = config === null || busy
      mode.disabled = config === null || busy
      toggle.setAttribute('aria-pressed', String(on))
      toggle.textContent = config === null ? '未安装' : (on ? '开' : '关')
      if (config !== null && typeof config.mode === 'string') mode.value = config.mode
    }

    function note(text, withLink) {
      hint.textContent = ''
      var span = doc.createElement('span')
      span.textContent = text
      hint.appendChild(span)
      if (withLink !== true) return
      var link = doc.createElement('button')
      link.type = 'button'
      link.className = 'lnk'
      link.textContent = '打开完整设置'
      link.addEventListener('click', function onopen() {
        var dialog = findSettingsDialog()
        if (dialog === null) return
        var cells = dialog.querySelectorAll('nav button')
        for (var i = 0; i < cells.length; i += 1) {
          if (cells[i].textContent.trim() === '启动动画') { cells[i].click(); return }
        }
      })
      hint.appendChild(link)
    }

    function save(patch) {
      if (busy || config === null) return
      busy = true
      paint()
      fetch(STARTUP_API, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ patch: patch }),
      }).then(function onok(response) { return response.json() })
        .then(function ondata(data) {
          if (data !== null && data.ok === true && data.config) config = data.config
          busy = false
          paint()
          note('已保存 · 立即生效', true)
        })
        .catch(function onerr() {
          busy = false
          paint()
          note('保存失败，请确认 dsh-startup-screen 已启用', true)
        })
    }

    toggle.addEventListener('click', function ontoggle() {
      if (config === null) return
      save({ enabled: config.enabled === false })
    })
    mode.addEventListener('change', function onmode() {
      if (config === null) return
      save({ mode: mode.value })
    })

    fetch(STARTUP_API, { credentials: 'same-origin' })
      .then(function onok(response) {
        if (!response.ok) throw new Error('http ' + response.status)
        return response.json()
      })
      .then(function ondata(data) {
        if (data === null || data.ok !== true || data.config === null || data.config === undefined) {
          throw new Error('no config')
        }
        config = data.config
        paint()
        note('已连接 dsh-startup-screen' + (data.version ? ' ' + data.version : ''), true)
      })
      .catch(function onerr() {
        config = null
        paint()
        hint.textContent = ''
        var span = doc.createElement('span')
        span.textContent = '未检测到 dsh-startup-screen。'
        hint.appendChild(span)
        var install = doc.createElement('button')
        install.type = 'button'
        install.className = 'lnk'
        install.textContent = '一键安装'
        install.addEventListener('click', function oninstall() {
          if (install.disabled) return
          install.disabled = true
          install.textContent = '安装中…'
          fetch('/furina-theme/api/startup-plugin', {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ action: 'install' }),
          }).then(function ondone(response) { return response.json() })
            .then(function ondata(data) {
              if (data !== null && data.ok === true) {
                hint.textContent = data.already === true
                  ? '启动动画插件已就绪，重启 DSH 后生效'
                  : '已安装启动动画插件 · 重启 DSH 后生效（设置保留）'
                return
              }
              install.disabled = false
              install.textContent = '一键安装'
              hint.textContent = '安装失败：' + (data && data.error ? data.error : '未知原因')
            })
            .catch(function onfail() {
              install.disabled = false
              install.textContent = '一键安装'
              hint.textContent = '安装失败：当前宿主版本不支持，请升级 furina-dsh-theme'
            })
        })
        hint.appendChild(install)
      })
  }

  /* --------------------------------------------------------------- switcher */

  function ensureSwitcher() {
    if (switcherHost !== null && switcherHost.isConnected) return switcherHost
    if (doc.body === null) return null

    switcherHost = doc.createElement('div')
    switcherHost.id = 'furina-switcher'
    switcherHost.setAttribute('data-furina-fallback', fallbackRevealed ? '1' : '0')
    shadow = switcherHost.attachShadow({ mode: 'open' })
    shadow.innerHTML = ''
      + '<style>' + SWITCHER_CSS + '</style>'
      + '<button class="fl" part="launcher" title="芙宁娜主题 · Furina theme (Ctrl+Shift+U)" aria-label="打开芙宁娜主题面板">'
      + '<img src="' + ROUTE + '/assets/emblem.svg" alt=""></button>'
      + '<div class="dual"><div class="panel" role="dialog" aria-modal="false" aria-label="芙宁娜主题设置">'
      + controlsMarkup()
      + '</div></div>'
    doc.body.appendChild(switcherHost)

    panel = shadow.querySelector('.dual')
    wireControls(shadow, function closePanel() { setPanelOpen(false) })

    shadow.querySelector('.fl').addEventListener('click', function (event) {
      event.stopPropagation()
      setPanelOpen(!panelOpen)
    })

    // Clicking the dimmed area (outside the panel) closes it.
    panel.addEventListener('pointerdown', function (event) {
      if (event.target === panel) setPanelOpen(false)
    })
    return switcherHost
  }

  function revealFallback(show) {
    fallbackRevealed = show === true
    if (switcherHost === null) return
    switcherHost.setAttribute('data-furina-fallback', fallbackRevealed ? '1' : '0')
    if (!fallbackRevealed && panelOpen) setPanelOpen(false)
  }

  function setPanelOpen(next) {
    panelOpen = next === true
    if (panel === null) return
    panel.classList.toggle('on', panelOpen)
    var launcher = shadow.querySelector('.fl')
    if (launcher !== null) launcher.setAttribute('aria-expanded', String(panelOpen))
  }

  /* ------------------------------------------------------- render + setters */

  function syncControls(root) {
    if (root === null) return
    var skinButtons = root.querySelectorAll('[data-skin]')
    for (var i = 0; i < skinButtons.length; i += 1) {
      var id = skinButtons[i].getAttribute('data-skin')
      skinButtons[i].setAttribute('aria-pressed', String(id === state.skin))
    }
    var wallButtons = root.querySelectorAll('[data-wall]')
    for (var j = 0; j < wallButtons.length; j += 1) {
      var wid = wallButtons[j].getAttribute('data-wall')
      wallButtons[j].setAttribute('aria-pressed', String(wid === state.wallpaper))
    }
    var customButtons = root.querySelectorAll('[data-custom-wall]')
    for (var k = 0; k < customButtons.length; k += 1) {
      customButtons[k].setAttribute('aria-pressed', String(state.wallpaper === 'custom'))
    }
    var glassButtons = root.querySelectorAll('[data-glass]')
    for (var m = 0; m < glassButtons.length; m += 1) {
      var gid = glassButtons[m].getAttribute('data-glass')
      glassButtons[m].setAttribute('aria-pressed', String(gid === state.glass))
    }
    var grainButtons = root.querySelectorAll('[data-grain]')
    for (var n = 0; n < grainButtons.length; n += 1) {
      grainButtons[n].setAttribute('aria-pressed', String(grainButtons[n].getAttribute('data-grain') === state.grain))
    }
  }

  function render() {
    var html = doc.documentElement
    html.setAttribute('data-furina-skin', state.skin)
    html.setAttribute('data-furina-wallpaper', state.wallpaper)
    html.setAttribute('data-furina-glass', state.glass)
    html.setAttribute('data-furina-grain', state.grain)

    syncControls(shadow)
    syncControls(settingsPaneShadow)
  }

  function commit(next) {
    state = next
    writeSettings(state)
    render()
    paintWallpaper()
  }

  function setSkin(id) {
    if (byId(SKINS, id) === null) return
    commit({ skin: id, wallpaper: state.wallpaper, glass: state.glass, grain: state.grain, customSrc: state.customSrc })
  }

  function setWallpaper(id) {
    if (id === 'custom' && state.customSrc === null) return
    commit({ skin: state.skin, wallpaper: id, glass: state.glass, grain: state.grain, customSrc: state.customSrc })
  }

  function setGlass(id) {
    if (byId(GLASS_MODES, id) === null) return
    commit({ skin: state.skin, wallpaper: state.wallpaper, glass: id, grain: state.grain, customSrc: state.customSrc })
  }

  function setGrain(id) {
    if (byId(GRAIN_MODES, id) === null) return
    commit({ skin: state.skin, wallpaper: state.wallpaper, glass: state.glass, grain: id, customSrc: state.customSrc })
  }

  function refreshWallpapers() {
    var roots = [shadow, settingsPaneShadow]
    for (var i = 0; i < roots.length; i += 1) {
      if (roots[i] === null) continue
      var walls = roots[i].querySelector('.walls')
      if (walls !== null) walls.innerHTML = wallpaperMarkup()
    }
    render()
  }

  function loadCustomWallpapers() {
    var request = new XMLHttpRequest()
    request.open('GET', ROUTE + '/wallpapers', true)
    request.onreadystatechange = function () {
      if (request.readyState !== 4) return
      if (request.status !== 200) return
      try {
        var parsed = JSON.parse(request.responseText)
        if (parsed === null || typeof parsed !== 'object' || !Array.isArray(parsed.files)) return
        customWallpapers = []
        for (var i = 0; i < parsed.files.length; i += 1) {
          var entry = parsed.files[i]
          if (entry !== null && typeof entry === 'object' && typeof entry.name === 'string') {
            customWallpapers.push(entry.name)
          }
        }
        if (customWallpapers.length > 0) refreshWallpapers()
      } catch (error) {
        /* an unparsable listing is simply no custom wallpapers */
      }
    }
    try {
      request.send()
    } catch (error) {
      /* offline host: nothing to list */
    }
  }

  /* ----------------------------------------------------------- startup splash */

  // dsh-startup-screen paints from CSS custom properties declared on
  // #dsh-startup-root (its lib/splash.css). Redefining those names under our
  // skin attribute re-colours the very first paint, before React exists.
  // `!important` is required because splash.js also writes --dsu-accent and
  // --dsu-glitch-* as inline styles on that same element.
  var SPLASH_STYLE_ID = 'furina-startup-skin'

  var SPLASH_CSS = ''
    + "html[data-furina-skin='fontaine-nocturne'] #dsh-startup-root{"
    + '--dsu-bg:#04060f;--dsu-bg-2:#0b1433;--dsu-ink:#eef4ff;--dsu-ink-soft:#c9d8f2;'
    + '--dsu-muted:#8ba0c7;--dsu-hair:rgba(126,168,255,.22);--dsu-hair-soft:rgba(126,168,255,.10);'
    + '--dsu-box-bg:#eef4ff;--dsu-box-ink:#04060f;--dsu-sub-glow:0 0 6px rgba(238,244,255,.9);'
    + '--fr-splash-wash:#0b1830;--fr-splash-black:#01030a;'
    + '--dsu-accent:#4ea4ef!important;--dsu-glitch-a:#f26d78!important;--dsu-glitch-b:#2d3c81!important;'
    + 'background:#02040c!important;color-scheme:dark}'
    // The plate also carries the skin's wallpaper, softly veiled so the splash
    // text keeps its contrast. This is the only place the theme touches the
    // startup package: plain CSS custom properties + overridable paint layers.
    + "html[data-furina-skin='fontaine-nocturne'] #dsh-startup-root .dsu-plate{background:"
    + 'linear-gradient(180deg,color-mix(in srgb,#04060f 80%,transparent) 0%,'
    + 'color-mix(in srgb,#04060f 92%,transparent) 100%),'
    + 'radial-gradient(120% 90% at 78% 12%,rgba(78,164,239,.20),transparent 56%),'
    + "url('" + ROUTE + "/assets/wallpapers/furina-01-city-noir.jpg')!important;"
    + 'background-size:cover!important;background-position:center!important;'
    + 'background-repeat:no-repeat!important}'
    + "html[data-furina-skin='hydro-iris'] #dsh-startup-root{"
    + '--dsu-bg:#01030a;--dsu-bg-2:#062033;--dsu-ink:#eaf7ff;--dsu-ink-soft:#bfe0f2;'
    + '--dsu-muted:#7ea8c2;--dsu-hair:rgba(120,220,255,.24);--dsu-hair-soft:rgba(120,220,255,.10);'
    + '--dsu-box-bg:#eaf7ff;--dsu-box-ink:#01030a;--dsu-sub-glow:0 0 6px rgba(234,247,255,.9);'
    + '--fr-splash-wash:#062536;--fr-splash-black:#000206;'
    + '--dsu-accent:#5fb4ff!important;--dsu-glitch-a:#8fe8ff!important;--dsu-glitch-b:#243a86!important;'
    + 'background:#000308!important;color-scheme:dark}'
    + "html[data-furina-skin='hydro-iris'] #dsh-startup-root .dsu-plate{background:"
    + 'linear-gradient(180deg,color-mix(in srgb,#01030a 78%,transparent) 0%,'
    + 'color-mix(in srgb,#01030a 91%,transparent) 100%),'
    + 'radial-gradient(120% 90% at 76% 10%,rgba(95,180,255,.22),transparent 56%),'
    + "url('" + ROUTE + "/assets/wallpapers/furina-02-hydro-iris.jpg')!important;"
    + 'background-size:cover!important;background-position:center!important;'
    + 'background-repeat:no-repeat!important}'
    + "html[data-furina-skin='salon-solitude'] #dsh-startup-root{"
    + '--dsu-bg:#0c0f1b;--dsu-bg-2:#241a2b;--dsu-ink:#fff2ea;--dsu-ink-soft:#e6d0c6;'
    + '--dsu-muted:#b49a90;--dsu-hair:rgba(240,200,185,.24);--dsu-hair-soft:rgba(240,200,185,.11);'
    + '--dsu-box-bg:#fff2ea;--dsu-box-ink:#0c0f1b;--dsu-sub-glow:0 0 6px rgba(255,242,234,.9);'
    + '--fr-splash-wash:#2a1d33;--fr-splash-black:#06070d;'
    + '--dsu-accent:#dea998!important;--dsu-glitch-a:#c79bd6!important;--dsu-glitch-b:#3a3f63!important;'
    + 'background:#080912!important;color-scheme:dark}'
    + "html[data-furina-skin='salon-solitude'] #dsh-startup-root .dsu-plate{background:"
    + 'linear-gradient(180deg,color-mix(in srgb,#0c0f1b 78%,transparent) 0%,'
    + 'color-mix(in srgb,#0c0f1b 92%,transparent) 100%),'
    + 'radial-gradient(120% 90% at 78% 12%,rgba(222,169,152,.20),transparent 58%),'
    + "url('" + ROUTE + "/assets/wallpapers/furina-03-salon-solitude.jpg')!important;"
    + 'background-size:cover!important;background-position:center!important;'
    + 'background-repeat:no-repeat!important}'
    // The transition layers are hard-coded light greys/whites in splash.css
    // (.dsu-wash #8b8a88, .dsu-flash #fff, .dsu-bloom white, .dsu-black #000).
    // They cover the whole viewport mid-sequence, so without these the themed
    // plates would still read as a white splash.
    + 'html[data-furina-skin] #dsh-startup-root .dsu-wash{background:var(--fr-splash-wash)!important}'
    + 'html[data-furina-skin] #dsh-startup-root .dsu-black{background:var(--fr-splash-black)!important}'
    + 'html[data-furina-skin] #dsh-startup-root .dsu-flash{background:var(--dsu-accent)!important}'
    // The faint archive panels behind the plate are separate .dsu-wm blocks
    // painted with a white gradient; tint them instead of the container.
    + 'html[data-furina-skin] #dsh-startup-root .dsu-wm{'
    + 'background:linear-gradient(180deg,color-mix(in srgb,var(--dsu-accent) 22%,transparent),'
    + 'color-mix(in srgb,var(--dsu-accent) 3%,transparent))!important;'
    + 'border-color:color-mix(in srgb,var(--dsu-accent) 32%,transparent)!important}'
    + 'html[data-furina-skin] #dsh-startup-root .dsu-bloom{background:'
    + 'radial-gradient(circle,color-mix(in srgb,var(--dsu-accent) 90%,#fff) 0%,'
    + 'color-mix(in srgb,var(--dsu-accent) 45%,transparent) 30%,transparent 74%)!important}'
    // The ID line is an annotation for the right archive column. The original
    // sequence puts its leading dot on the right-hand third line, not against
    // the viewport edge and not across the headline.
    + 'html[data-furina-skin] #dsh-startup-root .dsu-idline{'
    + 'left:max(69.666vw,calc(50% + 280px))!important;right:auto!important;top:49%!important;'
    + 'transform:translateY(-50%)!important;text-align:left!important;'
    + 'font-size:11px!important;letter-spacing:0.16em!important}'
    + 'html[data-furina-skin] #dsh-startup-root .dsu-idline.dsu-in{transform:translateY(-50%)!important}'
    // The whale/dots indicator only exists on some steps. In the stock flex
    // stack it changes the height of the centred block and drags the hairline
    // up on those steps; take it out of flow so the rule sits on one line for
    // every step of the sequence.
    + 'html[data-furina-skin] #dsh-startup-root .dsu-logo{position:absolute!important;'
    + 'left:50%!important;transform:translateX(-50%)!important;top:calc(100% + 26px)!important;'
    + 'margin-top:0!important}'
    + 'html[data-furina-skin] #dsh-startup-root .dsu-dots{position:absolute!important;'
    + 'left:50%!important;transform:translateX(-50%)!important;top:calc(100% + 96px)!important;'
    + 'margin-top:0!important}'
    // While the splash owns the screen, keep the app shell (composer, transcript,
    // toasts, footer status and our own widgets) completely out of the frame.
    // splash.js owns `html.dsu-lock` and removes it when the sequence ends.
    + 'html.dsu-lock body > *:not(#dsh-startup-root):not(#furina-backdrop){visibility:hidden!important}'

  function ensureSplashStyles() {
    var head = doc.head || doc.documentElement
    if (head === null) return
    if (doc.getElementById(SPLASH_STYLE_ID) !== null) return
    var style = doc.createElement('style')
    style.id = SPLASH_STYLE_ID
    style.setAttribute('data-furina-splash', '1')
    style.textContent = SPLASH_CSS
    head.appendChild(style)
  }

  /* ------------------------------------------------------------ settings page */

  var SETTINGS_DIALOG_SELECTOR = '[role="dialog"][data-shortcut-modal="settings"]'
  var SETTINGS_PANE_ATTR = 'data-furina-settings-pane'
  var SETTINGS_NAV_ATTR = 'data-furina-settings-nav'

  var settingsDialog = null
  var settingsPane = null
  var settingsPaneShadow = null
  var settingsNavList = null
  var settingsOpen = false
  var settingsSeen = false
  var activeNavClass = null

  function findSettingsDialog() {
    var list = doc.querySelectorAll(SETTINGS_DIALOG_SELECTOR)
    for (var i = list.length - 1; i >= 0; i -= 1) if (list[i].isConnected) return list[i]
    return null
  }

  // The modal's nav column: `nav.VOzbGW_nav` > `div.VOzbGW_navList`. Class names
  // are build-hashed, so match on structure and on the *List suffix instead.
  function navListOf(dialog) {
    var nav = dialog.querySelector('nav')
    if (nav === null) return null
    return nav.querySelector('[class*="navList"]') || nav
  }

  function optionsOf(dialog) {
    var content = dialog.querySelector('[class*="content"]')
    if (content !== null) {
      var inside = content.querySelector('[class*="options"]')
      if (inside !== null) return inside
    }
    return dialog.querySelector('[class*="options"]')
  }

  function buildNavCell(dialog, list) {
    if (list.querySelector('[' + SETTINGS_NAV_ATTR + ']') !== null) return
    var buttons = list.querySelectorAll('button')
    var template = null
    for (var i = 0; i < buttons.length; i += 1) {
      if (buttons[i].getAttribute(SETTINGS_NAV_ATTR) === null) {
        template = buttons[i]
        break
      }
    }
    var cell = null
    if (template !== null) {
      // Cloning an existing row keeps every build-hashed class, icon slot and
      // hover/active treatment the app owns; only the content is replaced.
      cell = template.cloneNode(true)
      var droppable = ['aria-current', 'data-modal-autofocus', 'data-dsh-automatic-focus', 'id', 'tabindex']
      for (var j = 0; j < droppable.length; j += 1) cell.removeAttribute(droppable[j])

      var tokens = (cell.getAttribute('class') || '').split(/\s+/)
      var kept = []
      for (var k = 0; k < tokens.length; k += 1) {
        if (tokens[k] === '') continue
        if (/active/i.test(tokens[k])) {
          if (activeNavClass === null) activeNavClass = tokens[k]
          continue
        }
        kept.push(tokens[k])
      }
      if (kept.length > 0) cell.setAttribute('class', kept.join(' '))
      else cell.removeAttribute('class')

      var glyph = cell.querySelector('svg')
      if (glyph !== null) {
        glyph.innerHTML = '<path fill="currentColor" d="M8 1.6l1.9 4.1 4.5.6-3.3 3.2.8 4.5L8 12l-4 2 .8-4.5L1.5 6.3l4.5-.6z"></path>'
      }
      var label = cell.querySelector('[class*="navLabel"]') || cell.lastElementChild
      if (label !== null) label.textContent = '芙宁娜主题'
    } else {
      cell = doc.createElement('button')
      cell.type = 'button'
      cell.className = 'VOzbGW_navCell'
      cell.innerHTML = '<span class="VOzbGW_navLabel">芙宁娜主题</span>'
    }
    cell.setAttribute(SETTINGS_NAV_ATTR, '1')
    cell.setAttribute('title', '芙宁娜主题 · Furina theme')
    list.appendChild(cell)
  }

  function navClick(event) {
    var target = event.target
    if (target === null || target.closest === undefined) return
    var button = target.closest('button')
    if (button === null) return
    if (button.getAttribute(SETTINGS_NAV_ATTR) !== null) {
      event.preventDefault()
      event.stopPropagation()
      setSettingsOpen(true)
      return
    }
    setSettingsOpen(false)
  }

  function buildPane(dialog) {
    var existing = doc.querySelector('[' + SETTINGS_PANE_ATTR + ']')
    if (existing !== null) {
      settingsPane = existing
      settingsPaneShadow = existing.shadowRoot
      return existing
    }
    var host = doc.createElement('div')
    host.setAttribute(SETTINGS_PANE_ATTR, '1')
    host.id = 'furina-settings-pane'
    host.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%;z-index:12;'
      + 'overflow:auto;overscroll-behavior:contain;display:none;'
    settingsPaneShadow = host.attachShadow({ mode: 'open' })
    settingsPaneShadow.innerHTML = ''
      + '<style>' + SWITCHER_CSS + '</style>'
      + '<div class="panel embed" role="region" aria-label="芙宁娜主题设置">'
      + controlsMarkup()
      + '</div>'
    dialog.appendChild(host)
    wireControls(settingsPaneShadow, function closePane() { setSettingsOpen(false) })
    return host
  }

  // The pane sits exactly on top of the area the dialog devotes to a section,
  // so the nav column and the dialog title stay visible while it is open. The
  // section column is display:none while the pane is open, so the geometry has
  // to come from its always-visible parent plus the content header.
  function positionPane() {
    if (settingsPane === null || settingsDialog === null) return
    var panelRect = settingsDialog.getBoundingClientRect()
    if (panelRect.width < 1) return
    var content = settingsDialog.querySelector('[class*="content"]')
    var base = content !== null ? content : settingsDialog
    var rect = base.getBoundingClientRect()
    if (rect.width < 1 || rect.height < 1) return
    var offset = 0
    var header = content !== null ? content.querySelector('[class*="header"]') : null
    if (header !== null) {
      var headerRect = header.getBoundingClientRect()
      if (headerRect.height > 0) offset = headerRect.height
    }
    var top = rect.top - panelRect.top + offset
    var height = Math.max(0, rect.height - offset)
    // Never spill past the dialog's own bottom edge (the content column can be
    // taller than the visible panel when a section scrolls).
    var maxHeight = panelRect.height - top
    if (maxHeight > 0 && height > maxHeight) height = maxHeight
    settingsPane.style.left = (rect.left - panelRect.left) + 'px'
    settingsPane.style.top = top + 'px'
    settingsPane.style.width = rect.width + 'px'
    settingsPane.style.height = height + 'px'
  }

  function setSettingsOpen(next) {
    var open = next === true
    if (settingsDialog === null || settingsPane === null) {
      settingsOpen = open
      return
    }
    settingsOpen = open
    // Measure while the section area still has a layout box: display:none on
    // the options column would make the pane's rectangle 0×0.
    positionPane()
    var options = optionsOf(settingsDialog)
    if (options !== null) options.style.display = open ? 'none' : ''
    settingsPane.style.display = open ? 'block' : 'none'

    var ours = settingsDialog.querySelectorAll('[' + SETTINGS_NAV_ATTR + ']')
    for (var i = 0; i < ours.length; i += 1) {
      var cell = ours[i]
      if (open) {
        cell.setAttribute('aria-current', 'true')
        if (activeNavClass !== null) cell.classList.add(activeNavClass)
        cell.style.background = 'color-mix(in srgb, var(--fr-accent) 16%, transparent)'
        cell.style.color = 'var(--fr-text)'
        cell.style.boxShadow = 'inset 0 0 0 1px color-mix(in srgb, var(--fr-accent) 34%, transparent)'
      } else {
        cell.removeAttribute('aria-current')
        if (activeNavClass !== null) cell.classList.remove(activeNavClass)
        cell.style.background = ''
        cell.style.color = ''
        cell.style.boxShadow = ''
      }
    }
    if (open) {
      syncControls(settingsPaneShadow)
      window.setTimeout(positionPane, 60)
    }
  }

  function ensureSettings() {
    var dialog = findSettingsDialog()
    if (dialog === null) {
      if (settingsDialog !== null && !settingsDialog.isConnected) {
        settingsDialog = null
        settingsPane = null
        settingsPaneShadow = null
        settingsNavList = null
        settingsOpen = false
      }
      return null
    }
    settingsDialog = dialog
    if (!settingsSeen) {
      settingsSeen = true
      revealFallback(false)
    }
    var list = navListOf(dialog)
    if (list !== null) {
      buildNavCell(dialog, list)
      if (settingsNavList !== list) {
        settingsNavList = list
        // Capture phase: land on our row before React's delegated handler runs.
        list.addEventListener('click', navClick, true)
      }
    }
    if (settingsPane === null || !settingsPane.isConnected) settingsPane = buildPane(dialog)
    if (settingsOpen) setSettingsOpen(true)
    return dialog
  }

  /* ----------------------------------------------------------------- keyboard */

  function onKeyDown(event) {
    if (event.ctrlKey && event.shiftKey && (event.key === 'U' || event.key === 'u')) {
      event.preventDefault()
      setPanelOpen(!panelOpen)
      return
    }
    if (event.key === 'Escape') {
      if (panelOpen) setPanelOpen(false)
      if (settingsOpen) setSettingsOpen(false)
    }
  }

  /* ------------------------------------------------------------- shell theme mode */

  // The application's own theme presenter owns the same attributes and may
  // rewrite them from the user's stored preference, so this is re-asserted on
  // mutation and again by reconcile(). Every write is guarded by a read, which
  // keeps it idempotent and means the observer cannot trigger itself forever.
  function assertDarkMode() {
    var html = doc.documentElement
    if (html === null) return
    if (html.style.colorScheme !== 'dark') html.style.colorScheme = 'dark'
    if (html.getAttribute(SOURCE_ATTRIBUTE) !== 'dark') html.setAttribute(SOURCE_ATTRIBUTE, 'dark')
    if (doc.body !== null && !doc.body.hasAttribute(DARK_ATTRIBUTE)) doc.body.setAttribute(DARK_ATTRIBUTE, '')
  }

  var darkGuard = null

  function startDarkGuard() {
    if (darkGuard !== null) return
    darkGuard = new MutationObserver(function onattribute() {
      assertDarkMode()
    })
    darkGuard.observe(doc.documentElement, {
      attributes: true,
      attributeFilter: ['style', SOURCE_ATTRIBUTE, 'color-scheme'],
    })
    if (doc.body !== null) {
      darkGuard.observe(doc.body, { attributes: true, attributeFilter: [DARK_ATTRIBUTE] })
    }
  }

  /* ------------------------------------------------------------- reconciliation */

  var reconcileTimer = null

  function reconcile() {
    if (doc.body === null) return
    assertDarkMode()
    if (backdrop === null || !backdrop.isConnected) {
      ensureBackdrop()
      paintWallpaper()
    }
    if (switcherHost === null || !switcherHost.isConnected) {
      ensureSwitcher()
      render()
    }
    ensureSettings()
  }

  function scheduleReconcile() {
    if (reconcileTimer !== null) return
    reconcileTimer = window.setTimeout(function () {
      reconcileTimer = null
      reconcile()
    }, 180)
  }

  function touchesSettings(node) {
    if (node === null || node === undefined || node.nodeType !== 1) return false
    if (node.querySelector === undefined) return false
    return node.matches(SETTINGS_DIALOG_SELECTOR) || node.querySelector(SETTINGS_DIALOG_SELECTOR) !== null
  }

  var observer = null

  function startObserver() {
    if (observer !== null || doc.body === null) return
    observer = new MutationObserver(function (records) {
      for (var i = 0; i < records.length; i += 1) {
        var record = records[i]
        for (var j = 0; j < record.removedNodes.length; j += 1) {
          var node = record.removedNodes[j]
          if (node === backdrop || node === switcherHost) {
            scheduleReconcile()
            return
          }
          if (node.nodeType === 1 && node.querySelector !== undefined) {
            if (node.querySelector('#furina-backdrop') !== null || node.querySelector('#furina-switcher') !== null) {
              scheduleReconcile()
              return
            }
          }
        }
        for (var k = 0; k < record.addedNodes.length; k += 1) {
          if (touchesSettings(record.addedNodes[k])) {
            scheduleReconcile()
            return
          }
        }
      }
    })
    observer.observe(doc.body, { childList: true, subtree: true })
  }

  /* ------------------------------------------------------------------- boot */

  function boot() {
    ensureSheet()
    ensureSplashStyles()
    assertDarkMode()
    startDarkGuard()
    ensureBackdrop()
    ensureSwitcher()
    render()
    paintWallpaper()
    loadCustomWallpapers()
    startObserver()
    ensureSettings()
    doc.documentElement.removeAttribute('data-furina-boot')

    // The settings page is the primary surface; the pill only appears when the
    // shell never produced its settings launcher (older/cut-down builds).
    window.setTimeout(function () {
      if (settingsSeen || fallbackRevealed) return
      var launcher = doc.querySelector('[data-slot="settings.launcher"]')
      revealFallback(launcher === null)
    }, 1600)

    window.addEventListener('keydown', onKeyDown, true)
    window.addEventListener('resize', function () {
      if (settingsOpen) positionPane()
    })
    window.addEventListener('storage', function (event) {
      if (event.key !== STORAGE_KEY) return
      state = readSettings()
      render()
      paintWallpaper()
    })
  }

  window.__furinaTheme = {
    version: VERSION,
    skins: SKINS.map(function (skin) { return skin.id }),
    wallpapers: WALLPAPERS.map(function (wallpaper) { return wallpaper.id }),
    get state() {
      return {
        skin: state.skin,
        wallpaper: state.wallpaper,
        glass: state.glass,
        custom: state.customSrc !== null,
      }
    },
    get mounted() {
      return {
        sheet: doc.querySelector('link[' + SCRIPT_TAG + ']') !== null
          || doc.querySelector('link[href="' + sheetHref() + '"]') !== null,
        backdrop: backdrop !== null && backdrop.isConnected,
        switcher: switcherHost !== null && switcherHost.isConnected,
        skin: doc.documentElement.getAttribute('data-furina-skin'),
      }
    },
    get settings() {
      return {
        seen: settingsSeen,
        pane: settingsPane !== null && settingsPane.isConnected,
        open: settingsOpen,
        fallback: fallbackRevealed,
      }
    },
    setSkin: setSkin,
    setWallpaper: setWallpaper,
    setGlass: setGlass,
    openPanel: function (open) { setPanelOpen(open !== false) },
    openSettings: function () {
      ensureSettings()
      setSettingsOpen(true)
    },
    closeSettings: function () { setSettingsOpen(false) },
    revealFallback: revealFallback,
    reset: function () {
      state = {
        skin: DEFAULTS.skin,
        wallpaper: DEFAULTS.wallpaper,
        glass: DEFAULTS.glass,
        grain: DEFAULTS.grain,
        customSrc: null,
      }
      writeSettings(state)
      render()
      paintWallpaper()
      refreshWallpapers()
    },
    remount: function () {
      if (backdrop !== null && backdrop.isConnected) backdrop.remove()
      if (switcherHost !== null && switcherHost.isConnected) switcherHost.remove()
      backdrop = null
      switcherHost = null
      shadow = null
      panel = null
      reconcile()
    },
  }

  if (doc.readyState === 'loading') {
    doc.addEventListener('DOMContentLoaded', boot, { once: true })
  } else {
    boot()
  }

  // The script is injected at the end of <body>, so both elements exist here:
  // assert before the first paint rather than waiting for DOMContentLoaded.
  assertDarkMode()
})()
