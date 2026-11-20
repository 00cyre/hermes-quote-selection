// Runs tests/app/*.test.tsx inside a Hermes source checkout, so the plugin meets
// the app's real plugin SDK, composer slot, middleware chain and runtime loader.
//
//   HERMES_SRC=~/.hermes/hermes-agent npm run test:app
//
// The files are copied into a temporary folder under apps/desktop/src and the
// folder is removed afterwards. Nothing else in the checkout is touched.
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const given = process.env.HERMES_SRC
const desktop = given && path.join(path.resolve(given.replace(/^~(?=$|\/)/, os.homedir())), 'apps', 'desktop')
const vitest = desktop && path.join(desktop, 'node_modules', '.bin', 'vitest')

if (!vitest || !fs.existsSync(vitest)) {
  console.error('Set HERMES_SRC to a Hermes source checkout whose apps/desktop dependencies are installed.')
  process.exit(2)
}

const folder = '__quote_selection_check__'
const target = path.join(desktop, 'src', folder)

if (fs.existsSync(target)) {
  console.error(`${target} already exists. Remove it and run again.`)
  process.exit(2)
}

fs.mkdirSync(target)

try {
  fs.copyFileSync(path.join(__dirname, '..', '..', 'desktop', 'plugin.js'), path.join(target, 'plugin.js'))

  for (const file of fs.readdirSync(__dirname).filter(name => name.endsWith('.test.tsx'))) {
    fs.copyFileSync(path.join(__dirname, file), path.join(target, file))
  }

  const run = spawnSync(vitest, ['run', '--project', 'ui', `src/${folder}/`], { cwd: desktop, stdio: 'inherit' })

  process.exitCode = run.status ?? 1
} finally {
  fs.rmSync(target, { recursive: true, force: true })
}
