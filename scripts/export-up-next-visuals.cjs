/* Bake the current module scenes into transparent popup plates.
 * Run: node scripts/export-up-next-visuals.cjs
 * Electron/Vite are build-time tools only; popups load ordinary WebP images.
 */
const { spawnSync } = require('node:child_process')
const path = require('node:path')
const fs = require('node:fs')

if (!process.versions.electron) {
  const result = spawnSync(require('electron'), [__filename], { stdio: 'inherit' })
  process.exit(result.status ?? 1)
}

const { app, BrowserWindow } = require('electron')
const root = path.resolve(__dirname, '..')
app.setPath('userData', path.join(require('node:os').tmpdir(), 'iqm-up-next-export'))

const page = `<!doctype html><html><body style="margin:0">
<div id="host" style="width:1400px;height:1000px;display:block"></div>
<script type="module">
import * as THREE from 'three';
import { createMajoranaScene } from '/js/modules/build-majorana-2/majorana-scene.js';
import { createShapeScenePool } from '/js/core/shape-scene-3d.js';

// Keep the final GPU frame readable only in this offline export process.
const getContext = HTMLCanvasElement.prototype.getContext;
HTMLCanvasElement.prototype.getContext = function (kind, options) {
  return getContext.call(this, kind, kind.startsWith('webgl')
    ? { ...options, preserveDrawingBuffer: true } : options);
};
const frames = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
const host = document.querySelector('#host');
const matchMedia = window.matchMedia.bind(window);
window.matchMedia = query => query.includes('prefers-reduced-motion')
  ? { matches: true, addEventListener() {}, removeEventListener() {} } : matchMedia(query);

function plate(source) {
  const canvas = document.createElement('canvas');
  canvas.width = source.width;
  canvas.height = source.height;
  const context = canvas.getContext('2d');
  context.drawImage(source, 0, 0);
  const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
  let left = canvas.width, top = canvas.height, right = 0, bottom = 0;
  for (let y = 0; y < canvas.height; y++) for (let x = 0; x < canvas.width; x++) {
    if (data[(y * canvas.width + x) * 4 + 3] < 8) continue;
    left = Math.min(left, x); right = Math.max(right, x);
    top = Math.min(top, y); bottom = Math.max(bottom, y);
  }
  if (right <= left || bottom <= top) throw new Error('Empty scene export');
  const padding = 24;
  const output = document.createElement('canvas');
  output.width = right - left + 1 + padding * 2;
  output.height = bottom - top + 1 + padding * 2;
  output.getContext('2d').drawImage(canvas, left, top, right - left + 1,
    bottom - top + 1, padding, padding, right - left + 1, bottom - top + 1);
  return { data: output.toDataURL('image/webp', 0.98), width: output.width, height: output.height };
}

window.exportPlates = async () => {
  console.log('Rendering Majorana');
  const majorana = await createMajoranaScene({ host, signal: new AbortController().signal });
  await frames();
  const chip = plate(host.querySelector('canvas'));
  majorana.dispose();
  console.log('Rendering nanowire');

  // Use navigation's own geometry, materials, environment and lights. Pause
  // its animation and choose a fixed blue flow frame for a repeatable plate.
  const pool = await createShapeScenePool({
    hosts: [{ moduleId: 'build-nanowire', element: host }], isVisible: () => false
  });
  if (!pool?.entries.length) throw new Error('Nanowire navigation scene unavailable');
  const entry = pool.entries[0];
  entry.ground.visible = false;
  if (entry.contactShadow) entry.contactShadow.plane.visible = false;
  // Floor/grid meshes are separate scene children; the subject lives in stage.
  entry.scene.children.forEach(node => { if (node.isMesh) node.visible = false; });
  entry.shapes.forEach(shape => shape.group.userData.update?.(10));
  const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true });
  renderer.setSize(2800, 2000, false);
  renderer.setClearColor(0, 0);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.18;
  renderer.render(entry.scene, entry.camera);
  const wire = plate(renderer.domElement);
  renderer.dispose();
  pool.dispose();
  return { 'build-majorana-2': chip, 'build-nanowire': wire };
};
</script></body></html>`

app.whenReady().then(async () => {
  let server
  let win
  try {
    const { createServer } = await import('vite')
    server = await createServer({
      configFile: path.join(root, 'vite.config.js'),
      server: { port: 5278, strictPort: true },
      plugins: [{ name: 'up-next-export', configureServer(vite) {
        vite.middlewares.use('/__up-next-export', async (_request, response) => {
          response.setHeader('Content-Type', 'text/html')
          response.end(await vite.transformIndexHtml('/__up-next-export', page))
        })
      } }]
    })
    await server.listen()
    console.log('Export server listening', server.httpServer.address())
    win = new BrowserWindow({ width: 1400, height: 1000, show: false,
      webPreferences: { backgroundThrottling: false } })
    win.webContents.on('console-message', event => console.log(event.message))
    win.webContents.setZoomFactor(1)
    console.log('Export window ready')
    console.log('Loading export page')
    await win.loadURL(`http://127.0.0.1:${server.httpServer.address().port}/__up-next-export`)
    const plates = await Promise.race([
      win.webContents.executeJavaScript('window.exportPlates()'),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Scene export timed out')), 120000))
    ])
    for (const [name, plate] of Object.entries(plates)) {
      const output = path.join(root, 'public/assets/ui/up-next', `${name}.webp`)
      fs.writeFileSync(output, Buffer.from(plate.data.split(',')[1], 'base64'))
      console.log(`${name}: ${plate.width} × ${plate.height}, ${fs.statSync(output).size} bytes`)
    }
  } catch (error) {
    console.error(error)
    process.exitCode = 1
  } finally {
    win?.destroy()
    await server?.close()
    app.exit(process.exitCode || 0)
  }
})
