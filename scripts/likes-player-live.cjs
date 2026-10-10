// Optional public-track smoke test. Uses a fresh browser, never a personal profile.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({headless:true});
  try {
    const page = await browser.newPage({viewport:{width:1200,height:900}});
    await page.goto('https://soundcloud.com/forss/flickermood',{waitUntil:'domcontentloaded',timeout:45000});
    await page.evaluate(fs.readFileSync(path.join(__dirname,'likes-player.js'),'utf8'));
    await page.evaluate(() => {
      window.widgetStates = []; window.widgetProgress = 0;
      const dock = document.createElement('section');
      dock.style.cssText='position:fixed;top:80px;right:24px;width:600px;padding:20px;background:white;z-index:2147483647';
      const start = document.createElement('button'); start.textContent = 'Test Explorer playback';
      const container = document.createElement('div'); container.style.height='80px';
      dock.append(start,container); document.body.append(dock);
      const player = SCLikesPlayer.create({container,title:'Explorer playback',onState:phase=>widgetStates.push(phase),onFinish:()=>{}});
      start.onclick = () => player.load({itemId:'293',title:'Flickermood'});
      window.addEventListener('message', event => {
        if (event.origin !== 'https://w.soundcloud.com' || event.source !== container.querySelector('iframe')?.contentWindow) return;
        try { const data=JSON.parse(event.data); if(data.method==='playProgress') widgetProgress=Math.max(widgetProgress,Number(data.value?.currentPosition)||0); } catch {}
      });
    });
    await page.getByRole('button',{name:'Test Explorer playback',exact:true}).click();
    try { await page.waitForFunction(()=>widgetProgress>1000,null,{timeout:20000}); }
    catch {
      const widget = page.frames().find(frame=>frame.url().startsWith('https://w.soundcloud.com/player/'));
      const play = widget?.locator('.playButton').first();
      if (play && await play.isVisible()) await play.click();
      await page.waitForFunction(()=>widgetProgress>1000,null,{timeout:15000});
    }
    const result=await page.evaluate(()=>({states:widgetStates,progressMs:widgetProgress}));
    assert.ok(result.states.includes('playing')); assert.ok(result.progressMs>1000);
    await page.screenshot({path:'test-results/likes-player-live.png'});
    console.log('Live public SoundCloud widget playback passed:',JSON.stringify(result));
  } finally { await browser.close(); }
})().catch(error=>{console.error(error);process.exitCode=1;});
