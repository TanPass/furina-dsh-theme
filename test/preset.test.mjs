import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { PRESET_DIR, installPreset, presetStatus, removePreset, renderPresetBlock } from '../lib/preset.js'

function scratchProfile() {
  const home = mkdtempSync(join(tmpdir(), 'furina-preset-'))
  const profile = join(home, 'profiles', 'web')
  mkdirSync(profile, { recursive: true })
  writeFileSync(join(profile, 'package.json'), JSON.stringify({
    name: 'web-profile',
    dependencies: { 'furina-dsh-theme': 'file:C:/x/furina-dsh-theme-1.2.6.tgz' },
  }))
  writeFileSync(join(profile, 'cordis.patch.yml'), [
    '- id: ui-theme',
    '  name: "@deepseek-ai/dsh-client-ui-theme"',
    '  config:',
    '    preference: system',
    '',
  ].join('\n'))
  return { home, profile }
}

test('renderPresetBlock emits one valid declaration row', () => {
  const block = renderPresetBlock()
  assert.match(block, /# \[furina-dsh-theme\] furina agent preset — begin/)
  assert.match(block, /- insert:/)
  assert.match(block, /- id: preset-furina-de-fontaine/)
  assert.match(block, /name: '@deepseek-ai\/dsh-agent-preset'/)
  assert.match(block, /id: furina-de-fontaine/)
  assert.match(block, /name: "芙宁娜·德·枫丹"/)
  assert.match(block, /plugins:/)
  assert.match(block, /- id: persona/)
  assert.match(block, /complete: true/)
  assert.ok(block.length > 8000)
})

test('install, status, re-install and remove touch only our marker block', () => {
  const { home, profile } = scratchProfile()
  const before = readFileSync(join(profile, 'cordis.patch.yml'), 'utf8')
  assert.equal(presetStatus(home).installed, false)

  const first = installPreset(home)
  assert.equal(first.ok, true)
  assert.equal(first.installed, true)
  assert.equal(first.already, false)
  assert.ok(first.backup)
  const installed = readFileSync(join(profile, 'cordis.patch.yml'), 'utf8')
  assert.ok(installed.startsWith(before.trimEnd()))
  assert.equal(presetStatus(home).installed, true)

  const again = installPreset(home)
  assert.equal(again.ok, true)
  assert.equal(again.installed, true)

  const custom = `${installed}\n- id: other-theme\n  name: other\n  config:\n    a: 1\n`
  writeFileSync(join(profile, 'cordis.patch.yml'), custom)
  const removed = removePreset(home)
  assert.equal(removed.ok, true)
  assert.equal(removed.installed, false)
  const after = readFileSync(join(profile, 'cordis.patch.yml'), 'utf8')
  assert.ok(!after.includes('furina agent preset'))
  assert.match(after, /- id: other-theme/)
  assert.ok(after.startsWith(before.trimEnd()))
  assert.equal(presetStatus(home).installed, false)
})

test('invalid preset folder is reported without touching the profile', () => {
  const { home, profile } = scratchProfile()
  const before = readFileSync(join(profile, 'cordis.patch.yml'), 'utf8')
  const empty = mkdtempSync(join(tmpdir(), 'furina-empty-'))
  const result = installPreset(home, empty)
  assert.equal(result.ok, false)
  assert.match(String(result.error), /preset-invalid/)
  assert.equal(readFileSync(join(profile, 'cordis.patch.yml'), 'utf8'), before)
})

test('bundled preset sources point persona at the Furina prompt', () => {
  const meta = readFileSync(join(PRESET_DIR, 'preset.yml'), 'utf8')
  assert.match(meta, /^id: furina-de-fontaine$/m)
  assert.match(meta, /^description: ".+"$/m)
  const plugins = readFileSync(join(PRESET_DIR, 'agent.cordis.yml'), 'utf8')
  assert.match(plugins, /^- id: persona$/m)
  assert.ok(plugins.includes('芙宁娜'))
  assert.ok(!plugins.includes('\uFFFD'))
})

test('bundled preset matches the DSH 0.2.2 plugin schema', () => {
  const source = readFileSync(join(PRESET_DIR, 'agent.cordis.yml'), 'utf8')
  // Comments explain the 0.2.2 differences, so only declaration lines count.
  const code = source.split(/\r?\n/u).filter((line) => !/^\s*#/u.test(line)).join('\n')
  // Removed in 0.2.2: the subpath export no longer exists, so this row fails the
  // import and takes the whole preset mount down with it (agent-preset/invalid).
  assert.ok(!code.includes('dsh-tool-subagent-control/list-agents'), 'list-agents row is gone in 0.2.2')
  // Renamed in 0.2.2: modelSelectionSettings -> modelSelection + modelDiscovery.
  assert.ok(!code.includes('modelSelectionSettings'))
  assert.match(code, /^\s*modelSelection: true$/m)
  assert.match(code, /^\s*modelDiscovery: true$/m)
  // Every plugin name in the preset must be a real 0.2.2 package (subpaths
  // excepted); a typo here only shows up as a failed mount at session creation.
  const names = [...code.matchAll(/name: '(@deepseek-ai\/[^']+)'/gu)].map((match) => match[1])
  assert.ok(names.length > 20, 'preset should declare the full tool set')
  // `@scope/name` has one slash. The two `/tools` subpaths are deliberate: they
  // are the plugin-manager and plugin-market tool surfaces, both still exported
  // by 0.2.2 and both disabled in the preset.
  const allowedSubpaths = new Set([
    '@deepseek-ai/dsh-plugin-manager/tools',
    '@deepseek-ai/dsh-plugin-market/tools',
  ])
  for (const name of names) {
    if (name.split('/').length === 2) continue
    assert.ok(allowedSubpaths.has(name), `unexpected subpath plugin name: ${name}`)
  }
})
