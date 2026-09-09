// Audit evidence for commit 6822c9; asserts observed defects, not desired behavior.
// Run from the repository root: node docs/audits/6822c9-repro.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const scripts = path.resolve(__dirname, '../../scripts');

function bridgeCase(name, extra) {
  const fixture = path.join(scripts, 'verify-looper-main-bridge.js');
  vm.runInNewContext(fs.readFileSync(fixture, 'utf8') + '\n' + extra, {
    require: createRequire(fixture), __dirname: scripts,
    console: { log() {} },
  }, { filename: name });
  console.log('REPRODUCED ' + name);
}

bridgeCase('source change while bypassed retains old loop', `
  command('set-loop', {startMs:1000,endMs:3000});
  command('set-global-bypass', {bypassed:true});
  replacementMedia.paused = true;
  replacementMedia.src = replacementMedia.currentSrc = 'track-B';
  assert.equal(command('state').state.loop.active, true);
  const result = command('set-global-bypass', {bypassed:false});
  assert.equal(replacementMedia.currentTime, 1);
  assert.equal(replacementMedia.paused, false);
  // play/playing clears only after the old range has already sought/played B.
  assert.equal(result.loop.active, false);
`);

bridgeCase('source refresh for same track clears loop', `
  command('set-loop', {startMs:1000,endMs:3000});
  replacementMedia.src = replacementMedia.currentSrc = 'same-track-new-source';
  [...animationCallbacks.values()].at(-1)();
  assert.equal(command('state').state.loop.active, false);
`);

bridgeCase('detached paused current player becomes unavailable', `
  command('set-loop', {startMs:1000,endMs:3000});
  media.isConnected = currentMedia.isConnected = false;
  media.paused = currentMedia.paused = true;
  replacementMedia.isConnected = false;
  documentMedia = [];
  replacementMedia.paused = true;
  const result = command('state');
  assert.equal(result.state.available, false);
  assert.equal(result.state.loop.active, true);
`);

bridgeCase('bypass-off is not idempotent', `
  command('set-loop', {startMs:1000,endMs:3000});
  assert.equal(command('state').state.loop.enabled, true);
  assert.equal(command('set-global-bypass', {bypassed:false}).loop.enabled, false);
`);

bridgeCase('unordered set-range differs from core normalizeRange', `
  command('set-loop', {startMs:1000,endMs:3000});
  const result = command('set-loop', {startMs:1000,endMs:0});
  assert.equal(result.loop.startMs, 1000);
  assert.equal(result.loop.endMs, 1250);
  const coreContext = vm.createContext({});
  vm.runInContext(fs.readFileSync(path.join(__dirname,'looper-core.js'),'utf8'),coreContext);
  const normalized = vm.runInContext('SCLooperCore.normalizeRange({startMs:1000,endMs:0,durationMs:44656})',coreContext);
  assert.equal(normalized.startMs,0);
  assert.equal(normalized.endMs,1000);
`);

const playbackFixture = path.join(scripts, 'verify-looper-playback.js');
vm.runInNewContext(fs.readFileSync(playbackFixture,'utf8') + `
  let shared = {active:true,enabled:true,startMs:1000,endMs:3000,durationMs:10000};
  let position = 2000;
  const writes = [];
  setPlaybackFixture({
    getLoopState:()=>shared,getCurrentTimeMs:()=>position,getTrackIdentity:()=>null,
    seekToMs:value=>{writes.push(value);position=value;}
  }, shared);
  nowMs=1000;runLoopFrame();
  shared={...shared,enabled:false};
  position=3500;nowMs=1016;runLoopFrame();
  assert.equal(shared.enabled,false);
  assert.deepEqual(writes,[1000]);
`, {require:createRequire(playbackFixture),__dirname:scripts,URL,console:{log(){},debug(){}}});
console.log('REPRODUCED waveform seeks using stale state after bypass');

const sessionContext = vm.createContext({});
vm.runInContext(fs.readFileSync(path.join(scripts, 'loop-session.js'), 'utf8'), sessionContext);
vm.runInContext(`
  const s = SCLoopSession.create();
  s.command({type:'set-range',startMs:8000,endMs:9000,durationMs:10000});
  s.command({type:'set-range',durationMs:5000});
  if (s.snapshot().endMs !== 9000) throw new Error('Expected stale unclamped range');
`, sessionContext);
console.log('REPRODUCED session retains out-of-duration omitted endpoints');

