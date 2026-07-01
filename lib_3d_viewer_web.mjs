// lib_3d_viewer_web.mjs — Web host adapter for screenplay (chromium + postMessage)
// Re-exports everything from lib-common.mjs, adds Web-specific functions.

import './env.mjs'

import { chromium } from 'playwright'
import { createServer } from 'http'
import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync, renameSync, statSync, readdirSync } from 'fs'
import { join, extname, dirname, basename, relative, resolve } from 'path'
import { fileURLToPath } from 'url'
import { spawnSync } from 'child_process'
const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// Re-export everything from common
export * from './lib-common.mjs'

import {
  screenplayDir,
  setOrientation,
  setGenContext,
  getOrientation,
  getMajorAxis,
  getMinorAxis,
  resolveOrientParam,
  resolveSizePreset,
  resolveOrientationFilter,
  resolve30fps,
  resolveTtsProvider,
  resolveNoWarm,
  zoomUI,
  SIZE_PRESETS,
  MODEL_PORT,
  postMessage,
  postMessageAndWait,
} from './lib-common.mjs'

export let majorAxis = 'x'
export let minorAxis = 'y'

const VIEWER_PORT = 4178

function resolveWebRoot() {
  const configured = process.env['3D_VIEWER_WEB_ROOT']
  if (configured) {
    return configured.startsWith('/') || /^[A-Z]:/.test(configured)
      ? configured
      : resolve(__dirname, configured)
  }
  return join(__dirname, '..')
}

export const rootDir = resolveWebRoot()
export const distDir = join(rootDir, 'dist')
export const fixtureDir = join(rootDir, 'src', 'test', 'fixtures')

export async function waitForModel(page) {
  await page.addInitScript(() => {
    window.__modelLoaded = new Promise(resolve => {
      window.addEventListener('model-loaded', resolve, { once: true })
    })
  })
}

export async function startRecording(page, tPageOpen, entryDuration) {
  entryDuration = resolveOrientParam(entryDuration, getOrientation())
  await zoomUI(page)
  await page.evaluate(() => window.__modelLoaded)
  const trimStart = Date.now() - tPageOpen
  const tModelBrowser = await page.evaluate(() => performance.now())
  await page.evaluate((t) => { window.__tModelBrowser = t }, tModelBrowser)
  if (entryDuration > 0) {
    await page.waitForTimeout(entryDuration)
  }
  return { trimStart, tModelBrowser }
}

export async function loadModel(page, modelPath, opts = {}, timeout = 10000) {
  const url = `http://localhost:${MODEL_PORT}/${modelPath}`
  const resolved = {}
  let resetCanvas = true
  for (const [k, v] of Object.entries(opts)) {
    if (k === 'resetCanvas') {
      resetCanvas = !!v
      continue
    }
    if (typeof v === 'string') {
      const idx = v.indexOf(':')
      if (idx !== -1) {
        resolved[k] = getOrientation() ? v.slice(0, idx).trim() : v.slice(idx + 1).trim()
      } else {
        resolved[k] = v
      }
    } else {
      resolved[k] = v
    }
  }
  if (resolved.entryAnim === 'fade') {
    delete resolved.entryDir
    delete resolved.entryZoomDist
    delete resolved.entryZoomEndDist
    delete resolved.entrySlideDist
    delete resolved.entryTargetShiftY
  }
  await page.evaluate((doReset) => {
    const s = document.createElement('style')
    s.id = '__movie_hide_drop'
    s.textContent = '.pointer-events-none { display: none !important; }'
    document.head.appendChild(s)
    if (doReset) window.__modelStore.getState().reset()
  }, resetCanvas)
  await postMessageAndWait(page, {
    id: 'load-' + Date.now(),
    command: 'loadModel',
    params: { url, ...resolved },
    timeout,
  })
}

