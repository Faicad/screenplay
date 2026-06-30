// lib-electron.mjs — Electron host adapter for screenplay
// Re-exports everything from lib-common.mjs, adds Electron-specific functions.

// Load .env first so 3D_VIEWER_ELECTRON_ROOT is available
import './env.mjs'

import { _electron as electron } from 'playwright'
import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync, renameSync, statSync } from 'fs'
import { join, extname, dirname, basename, resolve } from 'path'
import { fileURLToPath } from 'url'
import { spawnSync } from 'child_process'
const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// Re-export everything from common
export * from './lib-common.mjs'

// Import what we need to use locally
import {
  screenplayDir,
  moviesDir,
  setOrientation,
  setGenContext,
  getOrientation,
  resolveOrientParam,
  resolveSizePreset,
  resolveOrientationFilter,
  resolve30fps,
  resolveTtsProvider,
  zoomUI,
  SIZE_PRESETS,
  MODEL_PORT,
} from './lib-common.mjs'

// ── Host project path resolution ──

/**
 * Resolve the Electron host project root directory.
 * Configured via 3D_VIEWER_ELECTRON_ROOT in .env (relative path = relative to screenplay dir).
 * Falls back to assuming screenplay is inside the host project (__dirname/..).
 */
function resolveElectronRoot() {
  const configured = process.env['3D_VIEWER_ELECTRON_ROOT'] || process.env.ELECTRON_ROOT
  if (configured) {
    return configured.startsWith('/') || /^[A-Z]:/.test(configured)
      ? configured
      : resolve(__dirname, configured)
  }
  // Backward compat
  return join(__dirname, '..')
}

export const rootDir = resolveElectronRoot()
export const distDir = join(rootDir, 'dist')
export const fixtureDir = join(rootDir, 'src', 'test', 'fixtures')

// ── Electron-specific functions ──

/**
 * Electron: wait for model to finish loading by polling the model store.
 * Web uses addInitScript + model-loaded event; Electron uses executeCommand.
 */
export async function waitForModel(page) {
  await page.waitForFunction(
    () => window.__modelStore?.getState().__loadingPhase === 'done',
    { timeout: 60000 },
  )
}

/** Standard recording opening: zoomUI → wait for model → entry animation → calculate trimStart */
export async function startRecording(page, tPageOpen, entryDuration) {
  entryDuration = resolveOrientParam(entryDuration, getOrientation())
  await zoomUI(page)
  await waitForModel(page)
  const trimStart = Date.now() - tPageOpen
  const tModelBrowser = await page.evaluate(() => performance.now())
  await page.evaluate((t) => { window.__tModelBrowser = t }, tModelBrowser)
  if (entryDuration > 0) {
    await page.waitForTimeout(entryDuration)
  }
  return { trimStart, tModelBrowser }
}

/** Clear scene and load a model by path. Uses Electron's executeCommand('loadFile'). */
export async function loadModel(page, modelPath, opts = {}, timeout = 60000) {
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
  const absPath = resolve(modelPath)
  const loadFileParams = { filePath: absPath }
  const entryKeys = ['entryAnim', 'entryDir', 'entryDuration', 'entryZoomDist', 'entryZoomEndDist', 'entrySlideDist', 'entryTargetShiftY', 'entryEase']
  for (const key of entryKeys) {
    if (resolved[key] != null) loadFileParams[key] = resolved[key]
  }
  const result = await page.evaluate(async (p) => {
    return window.__executeCommand('loadFile', p)
  }, loadFileParams)
  if (result?.status === 'error') {
    throw new Error(`Failed to load model: ${result.error}`)
  }
  await waitForModel(page)
}

/** Clear the scene, optionally for a specific model file. */
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

  // All clear: scene-level fade, then reset
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

