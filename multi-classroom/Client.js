/* v9 integration layer. Bundled into App.html; no external code or JSONP. */
let mcSchools=[],mcAdmin=null,mcAdminSchools=[],mcClassroom=false,mcRoster=[];
let mcIdentity=(()=>{try{return JSON.parse(localStorage.getItem('sr10Identity')||'null');}catch(e){return null;}})();
const mcUuid=()=>crypto.randomUUID();
function mcSecret(){return Array.from(crypto.getRandomValues(new Uint8Array(32)),n=>n.toString(16).padStart(2,'0')).join('');}
function mcSaveIdentity(){localStorage.setItem('sr10Identity',JSON.stringify(mcIdentity));}
function mcContext(){return mcIdentity?{schoolId:mcIdentity.schoolId,studentId:mcIdentity.id,studentKey:mcIdentity.key}:{};}
function mcFilters(){return {schoolId:$('mcAdminSchool').value,from:$('mcFrom').value,to:$('mcTo').value};}
function mcBusy(msg){$('mcNotice').textContent=msg;}
function mcDrawSchool(){const s=mcSchools.find(s=>s.id===$('mcSchool').value);$('mcSchoolLabel').textContent=s?s.name:'教室を選択してください';}
function mcResetLocal(){
  if(appState.startAt){alert('進行中の自習を送信してから切り替えてください。');return false;}
  [STATE_KEY,PROFILE_KEY,LOCAL_TOTAL_KEY,'sr10Summary'].forEach(k=>localStorage.removeItem(k));
  mcIdentity=null;localStorage.removeItem('sr10Identity');appState={screen:'welcome',name:'',grade:'中1',status:'idle',breakTotalMs:0};
  $('studentName').value='';$('grade').value='中1';$('goalMinutes').value='';$('mcHistory').innerHTML='';
  ['todayUserCount','welcomeTodayUserCount','streakDays','welcomeStreakDays'].forEach(id=>$(id).textContent='0');return true;
}
function mcSwitchUser(){if(confirm('この端末のプロフィールと履歴キーを解除します。元の履歴へ戻すには先生の確認が必要です。切り替えますか？')){if(mcResetLocal()){mcStorageKeys();goScreen('welcome');mcBusy('新しい利用者の名前と学年を入力してください。');}}}
function mcStorageKeys(){const id=mcIdentity?mcIdentity.id:'new';STATE_KEY='sr10State:'+id;PROFILE_KEY='sr10Profile:'+id;LOCAL_TOTAL_KEY='sr10Totals:'+id;}
let mcCalls=0;
api=async function(action,data={},attempt=0,requestId=mcUuid()){
  if(action==='addActive'&&!data.session&&appState.activeRecordId===data.id)data={...data,startedAt:appState.startAt,goalMinutes:appState.goalMinutes};
  const context=['registerStudent','history','stats','addActive','update','checkout'].includes(action)&&!data.session?mcContext():{};
  const q={action,data:{...context,...data},requestId};
  mcCalls++;$('mcNetwork').textContent='通信中…';
  try{
    const result=await SRTransport.send(q,{rpc:window.google&&google.script&&google.script.run,endpoint:document.querySelector('meta[name="study-room-api"]')?.content});
    if(action==='addActive'&&result.result==='success'&&result.alreadyActive&&result.id!==data.id&&!data.session){appState.activeRecordId=result.id;if(result.startedAt)appState.startAt=result.startedAt;if(result.endedAt){appState.endAt=result.endedAt;appState.status='finished';}saveState();}
    if(result.result==='error'&&result.code==='AUTH'&&data.session){mcClearAdmin();}
    return result;
  }catch(e){
    if(attempt<2&&action!=='teacherLogin'&&action!=='saveAdmin'){await new Promise(r=>setTimeout(r,700*(attempt+1)));return api(action,data,attempt+1,requestId);}
    throw e;
  }finally{mcCalls--;$('mcNetwork').textContent=mcCalls?'通信中…':'';}
};
function mcRequire(r){if(!r||r.result!=='success')throw new Error(r&&r.message||'処理に失敗しました。');return r;}
const mcOldStart=startApp;
startApp=async function(){
  const btn=$('mcStart');btn.disabled=true;
  try{
    const schoolId=$('mcSchool').value,name=$('studentName').value.trim();if(!schoolId||!name)throw new Error('教室と名前を入力してください。');
    if(mcIdentity&&mcIdentity.name&&mcIdentity.name!==name)throw new Error('別の生徒が使う場合は「利用者を切り替える」を押してください。');
    if(!mcIdentity){mcIdentity={id:mcUuid(),key:mcSecret(),schoolId};mcSaveIdentity();mcStorageKeys();}
    mcIdentity.name=name;mcIdentity.grade=$('grade').value;mcSaveIdentity();
    mcRequire(await api('registerStudent',{name,grade:mcIdentity.grade}));mcOldStart();mcBusy('');
  }catch(e){setMsg('welcomeMsg',e.message,'err');}finally{btn.disabled=false;}
};
// Preserve one logical operation ID across manual retries, including ambiguous responses.
function mcOperation(action,data){const {session,studentKey,...payload}=data;const key='sr10Op:'+action+':'+JSON.stringify(payload);let op=sessionStorage.getItem(key);if(!op){op=mcUuid();sessionStorage.setItem(key,op);}return op;}
const mcApi=api;
api=function(action,data={},attempt=0,requestId){if(!requestId&&['addActive','update','checkout','delete'].includes(action))requestId=mcOperation(action,data);return mcApi(action,data,attempt,requestId);};
const mcOldSubmit=submitToTeacher;
submitToTeacher=async function(){
  const button=$('sendBtn');if(button.disabled)return;button.disabled=true;
  try{
    if(pendingCheckinPromise)await pendingCheckinPromise;
    if(!appState.activeRecordId){appState.activeRecordId=mcUuid();saveState();}
    const r=mcRequire(await api('addActive',{id:appState.activeRecordId,date:todayISO(),startTime:timeText(appState.startAt),subject:'入室中',content:'入室中'}));
    if(r.id!==appState.activeRecordId)throw new Error('別の入室記録があります。先生に確認してください。');
    await mcOldSubmit();if(appState.status==='idle'){appState.reviewDraft=null;saveState();}
  }catch(e){setMsg('reviewMsg',e.message,'err');}finally{button.disabled=false;}
};
const mcOldEnter=enterRoom;
enterRoom=async function(){
  if(appState.startAt)return;
  await mcOldEnter();
};
updateTodayUserCountFromSheet=async function(){await updateAccurateStatsFromSheet();};
updateAccurateStatsFromSheet=async function(){const identity=mcIdentity;if(!identity)return;try{const r=mcRequire(await api('stats'));if(mcIdentity!==identity)return;['todayUserCount','welcomeTodayUserCount'].forEach(id=>$(id).textContent=r.todayUserCount);['streakDays','welcomeStreakDays'].forEach(id=>$(id).textContent=r.streakDays);}catch(e){if(mcIdentity===identity)mcBusy(e.message);}};
async function mcHistory(){
  const identity=mcIdentity;
  try{if(!identity)throw new Error('名前を登録してから履歴を確認してください。');const r=mcRequire(await api('history'));if(mcIdentity!==identity)return;$('mcHistory').innerHTML='<h3>自分の学習履歴</h3>'+r.records.map(x=>`<div class="mcItem"><b>${escapeHtml(x['日付'])} ${escapeHtml(x['科目'])} ${escapeHtml(x['自習分数'])}分</b><p>${escapeHtml(x['学習内容'])}</p><p>${escapeHtml(x['コメント'])}</p></div>`).join('');if(!r.records.length)$('mcHistory').innerHTML+='<p>記録はまだありません。</p>';}catch(e){if(mcIdentity===identity)mcBusy(e.message);}
}
function mcClearAdmin(){teacherSession='';mcAdmin=null;records=[];mcRoster=[];crActiveRecords=[];crSelected=null;mcClassroom=false;stopTeacherAutoRefresh();sessionStorage.removeItem(TEACHER_SESSION_KEY);$('teacherPanel').classList.add('hide');$('loginBox').classList.remove('hide');$('tbody').innerHTML='';$('mcDashboard').innerHTML='';$('mcAdminEditor').innerHTML='';$('mcSchoolEditor').innerHTML='';$('mcStudentEditor').innerHTML='';$('crActiveList').innerHTML='';$('mcRoster').innerHTML='';$('mcAdminSchool').innerHTML='';$('crRecentNames').innerHTML='';['inRoomList','pendingReflectionList','detailRanking','subjectRanking'].forEach(id=>$(id).innerHTML='');window.mcAdmins=[];mcAdminSchools=[];$('appTitle').textContent='Study Room';updateModeButton();document.body.classList.remove('classroomMode');crScreenIds().forEach(id=>$(id).classList.add('hide'));}
async function mcLogout(){try{mcRequire(await api('logout',{session:teacherSession}));}catch(e){mcBusy(e.message);}finally{mcClearAdmin();goScreen('teacher');}}
teacherLogin=async function(){
  $('mcLogin').disabled=true;setMsg('loginMsg','認証中です…');
  try{const r=mcRequire(await api('teacherLogin',{teacherId:$('teacherId').value.trim(),teacherPass:$('teacherPass').value}));teacherSession=r.session;sessionStorage.setItem(TEACHER_SESSION_KEY,teacherSession);$('teacherPass').value='';await mcLoadAdmin();setMsg('loginMsg','');}catch(e){setMsg('loginMsg',e.message,'err');}finally{$('mcLogin').disabled=false;}
};
async function mcLoadAdmin(){
  const r=mcRequire(await api('me',{session:teacherSession}));mcAdmin=r.admin;mcAdminSchools=r.schools;
  $('mcRole').textContent=mcAdmin.role==='global'?'全体管理者':'教室管理者';
  $('mcGlobal').classList.toggle('hide',mcAdmin.role!=='global');$('loginBox').classList.add('hide');$('teacherPanel').classList.remove('hide');
  const chosen=$('mcAdminSchool').value;$('mcAdminSchool').innerHTML=(mcAdmin.role==='global'?'<option value="">全教室</option>':'')+r.schools.map(s=>`<option value="${escapeHtml(s.id)}">${escapeHtml(s.name)}${s.active?'':'（停止中）'}</option>`).join('');if(r.schools.some(s=>s.id===chosen))$('mcAdminSchool').value=chosen;
  await loadRecords();startTeacherAutoRefresh();
}
let mcLoadSequence=0;
loadRecords=async function(){
  if(!mcAdmin)return;$('mcSchoolLabel').textContent='管理：'+(($('mcAdminSchool').value&&(mcAdminSchools.find(s=>s.id===$('mcAdminSchool').value)||{}).name)||'全教室');const sequence=++mcLoadSequence;setMsg('teacherMsg','読み込み中です…');
  try{const data={session:teacherSession,...mcFilters()},r=mcRequire(await api('list',data)),dashboard=mcRequire(await api('dashboard',data));if(sequence!==mcLoadSequence)return;records=r.records;renderTeacher();renderDetailPanel();mcRenderDashboard(dashboard.dashboard);setMsg('teacherMsg','');}catch(e){if(sequence!==mcLoadSequence)return;records=[];$('tbody').innerHTML='';$('mcDashboard').innerHTML='';setMsg('teacherMsg',e.message,'err');}
};
function mcRenderDashboard(d){
  const ratio=v=>v==null?'算出不可（在籍生徒数未設定）':v.toFixed(1)+'%';const card=(name,value)=>`<div class="stat">${name}<b>${escapeHtml(value)}</b></div>`;
  $('mcDashboard').innerHTML='<h3>管理ダッシュボード</h3><div class="statGrid">'+card('対象教室数',d.schoolCount)+card('在籍生徒数',d.enrolled??'未設定')+card('自習利用生徒数',d.users+'人')+card('現在自習中',d.active+'人')+card('本日の総学習時間',d.todayMinutes+'分')+card('今月の総学習時間',d.monthMinutes+'分')+card('対象期間の総学習時間',d.minutes+'分')+card('自習室利用率',ratio(d.utilization))+'</div><p class="small">利用人数は生徒IDの重複を除外した送信済み記録の人数です。在籍生徒数が全教室に設定されている場合に全体利用率を計算します。別端末・利用者切替による重複IDは先生の確認が必要です。</p><h3>教室別比較</h3>'+d.schools.map(s=>`<div class="mcItem"><b>${escapeHtml(s.name)}</b><p>在籍 ${s.enrolled??'未設定'}人 ／ 利用 ${s.users}人 ／ ${s.minutes}分 ／ ${ratio(s.utilization)}</p></div>`).join('')+'<h3>学年別利用状況</h3>'+d.grades.map(g=>`<span class="crChip">${escapeHtml(g.grade)}：${g.users}人</span>`).join('')+'<h3>教室別ランキング</h3>'+d.schools.map(s=>`<h4>${escapeHtml(s.name)}</h4>`+d.ranking.filter(r=>r.schoolId===s.id).slice(0,10).map((r,i)=>`<div class="mcItem">${i+1}位 ${escapeHtml(r.name)}（${escapeHtml(r.studentId.slice(0,8))}）：${r.minutes}分</div>`).join('')).join('')+'<h3>利用状況の確認が必要な生徒</h3><p class="small">選択した終了日を基準に直近28日と前の28日を比較。前期間2日以上かつ利用日数半分以下、または28日以上利用なし。利用歴のない在籍生徒は判定対象外です。</p>'+d.alerts.map(a=>`<div class="mcItem">${escapeHtml((mcAdminSchools.find(s=>s.id===a.schoolId)||{}).name||'')} ／ ${escapeHtml(a.name)}：${escapeHtml(a.reason)}（最終 ${a.last}、前 ${a.prior}日→直近 ${a.recent}日）</div>`).join('');
}
function mcDownload(name,text){const a=document.createElement('a'),url=URL.createObjectURL(new Blob([text],{type:'text/csv;charset=utf-8'}));a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
downloadCSV=function(){const q=$('search').value.trim().toLowerCase();mcDownload('自習室ログ_'+todayISO()+'.csv',SR.csv(records.filter(r=>!q||JSON.stringify(r).toLowerCase().includes(q))));};
const mcOldGoScreen=goScreen;goScreen=function(id){mcOldGoScreen(id);if(id!=='teacher')mcDrawSchool();};
const mcOldRender=renderTeacher;
renderTeacher=function(){mcOldRender();document.querySelector('#teacher .tableWrap').scrollLeft=0;const rows=records.filter(r=>!$('search').value.trim()||JSON.stringify(r).toLowerCase().includes($('search').value.trim().toLowerCase()));$('statToday').textContent=new Set(rows.filter(r=>r['日付']===todayISO()).map(r=>r['教室ID']+':'+r['生徒ID'])).size;};
// Search-filtered row buttons must resolve by stable record ID, not the filtered index.
let mcEditVersion=null;
const mcOldOpenEdit=openEditModal,mcOldDelete=deleteRecordFromList;
function mcFilteredIndex(i){const q=$('search').value.trim().toLowerCase(),r=records.filter(r=>!q||JSON.stringify(r).toLowerCase().includes(q))[i];return records.findIndex(x=>r&&x['ID']===r['ID']);}
openEditModal=i=>{const idx=mcFilteredIndex(i);mcEditVersion=(records[idx]||{}).version;mcOldOpenEdit(idx);};deleteRecordFromList=i=>mcOldDelete(mcFilteredIndex(i));
const mcOldEditData=editDataFromModal;
editDataFromModal=()=>({...mcOldEditData(),version:mcEditVersion});
async function mcEditSchools(){
  $('mcSchoolEditor').innerHTML='<h3>教室の追加・編集</h3>'+mcAdminSchools.map((s,i)=>`<button class="btn light" type="button" onclick="mcFillSchool(${i})">${escapeHtml(s.name)}</button>`).join('')+'<button class="btn light" onclick="mcFillSchool(-1)">新しい教室</button><div id="mcSchoolForm"></div>';mcFillSchool(-1);
}
function mcFillSchool(i){const s=mcAdminSchools[i]||{id:mcUuid(),name:'',code:'',active:true,enrolled:null};$('mcSchoolForm').innerHTML=`<input id="mcSchoolId" type="hidden" value="${escapeHtml(s.id)}"><label>教室名<input id="mcSchoolName" value="${escapeHtml(s.name)}"></label><label>教室コード<input id="mcSchoolCode" value="${escapeHtml(s.code)}"></label><label>在籍生徒数（未設定なら空欄）<input id="mcEnrolled" type="number" min="1" value="${s.enrolled??''}"></label><label>利用状態<select id="mcSchoolActive"><option value="true">利用中</option><option value="false">停止中</option></select></label><p>登録日時：${escapeHtml(s.createdAt||'保存時に登録')} ／ 担当管理者：${escapeHtml((s.adminIds||[]).join('、')||'未設定')}</p><button class="btn" onclick="mcSaveSchool()">保存する</button>`;$('mcSchoolActive').value=String(s.active);}
async function mcSaveSchool(){try{mcRequire(await api('saveSchool',{session:teacherSession,school:{id:$('mcSchoolId').value,name:$('mcSchoolName').value,code:$('mcSchoolCode').value,enrolled:$('mcEnrolled').value,active:$('mcSchoolActive').value==='true'}}));await mcLoadAdmin();await mcEditSchools();mcBusy('教室を保存しました。');}catch(e){mcBusy(e.message);}}
async function mcEditAdmins(){
  try{const r=mcRequire(await api('admins',{session:teacherSession}));window.mcAdmins=r.admins;$('mcAdminEditor').innerHTML='<h3>管理者の登録・権限設定</h3>'+r.admins.map((a,i)=>`<button class="btn light" onclick="mcFillAdmin(${i})">${escapeHtml(a.id)}（${a.role==='global'?'全体管理者':'教室管理者'}）</button>`).join('')+'<button class="btn light" onclick="mcFillAdmin(-1)">新しい管理者</button><div id="mcAdminForm"></div>';mcFillAdmin(-1);}catch(e){mcBusy(e.message);}
}
function mcFillAdmin(i){const a=window.mcAdmins[i]||{id:'',role:'school',schoolIds:[],active:true};$('mcAdminForm').innerHTML=`<label>管理者ID<input id="mcAdminId" value="${escapeHtml(a.id)}" ${a.id?'readonly':''}></label><label>パスワード（12文字以上／編集時は空欄で維持）<input id="mcAdminPass" type="password" autocomplete="new-password"></label><label>権限<select id="mcAdminRole"><option value="school">教室管理者</option><option value="global">全体管理者</option></select></label><fieldset><legend>担当教室</legend>${mcAdminSchools.map(s=>`<label class="mcCheck"><input type="checkbox" name="mcAdminScope" value="${escapeHtml(s.id)}" ${a.schoolIds.includes(s.id)?'checked':''}>${escapeHtml(s.name)}</label>`).join('')}</fieldset><label>利用状態<select id="mcAdminActive"><option value="true">利用中</option><option value="false">停止中</option></select></label><button class="btn" onclick="mcSaveAdmin()">保存する</button>`;$('mcAdminRole').value=a.role;$('mcAdminActive').value=String(a.active);}
async function mcSaveAdmin(){try{mcRequire(await api('saveAdmin',{session:teacherSession,admin:{id:$('mcAdminId').value,password:$('mcAdminPass').value,role:$('mcAdminRole').value,active:$('mcAdminActive').value==='true',schoolIds:[...document.querySelectorAll('[name="mcAdminScope"]:checked')].map(e=>e.value)}}));$('mcAdminPass').value='';await mcEditAdmins();mcBusy('管理者を保存しました。変更した管理者の既存ログインは失効します。');}catch(e){mcBusy(e.message);}}
// Classroom mode is a supervised admin surface; student mode never receives a peer list.
isClassroomMode=()=>mcClassroom;
toggleClassroomMode=async function(){
  if(mcClassroom){mcClassroom=false;$('appTitle').textContent='Study Room';document.body.classList.remove('classroomMode');crScreenIds().forEach(id=>$(id).classList.add('hide'));goScreen('teacher');updateModeButton();return;}
  if(!mcAdmin){goScreen('teacher');setMsg('loginMsg','教室モードを使うには先生がログインしてください。');return;}
  if(!$('mcAdminSchool').value){mcBusy('教室モードで使う教室を選んでください。');goScreen('teacher');return;}
  mcClassroom=true;crInit();mcLoadRoster();
};
crRecentNames=()=>[];crAddRecentName=()=>{};crRenderRecentNames=()=>{};
async function mcLoadRoster(){try{const r=mcRequire(await api('students',{session:teacherSession,schoolId:$('mcAdminSchool').value}));mcRoster=r.students;$('mcRoster').innerHTML='<option value="">初めての生徒（新規）</option>'+r.students.map(s=>`<option value="${escapeHtml(s.id)}">${escapeHtml(s.name)}／${escapeHtml(s.grade)}／${escapeHtml(s.id.slice(0,8))}</option>`).join('');}catch(e){setMsg('crCheckinMsg',e.message,'err');}}
crSubmitCheckin=async function(){
  $('mcCrEnter').disabled=true;
  try{const schoolId=$('mcAdminSchool').value;let studentId=$('mcRoster').value;if(!studentId){const r=mcRequire(await api('saveStudent',{session:teacherSession,schoolId,student:{id:mcUuid(),name:$('crName').value.trim(),grade:$('crGrade').value}}));studentId=r.studentId;await mcLoadRoster();}
    const id=mcUuid(),r=mcRequire(await api('addActive',{session:teacherSession,schoolId,studentId,id,date:todayISO(),startTime:timeText(nowISO()),subject:'入室中',content:'入室中'}));if(r.alreadyActive)throw new Error(r.message||'すでに入室中です。');crGoScreen('crHome');
  }catch(e){setMsg('crCheckinMsg',e.message,'err');}finally{$('mcCrEnter').disabled=false;}
};
crLoadActiveList=async function(){try{const r=mcRequire(await api('listActive',{session:teacherSession,schoolId:$('mcAdminSchool').value}));crActiveRecords=r.records;crRenderActiveList();setMsg('crCheckoutMsg','');}catch(e){crActiveRecords=[];$('crActiveList').innerHTML='';setMsg('crCheckoutMsg',e.message,'err');}};
// Existing classroom checkout and reflection functions call the same API; attach teacher auth.
const mcApiWithRetry=api;
api=function(action,data={},attempt=0,requestId){if(mcClassroom&&['checkout','update'].includes(action)&&!data.session)data={...data,session:teacherSession};return mcApiWithRetry(action,data,attempt,requestId);};
const mcOldCrGo=crGoScreen;
crGoScreen=function(id){if(!mcAdmin){goScreen('teacher');return;}mcOldCrGo(id);if(id==='crCheckin')mcLoadRoster();};
openTeacherFromWelcome=()=>{mcClassroom=false;$('appTitle').textContent='Study Room';updateModeButton();document.body.classList.remove('classroomMode');crScreenIds().forEach(id=>$(id).classList.add('hide'));goScreen('teacher');};
async function mcInit(){
  mcStorageKeys();$('mcFrom').value=todayISO().slice(0,7)+'-01';$('mcTo').value=todayISO();
  try{const r=mcRequire(await api('schools'));mcSchools=r.schools;$('mcSchool').innerHTML='<option value="">教室を選択</option>'+r.schools.map(s=>`<option value="${escapeHtml(s.id)}">${escapeHtml(s.name)}</option>`).join('');if(mcIdentity)$('mcSchool').value=mcIdentity.schoolId;mcDrawSchool();mcBusy(r.schools.length?'':'利用できる教室がありません。先生に確認してください。');}catch(e){mcBusy(e.message);}
  if(mcIdentity){loadState();$('studentName').value=mcIdentity.name||appState.name||'';$('grade').value=mcIdentity.grade||appState.grade||'中1';if(appState.startAt)goScreen(appState.endAt?'reviewScreen':'timerScreen');}
  if(teacherSession){try{await mcLoadAdmin();}catch(e){mcClearAdmin();}}
  $('mcSchool').addEventListener('change',()=>{if(mcIdentity&&mcIdentity.schoolId!==$('mcSchool').value){if(!mcResetLocal())$('mcSchool').value=mcIdentity.schoolId;else mcStorageKeys();}mcDrawSchool();});
  ['mcAdminSchool','mcFrom','mcTo'].forEach(id=>$(id).addEventListener('change',()=>{records=[];$('tbody').innerHTML='';$('mcStudentEditor').innerHTML='';$('mcSchoolEditor').innerHTML='';$('mcAdminEditor').innerHTML='';closeEditModal();loadRecords();}));
}
document.addEventListener('DOMContentLoaded',mcInit);

async function mcRedeemLink(){
  if(appState.startAt){mcBusy('進行中の自習を送信してから引き継いでください。');return;}
  try{const key=mcSecret(),r=mcRequire(await api('redeemStudentLink',{link:$('mcLinkCode').value.trim(),studentKey:key}));mcResetLocal();mcIdentity={...r.student,key};mcSaveIdentity();mcStorageKeys();$('mcSchool').value=mcIdentity.schoolId;$('studentName').value=mcIdentity.name;$('grade').value=mcIdentity.grade;$('mcLinkCode').value='';mcDrawSchool();mcBusy('履歴を引き継ぎました。');}catch(e){mcBusy(e.message);}
}
async function mcManageStudents(){
  try{const schoolId=$('mcAdminSchool').value;if(!schoolId)throw new Error('対象教室を選んでください。');const r=mcRequire(await api('students',{session:teacherSession,schoolId}));const options=r.students.map(s=>`<option value="${escapeHtml(s.id)}">${escapeHtml(s.name)}／${escapeHtml(s.grade)}／${escapeHtml(s.id.slice(0,8))}</option>`).join('');$('mcStudentEditor').innerHTML='<h3>生徒の履歴引継ぎ・重複の確認</h3><label>引継ぎ先の生徒<select id="mcStudentTarget">'+options+'</select></label><button class="btn light" onclick="mcIssueLink()">10分間有効な引継ぎコードを発行</button><p id="mcIssuedCode" class="mcItem"></p><label>重複して作られた生徒ID（統合元）<select id="mcStudentSource">'+options+'</select></label><button class="btn light" onclick="mcMergeStudents()">上の引継ぎ先へ記録を統合</button><p class="small">本人と確認できた場合のみ操作してください。名前だけで統合しないでください。統合元の端末キーは無効になります。</p>';}catch(e){mcBusy(e.message);}
}
async function mcIssueLink(){try{const r=mcRequire(await api('issueStudentLink',{session:teacherSession,studentId:$('mcStudentTarget').value}));$('mcIssuedCode').textContent='本人にだけ伝えてください：'+r.link;}catch(e){mcBusy(e.message);}}
async function mcMergeStudents(){if(!confirm('同じ生徒本人であると確認しましたか？統合元の学習記録を選択した引継ぎ先へ移し、統合元の端末キーを失効させます。'))return;try{mcRequire(await api('mergeStudents',{session:teacherSession,sourceId:$('mcStudentSource').value,targetId:$('mcStudentTarget').value}));await mcManageStudents();await loadRecords();mcBusy('生徒IDを統合しました。');}catch(e){mcBusy(e.message);}}

const mcOldReview=renderReview;
renderReview=function(){mcOldReview();const d=appState.reviewDraft;if(d){$('content').value=d.content||'';$('comment').value=d.comment||'';$('subject').value=d.subject||'英語';}};
document.addEventListener('DOMContentLoaded',()=>{['content','comment','subject'].forEach(id=>$(id).addEventListener('input',()=>{appState.reviewDraft={content:$('content').value,comment:$('comment').value,subject:$('subject').value};saveState();}));});
