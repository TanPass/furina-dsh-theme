#!/usr/bin/env node
/**
 * verify.mjs — prove the theme is actually mounted and painting, in a real
 * DeepSeek Harness instance, and capture the screenshots the README uses.
 *
 * One browser session is opened, authenticated once with the token URL, and
 * then driven through every skin with `window.__furinaTheme`. Navigating again
 * per shot would burn a token each time (DSH issues single-use login URLs), and
 * would also throw away the app state the screenshots are supposed to show.
 *
 *   node tools/verify.mjs --url "http://127.0.0.1:3081/?token=…" --outdir docs
 *
 * Options:
 *   --url <url>        authenticated DSH URL, token included (required)
 *   --outdir <dir>     where screenshots and verify-report.json go (default docs)
 *   --width/--height   viewport (default 1600×900)
 *   --settle <ms>      settle time per shot (default 2400)
 *   --port <n>         CDP port for the private Edge (default 9418)
 *   --keep-open        leave the browser running for manual inspection
 *
 * Exit code 0 only if every assertion passes and all screenshots were written.
 */

import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const EDGE = process.env.EDGE_EXE
  ?? 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'

const SKINS = [
  { id: 'fontaine-nocturne', file: 'screenshot-fontaine-nocturne.png' },
  { id: 'hydro-iris', file: 'screenshot-hydro-iris.png' },
  { id: 'salon-solitude', file: 'screenshot-salon-solitude.png' },
]

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function parseArgs(argv) {
  const out = { width: 1600, height: 900, settle: 2400, port: 9418, outdir: 'docs', keepOpen: false }
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i]
    const next = () => argv[++i]
    switch (arg) {
      case '--url': out.url = next(); break
      case '--outdir': out.outdir = next(); break
      case '--width': out.width = Number(next()); break
      case '--height': out.height = Number(next()); break
      case '--settle': out.settle = Number(next()); break
      case '--port': out.port = Number(next()); break
      case '--keep-open': out.keepOpen = true; break
      default: throw new Error(`unknown argument ${arg}`)
    }
  }
  if (!out.url) throw new Error('--url is required (the authenticated DSH URL)')
  if (!/\?token=/.test(out.url)) throw new Error('--url must carry the ?token= login parameter')
  return out
}

class CDP {
  constructor(socket) {
    this.socket = socket
    this.nextId = 0
    this.pending = new Map()
    this.events = []
    this.stage = 'boot'
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data)
      if (message.id && this.pending.has(message.id)) {
        const { resolve, reject } = this.pending.get(message.id)
        this.pending.delete(message.id)
        if (message.error) reject(new Error(JSON.stringify(message.error)))
        else resolve(message.result)
      } else if (message.method) {
        this.events.push({ ...message, __stage: this.stage })
      }
    })
  }

  send(method, params = {}) {
    const id = (this.nextId += 1)
    this.socket.send(JSON.stringify({ id, method, params }))
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }))
  }

  async evaluate(expression) {
    const result = await this.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    })
    if (result.exceptionDetails) {
      throw new Error(`page threw: ${result.exceptionDetails.exception?.description ?? result.exceptionDetails.text}`)
    }
    return result.result.value
  }

  async shot(path) {
    const { data } = await this.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
    const bytes = Buffer.from(data, 'base64')
    writeFileSync(path, bytes)
    return bytes.length
  }
}