export async function unloadModel(page, target, opts = {}) {
  if (typeof target !== 'string') {
    opts = target ?? {}
    target = undefined
  }

  const { type = 'fade', duration = 2000, ease = 'power2.out', ...animOpts } = opts

  if (target) {
    await page.evaluate(async ({ path, duration, ease }) => {
      const gsap = window.__gsap
      const store = window.__modelStore
      const state = store?.getState()
      const fileName = path.split('/').pop() || path
      const file = state?.loadedFiles.find(f => f.filePath === path || f.filePath === fileName)
      if (!file) return

      const group = window.__modelGroupMap?.get(file.id)
      const mats = new Set()
      if (group) {
        group.traverse(obj => {
          if (obj.isMesh && obj.material) {
            const m = obj.material
            ;(Array.isArray(m) ? m : [m]).forEach(mm => mats.add(mm))
          }
        })
      }
      if (mats.size === 0) return

      const arr = [...mats]
      const proxy = { opacity: 1 }
      return new Promise(resolve => {
        gsap.to(proxy, {
          opacity: 0,
          duration: duration / 1000,
          ease,
          onUpdate: () => arr.forEach(m => { m.transparent = true; m.opacity = proxy.opacity }),
          onComplete: resolve,
        })
      })
    }, { path: target, duration, ease })

    await page.waitForTimeout(100)
    await page.evaluate((path) => {
      const fileName = path.split('/').pop() || path
      const store = window.__modelStore
      const state = store?.getState()
      if (!state) return
      const file = state.loadedFiles.find(f => f.filePath === path || f.filePath === fileName)
      if (file) state.removeLoadedFile(file.id)
    }, target)
    return
  }

  await page.evaluate(async ({ duration, ease, ...rest }) => {
    const fn = window.__triggerEntryAnimation
    if (fn) await fn({ ...rest, type: 'fade', duration, ease, reverse: true })
  }, { duration, ease, ...animOpts })

  await page.waitForTimeout(100)
  await page.evaluate(() => {
    const s = document.createElement('style')
    s.id = '__movie_hide_drop'
    s.textContent = '.pointer-events-none { display: none !important; }'
    document.head.appendChild(s)
    window.__modelStore?.getState()?.reset()
  })
}

export async function recordOne(browser, viewerUrl, viewport, suffix, pageFn, recordDir, entryDuration, modelBuffer, hdrBuffers, ttsTiming) {
  const context = await browser.newContext({
    viewport,
    recordVideo: { dir: recordDir, size: viewport },
  })
  const page = await context.newPage()
  page.on('console', msg => {
    if (msg.type() === 'error') console.log('[browser:error]', msg.text())
  })

  if (modelBuffer) {
    await page.route('**/*.glb', async (route) => {
      await route.fulfill({
        contentType: 'model/gltf-binary',
        body: modelBuffer,
        headers: { 'Access-Control-Allow-Origin': '*' },
      })
    })
  }
  if (hdrBuffers && hdrBuffers.size > 0) {
    await page.route('**/*.hdr', async (route) => {
      const buffer = hdrBuffers.get(route.request().url())
      if (buffer) {
        await route.fulfill({
          contentType: 'image/vnd.radiance',
          body: buffer,
          headers: { 'Access-Control-Allow-Origin': '*' },
        })
      } else {
        await route.continue()
      }
    })
  }

  await waitForModel(page)

  const tPageOpen = Date.now()
  console.log(`[${suffix}] Navigating...`)
  await page.goto(viewerUrl, { waitUntil: 'networkidle', timeout: 30000 })

  const isLandscape = viewport.width > viewport.height
  setOrientation(isLandscape)
  majorAxis = isLandscape ? 'x' : 'y'
  minorAxis = isLandscape ? 'y' : 'x'

  await page.waitForSelector('canvas', { timeout: 20000 })
  await page.waitForFunction(() => typeof (window).__modelStore?.getState === 'function', { timeout: 15000 })

  const tPageFn = Date.now()
  const { trimStart, tModelBrowser } = await startRecording(page, tPageOpen, entryDuration)

  if (ttsTiming) {
    await page.evaluate((timing) => {
      window.__ttsTiming = timing
      window.__ttsGroupIndex = 0
    }, ttsTiming)
  }

  await pageFn(page, suffix, tPageOpen)

  const rawSPs = await page.evaluate(() => {
    const sps = window.__movieSyncPoints
    window.__movieSyncPoints = []
    window.__ttsTiming = undefined
    return sps || []
  })
  const syncpoints = rawSPs.map(t => (t - tModelBrowser) / 1000)

  let pageFnDuration = Date.now() - tPageFn

  if (ttsTiming) {
    const requiredEnd = ttsTiming.ttsTotal * 1000
    if (pageFnDuration < requiredEnd) {
      const waitMs = Math.round(requiredEnd - pageFnDuration)
      console.log(`  [syncpoint implicit] Extending video by ${(waitMs / 1000).toFixed(2)}s for TTS total alignment...`)
      await page.waitForTimeout(waitMs)
      pageFnDuration = Date.now() - tPageFn
    }

    const diff = (pageFnDuration - ttsTiming.ttsTotal * 1000) / 1000
    if (Math.abs(diff) > 1.0) {
      const which = diff > 0 ? 'video longer' : 'audio longer'
      console.log(`  [syncpoint total] ${which} by ${Math.abs(diff).toFixed(2)}s (video=${(pageFnDuration / 1000).toFixed(2)}s, tts=${ttsTiming.ttsTotal.toFixed(2)}s)`)
    }
  }

  const rawPath = await page.video()?.path()
  await context.close()
  return { rawPath, trimStart, pageFnDuration, syncpoints }
}

