/**
 * furina-dsh-theme — host half.
 *
 * Two jobs, both plumbing:
 *
 *  1. serve the browser half (`client/theme.css`, `client/theme.js`, and the
 *     wallpapers under `client/assets/`) from one prefix route;
 *  2. get that script into the page on both transports the Web GUI uses —
 *     `webServer.tapIndex` for the browser-served shell, and a
 *     `webserver/index-inject` row for the desktop (Electron) shell, whose
 *     index.html never passes through `renderIndex`.
 *
 * The injected row is an INLINE script that appends its own `<script src>` with
 * `onerror` swallowed. A `script-src` row would be the shorter spelling, but the
 * desktop page interpreter rejects the whole boot when such a row fails to
 * load, and an injection table is collected before this plugin is live — so a
 * dead route would take the application down with it instead of costing us the
 * theme. Inline rows cannot fail to load.
 *
 * Nothing here writes to the DOM, and nothing here knows a class name: every
 * visual decision lives in `client/`.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, extname, join, normalize, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const PACKAGE_ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const CLIENT_ROOT = join(PACKAGE_ROOT, 'client')
const ROUTE_PREFIX = '/furina-theme'

const PACKAGE_VERSION = JSON.parse(readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf8')).version
const THEME_SCRIPT = `${ROUTE_PREFIX}/theme.js`
const THEME_STYLES = `${ROUTE_PREFIX}/theme.css`
/** Billing/balance browser half — self-mounts into `#furina-billing`. */
const BILLING_SCRIPT = `${ROUTE_PREFIX}/billing.js`
const BILLING_ENDPOINT = `${ROUTE_PREFIX}/api/billing`
/** Optional one-click install of the vendored startup-animation companion. */
const STARTUP_ENDPOINT = `${ROUTE_PREFIX}/api/startup-plugin`
/** Optional one-click install of the bundled, replaceable Furina agent preset. */
const PRESET_ENDPOINT = `${ROUTE_PREFIX}/api/preset`

const CONTENT_TYPES = {
  '.avif': 'image/avif',
  '.css': 'text/css; charset=utf-8',
  '.gif': 'image/gif',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml; charset=utf-8',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
}

/**
 * Paint the canvas before any stylesheet arrives, so the first frame of the
 * application is already deep Fontaine indigo instead of the shell's white.
 *
 * Deliberately no `:has()` here: a `:has()` anchored on <html> is re-evaluated
 * on every mutation anywhere in the body, which is a real cost while a long
 * transcript mounts. The browser half corrects the light theme later.
 */
const CRITICAL_CSS = 'html,body{background-color:#04060f}'

/** Inline row that pulls in the browser half without risking the boot. */
const LOADER_ROW = '(function(){try{'
  + 'var d=document.body||document.head||document.documentElement;if(!d)return;'
  + 'if(document.querySelector(\'script[data-furina-theme]\'))return;'
  + 'var s=document.createElement("script");s.src="' + THEME_SCRIPT + '";'
  + 's.async=false;s.setAttribute("data-furina-theme","1");s.onerror=function(){};'
  + 'd.appendChild(s);'
  /* billing is optional: a missing file only costs the sidebar panel */
  + 'if(!document.querySelector(\'script[data-furina-billing]\')){'
  + 'var b=document.createElement("script");b.src="' + BILLING_SCRIPT + '";'
  + 'b.async=false;b.setAttribute("data-furina-billing","1");b.onerror=function(){};'
  + 'd.appendChild(b)}'
  + '}catch(e){}})()'

/**
 * Mark the boot frame on <html> so the first stylesheet can fade its decoration
 * in instead of popping. Removed by theme.js once the backdrop is mounted, with
 * a timer as the no-theme.js fallback.
 */
const BOOT_ROW = '(function(){try{'
  + 'var h=document.documentElement;h.setAttribute("data-furina-boot","1");'
  + 'setTimeout(function(){h.removeAttribute("data-furina-boot")},4000)'
  + '}catch(e){}})()'

/** mtime-keyed file cache: editing a client file shows up on the next reload. */
const fileCache = new Map()

