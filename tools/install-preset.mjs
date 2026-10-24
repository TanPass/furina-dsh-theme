#!/usr/bin/env node
/**
 * Install / remove the Furina agent preset.
 *
 *   node tools/install-preset.mjs                 # install (default)
 *   node tools/install-preset.mjs --remove        # remove our block only
 *   node tools/install-preset.mjs --status        # print current state
 *   node tools/install-preset.mjs --preset D:\\my-preset
 *
 * --home overrides DSH_HOME (default ~/.dsh). The preset folder must contain
 * preset.yml and agent.cordis.yml, so it is a plain, replaceable source tree.
 */

import { homedir } from 'node:os'
import { join } from 'node:path'
import { installPreset, presetStatus, removePreset, PRESET_DIR } from '../lib/preset.js'

const args = process.argv.slice(2)
function flag(name) {
  const index = args.indexOf(name)
  return index >= 0 ? args[index + 1] : undefined
}

const home = flag('--home') ?? process.env.DSH_HOME ?? join(homedir(), '.dsh')
const presetDir = flag('--preset') ?? PRESET_DIR

let result
if (args.includes('--status')) result = presetStatus(home)
else if (args.includes('--remove')) result = removePreset(home)
else result = installPreset(home, presetDir)

console.log(JSON.stringify(result, null, 2))
process.exitCode = result.ok ? 0 : 1
