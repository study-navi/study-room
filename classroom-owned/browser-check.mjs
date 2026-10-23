/** Local-only integration check: real browser -> real HTTP/domain -> fake Google.
 * Never imports credentials or sends traffic to production/Google services.
 */
import {chromium as playwright} from 'playwright';
import chromium from '@sparticuz/chromium';
import {mkdirSync,readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {fixture} from './tests/fixture.mjs';
import {createApplication} from './server.mjs';

const f=await fixture(),origin='http://127.0.0.1:18793',server=createApplication({...f,origin,secureCookies:false});
await new Promise(r=>server.listen(18793,'127.0.0.1',r));
const browser=await playwright.launch({executablePath:process.env.SR_CHROMIUM_PATH||await chromium.executablePath(),args:['--no-sandbox','--disable-dev-shm-usage','--single-process','--disable-gpu','--disable-software-rasterizer','--no-zygote'],headless:true});
const output=new URL('./release/proofs/',import.meta.url);mkdirSync(output,{recursive:true});
const errors=[],calls=[];
try{
  const context=await browser.newContext({viewport:{width:390,height:844},acceptDownloads:true}),page=await context.newPage();
  page.on('pageerror',e=>errors.push(e.message));
  await context.route('**/*',route=>{const u=new URL(route.request().url());if(u.origin!==origin&&!['blob:','data:'].includes(u.protocol))return route.abort();return route.continue();});
  page.on('request',r=>{if(r.url().includes('/api/study'))calls.push(JSON.parse(r.postData()));});
  page.on('dialog',dialog=>dialog.accept());
  await page.goto(origin+'/study?classroom='+f.a);await page.waitForFunction(()=>document.querySelector('#mcSchool').value!=='');
  assert.equal(await page.locator('#mcSchoolLabel').textContent(),'森本校');
  // 生徒用画面には先生向けのボタンを出さない（入口は小さなリンクだけ）。
  assert.equal(await page.locator('.headerBtnGroup').isVisible(),false);assert.match(await page.locator('.viewLink a').textContent(),/先生の方はこちら/);assert.match(await page.locator('.viewLink a').getAttribute('href'),/^\/open\?classroom=/);assert.equal(await page.locator('#teacher').isVisible(),false);
  await page.fill('#studentName','架空ブラウザ検証');await page.selectOption('#grade','中2');await page.fill('#goalMinutes','60');await page.selectOption('#planSubject','数学');await page.fill('#planContent','数学：方程式の復習');await page.click('#mcStart');
  await page.waitForFunction(()=>!document.querySelector('#timerScreen').classList.contains('hide'));
  await page.evaluate(()=>enterRoom());await page.waitForFunction(()=>document.querySelector('#timerMsg').textContent.includes('入室しました。'));
  await page.evaluate(()=>toggleBreak());assert.equal(await page.evaluate(()=>appState.status),'break');await page.evaluate(()=>toggleBreak());
  await page.evaluate(()=>exitRoom());await page.waitForFunction(()=>!document.querySelector('#reviewScreen').classList.contains('hide'));assert.equal(await page.inputValue('#content'),'数学：方程式の復習');assert.equal(await page.inputValue('#subject'),'数学');await page.fill('#comment','途中式を見直した');
  await page.reload();await page.waitForFunction(()=>!document.querySelector('#reviewScreen').classList.contains('hide'));assert.equal(await page.inputValue('#content'),'数学：方程式の復習');
  await page.click('#sendBtn');await page.waitForFunction(()=>!document.querySelector('#completeScreen').classList.contains('hide'));
  await page.evaluate(()=>goScreen('welcome'));await page.click('button[onclick="mcHistory()"]');await page.waitForFunction(()=>document.querySelector('#mcHistory').textContent.includes('方程式'));
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.screenshot({path:new URL('student-mobile.png',output).pathname,fullPage:true,animations:'disabled'});
  // Opening a different classroom on the same browser cannot restore the first profile/history.
  await page.goto(origin+'/study?classroom='+f.b);await page.waitForFunction(()=>document.querySelector('#mcSchool').value!=='');assert.equal(await page.inputValue('#studentName'),'');
  await page.click('button[onclick="mcHistory()"]');assert.ok(!(await page.locator('#mcHistory').textContent()).includes('方程式'));
  await context.addCookies([{name:'sr_local_session',value:'alice-session',url:origin,httpOnly:true,sameSite:'Lax'}]);
  await page.goto(origin+'/teacher');await page.waitForSelector('#classrooms article');for(const t of ['利用状況','教室モード','管理画面','生徒用URL','保存先']){const link=page.locator('#classrooms .links a',{hasText:t}).first();assert.equal(await link.getAttribute('target'),'_blank');assert.match(await link.getAttribute('rel'),/noopener/);}assert.match(await page.locator('#classrooms').textContent(),/森本校/);assert.doesNotMatch(await page.locator('#classrooms').textContent(),/尾西校/);await page.waitForFunction(()=>document.querySelector('#classrooms img').complete&&document.querySelector('#classrooms img').naturalWidth>0);
  await page.screenshot({path:new URL('portal-mobile.png',output).pathname,fullPage:true,animations:'disabled'});
  await page.goto(origin+'/study?classroom='+f.a+'&manage=1');await page.waitForFunction(()=>!document.querySelector('#teacher').classList.contains('hide'));assert.equal(await page.locator('#welcome').isVisible(),false);assert.equal(await page.locator('.headerBtnGroup').isVisible(),false);assert.match(await page.locator('.viewLink a').textContent(),/生徒用の画面を開く/);await page.waitForFunction(()=>document.querySelector('#mcDashboard').textContent.includes('管理ダッシュボード'));
  assert.equal(await page.locator('#mcRole').textContent(),'教室管理者');assert.equal(await page.locator('#mcAdminSchool option').count(),1);
  await page.click('button[onclick="ownedSettings()"]');await page.fill('#mcEnrolled','100');await page.click('button[onclick="mcSaveSchool()"]');await page.waitForFunction(()=>document.querySelector('#mcDashboard').textContent.includes('1.0%'));
  // 教室名の変更：教室一覧の「教室名を変更」から直接フォームが開き、名前を変えても生徒用URLは変わらない。
  {const before=page.url();await page.goto(origin+'/teacher');await page.waitForSelector('#classrooms article');const rename=page.locator('#classrooms .links a',{hasText:'教室名を変更'}).first();assert.match(await rename.getAttribute('href'),/manage=1#rename$/);
   await page.goto(await rename.getAttribute('href'));await page.waitForSelector('#mcSchoolName');assert.equal(await page.locator('#mcSchoolCode').isVisible(),false);
   assert.equal(await page.evaluate(()=>document.documentElement.dataset.ready),'1');assert.equal(await page.locator('#welcome').isVisible(),false);
   await page.fill('#mcSchoolName','森本校（名前変更の確認）');await page.click('button[onclick="mcSaveSchool()"]');await page.waitForFunction(()=>document.querySelector('#mcNotice').textContent.includes('保存しました'));
   await page.goto(origin+'/study?classroom='+f.a);await page.waitForFunction(()=>document.querySelector('#mcSchoolLabel').textContent.includes('名前変更の確認'));
   await page.goto(origin+'/teacher');await page.waitForSelector('#classrooms article');assert.match(await page.locator('#classrooms').textContent(),/名前変更の確認/);
   await page.goto(origin+'/study?classroom='+f.a+'&manage=1');await page.waitForFunction(()=>document.querySelector('#teacherPanel')&&!document.querySelector('#teacherPanel').classList.contains('hide'));}

  await page.fill('#search','方程式');await page.locator('#tbody .miniActionBtn').first().click();await page.fill('#editContent','数学：検算まで完了');await page.click('button[onclick="saveEditRecord()"]');await page.waitForFunction(()=>document.querySelector('#editModal').classList.contains('hide'));await page.fill('#search','');
  const downloadWait=page.waitForEvent('download');await page.click('button[onclick="downloadCSV()"]');const download=await downloadWait,csv=readFileSync(await download.path(),'utf8');assert.match(csv,/検算まで完了/);assert.match(csv,/生徒ID/);assert.doesNotMatch(csv,/尾西校/);
  await page.evaluate(()=>toggleClassroomMode());await page.evaluate(()=>crGoScreen('crCheckin'));await page.waitForFunction(()=>document.querySelector('#mcRoster').options.length>1);
  const id=f.files.get('file-'+f.a).tables.Students[0].value.id;await page.selectOption('#mcRoster',id);await page.click('#mcCrEnter');await page.waitForFunction(()=>!document.querySelector('#crHome').classList.contains('hide'));
  await page.evaluate(()=>crGoScreen('crCheckout'));await page.waitForSelector('#crActiveList button');await page.click('#crActiveList button');await page.waitForFunction(()=>!document.querySelector('#crReview').classList.contains('hide'));await page.fill('#crContent','教室モード：英単語');await page.click('#crSendBtn');await page.waitForFunction(()=>!document.querySelector('#crComplete').classList.contains('hide'));
  await page.goto(origin+'/study?classroom='+f.a+'&manage=1');await page.waitForFunction(()=>document.querySelector('#tbody').textContent.includes('英単語'));
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.screenshot({path:new URL('admin-mobile.png',output).pathname,fullPage:true,animations:'disabled'});
  await page.setViewportSize({width:1440,height:1000});await page.click('#ownedAnalytics summary');await page.screenshot({path:new URL('admin-desktop.png',output).pathname,fullPage:true,animations:'disabled'});
  // One-tap classroom mode from the teacher list, and a visible button inside the admin screen.
  await page.goto(origin+'/study?classroom='+f.a+'&manage=1&mode=classroom');await page.waitForFunction(()=>document.querySelector('#appTitle').textContent.includes('教室モード'));await page.waitForFunction(()=>!document.querySelector('#crHome').classList.contains('hide'));await page.waitForTimeout(1500);assert.equal(new URL(page.url()).searchParams.get('mode'),'classroom');assert.equal(await page.locator('#crHome').isVisible(),true);// 教室モードの画面は生徒が触る。管理画面・個人モード・ログ確認へ進むボタンを一切出さない。
assert.equal(await page.locator('.headerBtnGroup').isVisible(),false);assert.equal(await page.locator('text=管理画面へ').count(),0);assert.equal(await page.locator('#teacherPanel').isVisible(),false);
  await page.goto(origin+'/study?classroom='+f.a+'&manage=1');await page.waitForFunction(()=>[...document.querySelectorAll('#teacherPanel > button')].some(b=>b.textContent.includes('教室モードを開く')));
  // Not logged in: tapping classroom mode on the student URL goes straight to Google login.
  await context.clearCookies();await page.goto(origin+'/study?classroom='+f.a);await page.waitForFunction(()=>document.querySelector('#mcSchool').value!=='');
  await Promise.all([page.waitForURL(/\/auth\/google/),page.evaluate(()=>toggleClassroomMode())]);assert.match(page.url(),/return=/);
  await context.addCookies([{name:'sr_local_session',value:'alice-session',url:origin,httpOnly:true,sameSite:'Lax'}]);
  // Per-classroom status dashboard: own classroom only, never another teacher's.
  await page.setViewportSize({width:390,height:844});await page.goto(origin+'/dashboard?classroom='+f.a);await page.waitForFunction(()=>!document.querySelector('#view').hidden&&document.querySelector('#cards').textContent.includes('利用生徒数'));
  assert.match(await page.locator('#title').textContent(),/森本校/);assert.match(await page.locator('#recent').textContent(),/英単語/);assert.match(await page.locator('#ranking').textContent(),/架空ブラウザ検証/);assert.doesNotMatch(await page.locator('body').textContent(),/尾西校|本部/);
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.screenshot({path:new URL('dashboard-mobile.png',output).pathname,fullPage:true,animations:'disabled'});
  // 生徒別の集計と個別レポート（印刷用表示）
  await page.waitForFunction(()=>document.querySelector('#stuTable').textContent.includes('架空ブラウザ検証'));
  await page.fill('#stuSearch','存在しない名前');assert.ok((await page.locator('#stuTable').textContent()).includes('該当する生徒がいません'));await page.fill('#stuSearch','');
  await page.locator('#stuTable .stuLink').first().click();
  await page.waitForFunction(()=>!document.querySelector('#detail').hidden&&document.querySelector('#view').hidden);
  assert.ok((await page.locator('#dName').textContent()).includes('架空ブラウザ検証'));assert.match(await page.locator('#dRecords').textContent(),/英単語|方程式/);assert.ok((await page.locator('#dSubjects').textContent()).includes('分'));
  await page.emulateMedia({media:'print'});assert.equal(await page.evaluate(()=>getComputedStyle(document.querySelector('#view')).display),'none');assert.ok(await page.locator('#dName').isVisible());assert.equal(await page.locator('.top').first().isVisible(),false);await page.screenshot({path:new URL('student-report-print.png',output).pathname,fullPage:true,animations:'disabled'});await page.emulateMedia({media:'screen'});
  await page.click('#stuBack');await page.waitForFunction(()=>document.querySelector('#detail').hidden&&!document.querySelector('#view').hidden);
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  await page.setViewportSize({width:1440,height:1000});await page.screenshot({path:new URL('dashboard-desktop.png',output).pathname,fullPage:true,animations:'disabled'});
  await page.goto(origin+'/dashboard?classroom='+f.b);await page.waitForFunction(()=>document.querySelector('#status').classList.contains('error'));
  assert.equal(await page.locator('#view').isVisible(),false);assert.doesNotMatch(await page.locator('#cards').textContent(),/人/);
  await page.evaluate(()=>navigator.serviceWorker.ready);assert.equal(await page.evaluate(async()=>(await caches.keys()).length),0);
  await page.goto(origin+'/study?classroom='+f.b+'&manage=1');await page.waitForURL(u=>new URL(u).pathname==='/teacher');assert.equal(await page.locator('#teacherPanel').count(),0);
  await page.goto(origin+'/study?classroom='+f.a+'&manage=1');await page.waitForFunction(()=>document.querySelector('#mcDashboard').textContent.includes('管理ダッシュボード'));await page.click('button[onclick="mcLogout()"]');await page.waitForURL(origin+'/teacher');await page.waitForSelector('#login:visible');assert.equal(f.sessions.has('alice-session'),false);
  assert.equal(f.files.get('file-'+f.a).tables.Records.length,2);assert.equal(f.files.get('file-'+f.b).tables.Records.length,0);assert.equal(errors.length,0,errors.join('\n'));
  console.log('PASS: real HTTP/domain/Google-adapter boundary; student start/break/reflection/reload/history, cross-classroom storage, teacher scope/settings/edit/CSV/classroom mode, QR, mobile390/desktop1440, PWA private cache empty, logout revocation; API calls='+calls.length);
}finally{await browser.close();await new Promise(r=>server.close(r));f.close();}