function readClientFile(relative) {
  const absolute = join(CLIENT_ROOT, relative)
  const stats = statSync(absolute)
  const cached = fileCache.get(absolute)
  if (cached !== undefined && cached.mtimeMs === stats.mtimeMs) return cached
  const entry = { mtimeMs: stats.mtimeMs, body: readFileSync(absolute) }
  fileCache.set(absolute, entry)
  return entry
}

/**
 * Resolve a request path inside `client/`, refusing anything that escapes it.
 * @returns the path relative to `client/`, or null when the request is unsafe.
 */
export function resolveRelative(requestPath) {
  let decoded
  try {
    decoded = decodeURIComponent(requestPath)
  } catch {
    return null
  }
  if (decoded.includes('\0')) return null
  // Reject traversal before `normalize` gets to fold it away: `/../x` normalises
  // to `/x`, which is contained but is not a path the client ever asks for, and
  // silently rewriting a hostile request into a valid one hides the attempt.
  if (decoded.split(/[/\\]/u).some((segment) => segment === '..')) return null
  const relative = normalize(decoded).replace(/^[/\\]+/u, '')
  if (relative === '' || relative === '.') return null
  if (relative.split(/[/\\]/u).some((segment) => segment === '..')) return null
  const absolute = join(CLIENT_ROOT, relative)
  if (absolute !== CLIENT_ROOT && !absolute.startsWith(CLIENT_ROOT + sep)) return null
  return relative
}

export const sameOriginOnly = (request) => {
  const site = request.headers['sec-fetch-site']
  if (typeof site === 'string' && site !== 'same-origin' && site !== 'none') return false
  const origin = request.headers.origin
  if (typeof origin !== 'string' || origin === '') return true
  try {
    const url = new URL(origin)
    return url.host === request.headers.host
  } catch {
    return false
  }
}

function sendJson(response, status, body) {
  const text = JSON.stringify(body)
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': String(Buffer.byteLength(text)),
    'cache-control': 'no-store',
  })
  response.end(text)
}

/* --------------------------------------------------------- user wallpapers */

/**
 * Extra wallpapers the user drops in by hand.
 *
 * The package ships the three Fontaine arts it documents; this folder is for
 * everything else. Any image here shows up in the switcher's wallpaper row by
 * file name, so "free wallpaper switching" is not limited to the shipped set.
 */
export function wallpaperDir(home = process.env.DSH_HOME ?? join(homedir(), '.dsh')) {
  return join(home, 'furina-wallpapers')
}

const WALLPAPER_IMAGE = /\.(jpe?g|png|webp|avif)$/i
const WALLPAPER_NAME = /^(?!\.{1,2}$)[^/\\\u0000-\u001f]+$/

export function ensureWallpaperDir(home) {
  const dir = wallpaperDir(home)
  try {
    mkdirSync(dir, { recursive: true })
  } catch {
    /* read-only home: the picker simply has no custom entries */
  }
  return dir
}

export function listWallpapers(home) {
  const dir = wallpaperDir(home)
  const files = []
  let entries = []
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return files
  }
  for (const entry of entries) {
    if (!entry.isFile() || !WALLPAPER_IMAGE.test(entry.name)) continue
    if (!WALLPAPER_NAME.test(entry.name)) continue
    let size = 0
    try {
      size = statSync(join(dir, entry.name)).size
    } catch {
      continue
    }
    files.push({ name: entry.name, size })
  }
  files.sort((a, b) => a.name.localeCompare(b.name))
  return files
}

function serveUserWallpaper(response, relative, home) {
  const dir = wallpaperDir(home)
  let name = ''
  try {
    name = decodeURIComponent(relative)
  } catch {
    response.writeHead(404)
    response.end()
    return
  }
  if (!WALLPAPER_NAME.test(name) || !WALLPAPER_IMAGE.test(name)) {
    response.writeHead(404)
    response.end()
    return
  }
  const absolute = join(dir, name)
  if (absolute !== dir && !absolute.startsWith(dir + sep)) {
    response.writeHead(404)
    response.end()
    return
  }
  let body
  try {
    body = readFileSync(absolute)
  } catch {
    response.writeHead(404)
    response.end()
    return
  }
  response.writeHead(200, {
    'content-type': CONTENT_TYPES[extname(name).toLowerCase()] ?? 'application/octet-stream',
    'content-length': body.length,
    'cache-control': 'no-cache',
  })
  response.end(body)
}

