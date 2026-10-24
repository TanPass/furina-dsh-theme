/**
 * furina-dsh-theme — install the bundled Furina agent preset as a replaceable
 * DSH preset.
 *
 * Current DSH (0.2.x) no longer reads `$DSH_HOME/.agent-presets/<id>/`; presets
 * are declared rows of `@deepseek-ai/dsh-agent-preset` in the profile's
 * `cordis.patch.yml`. This module renders one such row from the plain-text
 * preset sources in `preset/furina-preset/` and appends it to the active
 * profile, between marker comments so it can be removed again without touching
 * any other preset.
 *
 * The same sources are the replacement surface: point `presetDir` at another
 * folder with `preset.yml` + `agent.cordis.yml` and install that instead.
 */

import { existsSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const PACKAGE_ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
export const PRESET_DIR = join(PACKAGE_ROOT, 'preset', 'furina-preset')
export const PRESET_ID = 'furina-de-fontaine'
const ROW_ID = `preset-${PRESET_ID}`
const BEGIN = '# [furina-dsh-theme] furina agent preset — begin'
const END = '# [furina-dsh-theme] furina agent preset — end'

function profiles(home) {
  const root = join(home, 'profiles')
  let names = []
  try {
    names = readdirSync(root, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name)
  } catch {
    return []
  }
  return names.map((name) => join(root, name))
}

function activeProfile(home) {
  const found = []
  for (const dir of profiles(home)) {
    const manifestPath = join(dir, 'package.json')
    if (!existsSync(manifestPath)) continue
    let manifest
    try {
      manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
    } catch {
      continue
    }
    const deps = manifest.dependencies ?? {}
    const bundles = manifest.dsh?.profile?.bundles ?? []
    if (deps['furina-dsh-theme'] !== undefined || bundles.includes('furina-dsh-theme')) {
      found.push({ dir, manifestPath, patchPath: join(dir, 'cordis.patch.yml') })
    }
  }
  return found[0] ?? null
}

/** Tiny reader for the flat `key: value` lines this preset.yml uses. */
function readMeta(presetDir) {
  const path = join(presetDir, 'preset.yml')
  if (!existsSync(path)) throw new Error(`preset.yml missing: ${path}`)
  const meta = {}
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/u)) {
    const match = /^([a-zA-Z]+):\s*(.*)$/u.exec(line)
    if (match === null) continue
    let value = match[2].trim()
    if (/^".*"$/u.test(value)) value = value.slice(1, -1)
    meta[match[1]] = value
  }
  for (const key of ['id', 'name', 'description']) {
    if (typeof meta[key] !== 'string' || meta[key] === '') throw new Error(`preset.yml: ${key} missing`)
  }
  meta.order = Number.parseInt(meta.order ?? '20', 10)
  return meta
}

function readPlugins(presetDir) {
  const path = join(presetDir, 'agent.cordis.yml')
  if (!existsSync(path)) throw new Error(`agent.cordis.yml missing: ${path}`)
  const plugins = readFileSync(path, 'utf8').replace(/\s+$/u, '')
  if (!plugins.startsWith('- id: ')) throw new Error('agent.cordis.yml must be a top-level entry list')
  return plugins
}

function indent(text, spaces) {
  const pad = ' '.repeat(spaces)
  return text.split(/\r?\n/u).map((line) => (line === '' ? line : `${pad}${line}`)).join('\n')
}

export function renderPresetBlock(presetDir = PRESET_DIR) {
  const meta = readMeta(presetDir)
  const plugins = readPlugins(presetDir)
  return [
    BEGIN,
    '- insert:',
    `    - id: ${ROW_ID}`,
    "      name: '@deepseek-ai/dsh-agent-preset'",
    '      config:',
    `        id: ${meta.id}`,
    `        name: ${JSON.stringify(meta.name)}`,
    `        description: ${JSON.stringify(meta.description)}`,
    `        order: ${Number.isFinite(meta.order) ? meta.order : 20}`,
    '        plugins:',
    indent(plugins, 10),
    END,
    '',
  ].join('\n')
}

function backup(path) {
  const stamp = new Date().toISOString().replace(/[:.]/gu, '-')
  const copy = `${path}.furina-${stamp}.bak`
  writeFileSync(copy, readFileSync(path))
  return copy
}

