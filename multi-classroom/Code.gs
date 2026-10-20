/* NEW Apps Script project only. Public: HTML doGet, validated srApi and gated doPost.
 * All operator helpers end in '_' and are inaccessible via google.script.run.
 */
const SR_TABLES = ['Schools','Students','Admins','Records','Sessions'];
function doGet(){ return HtmlService.createHtmlOutputFromFile('App').setTitle('Study Room').addMetaTag('viewport','width=device-width, initial-scale=1'); }
function doPost(e){
  let result;
  try{
    if(srProps_().getProperty('SR_HTTP_ENABLED')!=='approved')SR.fail('POST通信は検証・承認前です。','SETUP');
    if(!e||e.queryString||!e.postData||!/^text\/plain(?:;|$)/i.test(e.postData.type||'')||typeof e.postData.contents!=='string'||e.postData.contents.length>30000)SR.fail('POST形式が不正です。');
    const q=JSON.parse(e.postData.contents);
    if(!q||typeof q!=='object'||Array.isArray(q)||typeof q.action!=='string'||!q.data||typeof q.data!=='object'||Array.isArray(q.data))SR.fail('リクエストが不正です。');
    result=srApi(q);
  }catch(error){result={result:'error',code:error.code||'INVALID',message:error.code?error.message:'リクエストのJSON形式が不正です。'};}
  return ContentService.createTextOutput(JSON.stringify(result)).setMimeType(ContentService.MimeType.JSON);
}
function srApi(request){
  const lock=LockService.getScriptLock();
  try {
    if(!request||JSON.stringify(request).length>30000) SR.fail('リクエストが不正です。');
    if(!lock.tryLock(15000)) SR.fail('処理が混み合っています。再送してください。','BUSY');
    return {result:'success',...srDispatch_(request)};
  }catch(e){return {result:'error',code:e.code||'SERVER',message:e.code?e.message:'処理に失敗しました。管理者に連絡してください。'};}
  finally {if(lock.hasLock())lock.releaseLock();}
}
function srProps_(){return PropertiesService.getScriptProperties();}
function srDb_(){ const id=srProps_().getProperty('SR_DATABASE_ID');if(!id)SR.fail('複数教室版の準備が完了していません。','SETUP');return SpreadsheetApp.openById(id); }
function srSheet_(table){if(!SR_TABLES.includes(table))SR.fail('テーブル不正');const s=srDb_().getSheetByName('SR10_'+table);if(!s||s.getRange(1,1,1,2).getDisplayValues()[0].join('|')!=='id|json')SR.fail('保存形式を確認してください。初期化は行いません。','SCHEMA');return s;}
function srAll_(table){const s=srSheet_(table);if(s.getLastRow()<2)return [];return s.getRange(2,1,s.getLastRow()-1,2).getDisplayValues().filter(r=>r[0]).map(r=>JSON.parse(r[1]));}
function srSave_(table,obj){const s=srSheet_(table),rows=s.getLastRow()>1?s.getRange(2,1,s.getLastRow()-1,1).getDisplayValues():[];const i=rows.findIndex(r=>r[0]===obj.id),json=JSON.stringify(obj);if(json.length>45000)SR.fail('保存容量を超えています。');s.getRange(i<0?s.getLastRow()+1:i+2,1,1,2).setValues([[obj.id,json]]);SpreadsheetApp.flush();return obj;}
function srNow_(){return new Date().toISOString();}
function srToday_(){return Utilities.formatDate(new Date(),'Asia/Tokyo','yyyy-MM-dd');}
function srToken_(){return Utilities.getUuid().replace(/-/g,'')+Utilities.getUuid().replace(/-/g,'');}
function srHash_(value){return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,String(value),Utilities.Charset.UTF_8).map(b=>('0'+((b+256)%256).toString(16)).slice(-2)).join('');}
function srEqual_(a,b){a=String(a);b=String(b);let n=a.length^b.length;for(let i=0;i<Math.max(a.length,b.length);i++)n|=(a.charCodeAt(i)||0)^(b.charCodeAt(i)||0);return n===0;}
function srSchool_(id,allowStopped=false){const s=srAll_('Schools').find(s=>s.id===id);if(!s||!s.active&&!allowStopped)SR.fail('この教室は利用できません。','SCHOOL');return s;}
function srAdmin_(token){const s=srAll_('Sessions').find(s=>s.id===srHash_(token||''));if(!s||s.expiresAt<Date.now()||s.revoked)SR.fail('ログイン期限が切れました。再ログインしてください。','AUTH');const a=srAll_('Admins').find(a=>a.id===s.adminId);if(!a||!a.active||a.authVersion!==s.authVersion)SR.fail('管理者の権限を確認してください。','AUTH');return a;}
function srStudent_(data){const s=srAll_('Students').find(s=>s.id===data.studentId);if(!s||s.mergedInto||s.schoolId!==data.schoolId||!(s.keyHashes||[s.keyHash]).filter(Boolean).some(hash=>srEqual_(hash,srHash_(data.studentKey||''))))SR.fail('この生徒の記録は操作できません。','FORBIDDEN');return s;}
function srVisible_(admin,schoolId){if(schoolId)SR.scope(admin,schoolId);const admins=srAll_('Admins');return srAll_('Schools').filter(s=>(!schoolId||s.id===schoolId)&&(admin.role==='global'||admin.schoolIds.includes(s.id))).map(s=>({...s,adminIds:admins.filter(a=>a.active&&a.role==='school'&&a.schoolIds.includes(s.id)).map(a=>a.id)}));}
function srDispatch_(q){
  const d=q.data||{}, action=q.action;
  if(action==='schools')return {schools:srAll_('Schools').filter(s=>s.active).map(s=>({id:s.id,name:s.name,code:s.code}))};
  if(action==='teacherLogin')return srLogin_(d);
  if(action==='redeemStudentLink'){
    const s=srAll_('Students').find(s=>s.linkHash&&srEqual_(s.linkHash,srHash_(d.link||''))&&s.linkExpires>Date.now());
    if(!s||s.mergedInto)SR.fail('引継ぎコードが無効か期限切れです。','FORBIDDEN');srSchool_(s.schoolId);
    if(!/^[a-f0-9]{64}$/.test(String(d.studentKey||'')))SR.fail('端末キーが不正です。');
    s.keyHashes=[...new Set([...(s.keyHashes||[s.keyHash]).filter(Boolean),srHash_(d.studentKey)])].slice(-5);delete s.linkHash;delete s.linkExpires;srSave_('Students',s);
    return {student:{id:s.id,schoolId:s.schoolId,name:s.name,grade:s.grade}};
  }
  if(action==='registerStudent'){
    srSchool_(d.schoolId);const id=SR.id(d.studentId),key=String(d.studentKey||'');if(!/^[a-f0-9]{64}$/.test(key))SR.fail('端末キーが不正です。');
    const old=srAll_('Students').find(s=>s.id===id);if(old)srStudent_(d);
    const name=SR.text(d.name,100),grade=SR.text(d.grade,30);if(!name||!grade)SR.fail('名前と学年を入力してください。');
    srSave_('Students',{...old,id,schoolId:d.schoolId,keyHash:srHash_(key),name,grade,createdAt:old?old.createdAt:srNow_()});return {studentId:id};
  }
  if(action==='history'||action==='stats'){
    srSchool_(d.schoolId);const student=srStudent_(d),all=srAll_('Records').filter(r=>!r.deletedAt&&r.schoolId===d.schoolId),own=all.filter(r=>r.studentId===student.id);
    const today=srToday_(),dates=new Set(own.filter(r=>r.status==='送信済み').map(r=>r.date));let streak=0;for(let i=0;i<365;i++){const day=new Date(Date.parse(today+'T00:00:00Z')-i*86400000).toISOString().slice(0,10);if(!dates.has(day))break;streak++;}
    return action==='history'?{records:own.map(r=>SR.display(r,srAll_('Schools')))}:{todayUserCount:new Set(all.filter(r=>r.date===today&&r.status==='送信済み').map(r=>r.studentId)).size,streakDays:streak};
  }
  if(['addActive','update','checkout','delete'].includes(action))return srRecordMutation_(action,d,q.requestId);
  const a=srAdmin_(d.session);
  if(action==='issueStudentLink'){
    const s=srAll_('Students').find(s=>s.id===d.studentId);if(!s||s.mergedInto)SR.fail('生徒が見つかりません。');SR.scope(a,s.schoolId);srSchool_(s.schoolId);
    const link=srToken_();s.linkHash=srHash_(link);s.linkExpires=Date.now()+10*60000;srSave_('Students',s);return {link,expiresAt:s.linkExpires};
  }
  if(action==='mergeStudents'){
    const all=srAll_('Students'),source=all.find(s=>s.id===d.sourceId),target=all.find(s=>s.id===d.targetId);
    if(!source||!target||source.id===target.id||source.mergedInto||target.mergedInto||source.schoolId!==target.schoolId)SR.fail('統合する生徒を確認してください。');SR.scope(a,source.schoolId);
    srAll_('Records').filter(r=>r.studentId===source.id&&r.schoolId===source.schoolId).forEach(r=>{r.originalStudentId=r.originalStudentId||source.id;r.studentId=target.id;r.version++;srSave_('Records',r);});
    source.mergedInto=target.id;source.keyHashes=[];source.keyHash='';delete source.linkHash;srSave_('Students',source);return {studentId:target.id};
  }
  if(action==='students'){SR.scope(a,d.schoolId);return {students:srAll_('Students').filter(s=>s.schoolId===d.schoolId&&!s.mergedInto).map(s=>({id:s.id,name:s.name,grade:s.grade}))};}
  if(action==='saveStudent'){
    SR.scope(a,d.schoolId);srSchool_(d.schoolId);const id=SR.id(d.student.id),old=srAll_('Students').find(s=>s.id===id);if(old&&old.schoolId!==d.schoolId)SR.fail('教室が一致しません。','FORBIDDEN');
    const name=SR.text(d.student.name,100),grade=SR.text(d.student.grade,30);if(!name||!grade)SR.fail('名前と学年が必要です。');srSave_('Students',{...old,id,schoolId:d.schoolId,name,grade,keyHash:old?old.keyHash:'',createdAt:old?old.createdAt:srNow_()});return {studentId:id};
  }
  if(action==='me')return {admin:srPublicAdmin_(a),schools:srVisible_(a)};
  if(action==='logout'){const s=srAll_('Sessions').find(s=>s.id===srHash_(d.session));s.revoked=true;srSave_('Sessions',s);return {};}
  if(action==='list'||action==='dashboard'||action==='listActive'){
    const schools=srVisible_(a,d.schoolId),ids=new Set(schools.map(s=>s.id));const records=srAll_('Records').filter(r=>ids.has(r.schoolId)&&!r.deletedAt);
    if(action==='dashboard')return {dashboard:SR.dashboard(records,srAll_('Students').filter(s=>ids.has(s.schoolId)),schools,d.from,d.to,srToday_())};
    const visible=records.filter(r=>(!d.from||r.date>=SR.date(d.from))&&(!d.to||r.date<=SR.date(d.to)));
    if(action==='listActive')return {records:visible.filter(r=>['入室中','振り返り待ち'].includes(r.status)).map(r=>({id:r.id,studentId:r.studentId,schoolId:r.schoolId,name:r.name,grade:r.grade,startTime:r.startTime,status:r.status,version:r.version}))};
    return {records:visible.map(r=>SR.display(r,schools))};
  }
  if(a.role!=='global')SR.fail('全体管理者の権限が必要です。','FORBIDDEN');
  if(action==='saveSchool'){
    const all=srAll_('Schools'),old=all.find(s=>s.id===d.school.id),s=SR.school(d.school,old);if(all.some(x=>x.id!==s.id&&x.code===s.code))SR.fail('教室コードはすでに使用されています。');srSave_('Schools',s);return {school:s};
  }
  if(action==='admins')return {admins:srAll_('Admins').map(srPublicAdmin_)};
  if(action==='saveAdmin')return srSaveAdmin_(d.admin,a);
  SR.fail('未対応の操作です。');
}
function srPublicAdmin_(a){return {id:a.id,role:a.role,schoolIds:a.schoolIds,active:a.active};}
function srLogin_(d){
  const id=SR.text(d.teacherId,100),props=srProps_(),key='SR_FAIL_'+srHash_(id),old=JSON.parse(props.getProperty(key)||'{}'),now=Date.now();
  if(old.until>now)SR.fail('認証失敗が続いています。15分後に再試行してください。','RATE');
  const a=srAll_('Admins').find(x=>x.id===id),valid=a&&a.active&&srEqual_(srPassword_(String(d.teacherPass||''),a.salt),a.passwordHash);
  if(!valid){const count=old.since>now-900000?(old.count||0)+1:1;props.setProperty(key,JSON.stringify({since:count===1?now:old.since,count,until:count>=5?now+900000:0}));SR.fail('IDまたはパスワードが違います。','AUTH');}
  props.deleteProperty(key);const token=srToken_();srSave_('Sessions',{id:srHash_(token),adminId:a.id,authVersion:a.authVersion,expiresAt:now+6*3600000,revoked:false});return {session:token,admin:srPublicAdmin_(a)};
}
function srPassword_(password,salt){if(password.length>200)SR.fail('パスワードが長すぎます。');return srPbkdf2_(password,salt,600000);}
function srSaveAdmin_(d,actor){
  const id=SR.id(d.id),old=srAll_('Admins').find(a=>a.id===id),role=d.role;if(!['global','school'].includes(role))SR.fail('権限が不正です。');
  const schoolIds=[...new Set(d.schoolIds||[])];schoolIds.forEach(id=>srSchool_(id,true));if(role==='school'&&!schoolIds.length)SR.fail('担当教室を選んでください。');
  if(old&&old.role==='global'&&old.active&&(role!=='global'||d.active===false)&&srAll_('Admins').filter(a=>a.active&&a.role==='global').length<2)SR.fail('最後の全体管理者は停止・降格できません。');
  if(actor&&id===actor.id&&d.active===false)SR.fail('操作中の管理者は停止できません。');
  const a={id,role,schoolIds,active:d.active!==false,salt:old?old.salt:srToken_(),passwordHash:old?old.passwordHash:'',authVersion:(old?old.authVersion:0)+1};
  if(d.password){if(String(d.password).length<12)SR.fail('パスワードは12文字以上にしてください。');a.salt=srToken_();a.passwordHash=srPassword_(d.password,a.salt);}if(!a.passwordHash)SR.fail('初回パスワードが必要です。');srSave_('Admins',a);return {admin:srPublicAdmin_(a)};
}
function srRecordMutation_(action,d,requestId){
  const op=SR.id(requestId);let admin=null,student=null;
  if(d.session)admin=srAdmin_(d.session);else student=srStudent_(d);
  const all=srAll_('Records'),old=all.find(r=>r.id===d.id);let schoolId=old?old.schoolId:d.schoolId;
  srSchool_(schoolId,!!admin);if(admin)SR.scope(admin,schoolId);else if(schoolId!==student.schoolId||old&&old.studentId!==student.id)SR.fail('この記録は操作できません。','FORBIDDEN');
  if(old&&old.operations&&old.operations.includes(op))return {id:old.id,...srCheckoutResponse_(old)};
  if(action==='addActive'){
    if(old){if(old.deletedAt)SR.fail('記録は削除されています。');return {id:old.id,alreadyActive:true};}
    const studentId=admin?SR.id(d.studentId):student.id;const s=srAll_('Students').find(s=>s.id===studentId&&s.schoolId===schoolId);if(!s)SR.fail('生徒を登録してください。');
    const active=all.find(r=>!r.deletedAt&&r.schoolId===schoolId&&r.studentId===studentId&&['入室中','振り返り待ち'].includes(r.status));if(active)return {id:active.id,startedAt:active.startedAt,endedAt:active.endedAt,status:active.status,alreadyActive:true,message:'すでに入室中または振り返り待ちです。'};
    const startedAt=d.startedAt?new Date(d.startedAt).toISOString():srNow_();if(Date.parse(startedAt)>Date.now()+60000||Date.parse(startedAt)<Date.now()-86400000)SR.fail('入室時刻を先生に確認してください。');
    const r={...SR.cleanRecord({...d,name:s.name,grade:s.grade,date:srToday_(),minutes:0}),id:SR.id(d.id),schoolId,studentId,status:'入室中',startedAt,goalMinutes:SR.number(d.goalMinutes||0,0,10080),createdAt:srNow_(),version:1,operations:[op]};srSave_('Records',r);return {id:r.id};
  }
  if(!old||old.deletedAt)SR.fail('対象の記録が見つかりません。','NOT_FOUND');
  if(d.version!=null&&Number(d.version)!==old.version)SR.fail('他の操作で更新されています。再読み込みしてください。','CONFLICT');
  if(action==='delete'){if(!admin)SR.fail('記録の削除には管理者の権限が必要です。','FORBIDDEN');old.deletedAt=srNow_();}
  if(action==='checkout'){
    if(old.status==='送信済み')SR.fail('送信済みです。');
    if(old.status==='入室中'){old.endedAt=srNow_();old.endTime=Utilities.formatDate(new Date(),'Asia/Tokyo','HH:mm');old.minutes=Math.max(0,Math.floor((Date.now()-Date.parse(old.startedAt))/60000));old.status='振り返り待ち';}
  }
  if(action==='update'){
    if(!admin&&old.status==='送信済み')SR.fail('送信済みの記録は先生に修正を依頼してください。','FORBIDDEN');
    const cleaned=SR.cleanRecord({...old,...d});if(!cleaned.content)SR.fail('学習内容を入力してください。');if(!cleaned.startTime||!cleaned.endTime)SR.fail('入室と退室の時刻を確認してください。');
    if(!admin){const max=Math.max(0,Math.floor((Date.now()-Date.parse(old.startedAt))/60000));if(cleaned.minutes>max+1)SR.fail('自習時間を確認してください。');cleaned.name=student.name;cleaned.grade=student.grade;cleaned.date=old.date;cleaned.startTime=old.startTime;}
    Object.assign(old,cleaned);old.status='送信済み';
  }
  old.version++;old.updatedAt=srNow_();old.operations=[...(old.operations||[]),op].slice(-50);srSave_('Records',old);return {id:old.id,...srCheckoutResponse_(old)};
}
function srCheckoutResponse_(r){return {name:r.name,grade:r.grade,startTime:r.startTime,endTime:r.endTime,minutes:r.minutes,version:r.version};}
/* Operator-only initialization, manual AFTER approval using a staging spreadsheet. */
function srSetup_(){
  const p=srProps_(),id=p.getProperty('SR_DATABASE_ID'),pass=p.getProperty('SR_INITIAL_PASSWORD');if(!id||!pass)throw new Error('SR_DATABASE_ID と SR_INITIAL_PASSWORD を設定してください。');
  const db=SpreadsheetApp.openById(id);if(SR_TABLES.some(t=>db.getSheetByName('SR10_'+t)))throw new Error('既存テーブルがあるため停止しました。');
  SR_TABLES.forEach(t=>db.insertSheet('SR10_'+t).appendRow(['id','json']));
  const school={id:Utilities.getUuid(),name:'大府柊山校',code:'obu-hiiragiyama',active:true,enrolled:null,createdAt:srNow_()};srSave_('Schools',school);
  srSaveAdmin_({id:p.getProperty('SR_INITIAL_ADMIN_ID')||'administrator',role:'global',schoolIds:[],password:pass},null);p.deleteProperty('SR_INITIAL_PASSWORD');
}