/* ------------------------------------------------------------------- routes */

/**
 * One handler for the whole prefix. Exported so the host tests can drive it
 * without a live web server.
 */
export function createHandler(options = {}) {
  const home = options.home ?? process.env.DSH_HOME ?? join(homedir(), '.dsh')
  /** Lazy: billing.js is optional, and a broken import must not take the theme down. */
  let billingPromise
  const billingHandler = () => {
    if (billingPromise === undefined) {
      billingPromise = import('./billing.js')
        .then((mod) => (typeof mod.createBillingHandler === 'function'
          ? mod.createBillingHandler({ ctx: options.ctx, home })
          : null))
        .catch(() => null)
    }
    return billingPromise
  }
  return (request, response) => {
    const pathname = new URL(request.url ?? '/', 'http://dsh.invalid').pathname

    if (pathname === BILLING_ENDPOINT) {
      if (!sameOriginOnly(request)) {
        response.writeHead(403)
        response.end()
        return
      }
      void billingHandler().then((handler) => {
        if (handler === null) {
          sendJson(response, 503, { ok: false, error: 'billing-unavailable' })
          return
        }
        return handler(request, response)
      }).catch(() => {
        try {
          sendJson(response, 500, { ok: false, error: 'billing-failed' })
        } catch {
          /* headers already sent */
        }
      })
      return
    }

    if (pathname === PRESET_ENDPOINT) {
      if (!sameOriginOnly(request)) {
        response.writeHead(403)
        response.end()
        return
      }
      void import('./preset.js')
        .then((mod) => {
          if (request.method === 'GET' || request.method === 'HEAD') {
            sendJson(response, 200, mod.presetStatus(home))
            return
          }
          if (request.method !== 'POST') {
            sendJson(response, 405, { ok: false, error: 'method-not-allowed' })
            return
          }
          let body = ''
          request.setEncoding('utf8')
          request.on('data', (chunk) => {
            body += chunk
            if (body.length > 4096) request.destroy()
          })
          request.on('end', () => {
            let action = 'install'
            try {
              const parsed = body === '' ? {} : JSON.parse(body)
              if (parsed !== null && typeof parsed === 'object' && typeof parsed.action === 'string') action = parsed.action
            } catch {
              sendJson(response, 400, { ok: false, error: 'invalid-json' })
              return
            }
            if (action !== 'install' && action !== 'remove') {
              sendJson(response, 400, { ok: false, error: 'unsupported-action' })
              return
            }
            const result = action === 'install' ? mod.installPreset(home) : mod.removePreset(home)
            sendJson(response, result.ok ? 200 : 500, result)
          })
        })
        .catch(() => {
          try {
            sendJson(response, 500, { ok: false, error: 'preset-installer-failed' })
          } catch {
            /* headers already sent */
          }
        })
      return
    }

    if (pathname === STARTUP_ENDPOINT) {
      if (!sameOriginOnly(request)) {
        response.writeHead(403)
        response.end()
        return
      }
      if (request.method !== 'POST') {
        sendJson(response, 405, { ok: false, error: 'method-not-allowed' })
        return
      }
      let body = ''
      request.setEncoding('utf8')
      request.on('data', (chunk) => {
        body += chunk
        if (body.length > 4096) request.destroy()
      })
      request.on('end', () => {
        let action = 'install'
        try {
          const parsed = body === '' ? {} : JSON.parse(body)
          if (parsed !== null && typeof parsed === 'object' && typeof parsed.action === 'string') action = parsed.action
        } catch {
          sendJson(response, 400, { ok: false, error: 'invalid-json' })
          return
        }
        if (action !== 'install') {
          sendJson(response, 400, { ok: false, error: 'unsupported-action' })
          return
        }
        void import('./startup-install.js')
          .then((mod) => {
            const result = mod.installCompanion(home)
            sendJson(response, result.ok ? 200 : 500, result)
          })
          .catch(() => sendJson(response, 500, { ok: false, error: 'installer-failed' }))
      })
      return
    }

    if (pathname === `${ROUTE_PREFIX}/wallpapers`) {
      if (!sameOriginOnly(request)) {
        response.writeHead(403)
        response.end()
        return
      }
      sendJson(response, 200, { ok: true, dir: wallpaperDir(home), files: listWallpapers(home) })
      return
    }

    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.writeHead(405, { allow: 'GET, HEAD' })
      response.end()
      return
    }
    if (!sameOriginOnly(request)) {
      response.writeHead(403)
      response.end()
      return
    }

    if (pathname.startsWith(`${ROUTE_PREFIX}/user-wallpaper/`)) {
      serveUserWallpaper(response, pathname.slice(`${ROUTE_PREFIX}/user-wallpaper/`.length), home)
      return
    }

    if (pathname === `${ROUTE_PREFIX}/` || pathname === ROUTE_PREFIX) {
      response.writeHead(302, { location: THEME_STYLES })
      response.end()
      return
    }

    const relative = resolveRelative(pathname.slice(ROUTE_PREFIX.length))
    if (relative === null) {
      response.writeHead(404)
      response.end()
      return
    }
    let entry
    try {
      entry = readClientFile(relative)
    } catch {
      response.writeHead(404, { 'cache-control': 'no-store' })
      response.end()
      return
    }
    response.writeHead(200, {
      'content-type': CONTENT_TYPES[extname(relative).toLowerCase()] ?? 'application/octet-stream',
      'content-length': String(entry.body.byteLength),
      'cache-control': 'no-cache',
    })
    response.end(request.method === 'HEAD' ? undefined : entry.body)
  }
}