function writeAtomic(path, text) {
  const temp = `${path}.furina.tmp`
  writeFileSync(temp, text)
  renameSync(temp, path)
}

/** @returns {{ ok: boolean, installed: boolean, profile: string|null, error?: string }} */
export function presetStatus(home = process.env.DSH_HOME ?? join(homedir(), '.dsh')) {
  const profile = activeProfile(home)
  let meta = null
  try {
    meta = readMeta(PRESET_DIR)
  } catch {
    meta = null
  }
  if (profile === null) {
    return { ok: false, installed: false, profile: null, error: 'profile-not-found', meta }
  }
  let installed = false
  try {
    installed = readFileSync(profile.patchPath, 'utf8').includes(BEGIN)
  } catch {
    installed = false
  }
  return { ok: true, installed, profile: profile.dir, presetId: PRESET_ID, meta }
}

/**
 * Install (or re-install) the preset. Re-installing replaces only our block, so
 * editing `preset/furina-preset/` and installing again is the supported way to
 * swap the persona.
 */
export function installPreset(home = process.env.DSH_HOME ?? join(homedir(), '.dsh'), presetDir = PRESET_DIR) {
  let block
  try {
    block = renderPresetBlock(presetDir)
  } catch (error) {
    return { ok: false, installed: false, profile: null, error: `preset-invalid: ${error instanceof Error ? error.message : String(error)}` }
  }
  const profile = activeProfile(home)
  if (profile === null) return { ok: false, installed: false, profile: null, error: 'profile-not-found' }
  let current = ''
  try {
    current = existsSync(profile.patchPath) ? readFileSync(profile.patchPath, 'utf8') : ''
  } catch (error) {
    return { ok: false, installed: false, profile: profile.dir, error: `patch-unreadable: ${error instanceof Error ? error.message : String(error)}` }
  }
  const already = current.includes(BEGIN)
  if (already && current.includes(block)) {
    return { ok: true, installed: true, already: true, profile: profile.dir, blocked: false }
  }
  let next
  if (already) {
    const start = current.indexOf(BEGIN)
    const end = current.indexOf(END, start)
    if (end < 0) return { ok: false, installed: false, profile: profile.dir, error: 'patch-marker-broken' }
    next = `${current.slice(0, start)}${block}${current.slice(end + END.length).replace(/^\r?\n/u, '')}`
  } else {
    next = `${current.replace(/\s+$/u, '')}\n\n${block}`
  }
  let saved = null
  try {
    if (current !== '') saved = backup(profile.patchPath)
    writeAtomic(profile.patchPath, next)
  } catch (error) {
    return { ok: false, installed: false, profile: profile.dir, error: `patch-write-failed: ${error instanceof Error ? error.message : String(error)}` }
  }
  return { ok: true, installed: true, already: false, profile: profile.dir, backup: saved, restart: true }
}

/** Remove only the block this theme wrote. */
export function removePreset(home = process.env.DSH_HOME ?? join(homedir(), '.dsh')) {
  const profile = activeProfile(home)
  if (profile === null) return { ok: false, installed: false, profile: null, error: 'profile-not-found' }
  let current
  try {
    current = readFileSync(profile.patchPath, 'utf8')
  } catch {
    return { ok: true, installed: false, profile: profile.dir, already: true }
  }
  const start = current.indexOf(BEGIN)
  if (start < 0) return { ok: true, installed: false, profile: profile.dir, already: true }
  const end = current.indexOf(END, start)
  if (end < 0) return { ok: false, installed: true, profile: profile.dir, error: 'patch-marker-broken' }
  const next = `${current.slice(0, start)}${current.slice(end + END.length).replace(/^\r?\n/u, '')}`.replace(/\s+$/u, '') + '\n'
  let saved = null
  try {
    saved = backup(profile.patchPath)
    writeAtomic(profile.patchPath, next)
  } catch (error) {
    return { ok: false, installed: true, profile: profile.dir, error: `patch-write-failed: ${error instanceof Error ? error.message : String(error)}` }
  }
  return { ok: true, installed: false, profile: profile.dir, backup: saved, restart: true }
}

export { PRESET_DIR as presetDirectory }
