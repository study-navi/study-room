/* Explicit opt-in only: creates two fictional students/records in the named staging deployment.
 * No administrator password, production endpoint, deletion, or response mocking.
 */
const assert=require('node:assert/strict'),fs=require('node:fs'),http=require('node:http'),path=require('node:path');
const {chromium}=require(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES?process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES+'/playwright':'playwright');
const endpoint='https://script.google.com/macros/s/AKfycbx6Qaaei0Fbh1_agSFSGG1_zywyiGWtetXYuCI-6iHri0LDc2rxTg3C5exK0RLdsQKq/exec';
if(process.env.SR_LIVE_STAGING!=='approved')throw new Error('Set SR_LIVE_STAGING=approved only after staging fixture creation is authorized.');
const root=path.resolve('multi-classroom/release/pages'),out=process.env.SR_TEST_OUTPUT||require('node:os').tmpdir();
assert.ok(fs.readFileSync(path.join(root,'index.html'),'utf8').includes(endpoint),'Rebuild candidate for this exact staging endpoint.');
(async()=>{
 const server=http.createServer((req,res)=>{const file={'/':'index.html','/index.html':'index.html','/sw.js':'sw.js','/manifest.webmanifest':'manifest.webmanifest'}[req.url.split('?')[0]];if(!file)return res.writeHead(404).end();res.setHeader('Content-Type',file.endsWith('.html')?'text/html':file.endsWith('.js')?'application/javascript':'application/manifest+json');res.end(fs.readFileSync(path.join(root,file)));}).listen(0,'127.0.0.1');
 await new Promise(r=>server.once('listening',r));let browser;
 try{
  browser=await chromium.launch({headless:true,executablePath:process.env.SR_CHROMIUM_PATH,...(process.env.HTTPS_PROXY?{proxy:{server:process.env.HTTPS_PROXY,bypass:'127.0.0.1,localhost'}}:{}),args:['--no-sandbox','--disable-dev-shm-usage','--single-process','--disable-gpu','--disable-software-rasterizer','--no-zygote']});
  const context=await browser.newContext({viewport:{width:390,height:844}}),page=await context.newPage(),calls=[],errors=[];
  page.setDefaultTimeout(120000);page.on('pageerror',e=>errors.push(String(e)));
  page.on('requestfailed',r=>console.log('Network failure:',new URL(r.url()).origin,r.failure()?.errorText));
  page.on('request',r=>{if(r.url()===endpoint){assert.equal(r.method(),'POST');assert.equal(r.headers()['cookie'],undefined);calls.push(JSON.parse(r.postData()));}});
  await page.goto('http://127.0.0.1:'+server.address().port);
  await page.waitForFunction(()=>document.querySelector('#mcSchool').options.length===5,null,{timeout:180000});
  assert.deepEqual(await page.locator('#mcSchool option').allTextContents(),['教室を選択','大府柊山校','共和校','森本校','尾西校']);
  console.log('PASS live anonymous browser POST/CORS: four schools, no Google cookie.');
  const identities=[],run=Date.now();
  for(const [school,tag] of [['森本校','morimoto'],['尾西校','bisai']]){
   await page.selectOption('#mcSchool',{label:school});await page.fill('#studentName','POST分離検証（架空）');await page.selectOption('#grade','中1');await page.fill('#goalMinutes','30');await page.click('#mcStart');
   await page.locator('#timerScreen').waitFor({state:'visible'});await page.locator('button[onclick="enterRoom()"]').click();await page.waitForFunction(()=>document.querySelector('#timerMsg').textContent.includes('入室しました。'),null,{timeout:180000});
   await page.click('#breakBtn');assert.equal(await page.locator('#breakBtn').textContent(),'休憩終了');await page.click('#breakBtn');
   await page.locator('button[onclick="exitRoom()"]').click();await page.locator('#reviewScreen').waitFor({state:'visible'});
   await page.fill('#content',`POST実通信検証 ${tag} ${run}（架空）`);await page.fill('#comment','本番データではありません。教室間分離の確認。');await page.reload();await page.locator('#reviewScreen').waitFor({state:'visible'});assert.ok((await page.inputValue('#content')).includes(tag));
   await page.click('#sendBtn');await page.locator('#completeScreen').waitFor({state:'visible',timeout:180000});await page.getByRole('button',{name:'終了する',exact:true}).click();
   await page.getByRole('button',{name:'自分の学習履歴',exact:true}).click();await page.waitForFunction(t=>document.querySelector('#mcHistory').textContent.includes(t),tag,{timeout:180000});
   const history=await page.locator('#mcHistory').innerText();assert.ok(history.includes(tag));assert.ok(!history.includes(tag==='morimoto'?'bisai':'morimoto'));
   identities.push(await page.evaluate(()=>mcContext()));
   await page.screenshot({path:path.join(out,`study-room-live-post-${tag}.png`),fullPage:true});
   if(tag==='morimoto'){page.once('dialog',d=>d.accept());await page.getByRole('button',{name:'利用者を切り替える',exact:true}).click();assert.equal(await page.inputValue('#studentName'),'');assert.equal(await page.locator('#mcHistory').innerText(),'');}
   console.log('PASS live student UI:',school,'start / break / exit / reflection draft reload / own history.');
  }
  const request=async(action,data,requestId)=>page.evaluate(async q=>SRTransport.send(q,{endpoint:document.querySelector('meta[name="study-room-api"]').content}),{action,data,requestId});
  const [a,b]=identities;
  for(const action of ['list','listActive','dashboard','students'])assert.equal((await request(action,{})).code,'AUTH');
  assert.equal((await request('history',{...a,studentKey:b.studentKey})).code,'FORBIDDEN');
  assert.equal((await request('history',{...a,schoolId:b.schoolId})).code,'FORBIDDEN');
  const ah=await request('history',a),bh=await request('history',b);assert.equal(ah.records.length,1);assert.equal(bh.records.length,1);
  const firstAdd=calls.find(q=>q.action==='addActive');assert.equal((await request(firstAdd.action,firstAdd.data,firstAdd.requestId)).result,'success');assert.equal((await request('history',a)).records.length,1);
  await page.evaluate(()=>navigator.serviceWorker.ready);assert.equal(await page.evaluate(async()=>(await caches.keys()).length),0);assert.equal(await page.evaluate(()=>Boolean(window.google?.script?.run)),false);assert.equal(errors.length,0,errors.join('\n'));
  console.log('PASS live unauthenticated admin denial, wrong-key/cross-school denial, duplicate replay, real POST/PWA, no CacheStorage. Calls:',calls.length);
 }finally{if(browser)await browser.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e.message);process.exitCode=1;});
