const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname,'likes-popup.js'),'utf8');
async function open(tabs) {
  const calls = []; let click;
  const button = { addEventListener: (_event, handler) => {click=handler;} };
  vm.runInNewContext(source, {
    URL, document: {getElementById:()=>button,querySelector:()=>({})},
    window: {close:()=>calls.push(['close'])},
    chrome: {tabs: {
      query: async()=>tabs,
      update: async(...args)=>calls.push(['update',...args]),
      create: async(...args)=>calls.push(['create',...args]),
      sendMessage: async(...args)=>calls.push(['message',...args]),
    }},
  });
  await click();
  return JSON.parse(JSON.stringify(calls));
}
(async()=>{
  const track={id:1,active:true,url:'https://soundcloud.com/artist/track'};
  assert.deepEqual(await open([track]),[
    ['create',{url:'https://soundcloud.com/you/likes#scdl-explore'}],['close'],
  ],'opening Explorer must preserve a playing track tab');
  const likes={id:2,active:false,url:'https://soundcloud.com/you/likes'};
  assert.deepEqual(await open([track,likes]),[
    ['update',2,{active:true}],['message',2,{type:'OPEN_LIKES_EXPLORER'},{frameId:0}],['close'],
  ],'reuse existing Explorer without navigating or losing its view');
  const activeLikes={id:3,active:true,url:'https://soundcloud.com/artist/likes/'};
  assert.equal((await open([likes,activeLikes]))[0][1],3);
  console.log('Likes popup: playing tabs preserved; existing likes tabs reused without navigation.');
})().catch(error=>{console.error(error);process.exitCode=1;});
