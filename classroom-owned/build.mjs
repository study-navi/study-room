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
html=html.replace("if(teacherSession){try{await mcLoadAdmin();}catch(e){mcClearAdmin();}}", "if(new URL(location.href).searchParams.get('manage')==='1'){teacherSession='cookie';try{await mcLoadAdmin();goScreen('teacher');if(new URL(location.href).searchParams.get('mode')==='classroom')await toggleClassroomMode();}catch(e){mcClearAdmin();mcBusy(e.message);}}");
html=html.replace("try{mcRequire(await api('logout',{session:teacherSession}));}","try{const me=await fetch('/api/me',{cache:'no-store'}).then(r=>r.json());await fetch('/auth/logout',{method:'POST',headers:{'X-CSRF-Token':me.csrf}});}");
// Settings use the server-authorized owner of this classroom, never role escalation.
html=html.replace('<div id="mcSchoolEditor"></div>','');
html=html.replace('<div id="mcDashboard"></div>','<details id="ownedAnalytics"><summary class="btn light">利用状況・ランキングを見る</summary><div id="mcDashboard"></div></details>');
html=html.replace('<div id="mcGlobal" class="hide">','<button class="btn" onclick="toggleClassroomMode()">教室モードを開く（この端末で生徒の入退室を記録）</button><button class="btn light" onclick="ownedSettings()">教室名・在籍生徒数・利用状態</button><a class="btn light" href="/teacher">教室URL・QR・バックアップ</a><div id="mcSchoolEditor"></div><div id="mcGlobal" class="hide">');
html=html.replace('</body>',`<script>
const ownedOriginalSettings=mcEditSchools;
mcEditSchools=async()=>{await ownedOriginalSettings();mcFillSchool(0);$('mcSchoolEditor').querySelectorAll('button').forEach(b=>{if(b.textContent!=='保存する')b.hidden=true;});};
async function ownedSettings(){await mcEditSchools();}
mcEditAdmins=()=>{};
teacherLogin=()=>location.assign('/teacher');
const ownedOpen='/open?classroom='+encodeURIComponent(new URL(location.href).searchParams.get('classroom'))+'&mode=classroom',ownedToggle=toggleClassroomMode;
toggleClassroomMode=async()=>{const own=encodeURIComponent(new URL(location.href).searchParams.get('classroom')||'');if(isClassroomMode()){location.assign('/study?classroom='+own);return;}if(!mcAdmin&&!mcClassroom){location.assign(ownedOpen);return;}return ownedToggle();};
if(document.documentElement.dataset.view==='classroom'){const g=document.querySelector('.headerBtnGroup'),b=document.createElement('button');b.type='button';b.className='headerTeacherBtn';b.textContent='管理画面へ';b.onclick=()=>location.assign('/study?classroom='+encodeURIComponent(new URL(location.href).searchParams.get('classroom')||'')+'&manage=1');g.prepend(b);}
document.querySelectorAll('#loginBox a.btn').forEach(a=>{a.href=ownedOpen;a.textContent='Googleでログインして教室モードを開く';});
mcLogout=async()=>{try{const me=await fetch('/api/me',{cache:'no-store'}).then(r=>r.json());const response=await fetch('/auth/logout',{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':me.csrf},body:'{}'});if(!response.ok)throw Error();mcClearAdmin();location.assign('/teacher');}catch{mcBusy('ログアウトを完了できませんでした。接続を確認して再試行してください。');}};
</script></body>`);
// 自習を始める前の画面でも、科目と学習内容（予定）を入力できる。送信画面にそのまま引き継ぐ。
html=html.replace('<button class="btn big" type="button" id="mcStart" onclick="startApp()">スタート</button>',
  '<div class="grid2"><div><label for="planSubject">科目（任意）</label><select id="planSubject"><option value="">あとで選ぶ</option><option>英語</option><option>数学</option><option>国語</option><option>理科</option><option>社会</option><option>物理</option><option>化学</option><option>生物</option><option>日本史</option><option>世界史</option><option>その他</option></select></div></div><label for="planContent">今日の学習内容（任意）</label><input id="planContent" maxlength="200" placeholder="例：数学ワーク p.20〜35" autocomplete="off"><p class="small">自習のあとの送信画面に、そのまま入ります。送信前に書き直せます。</p><button class="btn big" type="button" id="mcStart" onclick="startApp()">スタート</button>');