function resolveOrientParams(params, isLandscape) {
  const result = {}
  for (const [key, value] of Object.entries(params)) {
    result[key] = resolveOrientParam(value, isLandscape)
  }
  return result
}

export async function makeMovie(scriptUrl, modelPath, viewerParams, pageFn, outputDir) {
  const scriptName = basename(fileURLToPath(scriptUrl), '.mjs')
  const outDir = outputDir || join(dirname(fileURLToPath(scriptUrl)), 'gen')
  setGenContext(outDir, scriptName)
  mkdirSync(outDir, { recursive: true })

  const scriptPath = fileURLToPath(scriptUrl)
  const ttsTimingPath = join(outDir, `${scriptName}.tts-timing.json`)
  const forceTts = process.argv.slice(2).includes('-f') || process.argv.slice(2).includes('--force')
  const ttsProvider = resolveTtsProvider()
  const ttsArgs = [join(screenplayDir, 'pregen-tts.mjs'), scriptPath]
  if (forceTts) ttsArgs.push('--force')
  if (ttsProvider) ttsArgs.push('--tts', ttsProvider)
  const r = spawnSync('node', ttsArgs, { stdio: 'inherit', timeout: 600000 })
  if (r.status !== 0) process.exit(r.status ?? 1)

  let ttsTiming = null
  if (existsSync(ttsTimingPath)) {
    ttsTiming = JSON.parse(readFileSync(ttsTimingPath, 'utf-8'))
    console.log(`TTS timing: ${ttsTiming.groups.length} groups, total ${ttsTiming.ttsTotal.toFixed(2)}s`)
  }

  if (!(process.argv.slice(2).includes('-f') || process.argv.slice(2).includes('--force'))) {
    const checkPreset = resolveSizePreset()
    const checkOrientationFilter = resolveOrientationFilter()
    const checkOrientations = checkOrientationFilter !== 'both'
      ? checkPreset.orientations.filter(o => o.suffix === `_${checkOrientationFilter}`)
      : checkPreset.orientations
    const srcMtime = statSync(scriptPath).mtimeMs
    const timingMtime = existsSync(ttsTimingPath) ? statSync(ttsTimingPath).mtimeMs : 0
    const allCached = checkOrientations.every(({ suffix }) => {
      const webmPath = join(outDir, `${scriptName}${suffix}.webm`)
      if (!existsSync(webmPath)) return false
      return statSync(webmPath).mtimeMs >= srcMtime && statSync(webmPath).mtimeMs >= timingMtime
    })
    if (allCached) {
      console.log(`\n✓ Video up-to-date for ${scriptName} — skipping recording`)
      return
    }
  }

  const viewerServer = await createStaticServer(distDir, VIEWER_PORT)
  const modelServer = await createStaticServer(rootDir, MODEL_PORT)

  const MODEL_URL = `http://localhost:${MODEL_PORT}/${modelPath}`
  console.log(`Model:  ${MODEL_URL}`)

  const preset = resolveSizePreset()
  console.log(`Size preset: ${preset.label} (${preset.orientations.map(o => `${o.width}×${o.height}`).join(', ')})`)

  const modelBuffer = readFileSync(join(rootDir, modelPath))
  const hdrSuffix = preset === SIZE_PRESETS.g ? '_4k' : '_2k'
  const hdrBuffers = new Map()
  const moviesRoot = join(rootDir, 'movies')
  if (existsSync(moviesRoot)) {
    for (const f of readdirSync(moviesRoot)) {
      if (f.endsWith(`${hdrSuffix}.hdr`)) {
        const url = `http://localhost:${MODEL_PORT}/${f}`
        hdrBuffers.set(url, readFileSync(join(moviesRoot, f)))
      }
    }
  }

  const animType = viewerParams.entryAnim
  const explicitDir = viewerParams.entryDir

  const browser = await chromium.launch({ headless: false, args: ['--force-device-scale-factor=1'] })
  const results = []

  const orientationFilter = resolveOrientationFilter()
  const orientations = orientationFilter !== 'both'
    ? preset.orientations.filter(o => o.suffix === `_${orientationFilter}`)
    : preset.orientations

  if (!resolveNoWarm()) {
    const first = orientations[0]
    if (first) {
      const { width, height, suffix } = first
      const isLandscape = width > height
      const warmResolved = resolveOrientParams(viewerParams, isLandscape)
      const warmParams = new URLSearchParams({ url: MODEL_URL, movie_mode: '1', ...warmResolved })
      if (animType === 'slide' && !explicitDir) {
        warmParams.set('entryDir', isLandscape ? 'left' : 'top')
      }
      const warmUrl = `http://localhost:${VIEWER_PORT}/#/workspace?${warmParams.toString()}`
      console.log(`[warmup] ${suffix} ${width}×${height}: warming up cache and WebGL...`)
      const warmCtx = await browser.newContext({ viewport: { width, height } })
      const warmPage = await warmCtx.newPage()
      try {
        await warmPage.goto(warmUrl, { waitUntil: 'networkidle', timeout: 30000 })
        await warmPage.waitForTimeout(1000)
      } catch (e) {
        console.error('[warmup] Ignored:', e.message)
      }
      await warmCtx.close()
      console.log('[warmup] Done')
    }
  }

  for (const { width, height, suffix } of orientations) {
    const isLandscape = width > height
    const resolvedParams = resolveOrientParams(viewerParams, isLandscape)

    const params = new URLSearchParams({ url: MODEL_URL, movie_mode: '1', ...resolvedParams })
    if (animType === 'slide' && !explicitDir) {
      params.set('entryDir', isLandscape ? 'left' : 'top')
    }
    const resolvedEntryDuration = resolvedParams.entryDuration ? parseInt(resolvedParams.entryDuration, 10) : 2000
    const viewerUrl = `http://localhost:${VIEWER_PORT}/#/workspace?${params.toString()}`
    console.log(`[${suffix}] Viewer: ${viewerUrl}`)
    try {
      const result = await recordOne(browser, viewerUrl, { width, height }, suffix, pageFn, outDir, resolvedEntryDuration, modelBuffer, hdrBuffers, ttsTiming)
      result.suffix = suffix
      results.push(result)
    } catch (err) {
      console.error(`\n[${suffix}] Recording FAILED: ${err.message}`)
      if (err.stack) console.error(`[${suffix}] Stack:\n${err.stack}`)
      process.exit(1)
    }
  }

  await browser.close()
  viewerServer.close()
  modelServer.close()

  const allSyncpoints = results[0]?.syncpoints || []
  if (allSyncpoints.length > 0) {
    const spPath = join(outDir, `${scriptName}.syncpoints.json`)
    writeFileSync(spPath, JSON.stringify(allSyncpoints) + '\n')
    console.log(`Syncpoints: ${spPath} (${allSyncpoints.length} points)`)
  }

  for (const { suffix, rawPath, trimStart, pageFnDuration } of results) {
    if (!rawPath || !existsSync(rawPath)) {
      console.error(`\n[${suffix}] No recorded video found — recording produced no output file`)
      process.exit(1)
    }

    const outputVideo = join(outDir, `${scriptName}${suffix}.webm`)
    const tempVideo = outputVideo.replace(/\.\w+$/, '.tmp$&')

    console.log(`[${suffix}] Trimming (start=${(trimStart / 1000).toFixed(2)}s, duration=${(pageFnDuration / 1000).toFixed(2)}s)...`)
    const r2 = spawnSync('ffmpeg', [
      '-y',
      '-ss', (trimStart / 1000).toFixed(2),
      '-i', rawPath,
      '-t', (pageFnDuration / 1000).toFixed(2),
      '-c:v', 'libvpx-vp9',
      '-b:v', '8M',
      '-pix_fmt', 'yuv420p',
      tempVideo,
    ], { stdio: 'pipe' })
    if (r2.status === 0) {
      if (existsSync(outputVideo)) rmSync(outputVideo, { force: true })
      renameSync(tempVideo, outputVideo)
      const mb = (readFileSync(outputVideo).length / 1024 / 1024).toFixed(2)
      console.log(`  ${basename(outputVideo)} (${mb} MB)`)
    } else {
      const stderr = r2.stderr ? r2.stderr.toString() : '(no stderr output)'
      console.error(`\n  FFmpeg trim FAILED (exit code ${r2.status}):`)
      console.error(stderr.slice(-2000))
      process.exit(1)
    }

    if (existsSync(rawPath)) rmSync(rawPath)
  }

  console.log('Done!')
}

