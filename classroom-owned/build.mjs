import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync,mkdirSync,cpSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {Script} from 'node:vm';

const root=new URL('../',import.meta.url),out=new URL('./release/',import.meta.url);
execFileSync('python3',[fileURLToPath(new URL('multi-classroom/tools/build.py',root))]);
let html=readFileSync(new URL('multi-classroom/App.html',root),'utf8');
const oldTransport=readFileSync(new URL('multi-classroom/Transport.js',root),'utf8');
html=html.replace(oldTransport,`const SRTransport={send:async q=>{
  const ownUrl=new URL(location.href),classroom=ownUrl.searchParams.get('classroom');
  const headers={'Content-Type':'application/json'};
  if(q.data.session){const me=await fetch('/api/me',{cache:'no-store'}).then(r=>r.json());if(!me.csrf)return {result:'error',code:'AUTH',message:'先生がGoogleでログインしてください。'};headers['X-CSRF-Token']=me.csrf;}
  const response=await fetch('/api/study',{method:'POST',headers,credentials:'same-origin',cache:'no-store',body:JSON.stringify({classroom,...q}),signal:AbortSignal.timeout(90000)}).catch(()=>{throw new Error('通信できません。入力内容は残しています。電波の良い場所で、もう一度送信してください。');});
  return response.json();
}};`);
html=html.replace(/<div class="grid2">\s*<div><label>管理者ID[\s\S]*?<div id="loginMsg"><\/div>/,
  '<p>先生のGoogleアカウントで管理します。</p><a class="btn" href="/teacher">Googleで管理画面を開く</a><button class="hide" id="mcLogin"></button><div id="loginMsg"></div>');