html=html.replace("appState.goalMinutes = $('goalMinutes').value;\n  saveProfile();","appState.goalMinutes = $('goalMinutes').value;\n  appState.planSubject = $('planSubject').value;\n  appState.planContent = $('planContent').value.trim();\n  appState.planUsed = false;\n  saveProfile();");
html=html.replace("function renderReview(){\n  $('date').value = todayISO();","function renderReview(){\n  $('date').value = todayISO();\n  if(appState.planSubject && !appState.planUsed)$('subject').value = appState.planSubject;\n  if(appState.planContent && !$('content').value.trim())$('content').value = appState.planContent;\n  appState.planUsed = true;");
html=html.replaceAll("activeRecordId:null, focus:3, achievement:3\n  });","activeRecordId:null, focus:3, achievement:3, planSubject:'', planContent:'', planUsed:false\n  });");
html=html.replace("$('goalMinutes').value = keepGoal || '';\n  saveProfile();","$('goalMinutes').value = keepGoal || '';\n  $('planSubject').value = '';\n  $('planContent').value = '';\n  saveProfile();");
html=html.replace("$('goalMinutes').value='';$('mcHistory').innerHTML='';","$('goalMinutes').value='';$('planSubject').value='';$('planContent').value='';$('mcHistory').innerHTML='';");
html=html.replaceAll('https://study-navi.github.io/study-room/','/');
html=html.replace('</head>','<style>a.btn{display:inline-block;text-decoration:none;line-height:1.5}#teacherPanel>.btn{margin:5px 0;max-width:100%}@media(max-width:600px){#teacherPanel>.btn{display:block;width:100%;text-align:left}}</style></head>');
html=html.replaceAll("location.hostname==='study-navi.github.io' && 'serviceWorker' in navigator","'serviceWorker' in navigator");
// Never silently use a restored marker as authentication.
html=html.replace("sessionStorage.getItem(TEACHER_SESSION_KEY)","''");
html=html.replace("panel && !panel.classList.contains('hide')","panel && document.visibilityState==='visible' && !panel.classList.contains('hide')").replace('}, 15000);','}, 60000);');
// 生徒用画面と先生用画面を分ける：生徒用には先生向けのボタンを出さず、管理画面には生徒の個人画面を出さない。
html=html.replace('</head>',`<meta name="sr-view" content="auto"><script>(()=>{const url=new URL(location.href),q=url.searchParams,forced=document.querySelector('meta[name=sr-view]').content;if(forced==='student'&&(q.has('manage')||q.has('mode'))){q.delete('manage');q.delete('mode');history.replaceState(null,'',url);}document.documentElement.dataset.view=forced==='student'?'student':q.get('mode')==='classroom'?'classroom':q.get('manage')==='1'?'manage':'student';})();</script><style>:root[data-view="student"] .headerBtnGroup{display:none !important}:root[data-view="manage"] .headerBtnGroup{display:none !important}:root[data-view="manage"] #teacher .teacherBackBtn{display:none}.viewLink{text-align:center;margin:18px 0 6px}.viewLink a{color:#1768ad}</style></head>`);
html=html.replace('</body>',`<script>
(()=>{const id=new URL(location.href).searchParams.get('classroom')||'',view=document.documentElement.dataset.view;
if(view==='student'){const p=document.createElement('p');p.className='small viewLink';const a=document.createElement('a');a.href='/open?classroom='+encodeURIComponent(id);a.textContent='先生の方はこちら（管理画面・教室モード）';p.append(a);document.querySelector('.wrap').append(p);}
if(view==='manage'){const h=document.querySelector('#teacher .teacherHead'),p=document.createElement('p');p.className='small viewLink';const a=document.createElement('a');a.href='/study?classroom='+encodeURIComponent(id);a.textContent='生徒用の画面を開く（生徒に配るURLと同じです）';p.append(a);h.after(p);}
})();
</script></body>`);
// 先生用の画面（管理画面と教室モード）を、サーバーが生徒用に返すときに丸ごと取り除けるよう目印を付ける。
{const a=html.indexOf('<section id="teacher"'),c=html.indexOf('<section id="crComplete"');const e=html.indexOf('</section>',c)+'</section>'.length;if(a<0||c<a||e<c)throw new Error('先生用画面の範囲を特定できません');html=html.slice(0,a)+'<!--SR-ADMIN-START-->'+html.slice(a,e)+'<!--SR-ADMIN-END-->'+html.slice(e);}
// 画面と応答メッセージの日本語表記をそろえる（元のアプリのソースは変更しない）。
const wording=[
['ログ確認へ進むできません：','ログ確認へ進めません：'],
['現在時刻で入室を押すと計測します','「入室」を押すと、計測を始めます'],
['>自習室を利用する<','>続けて自習する<'],
['ただしログ確認への仮反映に失敗しました。退室後の送信はできます。','ただし、ログ確認にはまだ表示されていません。退室後に送信できます。'],
['ただし通信できないため、ログ確認への仮反映はできませんでした。','ただし通信できなかったため、ログ確認にはまだ表示されていません。'],
['原因不明','原因は不明です'],
['引継ぎ','引き継ぎ'],
['算出不可（在籍生徒数未設定）','計算できません（在籍生徒数が未設定です）'],
['教室URL・QR・バックアップ','教室URL・QRコード・バックアップ'],
['が不正です。','が正しくありません。'],
['ログイン期限が切れました。再ログインしてください。','ログインの有効期限が切れました。もう一度ログインしてください。'],
['他の操作で更新されています。再読み込みしてください。','ほかの操作で更新されました。画面を再読み込みしてください。'],
['選択した終了日を基準に直近28日と前の28日を比較。前期間2日以上かつ利用日数半分以下、または28日以上利用なし。利用歴のない在籍生徒は判定対象外です。','選択した終了日を基準に、直近28日とその前の28日を比べます。前の28日に2日以上利用があり、利用日数が半分以下に減った生徒、または28日以上利用がない生徒を表示します。利用歴のない在籍生徒は対象外です。'],
];
const polish=text=>wording.reduce((t,[a,b])=>t.replaceAll(a,b),text);
html=html.replace("$('search').addEventListener('input', renderTeacher);","if($('search'))$('search').addEventListener('input', renderTeacher);");
html=polish(html);
mkdirSync(out,{recursive:true});writeFileSync(new URL('study.html',out),html);
for(const [,js] of html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g))new Script(js);
const domainSource='export function dispatch(request,hooks){\n'+readFileSync(new URL('multi-classroom/Core.gs',root),'utf8').replace("if(typeof module!=='undefined') module.exports=SR;",'')+'\n'+readFileSync(new URL('multi-classroom/Code.gs',root),'utf8')+`\n
srAll_=hooks.all;srSave_=hooks.save;srAdmin_=hooks.admin;srHash_=hooks.hash;srToken_=hooks.token;
srNow_=()=>new Date().toISOString();srToday_=hooks.today;
const Utilities={formatDate:hooks.formatDate};
return srDispatch_(request);\n}\n`;
writeFileSync(new URL('domain-engine.mjs',out),polish(domainSource));
writeFileSync(new URL('portal.html',out),readFileSync(new URL('./portal.html',import.meta.url)));
writeFileSync(new URL('privacy.html',out),readFileSync(new URL('./privacy.html',import.meta.url)));
writeFileSync(new URL('dashboard.html',out),readFileSync(new URL('./dashboard.html',import.meta.url)));
writeFileSync(new URL('sw.js',out),"self.addEventListener('install',()=>self.skipWaiting());self.addEventListener('activate',e=>e.waitUntil(self.clients.claim()));self.addEventListener('fetch',()=>{});\n");
const manifest=JSON.parse(readFileSync(new URL('manifest.webmanifest',root),'utf8'));manifest.start_url='/';manifest.scope='/';
writeFileSync(new URL('manifest.webmanifest',out),JSON.stringify(manifest));
cpSync(new URL('icons',root),new URL('icons',out),{recursive:true});
cpSync(new URL('apple-touch-icon.png',root),new URL('apple-touch-icon.png',out));
const publicOut=new URL('public/',out);mkdirSync(publicOut,{recursive:true});
for(const name of ['study.html','portal.html','privacy.html','dashboard.html','manifest.webmanifest','sw.js','apple-touch-icon.png'])cpSync(new URL(name,out),new URL(name,publicOut));
cpSync(new URL('icons/',out),new URL('icons/',publicOut),{recursive:true});
console.log('Built independent classroom student/teacher app; production files unchanged.');