function createStaticServer(root, port) {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      const urlPath = req.url.split('?')[0]
      const filePath = join(root, urlPath === '/' ? 'index.html' : urlPath)

      if (req.method === 'OPTIONS') {
        res.writeHead(204, {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS',
          'Access-Control-Allow-Headers': '*',
        })
        res.end()
        return
      }

      if (req.method === 'PUT') {
        const chunks = []
        req.on('data', chunk => chunks.push(chunk))
        req.on('end', () => {
          const dir = dirname(filePath)
          if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
          writeFileSync(filePath, Buffer.concat(chunks))
          const url = `http://localhost:${port}${urlPath}`
          res.writeHead(200, {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
          })
          res.end(JSON.stringify({ url }))
        })
        return
      }

      if (!existsSync(filePath)) {
        res.writeHead(404, { 'Access-Control-Allow-Origin': '*' })
        res.end()
        return
      }
      const ext = extname(filePath)
      const MIME_MAP = {
        '.html': 'text/html',
        '.js': 'text/javascript',
        '.css': 'text/css',
        '.glb': 'model/gltf-binary',
        '.png': 'image/png',
        '.wasm': 'application/wasm',
        '.svg': 'image/svg+xml',
        '.hdr': 'image/vnd.radiance',
        '.json': 'application/json',
        '.ico': 'image/x-icon',
      }
      res.writeHead(200, {
        'Content-Type': MIME_MAP[ext] || 'application/octet-stream',
        'Access-Control-Allow-Origin': '*',
      })
      res.end(readFileSync(filePath))
    })
    server.listen(port, () => resolve(server))
  })
}
