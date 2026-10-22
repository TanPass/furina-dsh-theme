/**
 * Host-half tests: manifest, patch, injection rows, and the real HTTP handler.
 *
 * The handler is exercised over a real loopback server and real `fetch` calls,
 * not a mock response object — the things that break in production here are
 * status codes, content types, traversal and cross-origin handling, and those
 * only prove themselves on the wire.
 *
 *   node --test test/
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import plugin, {
  CLIENT_ROOT,
  ROUTE_PREFIX,
  THEME_SCRIPT,
  THEME_STYLES,
  createHandler,
  indexTags,
  injectionRows,
  listWallpapers,
  resolveRelative,
  wallpaperDir,
} from '../lib/index.js'

const PACKAGE_ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const manifest = JSON.parse(readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf8'))

/* --------------------------------------------------------------- fixtures */

function makeHome() {
  const home = mkdtempSync(join(tmpdir(), 'furina-test-home-'))
  const dir = wallpaperDir(home)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'zebra.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]))
  writeFileSync(join(dir, 'alpha.webp'), Buffer.from([1, 2, 3]))
  writeFileSync(join(dir, 'notes.txt'), 'not an image')
  mkdirSync(join(dir, 'folder.png'))
  return { home, dir }
}

async function withServer(handler, fn) {
  const server = createServer(handler)
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address()
  try {
    return await fn(`http://127.0.0.1:${port}`)
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
}

const get = (url, init) => fetch(url, { redirect: 'manual', ...init })

/* ---------------------------------------------------------------- manifest */

test('package manifest is installable as a dsh plugin', () => {
  assert.equal(manifest.name, 'furina-dsh-theme')
  assert.match(manifest.version, /^\d+\.\d+\.\d+$/u)
  assert.equal(manifest.main, 'lib/index.js')
  assert.equal(manifest.exports['.'], './lib/index.js')
  assert.equal(manifest.exports['./cordis.patch.yml'], './cordis.patch.yml')
  assert.ok(manifest.files.includes('lib'))
  assert.ok(manifest.files.includes('client'))
  assert.ok(manifest.files.includes('cordis.patch.yml'))
  assert.equal(manifest.dsh.bundle.patch, './cordis.patch.yml')
  // The host half is ESM and imports node: builtins only — no runtime deps.
  assert.equal(manifest.type, 'module')
  assert.equal(manifest.dependencies, undefined)
})

test('cordis.patch.yml inserts this package into the dsh:plugin group', () => {
  const patch = readFileSync(join(PACKAGE_ROOT, 'cordis.patch.yml'), 'utf8')
  // Same shape as the reference bundle patch: an `insert` block, no group key.
  assert.match(patch, /^- insert:/mu)
  assert.match(patch, /^ {4}- id: furina-dsh-theme$/mu)
  assert.match(patch, /^ {6}name: furina-dsh-theme$/mu)
  assert.match(patch, /name: furina-dsh-theme/u)
  assert.ok(!/^\uFEFF/u.test(patch), 'patch must not carry a BOM')
})

/* -------------------------------------------------------------- injection */

test('injection rows load the browser half without risking the boot', () => {
  const rows = injectionRows()
  assert.equal(rows.length, 3)

  const [style, boot, loader] = rows
  assert.equal(style.kind, 'style')
  assert.match(style.text, /background-color:#04060f/u)

  assert.equal(boot.kind, 'script')
  assert.equal(boot.placement, 'body')
  assert.match(boot.text, /data-furina-boot/u)

  assert.equal(loader.kind, 'script')
  assert.equal(loader.placement, 'body')
  assert.ok(loader.text.includes(THEME_SCRIPT), 'loader must point at the route')
  assert.match(loader.text, /document\.querySelector\('script\[data-furina-theme\]'\)/u)
  assert.match(loader.text, /onerror=function\(\)\{\}/u)
  // An inline row can never fail to load, which is the whole point.
  assert.ok(!loader.text.includes('script-src'))
})

test('indexTags() splices cleanly into a rendered index', () => {
  const tags = indexTags()
  assert.match(tags, /^<style>.*<\/style><script>.*<\/script><script>.*<\/script>$/u)
  assert.ok(tags.includes(THEME_SCRIPT))

  const html = '<html><body><div id="root"></div></body></html>'
  const patched = html.includes(THEME_SCRIPT) ? html : html.replace('</body>', `${tags}</body>`)
  assert.ok(patched.indexOf(THEME_SCRIPT) > patched.indexOf('<div id="root">'))
  assert.match(patched, /<\/script><\/body>/u)
})

/* -------------------------------------------------------------------- apply */

function fakeCordis() {
  const events = new Map()
  const injected = []
  const disposers = []
  const ctx = {
    on(event, handler) {
      if (!events.has(event)) events.set(event, [])
      events.get(event).push(handler)
    },
    inject(services, factory) {
      injected.push({ services, factory })
    },
    effect(fn) {
      disposers.push(fn())
    },
    webServer: {
      register(options) {
        ctx.registered = options
        return () => {
          ctx.registered = null
        }
      },
      tapIndex(tap) {
        ctx.tap = tap
        return () => {
          ctx.tap = null
        }
      },
    },
  }
  return { ctx, events, injected, disposers }
}

test('apply() registers a prefix route, an index tap and the injection row', async () => {
  const { ctx, events, injected, disposers } = fakeCordis()
  plugin.apply(ctx)

  // The row listener is synchronous: the desktop table is collected once, early.
  assert.equal(events.get('webserver/index-inject').length, 1)
  assert.equal(injected.length, 1)
  assert.deepEqual(injected[0].services, ['webServer'])

  const table = []
  events.get('webserver/index-inject')[0](table)
  assert.equal(table.length, 3)
  // A second collection pass must not double up.
  events.get('webserver/index-inject')[0](table)
  assert.equal(table.length, 3)

  injected[0].factory(ctx)
  assert.equal(ctx.registered.kind, 'prefix')
  assert.equal(ctx.registered.path, ROUTE_PREFIX)
  assert.equal(typeof ctx.registered.handler, 'function')

  const html = '<html><body>app</body></html>'
  const tapped = ctx.tap(html)
  assert.ok(tapped.indexOf(THEME_SCRIPT) < tapped.indexOf('</body>'))
  assert.equal(ctx.tap(tapped), tapped, 'the tap is idempotent')

  // Disposal releases both registrations.
  assert.equal(disposers.length, 1)
  disposers[0]()
  assert.equal(ctx.registered, null)
  assert.equal(ctx.tap, null)
})

test('apply() tolerates a hostile injection table', () => {
  const { ctx, events } = fakeCordis()
  plugin.apply(ctx)
  const handler = events.get('webserver/index-inject')[0]
  for (const table of [null, undefined, 'nope', {}, []]) {
    assert.doesNotThrow(() => handler(table))
  }
  const table = [null, 42, { kind: 'script', src: THEME_SCRIPT }, { kind: 'script', text: `x${THEME_SCRIPT}x` }]
  handler(table)
  assert.equal(table.length, 4, 'existing rows are left alone')
})

/* ------------------------------------------------------------- path safety */

test('resolveRelative refuses escapes and accepts client files', () => {
  assert.equal(resolveRelative('/theme.js'), 'theme.js')
  assert.equal(resolveRelative('/assets/wallpapers/a.jpg'), join('assets', 'wallpapers', 'a.jpg'))
  assert.equal(resolveRelative('/../../package.json'), null)
  assert.equal(resolveRelative('/assets/../../lib/index.js'), null)
  assert.equal(resolveRelative('/..%2f..%2fpackage.json'), null)
  assert.equal(resolveRelative('/%2e%2e/%2e%2e/package.json'), null)
  assert.equal(resolveRelative('/a%00b'), null)
  assert.equal(resolveRelative('/'), null)
  assert.equal(resolveRelative('/%E0%A4%A'), null)
  assert.equal(resolveRelative('/%5C..%5Cpackage.json'), null)
})

/* ------------------------------------------------------------ HTTP surface */

test('serves the browser half over HTTP with correct types', async () => {
  const handler = createHandler({ home: makeHome().home })
  await withServer(handler, async (base) => {
    const js = await get(`${base}${THEME_SCRIPT}`)
    assert.equal(js.status, 200)
    assert.equal(js.headers.get('content-type'), 'text/javascript; charset=utf-8')
    const jsBody = await js.text()
    assert.ok(jsBody.includes('__furinaTheme'))
    assert.ok(jsBody.length > 10000)

    const css = await get(`${base}${THEME_STYLES}`)
    assert.equal(css.status, 200)
    assert.equal(css.headers.get('content-type'), 'text/css; charset=utf-8')
    assert.ok((await css.text()).includes('data-furina-skin'))

    const img = await get(`${base}${ROUTE_PREFIX}/assets/wallpapers/furina-01-city-noir.jpg`)
    assert.equal(img.status, 200)
    assert.equal(img.headers.get('content-type'), 'image/jpeg')
    assert.ok((await img.arrayBuffer()).byteLength > 100000)

    const emblem = await get(`${base}${ROUTE_PREFIX}/assets/emblem.svg`)
    assert.equal(emblem.status, 200)
    assert.equal(emblem.headers.get('content-type'), 'image/svg+xml; charset=utf-8')

    const head = await get(`${base}${THEME_STYLES}`, { method: 'HEAD' })
    assert.equal(head.status, 200)
    assert.equal(await head.text(), '')
    assert.ok(Number(head.headers.get('content-length')) > 0)

    const root = await get(`${base}${ROUTE_PREFIX}/`)
    assert.equal(root.status, 302)
    assert.equal(root.headers.get('location'), THEME_STYLES)

    assert.equal((await get(`${base}${ROUTE_PREFIX}/nope.css`)).status, 404)
    assert.equal((await get(`${base}${ROUTE_PREFIX}/assets/../../../package.json`)).status, 404)
    assert.equal((await get(`${base}${ROUTE_PREFIX}/theme.js`, { method: 'POST' })).status, 405)
    assert.equal((await get(`${base}${ROUTE_PREFIX}/theme.js`, { method: 'PUT' })).status, 405)
  })
})

test('refuses cross-site reads', async () => {
  const handler = createHandler({ home: makeHome().home })
  await withServer(handler, async (base) => {
    const cross = await get(`${base}${THEME_STYLES}`, { headers: { 'sec-fetch-site': 'cross-site' } })
    assert.equal(cross.status, 403)
    const foreign = await get(`${base}${THEME_STYLES}`, { headers: { origin: 'https://evil.example' } })
    assert.equal(foreign.status, 403)
    const same = await get(`${base}${THEME_STYLES}`, { headers: { 'sec-fetch-site': 'same-origin' } })
    assert.equal(same.status, 200)
  })
})

/* --------------------------------------------------------------- wallpapers */

test('lists only image files from the user wallpaper folder', () => {
  const { home, dir } = makeHome()
  try {
    const files = listWallpapers(home)
    assert.deepEqual(files.map((file) => file.name), ['alpha.webp', 'zebra.png'])
    assert.ok(files.every((file) => file.size >= 1))
    assert.deepEqual(listWallpapers(join(home, 'missing')), [], 'a missing folder is empty, not an error')
    assert.equal(wallpaperDir(home), join(home, 'furina-wallpapers'))
    assert.ok(dir.length > 0)
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test('wallpaper API is same-origin JSON and serves files safely', async () => {
  const { home } = makeHome()
  const handler = createHandler({ home })
  try {
    await withServer(handler, async (base) => {
      const list = await get(`${base}${ROUTE_PREFIX}/wallpapers`)
      assert.equal(list.status, 200)
      const body = await list.json()
      assert.equal(body.ok, true)
      assert.equal(body.dir, wallpaperDir(home))
      assert.deepEqual(body.files.map((file) => file.name), ['alpha.webp', 'zebra.png'])

      const one = await get(`${base}${ROUTE_PREFIX}/user-wallpaper/zebra.png`)
      assert.equal(one.status, 200)
      assert.equal(one.headers.get('content-type'), 'image/png')
      assert.equal((await one.arrayBuffer()).byteLength, 4)

      assert.equal((await get(`${base}${ROUTE_PREFIX}/user-wallpaper/notes.txt`)).status, 404)
      assert.equal((await get(`${base}${ROUTE_PREFIX}/user-wallpaper/folder.png`)).status, 404)
      assert.equal((await get(`${base}${ROUTE_PREFIX}/user-wallpaper/..%2F..%2Fpackage.json`)).status, 404)
      assert.equal((await get(`${base}${ROUTE_PREFIX}/user-wallpaper/nope.png`)).status, 404)

      const cross = await get(`${base}${ROUTE_PREFIX}/wallpapers`, { headers: { 'sec-fetch-site': 'cross-site' } })
      assert.equal(cross.status, 403)
    })
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test('client root is the packaged client/ folder', () => {
  assert.ok(CLIENT_ROOT.endsWith(`${join('dsh', 'client')}`) || CLIENT_ROOT.endsWith('client'))
  for (const file of ['theme.js', 'theme.css', join('assets', 'emblem.svg')]) {
    assert.ok(readFileSync(join(CLIENT_ROOT, file)).byteLength > 0, `${file} exists`)
  }
})
