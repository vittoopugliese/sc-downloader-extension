const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { chromium } = require('playwright');
(async()=>{
  const browser = await chromium.launch({headless:true});
  try {
    const page = await browser.newPage({viewport:{width:1360,height:960}});
    await page.route('https://soundcloud.com/**',route=>route.fulfill({contentType:'text/html',body:'<body style="background:#eee"><header class="header" style="height:48px">SoundCloud</header><main class="l-main">Your likes</main></body>'}));
    await page.goto('https://soundcloud.com/you/likes');
    for(const file of ['soundcloud-likes-source.js','likes-library.js']) await page.addScriptTag({path:path.join(__dirname,file)});
    const dbResult = await page.evaluate(async()=>{
      const db=SCLikesLibrary;
      const j=await db.start('42','Test',false);
      const entry=id=>({kind:'track',itemId:String(id),title:'Track '+id,artistName:'Artist',likedAt:'2020-01-01T00:00:00.000Z',permalink:'https://soundcloud.com/a/b',artworkUrl:null});
      await db.commit(j,{entries:[entry(1),entry(1),{kind:'playlist',itemId:'9'}],rawCount:3,nextCursor:'https://api-v2.soundcloud.com/users/42/likes?offset=50'});
      const first=await db.get('libraries','42');
      const replay=await db.commit(j,{entries:[entry(2)],rawCount:1,nextCursor:null});
      const next=await db.get('jobs','42'); await db.pause('42');
      const late=await db.commit(next,{entries:[entry(2)],rawCount:1,nextCursor:null});
      const resumed=await db.start('42','Test',false); await db.commit(resumed,{entries:[entry(2)],rawCount:1,nextCursor:null});
      const complete=await db.get('libraries','42');
      const refresh=await db.start('42','Test',true); await db.commit(refresh,{entries:[entry(3)],rawCount:1,nextCursor:'https://api-v2.soundcloud.com/users/42/likes?offset=50'});
      const during=await db.get('libraries','42');
      await db.commit(await db.get('jobs','42'),{entries:[entry(4)],rawCount:1,nextCursor:null});
      const after=await db.get('libraries','42');
      const tracks=await db.tracks('42',after.generation);
      return {first,replay,late,complete,during,after,tracks};
    });
    assert.equal(dbResult.first.count,1); assert.equal(dbResult.replay,false); assert.equal(dbResult.late,false);
    assert.equal(dbResult.complete.count,2); assert.equal(dbResult.complete.complete,true);
    assert.equal(dbResult.during.generation,dbResult.complete.generation); assert.notEqual(dbResult.after.generation,dbResult.complete.generation);
    assert.deepEqual(dbResult.tracks.map(x=>x.itemId),['3','4']);
    await page.evaluate(()=>{
      window.fixtureCount=50000;
      window.fixtureCalls=[];
      window.fixturePro=true;
      const items=Array.from({length:50000},(_,i)=>({itemId:String(i+1),trackOrdinal:i,title:`Remember this track ${i+1}`,artistName:`Artist ${i%37}`,likedAt:new Date(Date.UTC(2026-Math.floor(i/4000),i%12,1)).toISOString(),artworkUrl:null,permalink:`https://soundcloud.com/artist/track-${i+1}`}));
      window.chrome={i18n:{getUILanguage:()=> 'es'},runtime:{onMessage:{addListener:fn=>window.fixtureListener=fn},sendMessage:async r=>{
        fixtureCalls.push(r);
        if(!fixturePro)return{success:false,code:'pro-required'};
        if(r.type==='GET_LIKES_LIBRARY_STATUS')return{success:true,ownerId:'42',displayName:'Your archive',library:{generation:'g1',revision:1,count:fixtureCount,complete:true},job:{phase:'complete',count:fixtureCount},bookmarks:[]};
        if(r.type==='QUERY_LIKES'){
          const all=items.slice(0,fixtureCount); const filtered=all.filter(x=>(!r.query || `${x.title} ${x.artistName}`.toLowerCase().includes(r.query.toLowerCase()))&&(!r.period || x.likedAt.slice(0,7)===r.period));
          const periods={};for(const x of all){const k=x.likedAt.slice(0,7);periods[k]||={count:0,firstTrackId:x.itemId};periods[k].count++;}
          return{success:true,generation:'g1',revision:1,items:filtered.slice(r.offset||0,(r.offset||0)+(r.limit||100)),matchingCount:filtered.length,indexedCount:all.length,anchor:filtered.findIndex(x=>x.itemId===r.trackId),complete:true,periods};
        }
        return{success:true,images:{}};
      }}};
    });
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    for(const file of ['likes-explorer-i18n.js','soundcloud-likes-locator.js','likes-explorer.js'])await page.addScriptTag({path:path.join(__dirname,file)});
    const locator=await page.evaluate(async()=>{
      const scroll=document.scrollingElement,original=scroll.scrollTo;let calls=0;
      scroll.scrollTo=()=>{calls++;setTimeout(()=>{const link=document.createElement('a');link.className='soundTitle__title';link.href='https://soundcloud.com/a/target';link.textContent='Target';document.querySelector('.l-main').append(link);},10);};
      const found=await SCLikesLocator.locate('https://soundcloud.com/a/target',()=>{});
      const cancelled=SCLikesLocator.locate('https://soundcloud.com/a/missing',()=>{});SCLikesLocator.cancel();const count=calls;
      await cancelled;await new Promise(resolve=>setTimeout(resolve,800));scroll.scrollTo=original;
      return{found,cancelledCalls:calls-count};
    });assert.equal(locator.found,true);assert.equal(locator.cancelledCalls,0);
    await page.locator('#scdl-likes-explorer .launch').click();
    await page.waitForFunction(()=>document.querySelector('#scdl-likes-explorer')?.shadowRoot.querySelectorAll('.card').length>0);
    assert.ok(await page.locator('#scdl-likes-explorer .card').count()<100);
    assert.equal(await page.locator('#scdl-likes-explorer aside').count(),0);
    const compactLayout=await page.locator('#scdl-likes-explorer .card').evaluateAll(cards=>cards.slice(0,7).map(card=>({top:card.style.top,left:card.style.left})));
    assert.equal(new Set(compactLayout.slice(0,6).map(card=>card.top)).size,1);
    assert.notEqual(compactLayout[5].left,compactLayout[0].left);
    assert.notEqual(compactLayout[6].top,compactLayout[0].top);
    assert.equal(await page.locator('#scdl-likes-explorer header').count(),0);
    assert.equal(await page.locator('#scdl-likes-explorer .bottom').count(),0);
    assert.ok(!(await page.locator('#scdl-likes-explorer .main').textContent()).includes('Your archive'));
    const toolbarLayout=await page.locator('#scdl-likes-explorer .toolbar-line').evaluate(line=>{
      const search=line.querySelector('.search-wrap').getBoundingClientRect(), close=line.querySelector('.search-close').getBoundingClientRect();
      const tops=[...line.children].map(child=>Math.round(child.getBoundingClientRect().top));
      return {oneLine:new Set(tops).size===1,closeInside:close.left>=search.left&&close.right<=search.right};
    });
    assert.deepEqual(toolbarLayout,{oneLine:true,closeInside:true});
    assert.deepEqual(await page.locator('#scdl-likes-explorer .action-button').evaluateAll(buttons=>buttons.map(button=>button.title)),['Actualizar biblioteca','Almacenamiento','Guardar este lugar']);
    assert.equal(await page.locator('#scdl-likes-explorer .action-spinner').count(),1);
    const visibleCards=await page.locator('#scdl-likes-explorer .card').evaluateAll(cards=>{const viewport=cards[0]?.closest('.viewport').getBoundingClientRect();return cards.filter(card=>{const rect=card.getBoundingClientRect();return rect.top>=viewport.top&&rect.bottom<=viewport.bottom;}).length;});
    assert.ok(visibleCards>=24);
    const rail=page.locator('#scdl-likes-explorer .viewport');
    await rail.press('End');
    await page.waitForFunction(()=>document.querySelector('#scdl-likes-explorer').shadowRoot.querySelector('.canvas').textContent.includes('50000'));
    await page.locator('#scdl-likes-explorer .toolbar input').fill('Artist 12');
    await page.waitForTimeout(300);
    assert.ok((await page.locator('#scdl-likes-explorer .card').first().textContent()).includes('Artist 12'));
    await page.locator('#scdl-likes-explorer .toolbar input').fill('');
    await page.waitForTimeout(250);
    assert.equal(await page.locator('#scdl-likes-explorer .toolbar input').inputValue(),'');
    await rail.evaluate(node=>node.scrollTop=360); await page.waitForTimeout(200);
    assert.ok(await rail.evaluate(node=>node.scrollTop > 0));
    await page.locator('#scdl-likes-explorer .card-main').first().click();
    assert.equal(await page.locator('#scdl-likes-explorer .detail').isVisible(),true);
    const footerLayout=await page.locator('#scdl-likes-explorer .main').evaluate(main=>{
      const detail=main.querySelector('.detail'),toolbar=main.querySelector('.toolbar'),open=detail.querySelector('.accent');
      return {
        toolbarBelowTrack:toolbar.getBoundingClientRect().top>=detail.getBoundingClientRect().bottom,
        detailButtons:[...detail.querySelectorAll('button')].map(button=>button.textContent.trim()),
        locateTitle:detail.querySelector('.locate-action')?.title,
        locateIcon:!!detail.querySelector('.locate-action .locate-icon'),
        openSingleLine:open.scrollHeight<=open.clientHeight,
      };
    });
    assert.deepEqual(footerLayout,{toolbarBelowTrack:true,detailButtons:['Abrir ↗',''],locateTitle:'Teleport to selected track',locateIcon:true,openSingleLine:true});
    await page.screenshot({path:'test-results/likes-explorer-desktop.png'});
    for(const width of [390,760,1024]){
      await page.setViewportSize({width,height:800});await page.waitForTimeout(180);
      const rect=await page.locator('#scdl-likes-explorer .main').boundingBox();assert.ok(rect.x>=0&&rect.x+rect.width<=width);
    }
    await page.screenshot({path:'test-results/likes-explorer-mobile.png'});
    await page.evaluate(()=>{history.pushState({},'', '/artist/track');});await page.waitForTimeout(550);
    assert.equal(await page.locator('#scdl-likes-explorer').count(),0);
    await page.evaluate(()=>{history.pushState({},'', '/you/likes');fixturePro=false;});await page.waitForTimeout(550);
    await page.locator('#scdl-likes-explorer .launch').click();await page.waitForTimeout(100);
    assert.equal(await page.locator('#scdl-likes-explorer .gate').isVisible(),true);
    assert.equal(errors.length,0,errors.join('\n'));
    console.log('Likes IDB atomicity, dedupe, pause, refresh and browser 50k virtualization/search/teleport/SPA/Pro passed.');
  }finally{await browser.close();}
  const profile=fs.mkdtempSync(path.join(os.tmpdir(),'scdl-likes-test-'));
  const extensionPath=path.resolve(__dirname,'..');
  const context=await chromium.launchPersistentContext(profile,{channel:'chromium',headless:true,args:[`--disable-extensions-except=${extensionPath}`,`--load-extension=${extensionPath}`]});
  try {
    const worker=context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    const result=await worker.evaluate(async()=>{
      const originalFetch=globalThis.fetch;
      const canvas=new OffscreenCanvas(240,120);canvas.getContext('2d').fillRect(0,0,240,120);
      const png=await canvas.convertToBlob({type:'image/png'});
      globalThis.fetch=async()=>new Response(png,{headers:{'content-type':'image/png'}});
      try{
        const result=await likesJobs.convertArtwork('https://i1.sndcdn.com/test-large.jpg');
        const sizes=[];
        for(const [size,blob] of Object.entries(result.variants)){const image=await createImageBitmap(blob);sizes.push({size:Number(size),type:blob.type,width:image.width,height:image.height});image.close();}
        return {sizes,bytes:result.bytes};
      }finally{globalThis.fetch=originalFetch;}
    });
    assert.deepEqual(result.sizes,[{size:48,type:'image/webp',width:48,height:48}]);assert.ok(result.bytes>0&&result.bytes<16*1024);
    console.log('Real extension service worker loaded; single compact 48px WebP encoding and decoding passed.');
    const jobsResult=await worker.evaluate(async()=>{
      const originalSend=chrome.tabs.sendMessage, originalQuery=chrome.tabs.query, originalPage=SCLikesSource.fetchPage;
      let token='fixture-a', allowed=true, changeDuringFetch=true, fetches=0, fetchedOwners=[];
      chrome.tabs.sendMessage=async()=>({success:true,clientId:'fixture-client'});
      chrome.tabs.query=async()=>[{id:123,url:'https://soundcloud.com/you/likes'}];
      SCLikesSource.fetchPage=async({ownerId})=>{fetches++;fetchedOwners.push(String(ownerId));if(changeDuringFetch)token='fixture-b';return {entries:[{kind:'track',itemId:String(ownerId)==='654'?'902':'901',title:'Private fixture',artistName:'Fixture',likedAt:null,artworkUrl:null}],rawCount:1,nextCursor:null};};
      const jobs=SCLikesJobs.create({getToken:async()=>token,resolveUser:async()=>({user:{id:987,username:'Fixture'},oauthToken:token}),access:{authorize:async()=>({allowed,code:'pro-required'})}});
      const sender={id:chrome.runtime.id,tab:{id:123,url:'https://soundcloud.com/you/likes'},frameId:0,url:'https://soundcloud.com/you/likes'};
      try {
        await SCLikesLibrary.start('987','Fixture',false);await jobs.tick();
        const invalidated=await SCLikesLibrary.get('libraries','987');
        const paused=await SCLikesLibrary.get('jobs','987');
        changeDuringFetch=false;
        await SCLikesLibrary.start('987','Fixture',false);await jobs.tick();
        const status=await jobs.handle({type:'GET_LIKES_LIBRARY_STATUS',ownerId:'987'},sender);
        const query=await jobs.handle({type:'QUERY_LIKES',ownerId:'987',limit:10},sender);
        await SCLikesLibrary.startCollection('987',{collectionId:'likes:654',sourceUserId:'654',name:'Other profile'},true);
        await jobs.tick();
        const other=await SCLikesLibrary.get('collections',['987','likes:654']);
        let wrongOwner,wrongSender,free;
        try{await jobs.handle({type:'QUERY_LIKES',ownerId:'888'},sender);}catch(e){wrongOwner=e.code;}
        try{await jobs.handle({type:'QUERY_LIKES',ownerId:'987'},{...sender,frameId:1});}catch(e){wrongSender=e.code;}
        allowed=false;
        try{await jobs.handle({type:'QUERY_LIKES',ownerId:'987'},sender);}catch(e){free=e.code;}
        await jobs.handle({type:'DELETE_LIKES_LIBRARY',ownerId:'987'},sender);
        const deleted=await SCLikesLibrary.get('libraries','987');
        return {invalidatedCount:invalidated.count,paused:paused.phase,complete:status.library.complete,count:query.items.length,wrongOwner,wrongSender,free,deleted:!deleted,fetches,otherSource:other?.sourceUserId,externalFetched:fetchedOwners.includes('654')};
      }finally{chrome.tabs.sendMessage=originalSend;chrome.tabs.query=originalQuery;SCLikesSource.fetchPage=originalPage;}
    });
    assert.equal(jobsResult.invalidatedCount,0);assert.equal(jobsResult.paused,'paused');assert.equal(jobsResult.complete,true);assert.equal(jobsResult.count,1);
    assert.equal(jobsResult.otherSource,'654');assert.equal(jobsResult.externalFetched,true);
    assert.equal(jobsResult.wrongOwner,'owner-mismatch');assert.equal(jobsResult.wrongSender,'invalid-request');assert.equal(jobsResult.free,'pro-required');assert.equal(jobsResult.deleted,true);
    console.log('Worker jobs: account change during fetch blocks commit; resume, sender/owner checks, Pro denial and Free deletion passed.');
    const popup=await context.newPage();await popup.setViewportSize({width:426,height:760});
    await popup.goto(`chrome-extension://${new URL(worker.url()).host}/popup.html`);
    const entry=popup.locator('#likesExplorerBtn');
    await entry.waitFor();assert.equal(await entry.isVisible(),true);
    console.log('Real extension popup exposes the Likes Explorer entry.');
  }finally{await context.close();fs.rmSync(profile,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
