// Keep the established PowerShell allow-list as the single source of package files.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname,'..');
if (process.platform === 'win32') {
  execFileSync('powershell',['-NoProfile','-ExecutionPolicy','Bypass','-File',path.join(__dirname,'package-extension.ps1')],{stdio:'inherit'});
} else {
  const script = fs.readFileSync(path.join(__dirname,'package-extension.ps1'),'utf8');
  const list = script.match(/\$packageItems = @\(([\s\S]*?)\n\s*\)/)[1];
  const items = [...list.matchAll(/"([^"]+)"/g)].map(match=>match[1]);
  const stage = fs.mkdtempSync(path.join(os.tmpdir(),'scdl-package-'));
  const manifest = JSON.parse(fs.readFileSync(path.join(root,'manifest.json'),'utf8'));
  const output = path.join(root,'dist',`soundcloud-track-downloader-${manifest.version}.zip`);
  fs.mkdirSync(path.dirname(output),{recursive:true});
  try {
    for (const item of items) {
      const destination = path.join(stage,item);
      fs.mkdirSync(path.dirname(destination),{recursive:true});
      fs.cpSync(path.join(root,item),destination,{recursive:true});
    }
    const commercePath = path.join(stage,'scripts','player-tools-commerce.js');
    const testLoginLine = 'const TEST_LOGIN = Object.freeze({ username: "1", password: "1" });';
    const commerceSource = fs.readFileSync(commercePath,'utf8');
    if (!commerceSource.includes(testLoginLine)) throw new Error('Could not disable the test login in the production package.');
    fs.writeFileSync(commercePath,commerceSource.replace(testLoginLine,'const TEST_LOGIN = null;'));
    const popupPath = path.join(stage,'popup.html');
    const popupSource = fs.readFileSync(popupPath,'utf8');
    const productionPopup = popupSource.replace(/\s*<!-- TEST_ACCESS_START -->[\s\S]*?<!-- TEST_ACCESS_END -->/,'');
    if (productionPopup === popupSource) throw new Error('Could not remove the test login UI from the production package.');
    fs.writeFileSync(popupPath,productionPopup);
    const temporary = path.join(stage,'extension.zip');
    execFileSync('zip',['-q','-r',temporary,...fs.readdirSync(stage)],{cwd:stage});
    fs.copyFileSync(temporary,output);
    console.log(`Created ${output}`);
  } finally { fs.rmSync(stage,{recursive:true,force:true}); }
}
