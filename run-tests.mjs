import { spawn } from 'child_process'
import { readdirSync } from 'fs'
import { fileURLToPath } from 'url'
import path from 'path'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const testsDir = path.join(__dirname, 'tests')
const repoRoot = path.resolve(__dirname, '..')

const testFiles = readdirSync(testsDir)
  .filter(f => f.startsWith('test') && f.endsWith('.mjs') && f !== 'test_spark.mjs')

let passed = 0
let failed = 0
let skipped = 0
const failedNames = []
const skippedNames = []

// Definitive failure markers. Deliberately NOT a case-insensitive "FAIL"
// scan: tests define a color-code constant `const FAIL = ...` whose value
// contains the substring "FAIL", which would otherwise cause false positives
// for passing tests. We only treat a test as failed when it emits a clear
// failure signal or exits non-zero.
const failureMarkers = /❌|SOME FAILED|FAILED/

function printRelevant(output) {
  const lines = output.split('\n').filter(Boolean).slice(-15)
  for (const line of lines) {
    if (/❌|FAIL|Error|error|SOME FAILED|failed/i.test(line)) {
      console.log(`  ${line.trim()}`)
    }
  }
}

for (const file of testFiles) {
  const filePath = path.join(testsDir, file)
  process.stdout.write(`▶ ${file} ... `)

  let status = 0
  let output = ''
  try {
    const child = await new Promise((resolve, reject) => {
      const c = spawn('node', [filePath], {
        cwd: repoRoot,
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: true,
      })
      let stdout = '', stderr = ''
      c.stdout.on('data', d => { stdout += d })
      c.stderr.on('data', d => { stderr += d })
      c.on('close', code => resolve({ status: code, output: stdout + stderr }))
      c.on('error', reject)
    })
    status = child.status
    output = child.output
  } catch (err) {
    console.log('ERROR (spawn)')
    failed++
    failedNames.push(file + ' (spawn error)')
    console.log(`  ${err.message}`)
    continue
  }

  if (status === 2) {
    // Explicit SKIP protocol (tests call process.exit(2) when runtime deps
    // such as the Electron viewer are unavailable).
    console.log('SKIP')
    skipped++
    skippedNames.push(file)
  } else if (status === 0) {
    if (failureMarkers.test(output)) {
      console.log('FAIL')
      failed++
      failedNames.push(file)
      printRelevant(output)
    } else {
      console.log('PASS')
      passed++
    }
  } else {
    console.log('FAIL')
    failed++
    failedNames.push(file)
    printRelevant(output)
  }
}

const total = passed + failed + skipped
console.log(`\n── Results: ${passed} passed, ${failed} failed, ${skipped} skipped (${total} total)`)
if (failed > 0) {
  console.log(`   Failed: ${failedNames.join(', ')}`)
  process.exit(1)
}
if (skipped > 0) {
  console.log(`   Skipped: ${skippedNames.join(', ')}`)
}
