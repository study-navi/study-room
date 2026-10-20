/* Pure domain functions shared by Apps Script and Node verification. */
const SR = (() => {
  const fields = ['date','name','grade','subject','startTime','endTime','minutes','focus','achievement','content','comment'];
  const jp = ['日付','名前','学年','科目','入室時間','退室時間','自習分数','集中度','達成度','学習内容','コメント'];
  function fail(message, code='INVALID'){ const e=new Error(message); e.code=code; throw e; }
  function text(v,max=200){ v=String(v??'').trim(); if(v.length>max) fail('入力が長すぎます。'); return v; }
  function id(v){ v=text(v,100); if(!/^[a-zA-Z0-9_-]{3,100}$/.test(v)) fail('IDが不正です。'); return v; }
  function date(v){ v=text(v); if(!/^\d{4}-\d{2}-\d{2}$/.test(v)||new Date(v+'T00:00:00Z').toISOString().slice(0,10)!==v) fail('日付が不正です。'); return v; }
  function number(v,min,max){ const n=Number(v); if(!Number.isFinite(n)||n<min||n>max||!Number.isInteger(n)) fail('数値が不正です。'); return n; }
  function scope(admin,schoolId){ if(!admin) fail('管理者ログインが必要です。','AUTH'); if(admin.role!=='global'&&!admin.schoolIds.includes(schoolId)) fail('この教室への権限がありません。','FORBIDDEN'); }
  function school(data, previous){
    const s={id:previous?previous.id:id(data.id), name:text(data.name,100), code:text(data.code,40), active:data.active!==false, enrolled:data.enrolled===''||data.enrolled==null?null:number(data.enrolled,1,100000), createdAt:previous?previous.createdAt:new Date().toISOString()};
    if(!s.name||!s.code) fail('教室名と教室コードを入力してください。'); return s;
  }
  function cleanRecord(d){
    const r={}; fields.forEach(k=>r[k]=text(d[k], k==='content'||k==='comment'?3000:200));
    r.date=date(r.date); if(!r.name||!r.grade) fail('名前と学年を入力してください。');
    for(const k of ['startTime','endTime']) if(r[k]&&!/^([01]\d|2[0-3]):[0-5]\d$/.test(r[k])) fail('時刻が不正です。');
    r.minutes=number(d.minutes||0,0,10080);
    r.focus=number(d.focus||3,1,5); r.achievement=number(d.achievement||3,1,5); return r;
  }
  function display(r,schools){
    const x={'ID':r.id,'生徒ID':r.studentId,'教室ID':r.schoolId,'教室':(schools.find(s=>s.id===r.schoolId)||{}).name||r.schoolId,'送信日時':r.createdAt,'状態':r.status,version:r.version};
    fields.forEach((k,i)=>x[jp[i]]=r[k]??''); return x;
  }
  function dashboard(records,students,schools,from,to,today){
    date(from);date(to); if(from>to) fail('期間の開始日と終了日を確認してください。');
    const live=records.filter(r=>!r.deletedAt), period=live.filter(r=>r.date>=from&&r.date<=to), completed=period.filter(r=>r.status==='送信済み');
    const used=new Set(completed.map(r=>r.schoolId+':'+r.studentId));
    const enrolled=schools.every(s=>s.enrolled>0)?schools.reduce((n,s)=>n+s.enrolled,0):null;
    const total=rows=>rows.reduce((n,r)=>n+Number(r.minutes||0),0);
    const rankingMap=new Map(), grades={};
    completed.forEach(r=>{const key=r.schoolId+':'+r.studentId;const v=rankingMap.get(key)||{studentId:r.studentId,schoolId:r.schoolId,name:r.name,minutes:0,visits:0};v.minutes+=r.minutes;v.visits++;rankingMap.set(key,v);if(!grades[r.grade])grades[r.grade]=new Set();grades[r.grade].add(key);});
    // Equal 28-day windows ending at the selected end date. Unknown roster members cannot be inferred.
    const offset=n=>new Date(Date.parse(to+'T00:00:00Z')+n*86400000).toISOString().slice(0,10);
    const recentStart=offset(-27), priorStart=offset(-55), allDone=live.filter(r=>r.status==='送信済み'&&r.date<=to);
    const alerts=[];
    students.forEach(s=>{const own=allDone.filter(r=>r.schoolId===s.schoolId&&r.studentId===s.id);if(!own.length)return;const dates=[...new Set(own.map(r=>r.date))].sort(),last=dates[dates.length-1],recent=dates.filter(d=>d>=recentStart).length,prior=dates.filter(d=>d>=priorStart&&d<recentStart).length;if(last<recentStart||prior>=2&&recent<=prior/2)alerts.push({studentId:s.id,schoolId:s.schoolId,name:s.name,last,recent,prior,reason:last<recentStart?'28日以上利用なし':'利用日数が半分以下'});});
    return {schoolCount:schools.length,enrolled,users:used.size,recordCount:completed.length,active:new Set(live.filter(r=>r.status==='入室中').map(r=>r.schoolId+':'+r.studentId)).size,todayMinutes:total(live.filter(r=>r.status==='送信済み'&&r.date===today)),monthMinutes:total(live.filter(r=>r.status==='送信済み'&&r.date.slice(0,7)===today.slice(0,7))),minutes:total(completed),utilization:enrolled?used.size/enrolled*100:null,grades:Object.entries(grades).map(([grade,ids])=>({grade,users:ids.size})),ranking:[...rankingMap.values()].sort((a,b)=>b.minutes-a.minutes),alerts,schools:schools.map(s=>{const rows=completed.filter(r=>r.schoolId===s.id),users=new Set(rows.map(r=>r.studentId)).size;return {...s,users,minutes:total(rows),utilization:s.enrolled?users/s.enrolled*100:null};})};
  }
  function csv(rows){ const h=['教室ID','教室','生徒ID','ID','送信日時',...jp,'状態'];const cell=v=>'"'+String(v??'').replace(/^(?:[\s]*[=+@\-]|[\t\r\n])/,"'$&").replace(/"/g,'""')+'"';return '\ufeff'+[h,...rows.map(r=>h.map(k=>r[k]))].map(row=>row.map(cell).join(',')).join('\r\n'); }
  return {fail,text,id,date,number,scope,school,cleanRecord,display,dashboard,csv};
})();
if(typeof module!=='undefined') module.exports=SR;
