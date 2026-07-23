import { existsSync, mkdirSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import * as lib from '../lib_3d_viewer_electron.mjs'

const __dir = dirname(fileURLToPath(import.meta.url))
const genDir = join(__dir, 'gen')
mkdirSync(genDir, { recursive: true })

const subtitle = `
捕获24种模型格式截图
`

const MODELS = [
  { path: 'res/13+pro+max.stl', label: 'STL' },
  { path: 'res/Mini注塑模具.glb', label: 'STEP/STP' },
  { path: 'src/test/fixtures/vise.3mf', label: '3MF' },
  { path: 'src/test/fixtures/Cerberus.obj', label: 'OBJ' },
  { path: 'res/IridescentDishWithOlives.glb', label: 'GLB/GLTF' },
  { path: 'src/test/fixtures/dolphins_be.ply', label: 'PLY' },
  { path: 'src/test/fixtures/mixamo.fbx', label: 'FBX' },
  { path: 'res/abb_irb52_7_120.dae', label: 'DAE' },
  { path: 'src/test/fixtures/portalgun.3ds', label: '3DS' },
  { path: 'src/test/fixtures/saeukkang.usdz', label: 'USDZ' },
  { path: 'src/test/fixtures/bunny.drc', label: 'DRC' },
  { path: 'src/test/fixtures/pirouette.bvh', label: 'BVH' },
  { path: 'res/liver.vtk.glb', label: 'VTK' },
  { path: 'src/test/fixtures/helix_201.xyz', label: 'XYZ' },
  { path: 'src/test/fixtures/Al2O3.pdb', label: 'PDB' },
  { path: 'src/test/fixtures/I.nrrd', label: 'NRRD' },
  { path: 'src/test/fixtures/benchy.gcode', label: 'GCode' },
  { path: 'src/test/fixtures/camera.wrl', label: 'WRL' },
  { path: 'src/test/fixtures/menger.vox', label: 'VOX' },
  { path: 'src/test/fixtures/Box.kmz', label: 'KMZ' },
  { path: 'src/test/fixtures/rook.amf', label: 'AMF' },
  { path: 'src/test/fixtures/Demo.lwo', label: 'LWO' },
  { path: 'src/test/fixtures/ogro.md2', label: 'MD2' },
  { path: 'src/test/fixtures/Rhino_Logo.3dm', label: '3DM' },
]

/** Resolve model path: try screenplayDir first, fall back to rootDir. */
function modelPath(path) {
  const full = join(lib.screenplayDir, path)
  if (existsSync(full)) return full
  return join(lib.rootDir, path)
}

const ENTRY_MS = 1500

lib.makeMovie(
  import.meta.url,
  modelPath(MODELS[0].path),
  {
    AutoRotate: '0',
    closeLeftPanel: '1',
    closeRightPanel: '1',
    enablePreview: '0',
    entryZoomDist: '5;10',
    entryZoomEndDist: '1.1;1.3',
    entryAnim: 'zoom',
    entryDuration: String(ENTRY_MS),
  },
  async (page, suffix, tPageOpen) => {
    await page.route('**/*', route => {
      const url = route.request().url()
      if (url.includes('fixtures') || url.endsWith('.glb') || url.endsWith('.stl') || url.endsWith('.stp')) {
        route.continue({ headers: { ...route.request().headers(), 'Cache-Control': 'no-cache', 'Pragma': 'no-cache' } })
      } else {
        route.continue()
      }
    })

    // Screenshot model 0 (loaded by makeMovie)
    await page.waitForTimeout(2000)
    await lib.screenshot(page, join(genDir, `thumb_00_STL`))

    for (let i = 1; i < MODELS.length; i++) {
      try {
        await lib.loadModel(page, modelPath(MODELS[i].path), {
          entryAnim: 'zoom',
          entryDuration: ENTRY_MS,
          entryZoomDist: '5;10',
          entryZoomEndDist: '1.1;1.3',
        })
        await page.waitForTimeout(2000)
        const idx = String(i).padStart(2, '0')
        await lib.screenshot(page, join(genDir, `thumb_${idx}_${MODELS[i].label.replace(/[/ ]/g, '_')}`))
        console.log(`  [${suffix}] Captured ${MODELS[i].label}`)
      } catch {
        console.log(`  [${suffix}] Failed to load ${MODELS[i].label}, skipping`)
        await page.waitForTimeout(1000)
      }
    }

    await page.waitForTimeout(500)
  },
)