/** Electron executable path. Override via ELECTRON_EXE env var or 3D_VIEWER_ELECTRON_ROOT. */
function getElectronExePath() {
  if (process.env.ELECTRON_EXE) return process.env.ELECTRON_EXE
  // Derive from host root
  const exePath = join(rootDir, 'dist', 'win-unpacked', '3D_Viewer.exe')
  if (existsSync(exePath)) return exePath
  throw new Error(
    'Cannot find Electron executable. Set ELECTRON_EXE env var or 3D_VIEWER_ELECTRON_ROOT in .env.\n' +
    '  Expected: ' + exePath
  )
}

export async function recordOne(electronApp, page, viewport, suffix, pageFn, recordDir, entryDuration, modelPath, ttsTiming, viewerParams) {
  page.on('console', msg => {
    if (msg.type() === 'error') console.log('[browser:error]', msg.text())
  })

  // Resize the actual Electron BrowserWindow
  const bwHandle = await electronApp.browserWindow(page)
  await bwHandle.evaluate((bw, { width, height }) => {
    bw.setContentSize(width, height)
  }, { width: viewport.width, height: viewport.height })
  await page.setViewportSize(viewport)

  // Wait for app to be ready
  await page.waitForSelector('canvas', { timeout: 20000 })
  await page.waitForFunction(() => typeof (window).__executeCommand === 'function', { timeout: 15000 })
  await page.waitForFunction(() => typeof (window).__modelStore?.getState === 'function', { timeout: 15000 })

  const bwCheck = await bwHandle.evaluate((bw) => ({
    bounds: bw.getBounds(),
    contentSize: bw.getContentSize(),
  }))
  console.log(`[${suffix}] BrowserWindow: bounds=${JSON.stringify(bwCheck.bounds)} contentSize=${JSON.stringify(bwCheck.contentSize)}`)

  setOrientation(viewport.width > viewport.height)

  // Apply viewerParams to stores
  if (viewerParams) {
    await page.evaluate((vp) => {
      const store = window.__engineStore?.getState?.()
      if (!store) return
      if (vp.movie_mode === '1' || vp.movie_mode === true) {
        store.setMovieMode(true)
        store.setControlsEnabled(false)
      }
      if (vp.AutoRotate != null) {
        store.setAutoRotate(vp.AutoRotate === '1' || vp.AutoRotate === 'true' || vp.AutoRotate === true)
      }
      if (vp.shadowFloorEnabled != null) {
        const val = vp.shadowFloorEnabled === '1' || vp.shadowFloorEnabled === 'true' || vp.shadowFloorEnabled === true
        store.setShadowFloorEnabled(val)
      }
    }, viewerParams)
    const closeLeft = viewerParams.closeLeftPanel != null &&
      (viewerParams.closeLeftPanel === '1' || viewerParams.closeLeftPanel === 'true' || viewerParams.closeLeftPanel === true)
    const closeRight = viewerParams.closeRightPanel != null &&
      (viewerParams.closeRightPanel === '1' || viewerParams.closeRightPanel === 'true' || viewerParams.closeRightPanel === true)
    const noPreview = viewerParams.enablePreview === '0' || viewerParams.enablePreview === 'false' || viewerParams.enablePreview === false
    const uiPatch = {}
    if (closeLeft) uiPatch.leftPanelOpen = false
    if (closeRight) uiPatch.rightPanelOpen = false
    if (noPreview) uiPatch.enablePreview = false
    if (Object.keys(uiPatch).length > 0) {
      await page.evaluate((patch) => {
        window.__uiStore?.setState?.(patch)
      }, uiPatch)
      await page.waitForTimeout(300)
    }
  }

  const tPageOpen = Date.now()
  console.log(`[${suffix}] Loading model: ${modelPath}`)

  const loadFileParams = { filePath: modelPath }
  if (viewerParams) {
    const entryKeys = ['entryAnim', 'entryDir', 'entryDuration', 'entryZoomDist', 'entryZoomEndDist', 'entrySlideDist', 'entryTargetShiftY', 'entryEase']
    for (const key of entryKeys) {
      if (viewerParams[key] != null) loadFileParams[key] = viewerParams[key]
    }
    if (viewerParams.entryAnim === 'fade') {
      delete loadFileParams.entryDir
      delete loadFileParams.entryZoomDist
      delete loadFileParams.entryZoomEndDist
      delete loadFileParams.entrySlideDist
      delete loadFileParams.entryTargetShiftY
    }
  }
  const loadResult = await page.evaluate(async (fp) => {
    return window.__executeCommand('loadFile', fp)
  }, loadFileParams)
  if (loadResult?.status === 'error') {
    throw new Error(`Failed to load model: ${loadResult.error}`)
  }
  console.log(`[${suffix}] Model loaded: ${loadResult?.data?.fileName}`)

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
  return { rawPath, trimStart, pageFnDuration, syncpoints }
}