async function launchEdge(port, width, height) {
  const profile = mkdtempSync(join(tmpdir(), 'furina-verify-'))
  const child = spawn(EDGE, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--hide-scrollbars', '--mute-audio', '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
    `--window-size=${width},${height}`,
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    'about:blank',
  ], { stdio: 'ignore' })

  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`)
      if (response.ok) return child
    } catch { /* not up yet */ }
    await sleep(250)
  }
  throw new Error(`Edge CDP endpoint never came up on ${port}`)
}

async function connect(port) {
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
  const page = targets.find((target) => target.type === 'page')
  if (!page) throw new Error('no page target in Edge')
  const socket = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true })
    socket.addEventListener('error', reject, { once: true })
  })
  return new CDP(socket)
}

/** Wait until the browser half reports itself mounted, or the budget runs out. */
async function waitForMount(cdp, budgetMs = 30000) {
  const deadline = Date.now() + budgetMs
  let last = null
  while (Date.now() < deadline) {
    try {
      last = await cdp.evaluate(`(() => {
        const api = window.__furinaTheme;
        if (!api) return { api: false };
        const mounted = api.mounted;
        return { api: true, mounted, sheetLinks: document.querySelectorAll('link[data-furina-theme]').length };
      })()`)
      if (last?.api && last.mounted?.sheet && last.mounted?.backdrop && last.mounted?.switcher) return { ok: true, ...last }
    } catch { /* app still booting */ }
    await sleep(400)
  }
  return { ok: false, ...(last ?? {}) }
}

const DIAGNOSTICS = `(() => {
  const cs = (el, prop) => (el ? getComputedStyle(el).getPropertyValue(prop).trim() : null);
  const backdrop = document.getElementById('furina-backdrop');
  const layer = backdrop && backdrop.querySelector('.fr-wp.fr-on');
  const firstPanel = document.querySelector("[class*='centerCol']");
  return {
    url: location.href.replace(/token=[^&]+/, 'token=***'),
    title: document.title,
    skin: document.documentElement.getAttribute('data-furina-skin'),
    wallpaper: document.documentElement.getAttribute('data-furina-wallpaper'),
    glass: document.documentElement.getAttribute('data-furina-glass'),
    storage: (() => { try { return localStorage.getItem('furina-theme.settings.v1'); } catch { return null; } })(),
    api: typeof window.__furinaTheme,
    backdropConnected: !!backdrop && backdrop.isConnected,
    backdropZ: cs(backdrop, 'z-index'),
    backdropVisible: !!layer && layer.classList.contains('fr-on'),
    activeWallpaper: layer ? getComputedStyle(layer).backgroundImage.slice(0, 120) : null,
    switcher: (() => {
      const host = document.getElementById('furina-switcher');
      if (!host || !host.shadowRoot) return null;
      const root = host.shadowRoot;
      return {
        inserted: true,
        skinButtons: root.querySelectorAll('button[data-skin]').length,
        wallpaperButtons: root.querySelectorAll('button[data-wall]').length,
        glassButtons: root.querySelectorAll('button[data-glass]').length,
        thumbs: root.querySelectorAll('img').length,
        launcher: !!root.querySelector('.fl'),
        open: root.querySelector('.dual')?.classList.contains('on') ?? false,
      };
    })(),
    tokens: {
      accent: cs(document.body, '--dsw-alias-brand-primary'),
      layer1: cs(document.body, '--dsw-alias-bg-layer-1'),
      label: cs(document.body, '--dsw-alias-label-primary'),
      frAccent: cs(document.documentElement, '--fr-accent'),
    },
    computed: {
      bodyBg: cs(document.body, 'background-color'),
      centerBg: cs(firstPanel, 'background-color'),
      composerBorder: (() => {
        const wrap = document.querySelector("[data-slot='conversation.composer'] [class*='inputWrap']");
        return wrap ? cs(wrap, 'border-top-color') : null;
      })(),
    },
    otherThemes: [...document.documentElement.attributes]
      .map((attr) => attr.name)
      .filter((name) => /endfield|firefly|maid|fairy/.test(name)),
    // Who else is writing to the page? Useful when two themes are installed.
    competition: {
      inlineHtmlStyle: (document.documentElement.getAttribute('style') ?? '').slice(0, 120),
      inlineBodyStyle: (document.body.getAttribute('style') ?? '').slice(0, 120),
      sheets: [...document.styleSheets].map((sheet) => sheet.href ?? 'inline').filter((href) => href !== 'inline'),
      styleTags: document.querySelectorAll('style').length,
      furinaLinkIndex: [...document.querySelectorAll('link[rel="stylesheet"]')]
        .findIndex((link) => (link.getAttribute('href') ?? '').startsWith('/furina-theme/')),
      styleSheetCount: [...document.querySelectorAll('link[rel="stylesheet"]')].length,
    },
  };
})()`

async function main() {
  const args = parseArgs(process.argv)
  const outdir = resolve(args.outdir)
  mkdirSync(outdir, { recursive: true })
  if (!existsSync(EDGE)) throw new Error(`Edge not found at ${EDGE}`)

  const checks = []
  const check = (name, ok, detail) => {
    checks.push({ name, ok: Boolean(ok), detail })
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail === undefined ? '' : `  — ${JSON.stringify(detail)}`}`)
  }

  const edge = await launchEdge(args.port, args.width, args.height)
  let code = 0
  try {
    const cdp = await connect(args.port)
    await cdp.send('Page.enable')
    await cdp.send('Runtime.enable')
    await cdp.send('Log.enable')
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: args.width, height: args.height, deviceScaleFactor: 1, mobile: false,
    })

    // A single navigation consumes the one-time token and installs the session cookie.
    cdp.stage = 'navigate'
    await cdp.send('Page.navigate', { url: args.url })
    await sleep(1500)

    const mount = await waitForMount(cdp)
    check('browser half mounted (sheet + backdrop + switcher)', mount.ok, mount.mounted ?? mount)

    cdp.stage = 'diagnostics'
    await sleep(args.settle)
    const diagnostics = await cdp.evaluate(DIAGNOSTICS)
    console.log(JSON.stringify({ diagnostics }, null, 1))

    check('skin attribute present', Boolean(diagnostics.skin), diagnostics.skin)
    check('theme tokens reach the app', diagnostics.tokens.accent.length > 0, diagnostics.tokens.accent)
    check('wallpaper layer is on', diagnostics.backdropVisible, diagnostics.activeWallpaper)
    check('backdrop sits behind the app', diagnostics.backdropZ === '-1', diagnostics.backdropZ)
    check(
      'switcher is a shadow-root panel with every choice',
      diagnostics.switcher?.skinButtons === 3
        && diagnostics.switcher.wallpaperButtons >= 5
        && diagnostics.switcher.glassButtons === 3
        && diagnostics.switcher.thumbs >= 4,
      diagnostics.switcher,
    )
    check('body ground is transparent (wallpaper shows through)', diagnostics.computed.bodyBg === 'rgba(0, 0, 0, 0)', diagnostics.computed.bodyBg)

    const shots = []
    for (const skin of SKINS) {
      cdp.stage = 'skin:' + skin.id
      await cdp.evaluate(`window.__furinaTheme.setSkin(${JSON.stringify(skin.id)})`)
      await sleep(args.settle)
      const state = await cdp.evaluate(DIAGNOSTICS)
      check(`skin ${skin.id} applied in place`, state.skin === skin.id, state.skin)
      const path = join(outdir, skin.file)
      const bytes = await cdp.shot(path)
      shots.push({ skin: skin.id, path, bytes })
      console.log(`shot ${path} (${bytes} bytes)`)
    }

    // Glass mode + the switcher panel itself.
    cdp.stage = 'panel'
    await cdp.evaluate(`window.__furinaTheme.setSkin('hydro-iris'); window.__furinaTheme.setGlass('rich'); window.__furinaTheme.openPanel(true)`)
    await sleep(args.settle)
    const panel = await cdp.evaluate(DIAGNOSTICS)
    check(
      'switcher panel opens',
      panel.switcher?.open === true && panel.glass === 'rich',
      { open: panel.switcher?.open, glass: panel.glass },
    )
    const panelPath = join(outdir, 'screenshot-switcher-open.png')
    const panelBytes = await cdp.shot(panelPath)
    shots.push({ state: 'switcher-open', path: panelPath, bytes: panelBytes })
    console.log(`shot ${panelPath} (${panelBytes} bytes)`)

    // Free wallpaper switching: keep the skin, change the art.
    cdp.stage = 'wallpaper-swap'
    await cdp.evaluate(`window.__furinaTheme.openPanel(false); window.__furinaTheme.setSkin('fontaine-nocturne'); window.__furinaTheme.setWallpaper('salon-solitude')`)
    await sleep(args.settle)
    const swapped = await cdp.evaluate(DIAGNOSTICS)
    check(
      'wallpaper changes independently of the skin',
      swapped.skin === 'fontaine-nocturne' && swapped.wallpaper === 'salon-solitude' && /salon-solitude/.test(swapped.activeWallpaper ?? ''),
      { skin: swapped.skin, wallpaper: swapped.wallpaper, art: swapped.activeWallpaper },
    )
    const swapPath = join(outdir, 'screenshot-wallpaper-swap.png')
    const swapBytes = await cdp.shot(swapPath)
    shots.push({ state: 'wallpaper-swap', path: swapPath, bytes: swapBytes })
    console.log(`shot ${swapPath} (${swapBytes} bytes)`)

    // No-wallpaper mode must still leave a usable, legible ground.
    cdp.stage = 'no-wallpaper'
    await cdp.evaluate(`window.__furinaTheme.setWallpaper('none')`)
    await sleep(1200)
    const flat = await cdp.evaluate(DIAGNOSTICS)
    check('no-wallpaper mode keeps a painted ground', flat.backdropConnected && !flat.backdropVisible, { connected: flat.backdropConnected, visible: flat.backdropVisible })

    // Restore the defaults so the next manual look at the GUI is the hero skin.
    cdp.stage = 'reset'
    await cdp.evaluate(`window.__furinaTheme.reset()`)

    // An exception with a message and/or a source location is attributable and fails the
    // run. A bare thrown object with neither (Chromium reports it as `Object`, no url) is
    // produced by app code in states this theme never touches; it is recorded as a warning
    // instead of being silently ignored, so the report still shows it.
    const describeError = (event) => {
      const details = event.params?.exceptionDetails ?? {}
      return {
        stage: event.__stage,
        text: details.text ?? null,
        exception: details.exception?.description ?? details.exception?.value ?? null,
        url: details.url ?? null,
        line: details.lineNumber ?? null,
        column: details.columnNumber ?? null,
      }
    }
    const isAttributable = (event) => {
      const details = event.params?.exceptionDetails ?? {}
      const description = details.exception?.description
      return Boolean(description && /^(?:[A-Z]\w*Error|Error)\b/.test(description)) || Boolean(details.url)
    }
    const rawPageErrors = cdp.events
      .filter((event) => event.method === 'Runtime.exceptionThrown')
      .filter((event) => !/chrome-extension:/.test(String(event.params?.exceptionDetails?.url ?? '')))
    const attributable = rawPageErrors.filter(isAttributable)
    const unattributed = rawPageErrors.filter((event) => !isAttributable(event))
    const pageErrorDetail = attributable.slice(0, 3).map(describeError)
    check('no attributable page exceptions from the app', attributable.length === 0, pageErrorDetail)
    if (unattributed.length > 0) {
      console.log(`WARN  ${unattributed.length} unattributed thrown value(s) from app code (non-Error, no url): ${JSON.stringify(unattributed.map(describeError))}`)
    }

    const failures = checks.filter((entry) => !entry.ok)
    code = failures.length === 0 ? 0 : 1
    const report = {
      ok: failures.length === 0,
      generatedAt: new Date().toISOString(),
      url: diagnostics.url,
      viewport: { width: args.width, height: args.height },
      edge: process.env.EDGE_EXE ?? EDGE,
      diagnostics,
      checks,
      failures: failures.map((entry) => entry.name),
      pageWarnings: unattributed.map(describeError),
      screenshots: shots.map((shot) => ({ ...shot, bytes: shot.bytes })),
    }
    const reportPath = join(outdir, 'verify-report.json')
    writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
    console.log(JSON.stringify({ report: reportPath, ok: code === 0, checks: checks.length, failed: failures.length }))
  } finally {
    if (!args.keepOpen) {
      spawnSync('taskkill', ['/PID', String(edge.pid), '/T', '/F'], { stdio: 'ignore' })
    }
  }
  process.exit(code)
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: String(error && error.stack ? error.stack : error) }))
  process.exit(1)
})