async function browserCases() {
  const { chromium } = require('playwright');
  const browser = await chromium.launch({headless:true});
  try {
    const page = await browser.newPage();
    page.on('pageerror', error => console.log('FIXTURE PAGE ERROR', error.message));
    await page.route('https://soundcloud.com/**', route => route.fulfill({
      contentType:'text/html', body:`<!doctype html>
      <style>.waveform{width:600px;height:120px}.playControls__elements{display:flex;position:fixed;bottom:0}</style>
      <div class="track"><h1>Track A</h1><div class="waveform" role="slider" aria-label="Waveform" aria-valuemax="20000"></div>
      <button aria-haspopup="true" aria-label="More actions">More</button></div>
      <div class="playControls__elements"><div class="playControls__soundBadge">
      <a class="playbackSoundBadge__titleLink" href="/artist/track-a">A</a></div><button id="scdl-player-download">Download</button></div>
      <audio src="track-a.mp3"></audio>`
    }));
    await page.goto('https://soundcloud.com/artist/track-a');
    await page.evaluate(() => {
      window.chrome = {runtime:{getURL:path=>path},i18n:{getMessage:key=>key}};
      const media = document.querySelector('audio');
      Object.defineProperty(media, 'currentSrc', {get(){return this.src;},configurable:true});
      Object.defineProperty(media, 'duration', {value:20,configurable:true});
      Object.defineProperty(media, 'currentTime', {value:2,writable:true,configurable:true});
      Object.defineProperty(media, 'paused', {value:false,writable:true,configurable:true});
      HTMLMediaElement.prototype.play = function() { this.paused=false; this.dispatchEvent(new Event('playing')); return Promise.resolve(); };
      window.auditCommand = (type, payload={}) => {
        const root=document.documentElement;
        root.setAttribute('data-scdl-looper-command',JSON.stringify({id:'audit',type,...payload}));
        root.dispatchEvent(new CustomEvent('scdl-looper:command',{bubbles:true}));
        return JSON.parse(root.getAttribute('data-scdl-looper-response'));
      };
    });
    for(const file of ['tempo-control-core.js','tempo-control-main.js','loop-session.js','looper-main-bridge.js','looper-core.js','looper.js']) {
      await page.addScriptTag({path:path.join(scripts,file)});
    }
    console.log('Fixture mount:', await page.evaluate(()=>document.documentElement.getAttribute('data-scdl-looper-debug')));
    await page.locator('[data-scdl-looper]').click();
    await page.locator('#scdl-tempo-control .trigger').click();
    assert.equal(await page.evaluate(()=>auditCommand('state').state.loop.active),true);
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#scdl-tempo-control .panel').isVisible(),false);
    assert.equal(await page.evaluate(()=>auditCommand('state').state.loop.active),false);
    console.log('REPRODUCED Escape closes panel and clears waveform session');

    // A view already mounted without a range bypasses the permalink guard.
    await page.evaluate(()=>SCLooper.ensureMounted());
    const mismatch = await page.evaluate(()=> {
      document.querySelector('.playbackSoundBadge__titleLink').href='/artist/track-b';
      const media=document.querySelector('audio');
      media.src='track-b.mp3';
      auditCommand('set-loop',{startMs:4000,endMs:6000,startPlayback:false});
      SCLooper.ensureMounted();
      return {overlay:!!document.querySelector('[data-scdl-loop-overlay]'),state:SCLooper.getState(),page:location.pathname};
    });
    assert.equal(mismatch.overlay,true);
    assert.equal(mismatch.state.trackIdentity,'url:https://soundcloud.com/artist/track-b');
    assert.equal(mismatch.page,'/artist/track-a');
    console.log('REPRODUCED loop B is attached to pre-mounted waveform A');

    const rebound = await page.evaluate(()=> {
      SCLooper.reset();
      document.querySelector('.playbackSoundBadge__titleLink').href='/artist/track-a';
      const audio=document.querySelector('audio');
      audio.src='track-a.mp3';
      SCLooper.ensureMounted();
      auditCommand('set-loop',{startMs:1000,endMs:3000,startPlayback:false});
      SCLooper.ensureMounted();
      audio.src='track-b.mp3';
      audio.dispatchEvent(new Event('loadedmetadata'));
      audio.dispatchEvent(new Event('playing'));
      return auditCommand('state').state.loop;
    });
    assert.equal(rebound.active,true);
    assert.match(rebound.trackIdentity,/track-b\.mp3$/);
    assert.equal(rebound.startMs,1000);
    console.log('REPRODUCED waveform metadata event rebinds old range to new source');

    const frameBypass = await page.evaluate(async () => {
      auditCommand('clear-loop');
      const host=document.querySelector('#scdl-tempo-control');
      host.shadowRoot.querySelector('.bypass').click();
      const frame=document.createElement('iframe');
      frame.src='about:blank';
      const loaded=new Promise(resolve=>frame.addEventListener('load',resolve,{once:true}));
      document.body.appendChild(frame);
      await loaded;
      return host.shadowRoot.querySelector('.bypass').getAttribute('aria-pressed');
    });
    assert.equal(frameBypass,'true');
    const child = page.frames().find(frame=>frame !== page.mainFrame());
    for(const file of ['loop-session.js','looper-main-bridge.js']) {
      await child.addScriptTag({path:path.join(scripts,file)});
    }
    const enabled = await child.evaluate(()=> {
      const audio=new Audio();
      Object.defineProperty(audio,'duration',{value:20});
      document.body.appendChild(audio);
      const root=document.documentElement;
      root.setAttribute('data-scdl-looper-command',JSON.stringify({id:'child',type:'set-loop',startMs:1000,endMs:3000,startPlayback:false}));
      root.dispatchEvent(new CustomEvent('scdl-looper:command',{bubbles:true}));
      return JSON.parse(root.getAttribute('data-scdl-looper-response')).loop.enabled;
    });
    assert.equal(enabled,true);
    console.log('REPRODUCED new frame enables loop while global bypass is on');
    await page.evaluate(()=> {
      auditCommand('set-global-bypass',{bypassed:false});
      auditCommand('set-loop',{startMs:1000,endMs:3000,startPlayback:false});
    });
    await child.evaluate(()=>document.querySelector('audio').dispatchEvent(new Event('playing')));
    assert.equal(await page.evaluate(()=>auditCommand('state').state.loop.active),true);
    assert.equal(await child.evaluate(()=>JSON.parse(document.documentElement.getAttribute('data-scdl-loop-session')).active),true);
    console.log('REPRODUCED playing in another frame leaves two active loop sessions');
    const realPage=await browser.newPage();
    await realPage.setContent('<audio></audio>');
    const wav=Buffer.alloc(44+8000);
    wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);
    wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);
    wav.writeUInt32LE(8000,24);wav.writeUInt32LE(16000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);
    wav.write('data',36);wav.writeUInt32LE(8000,40);
    await realPage.evaluate(src=>{document.querySelector('audio').src=src;},'data:audio/wav;base64,'+wav.toString('base64'));
    await realPage.waitForFunction(()=>Number.isFinite(document.querySelector('audio').duration));
    for(const file of ['loop-session.js','looper-main-bridge.js']) await realPage.addScriptTag({path:path.join(scripts,file)});
    await realPage.evaluate(()=>{
      const root=document.documentElement;
      root.setAttribute('data-scdl-looper-command',JSON.stringify({id:'real',type:'set-loop',startMs:0,endMs:500}));
      root.dispatchEvent(new CustomEvent('scdl-looper:command',{bubbles:true}));
    });
    await realPage.waitForTimeout(1200);
    const ended=await realPage.evaluate(()=>({paused:document.querySelector('audio').paused,time:document.querySelector('audio').currentTime,enabled:JSON.parse(document.documentElement.getAttribute('data-scdl-loop-session')).enabled}));
    assert.equal(ended.enabled,true);
    assert.equal(ended.paused,false);
    console.log('CONTROL PASS real 500ms WAV keeps playing with B at duration',ended);
  } finally { await browser.close(); }
}
browserCases().catch(error=> { console.error(error); process.exitCode=1; });