export async function makeMovie(scriptUrl, modelPath, viewerParams, pageFn, outputDir) {
  const scriptPath = fileURLToPath(scriptUrl)
  const scriptName = basename(scriptPath, extname(scriptPath))
  const outDir = outputDir || join(dirname(scriptPath), 'gen')
  setGenContext(outDir, scriptName)
  mkdirSync(outDir, { recursive: true })

  let absModelPath = resolve(modelPath)
  // If model not found at resolved path, try screenplay root by basename.
  // This handles models that were moved from host project to screenplay.
  if (!existsSync(absModelPath)) {
    const altPath = join(screenplayDir, basename(modelPath))
    if (existsSync(altPath)) {
      console.log(`  Model not found at ${absModelPath}`)
      console.log(`  Using screenplay copy: ${altPath}`)
      absModelPath = altPath
    }
  }

  // ── Pre-generate TTS timing ──
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

  // ── Check if all orientations' webm are up-to-date ──
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

  const preset = resolveSizePreset()
  console.log(`Size preset: ${preset.label} (${preset.orientations.map(o => `${o.width}×${o.height}`).join(', ')})`)

  const orientationFilter = resolveOrientationFilter()
  const orientations = orientationFilter !== 'both'
    ? preset.orientations.filter(o => o.suffix === `_${orientationFilter}`)
    : preset.orientations

  const results = []

  for (const { width, height, suffix } of orientations) {
    const isLandscape = width > height
    const viewport = { width, height }

    const resolvedParams = {}
    for (const [key, value] of Object.entries(viewerParams)) {
      resolvedParams[key] = resolveOrientParam(value, isLandscape)
    }
    const resolvedEntryDuration = resolvedParams.entryDuration ? parseInt(resolvedParams.entryDuration, 10) : 2000

    console.log(`[${suffix}] Launching Electron (${width}×${height})...`)
    const electronApp = await electron.launch({
      executablePath: getElectronExePath(),
      args: ['--no-sandbox', '--disable-gpu-shader-disk-cache', '--force-device-scale-factor=1'],
      env: { ...process.env, E2E: '1', MOVIE_MODE: '1', MOVIE_VIEWPORT_WIDTH: String(width), MOVIE_VIEWPORT_HEIGHT: String(height) },
      recordVideo: { dir: outDir, size: viewport },
    })
    const page = await electronApp.firstWindow()

    try {
      const result = await recordOne(electronApp, page, viewport, suffix, pageFn, outDir, resolvedEntryDuration, absModelPath, ttsTiming, resolvedParams)
      result.suffix = suffix
      results.push(result)
    } catch (err) {
      console.error(`\n[${suffix}] Recording FAILED: ${err.message}`)
      if (err.stack) console.error(`[${suffix}] Stack:\n${err.stack}`)
      try { await electronApp.close() } catch {}
      process.exit(1)
    }

    await electronApp.close()
  }

  // Write syncpoints from first orientation
  const allSyncpoints = results[0]?.syncpoints || []
  if (allSyncpoints.length > 0) {
    const spPath = join(outDir, `${scriptName}.syncpoints.json`)
    writeFileSync(spPath, JSON.stringify(allSyncpoints) + '\n')
    console.log(`Syncpoints: ${spPath} (${allSyncpoints.length} points)`)
  }

  // ── FFmpeg trim ──
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
