const fs = require('node:fs')
const { spawn } = require('node:child_process')
const root = process.env.IQM_AUDIT_ROOT || process.cwd()
const req = require('node:module').createRequire(root + '/package.json')
const { app, BrowserWindow } = req('electron')
const sleep = ms => new Promise(r => setTimeout(r, ms))
let server, win
async function main() {
  server = spawn(process.execPath, [root + '/node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '5245', '--strictPort'], { cwd: root, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'ignore' })
  await app.whenReady()
  for(let i=0;i<100;i++) { try { if((await fetch('http://127.0.0.1:5245')).ok) break } catch {} await sleep(100) }
  win = new BrowserWindow({width:540,height:960,show:true,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}})
  await win.loadURL('about:blank')
  const wc=win.webContents
  wc.debugger.attach('1.3')
  await wc.debugger.sendCommand('Page.enable')
  await wc.debugger.sendCommand('Page.addScriptToEvaluateOnNewDocument',{source:`
    const srcDescriptor = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype,'src');
    globalThis.__stalledImages=[];
    Object.defineProperty(HTMLImageElement.prototype,'src', { ...srcDescriptor, set(value) {
      if(String(value).includes('/nanoscale/')) { __stalledImages.push(value); return; }
      srcDescriptor.set.call(this,value);
    }});
  `})
  await win.loadURL('http://127.0.0.1:5245')
  const run=s=>wc.executeJavaScript(s,true)
  for(let i=0;i<100;i++) { if(await run('Boolean(globalThis.__kioskApp)')) break; await sleep(100) }
  await run(`__kioskApp.runtime.isKiosk=true; __kioskApp.openMenu(); __kioskApp.openModule('nanoscale')`)
  await sleep(6000)
  const snapshot=()=>run(`({stalledImages:__stalledImages,opening:__kioskApp.isOpeningExperience,screen:__kioskApp.router.currentScreen,activeModule:__kioskApp.activeModuleId,wipe:document.querySelector('.screen-wipe')?.className,moduleState:document.getElementById('module-host').dataset.moduleState,hiddenStage:!!document.querySelector('.module-host__stage.is-awaiting-content')})`)
  const before=await snapshot()
  await run('__kioskApp.onIdle(); __kioskApp.openMenu(); __kioskApp.goHome()')
  await sleep(1000)
  const afterRecoveryAttempts=await snapshot()
  fs.writeFileSync('/tmp/iqm-audit-stall.json',JSON.stringify({fault:'Simulated image request with no load/error event; cache preheat remains pending.',before,afterRecoveryAttempts},null,2))
  console.log(JSON.stringify({before,afterRecoveryAttempts}))
}
main().then(()=>{win?.destroy();server?.kill();app.exit(0)},e=>{console.error(e);win?.destroy();server?.kill();app.exit(1)})
