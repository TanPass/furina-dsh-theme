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
 *   #furina-switcher   fixed panel in a shadow root — free skin switching, free
 *                      wallpaper switching and a glass-strength control.
 *
 * State is three strings in localStorage. Nothing here talks to the host at
 * runtime except one optional fetch of the user's own wallpaper folder, and
 * that fetch failing only costs the custom entries.
 */
(function () {
  'use strict'

  if (window.__furinaTheme) return

  var doc = document
  var VERSION = '1.0.0'
  var ROUTE = '/furina-theme'
  var STORAGE_KEY = 'furina-theme.settings.v1'
  var SCRIPT_TAG = 'data-furina-theme'

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

  var DEFAULTS = { skin: 'fontaine-nocturne', wallpaper: 'auto', glass: 'standard' }
  var WALLPAPER_CHOICES = [{ id: 'auto', zh: '跟随皮肤' }, { id: 'none', zh: '无壁纸' }].concat(
    WALLPAPERS.map(function (w) { return { id: w.id, zh: w.zh } }),
  )

  function byId(list, id) {
    for (var i = 0; i < list.length; i += 1) if (list[i].id === id) return list[i]
    return null
  }

  function readSettings() {
    var next = { skin: DEFAULTS.skin, wallpaper: DEFAULTS.wallpaper, glass: DEFAULTS.glass }
    try {
      var raw = window.localStorage.getItem(STORAGE_KEY)
      if (raw === null) return next
      var parsed = JSON.parse(raw)
      if (parsed === null || typeof parsed !== 'object') return next
      if (typeof parsed.skin === 'string' && byId(SKINS, parsed.skin) !== null) next.skin = parsed.skin
      if (typeof parsed.wallpaper === 'string' && parsed.wallpaper !== '') next.wallpaper = parsed.wallpaper
      if (typeof parsed.glass === 'string' && byId(GLASS_MODES, parsed.glass) !== null) next.glass = parsed.glass
    } catch (error) {
      /* corrupt or unavailable storage: defaults are a valid answer */
    }
    return next
  }

  function writeSettings(settings) {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
    } catch (error) {
      /* private mode: the theme still works for this page load */
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

  /* --------------------------------------------------------------- switcher */

  var switcherHost = null
  var shadow = null
  var panel = null
  var panelOpen = false

  var SWITCHER_CSS = ''
    + ':host{all:initial}'
    + '*,*::before,*::after{box-sizing:border-box}'
    // Bottom-right, but lifted clear of the pet widget's corner so neither covers the
    // other; the composer's send button sits further left and is never touched.
    + '.fl{position:fixed;right:20px;bottom:196px;z-index:2147481200;width:52px;height:52px;'
    + 'padding:0;border-radius:50%;border:1px solid var(--fr-glass-border,rgba(255,255,255,.22));'
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
    + 'border:1px solid var(--fr-glass-border,rgba(255,255,255,.16));'
    + 'box-shadow:0 24px 60px rgba(0,0,0,.62),0 0 0 1px rgba(255,255,255,.04) inset;'
    + 'backdrop-filter:blur(22px) saturate(140%);font:13px/1.45 "Segoe UI","Microsoft YaHei",system-ui,sans-serif}'
    + '.panel::-webkit-scrollbar{width:8px}'
    + '.panel::-webkit-scrollbar-thumb{border-radius:8px;background:var(--fr-scrollbar,rgba(78,164,239,.28))}'
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
    + '.glass{display:grid;grid-template-columns:repeat(3,1fr);gap:7px}'
    + '.glass button{padding:7px 4px;border-radius:9px;cursor:pointer;color:inherit;font-size:11.5px;letter-spacing:.04em;'
    + 'background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.1);transition:all .18s}'
    + '.glass button:hover{background:rgba(255,255,255,.08)}'
    + '.glass button[aria-pressed="true"]{border-color:var(--fr-accent,#4ea4ef);background:var(--fr-accent-14,rgba(78,164,239,.16));'
    + 'box-shadow:0 0 0 1px var(--fr-accent-45,rgba(78,164,239,.45)) inset}'
    + '.ft{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:14px;'
    + 'padding-top:10px;border-top:1px solid var(--fr-line,rgba(255,255,255,.1));font-size:10.5px;opacity:.6}'
    + '.rst{padding:4px 9px;border-radius:8px;cursor:pointer;color:inherit;font-size:10.5px;'
    + 'background:transparent;border:1px solid var(--fr-line,rgba(255,255,255,.16));opacity:.85}'
    + '.rst:hover{opacity:1;background:rgba(255,255,255,.08)}'
    + 'kbd{font:inherit;font-size:10px;padding:1px 4px;border-radius:4px;border:1px solid rgba(255,255,255,.2);'
    + 'background:rgba(255,255,255,.06)}'
    + '@media (prefers-reduced-motion:reduce){.fl,.panel,.skin,.wall img{transition:none!important}}'

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

  function ensureSwitcher() {
    if (switcherHost !== null && switcherHost.isConnected) return switcherHost
    if (doc.body === null) return null

    switcherHost = doc.createElement('div')
    switcherHost.id = 'furina-switcher'
    shadow = switcherHost.attachShadow({ mode: 'open' })
    shadow.innerHTML = ''
      + '<style>' + SWITCHER_CSS + '</style>'
      + '<button class="fl" part="launcher" title="芙宁娜主题 · Furina theme (Ctrl+Shift+U)" aria-label="打开芙宁娜主题面板">'
      + '<img src="' + ROUTE + '/assets/emblem.svg" alt=""></button>'
      + '<div class="dual"><div class="panel" role="dialog" aria-modal="false" aria-label="芙宁娜主题设置">'
      + '<div class="hd"><img src="' + ROUTE + '/assets/emblem.svg" alt="">'
      + '<div class="tt"><h1>芙宁娜</h1><p>Furina · Fontaine</p></div>'
      + '<button class="x" aria-label="关闭">×</button></div>'
      + '<h2>皮肤 · Skin</h2><div class="skins">' + skinMarkup() + '</div>'
      + '<h2>壁纸 · Wallpaper</h2><div class="walls">' + wallpaperMarkup() + '</div>'
      + '<h2>玻璃 · Glass</h2><div class="glass">' + glassMarkup() + '</div>'
      + '<div class="ft"><button class="rst">恢复默认</button><span>v' + VERSION + ' · <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>U</kbd></span></div>'
      + '</div></div>'
    doc.body.appendChild(switcherHost)

    panel = shadow.querySelector('.dual')

    shadow.querySelector('.fl').addEventListener('click', function (event) {
      event.stopPropagation()
      setPanelOpen(!panelOpen)
    })
    shadow.querySelector('.x').addEventListener('click', function () { setPanelOpen(false) })
    shadow.querySelector('.rst').addEventListener('click', function () {
      state = { skin: DEFAULTS.skin, wallpaper: DEFAULTS.wallpaper, glass: DEFAULTS.glass }
      writeSettings(state)
      render()
      refreshWallpapers()
    })

    shadow.querySelector('.skins').addEventListener('click', function (event) {
      var button = event.target.closest('[data-skin]')
      if (button === null) return
      setSkin(button.getAttribute('data-skin'))
    })
    shadow.querySelector('.walls').addEventListener('click', function (event) {
      var button = event.target.closest('[data-wall]')
      if (button === null) return
      setWallpaper(button.getAttribute('data-wall'))
    })
    shadow.querySelector('.glass').addEventListener('click', function (event) {
      var button = event.target.closest('[data-glass]')
      if (button === null) return
      setGlass(button.getAttribute('data-glass'))
    })

    // Clicking the wallpaper area (outside the panel) closes it.
    panel.addEventListener('pointerdown', function (event) {
      if (event.target === panel) setPanelOpen(false)
    })
    return switcherHost
  }

  function setPanelOpen(next) {
    panelOpen = next === true
    if (panel === null) return
    panel.classList.toggle('on', panelOpen)
    var launcher = shadow.querySelector('.fl')
    if (launcher !== null) launcher.setAttribute('aria-expanded', String(panelOpen))
  }

  function render() {
    var html = doc.documentElement
    html.setAttribute('data-furina-skin', state.skin)
    html.setAttribute('data-furina-wallpaper', state.wallpaper)
    html.setAttribute('data-furina-glass', state.glass)

    if (shadow !== null) {
      var skinButtons = shadow.querySelectorAll('[data-skin]')
      for (var i = 0; i < skinButtons.length; i += 1) {
        var id = skinButtons[i].getAttribute('data-skin')
        skinButtons[i].setAttribute('aria-pressed', String(id === state.skin))
      }
      var wallButtons = shadow.querySelectorAll('[data-wall]')
      for (var j = 0; j < wallButtons.length; j += 1) {
        var wid = wallButtons[j].getAttribute('data-wall')
        wallButtons[j].setAttribute('aria-pressed', String(wid === state.wallpaper))
      }
      var glassButtons = shadow.querySelectorAll('[data-glass]')
      for (var k = 0; k < glassButtons.length; k += 1) {
        var gid = glassButtons[k].getAttribute('data-glass')
        glassButtons[k].setAttribute('aria-pressed', String(gid === state.glass))
      }
    }
  }

  function commit(next) {
    state = next
    writeSettings(state)
    render()
    paintWallpaper()
  }

  function setSkin(id) {
    if (byId(SKINS, id) === null) return
    commit({ skin: id, wallpaper: state.wallpaper, glass: state.glass })
  }

  function setWallpaper(id) {
    commit({ skin: state.skin, wallpaper: id, glass: state.glass })
  }

  function setGlass(id) {
    if (byId(GLASS_MODES, id) === null) return
    commit({ skin: state.skin, wallpaper: state.wallpaper, glass: id })
  }

  function refreshWallpapers() {
    if (shadow === null) return
    var walls = shadow.querySelector('.walls')
    if (walls === null) return
    walls.innerHTML = wallpaperMarkup()
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

  /* --------------------------------------------------------------- keyboard */

  function onKeyDown(event) {
    if (event.ctrlKey && event.shiftKey && (event.key === 'U' || event.key === 'u')) {
      event.preventDefault()
      setPanelOpen(!panelOpen)
      return
    }
    if (event.key === 'Escape' && panelOpen) setPanelOpen(false)
  }

  /* ------------------------------------------------------------- reconciliation */

  var reconcileTimer = null

  function reconcile() {
    if (doc.body === null) return
    if (backdrop === null || !backdrop.isConnected) {
      ensureBackdrop()
      paintWallpaper()
    }
    if (switcherHost === null || !switcherHost.isConnected) {
      ensureSwitcher()
      render()
    }
  }

  function scheduleReconcile() {
    if (reconcileTimer !== null) return
    reconcileTimer = window.setTimeout(function () {
      reconcileTimer = null
      reconcile()
    }, 180)
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
      }
    })
    observer.observe(doc.body, { childList: true, subtree: true })
  }

  /* ------------------------------------------------------------------- boot */

  function boot() {
    ensureSheet()
    ensureBackdrop()
    ensureSwitcher()
    render()
    paintWallpaper()
    loadCustomWallpapers()
    startObserver()
    doc.documentElement.removeAttribute('data-furina-boot')

    window.addEventListener('keydown', onKeyDown, true)
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
    get state() { return { skin: state.skin, wallpaper: state.wallpaper, glass: state.glass } },
    get mounted() {
      return {
        sheet: doc.querySelector('link[' + SCRIPT_TAG + ']') !== null
          || doc.querySelector('link[href="' + sheetHref() + '"]') !== null,
        backdrop: backdrop !== null && backdrop.isConnected,
        switcher: switcherHost !== null && switcherHost.isConnected,
        skin: doc.documentElement.getAttribute('data-furina-skin'),
      }
    },
    setSkin: setSkin,
    setWallpaper: setWallpaper,
    setGlass: setGlass,
    openPanel: function (open) { setPanelOpen(open !== false) },
    reset: function () {
      state = { skin: DEFAULTS.skin, wallpaper: DEFAULTS.wallpaper, glass: DEFAULTS.glass }
      writeSettings(state)
      render()
      paintWallpaper()
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
})()