// No identity, session or profile state is shared between classroom URLs.
html=html.replaceAll('sr10Identity',"srOwnedIdentity:'+new URL(location.href).searchParams.get('classroom')+'");
html=html.replaceAll("'sr10Summary'","'srOwnedSummary:'+new URL(location.href).searchParams.get('classroom')");
html=html.replaceAll('sr10State:','srOwnedState:').replaceAll('sr10Profile:','srOwnedProfile:').replaceAll('sr10Totals:','srOwnedTotals:').replaceAll('sr10AdminSession','srOwnedAdminMarker');
html=html.replace("const id=mcIdentity?mcIdentity.id:'new';","const id=new URL(location.href).searchParams.get('classroom')+':'+(mcIdentity?mcIdentity.id:'new');");
html=html.replace("if(mcIdentity)$('mcSchool').value=mcIdentity.schoolId;", "if(mcIdentity)$('mcSchool').value=mcIdentity.schoolId;else if(r.schools.length===1)$('mcSchool').value=r.schools[0].id;$('mcSchool').disabled=true;");
html=html.replace("if(teacherSession){try{await mcLoadAdmin();}catch(e){mcClearAdmin();}}", "if(new URL(location.href).searchParams.get('manage')==='1'){teacherSession='cookie';try{await mcLoadAdmin();goScreen('teacher');}catch(e){mcClearAdmin();mcBusy(e.message);}}");
html=html.replace("try{mcRequire(await api('logout',{session:teacherSession}));}","try{const me=await fetch('/api/me',{cache:'no-store'}).then(r=>r.json());await fetch('/auth/logout',{method:'POST',headers:{'X-CSRF-Token':me.csrf}});}");
// Settings use the server-authorized owner of this classroom, never role escalation.
html=html.replace('<div id="mcSchoolEditor"></div>','');
html=html.replace('<div id="mcDashboard"></div>','<details id="ownedAnalytics"><summary class="btn light">利用状況・ランキングを見る</summary><div id="mcDashboard"></div></details>');
html=html.replace('<div id="mcGlobal" class="hide">','<button class="btn light" onclick="ownedSettings()">教室名・在籍生徒数・利用状態</button><a class="btn light" href="/teacher">教室URL・QR・バックアップ</a><div id="mcSchoolEditor"></div><div id="mcGlobal" class="hide">');
html=html.replace('</body>',`<script>
const ownedOriginalSettings=mcEditSchools;
mcEditSchools=async()=>{await ownedOriginalSettings();mcFillSchool(0);$('mcSchoolEditor').querySelectorAll('button').forEach(b=>{if(b.textContent!=='保存する')b.hidden=true;});};
async function ownedSettings(){await mcEditSchools();}
mcEditAdmins=()=>{};
teacherLogin=()=>location.assign('/teacher');
mcLogout=async()=>{try{const me=await fetch('/api/me',{cache:'no-store'}).then(r=>r.json());const response=await fetch('/auth/logout',{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':me.csrf},body:'{}'});if(!response.ok)throw Error();mcClearAdmin();location.assign('/teacher');}catch{mcBusy('ログアウトを完了できませんでした。接続を確認して再試行してください。');}};
</script></body>`);
html=html.replaceAll('https://study-navi.github.io/study-room/','/');
html=html.replace('</head>','<style>a.btn{display:inline-block;text-decoration:none;line-height:1.5}#teacherPanel>.btn{margin:5px 0;max-width:100%}@media(max-width:600px){#teacherPanel>.btn{display:block;width:100%;text-align:left}}</style></head>');
html=html.replaceAll("location.hostname==='study-navi.github.io' && 'serviceWorker' in navigator","'serviceWorker' in navigator");
// Never silently use a restored marker as authentication.
html=html.replace("sessionStorage.getItem(TEACHER_SESSION_KEY)","''");
html=html.replace("panel && !panel.classList.contains('hide')","panel && document.visibilityState==='visible' && !panel.classList.contains('hide')").replace('}, 15000);','}, 60000);');
mkdirSync(out,{recursive:true});writeFileSync(new URL('study.html',out),html);
for(const [,js] of html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g))new Script(js);
const domainSource='export function dispatch(request,hooks){\n'+readFileSync(new URL('multi-classroom/Core.gs',root),'utf8').replace("if(typeof module!=='undefined') module.exports=SR;",'')+'\n'+readFileSync(new URL('multi-classroom/Code.gs',root),'utf8')+`\n
srAll_=hooks.all;srSave_=hooks.save;srAdmin_=hooks.admin;srHash_=hooks.hash;srToken_=hooks.token;
srNow_=()=>new Date().toISOString();srToday_=hooks.today;
const Utilities={formatDate:hooks.formatDate};
return srDispatch_(request);\n}\n`;
writeFileSync(new URL('domain-engine.mjs',out),domainSource);
writeFileSync(new URL('portal.html',out),readFileSync(new URL('./portal.html',import.meta.url)));
writeFileSync(new URL('privacy.html',out),readFileSync(new URL('./privacy.html',import.meta.url)));
writeFileSync(new URL('sw.js',out),"self.addEventListener('install',()=>self.skipWaiting());self.addEventListener('activate',e=>e.waitUntil(self.clients.claim()));self.addEventListener('fetch',()=>{});\n");
const manifest=JSON.parse(readFileSync(new URL('manifest.webmanifest',root),'utf8'));manifest.start_url='/';manifest.scope='/';
writeFileSync(new URL('manifest.webmanifest',out),JSON.stringify(manifest));
cpSync(new URL('icons',root),new URL('icons',out),{recursive:true});
cpSync(new URL('apple-touch-icon.png',root),new URL('apple-touch-icon.png',out));
const publicOut=new URL('public/',out);mkdirSync(publicOut,{recursive:true});
for(const name of ['study.html','portal.html','privacy.html','manifest.webmanifest','sw.js','apple-touch-icon.png'])cpSync(new URL(name,out),new URL(name,publicOut));
cpSync(new URL('icons/',out),new URL('icons/',publicOut),{recursive:true});
console.log('Built independent classroom student/teacher app; production files unchanged.');