/** Rows for the desktop injection table. Exported for the tests. */
export function injectionRows() {
  return [
    { kind: 'style', text: CRITICAL_CSS },
    { kind: 'script', placement: 'body', text: BOOT_ROW },
    { kind: 'script', placement: 'body', text: LOADER_ROW },
  ]
}

/** The snippet appended to a browser-served index. Exported for the tests. */
export function indexTags() {
  return `<style>${CRITICAL_CSS}</style><script>${BOOT_ROW}</script><script>${LOADER_ROW}</script>`
}

export default {
  name: 'furina-theme',

  apply(root) {
    ensureWallpaperDir()

    // The injection row is registered synchronously: the desktop shell collects
    // its table once, early, and a row added after that collection never lands.
    root.on('webserver/index-inject', (table) => {
      if (!Array.isArray(table)) return
      for (const row of table) {
        if (row === null || typeof row !== 'object') continue
        if (row.kind === 'script' && typeof row.text === 'string' && row.text.includes(THEME_SCRIPT)) return
        if (row.kind === 'script-src' && row.src === THEME_SCRIPT) return
      }
      for (const row of injectionRows()) table.push(row)
    })

    root.inject(['webServer'], (ctx) => {
      const disposers = []

      disposers.push(ctx.webServer.register({
        kind: 'prefix',
        path: ROUTE_PREFIX,
        handler: createHandler({ ctx }),
      }))

      // Browser-served shell: the index HTML is rendered per request, so a tap
      // registered now applies to the very next page load.
      disposers.push(ctx.webServer.tapIndex((html) => {
        if (html.includes(THEME_SCRIPT)) return html
        const tags = indexTags()
        if (html.includes('</body>')) return html.replace('</body>', `${tags}</body>`)
        return html + tags
      }))

      ctx.effect(() => () => {
        for (const dispose of disposers) {
          try {
            dispose()
          } catch {
            /* a route that already went away is not a failure worth reporting */
          }
        }
      })
    })
  },
}

export { PACKAGE_VERSION, ROUTE_PREFIX, THEME_SCRIPT, THEME_STYLES, BILLING_SCRIPT, BILLING_ENDPOINT, CLIENT_ROOT, existsSync }
