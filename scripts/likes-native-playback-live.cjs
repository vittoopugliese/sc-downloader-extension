// Optional live smoke test. Fresh anonymous browser; no personal profile.
// Native adapter/widget run in an isolated world, like extension content scripts.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const source = name => fs.readFileSync(path.join(__dirname,name),'utf8');
const output = path.join(__dirname,'../test-results/likes-native-live');

(async () => {
  fs.mkdirSync(output,{recursive:true});
  const browser = await chromium.launch({headless:true});
  const result = { stages: [] };
  let page;
  try {
    page = await browser.newPage({viewport:{width:1200,height:900}});
    await page.addInitScript({content:[source('looper-core.js'),source('loop-session.js'),source('looper-main-bridge.js'),source('tempo-control-core.js'),
      'window.liveTempo=SCTempoControl.create();liveTempo.install();window.liveDocument=crypto.randomUUID();'].join('\n')});
    await page.goto('https://soundcloud.com/forss/soulhack',{waitUntil:'domcontentloaded',timeout:45000});
    await page.locator('.fullHero .playButton').first().waitFor();
    const consent=page.getByRole('button',{name:/^(Rechazarlas todas|Reject all|Deny all)$/i}).first();
    await consent.waitFor({timeout:10000}).catch(()=>{});
    if(await consent.isVisible())await consent.click();
    const modal=page.locator('.modal__closeButton').first();
    if(await modal.isVisible())await modal.click();
    await page.locator('.fullHero .playButton').first().click();
    await page.waitForFunction(()=>document.querySelector('.playbackSoundBadge__titleLink')?.getAttribute('href')==='/forss/soulhack',null,{timeout:15000});
    result.document=await page.evaluate(()=>liveDocument);
    result.stages.push({step:'initial',track:await page.locator('.playbackSoundBadge__titleLink').getAttribute('href')});

    const cdp=await page.context().newCDPSession(page);
    const {frameTree}=await cdp.send('Page.getFrameTree');
    const {executionContextId}=await cdp.send('Page.createIsolatedWorld',{frameId:frameTree.frame.id,worldName:'likes-native-live'});
    const isolated=async expression=>{
      const response=await cdp.send('Runtime.evaluate',{contextId:executionContextId,expression,awaitPromise:true,returnByValue:true});
      if(response.exceptionDetails)throw new Error(response.exceptionDetails.exception?.description || response.exceptionDetails.text);
      return response.result.value;
    };
    await isolated(source('likes-player.js')+'\n'+source('soundcloud-playback.js'));
    await isolated(`
      window.liveTarget={itemId:'293',title:'Flickermood',permalink:'https://soundcloud.com/forss/flickermood'};
      window.liveStates=[];
      const dock=document.createElement('section');dock.id='live-preview';dock.style.cssText='position:fixed;top:80px;right:24px;width:560px;padding:12px;background:#252326;z-index:2147483647';
      const button=document.createElement('button');button.textContent='Preview Flickermood';
      const container=document.createElement('div');container.style.height='80px';dock.append(button,container);document.body.append(dock);
      window.liveWidget=SCLikesPlayer.create({container,title:'Preview',onState:phase=>{liveStates.push(phase);if(phase==='playing')document.querySelector('.playControls .playControl.playing')?.click();},onFinish:()=>{}});
      button.onclick=()=>liveWidget.load(liveTarget);
    `);
    await page.getByRole('button',{name:'Preview Flickermood',exact:true}).click();
    const widget=page.frames().find(frame=>frame.url().startsWith('https://w.soundcloud.com/player/')) || await page.waitForEvent('framenavigated',{predicate:frame=>frame.url().startsWith('https://w.soundcloud.com/player/'),timeout:15000});
    assert.ok(widget,'the real preview iframe loaded');
    await widget.locator('.playButton').first().waitFor({timeout:20000});
    if(!await isolated("liveStates.includes('playing')"))await widget.locator('.playButton').first().click();
    await isolated(`new Promise((resolve,reject)=>{const until=Date.now()+15000;const poll=()=>liveStates.includes('playing')?resolve(true):Date.now()>until?reject(new Error('Widget did not play')):setTimeout(poll,100);poll();})`);
    const frameNode=await page.locator('#live-preview iframe').elementHandle();
    let handoff=await isolated('liveWidget.pause();SCSoundCloudPlayback.play(liveTarget)');
    result.stages.push({step:'handoff',...handoff});
    result.nativeView=await isolated(`({url:location.href,title:document.querySelector('.fullHero .soundTitle__title')?.textContent,artist:document.querySelector('.fullHero .soundTitle__username')?.outerHTML,badge:document.querySelector('.playbackSoundBadge__titleLink')?.getAttribute('href')})`);
    if(handoff.phase==='needs-play'){
      await page.locator('.playControls .playControl').click();
      handoff=await isolated('SCSoundCloudPlayback.play(liveTarget)');
      result.stages.push({step:'manual-play-fallback',...handoff});
    }
    assert.equal(handoff.phase,'playing');
    assert.equal(await page.evaluate(()=>liveDocument),result.document);
    assert.equal(await frameNode.evaluate(node=>node.isConnected),true);
    assert.equal(page.frames().includes(widget),true);
    assert.equal(await page.locator('.playbackSoundBadge__titleLink').getAttribute('href'),'/forss/flickermood');
    await page.evaluate(()=>liveTempo.setRate(1.25));
    assert.equal(await page.evaluate(()=>liveTempo.getActiveAudio()?.playbackRate),1.25);
    const loop=await isolated(`
      (()=>{const node=document.documentElement;node.setAttribute('data-scdl-looper-command',JSON.stringify({id:'live-loop',type:'set-loop',startMs:1000,endMs:3000,enabled:true}));node.dispatchEvent(new CustomEvent('scdl-looper:command',{bubbles:true}));return JSON.parse(node.getAttribute('data-scdl-looper-response'));})()
    `);
    assert.equal(loop.ok,true);
    assert.equal(loop.loop.trackIdentity,'permalink:https://soundcloud.com/forss/flickermood');
    const wrapped=await page.evaluate(()=>new Promise(resolve=>{
      let previous=liveTempo.getActiveAudio().currentTime;const until=performance.now()+6000;
      const timer=setInterval(()=>{const now=liveTempo.getActiveAudio().currentTime;if(previous>2&&now<1.5){clearInterval(timer);resolve(true);}else if(performance.now()>until){clearInterval(timer);resolve(false);}previous=now;},50);
    }));
    assert.equal(wrapped,true,'the loop must wrap the real native audio');
    result.stages.push({step:'player-tools',rate:1.25,loop:loop.loop,wrapped,iframePreserved:true});
    await page.screenshot({path:path.join(output,'handoff.png')});
    result.ok=true;
    console.log('Live native handoff passed:',JSON.stringify(result));
  } catch(error) {
    result.ok=false;result.error=error.message;
    if(page)await page.screenshot({path:path.join(output,'failure.png')}).catch(()=>{});
    throw error;
  } finally {
    fs.writeFileSync(path.join(output,'result.json'),JSON.stringify(result,null,2)+'\n');
    await browser.close();
  }
})().catch(error=>{console.error(error.message);process.exitCode=1;});
