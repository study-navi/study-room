/* Operator-only migration. No helper here is callable by browser RPC.
 * Never modifies the source workbook. Approval + verified backup are required.
 */
function srMigrationPlan_(){
  const p=srProps_(),id=p.getProperty('SR_LEGACY_DATABASE_ID');if(!id)throw new Error('移行元IDを設定してください。');
  const db=SpreadsheetApp.openById(id),s=db.getSheetByName('自習室ログ');if(!s)throw new Error('移行元タブがありません。');
  const headers=['ID','送信日時','日付','名前','学年','科目','入室時間','退室時間','自習分数','集中度','達成度','学習内容','コメント','状態','教室'];
  const values=s.getRange(1,1,Math.max(1,s.getLastRow()),15).getDisplayValues();if(JSON.stringify(values[0])!==JSON.stringify(headers))throw new Error('移行元の列構成が確認済みの15列と異なります。');
  if(s.getLastColumn()>15&&s.getRange(1,16,s.getLastRow(),s.getLastColumn()-15).getDisplayValues().some(r=>r.some(Boolean)))throw new Error('未確認の追加列があります。');
  const rows=values.slice(1).filter(r=>r.some(Boolean));const ids=rows.map(r=>r[0]);if(ids.some(id=>!id)||new Set(ids).size!==ids.length)throw new Error('ID欠落・重複を確認してください。');
  ids.forEach(id=>SR.id(id));
  const classes=[...new Set(rows.map(r=>r[14]).filter(Boolean))];
  return {sourceId:id,headers,rows,count:rows.length,classes,fingerprint:srHash_(JSON.stringify({headers,rows}))};
}
function srBackupLegacy_(){
  if(srProps_().getProperty('SR_BACKUP_APPROVAL')!=='approved')throw new Error('バックアップ作成の承認が必要です。');
  const plan=srMigrationPlan_();const file=DriveApp.getFileById(plan.sourceId).makeCopy('Study Room 移行前バックアップ '+srNow_());
  const copy=SpreadsheetApp.openById(file.getId()).getSheetByName('自習室ログ');
  const rows=copy.getRange(1,1,copy.getLastRow(),15).getDisplayValues(),records=rows.slice(1).filter(r=>r.some(Boolean));
  if(srHash_(JSON.stringify({headers:rows[0],rows:records}))!==plan.fingerprint)throw new Error('バックアップの内容が一致しません。移行を停止してください。');
  srProps_().setProperty('SR_VERIFIED_BACKUP',JSON.stringify({id:file.getId(),fingerprint:plan.fingerprint,count:plan.count,at:srNow_()}));srProps_().deleteProperty('SR_BACKUP_APPROVAL');
  return {backupId:file.getId(),count:plan.count,fingerprint:plan.fingerprint};
}
function srMigrateLegacy_(){
  const lock=LockService.getScriptLock();if(!lock.tryLock(30000))throw new Error('再試行してください。');
  try{
    const p=srProps_(),plan=srMigrationPlan_(),approval=JSON.parse(p.getProperty('SR_MIGRATION_APPROVAL')||'null'),backup=JSON.parse(p.getProperty('SR_VERIFIED_BACKUP')||'null');
    if(!approval||approval.fingerprint!==plan.fingerprint||!backup||backup.fingerprint!==plan.fingerprint)throw new Error('最新の件数・内容を承認し、バックアップを検証してください。');
    // mapping is explicit per record ID; never merge pupils solely by name/grade.
    const school=srSchool_(approval.schoolId),mapping=approval.studentIdsByRecord||{};
    if(!approval.confirmedSingleSchool||plan.classes.some(c=>c!==school.id&&c!==school.name&&c!==school.code))throw new Error('全件の所属教室確認が必要です。');
    const records=srAll_('Records'),students=srAll_('Students'),pending=[];
    plan.rows.forEach(row=>{
      const studentId=SR.id(mapping[row[0]]);const s=students.find(s=>s.id===studentId&&s.schoolId===school.id);if(!s)throw new Error('全記録を確認済みの生徒IDに対応付けてください。');
      const r={id:row[0],schoolId:school.id,studentId,createdAt:row[1],date:row[2],name:row[3],grade:row[4],subject:row[5],startTime:row[6],endTime:row[7],minutes:Number(row[8]||0),focus:row[9],achievement:row[10],content:row[11],comment:row[12],status:row[13]||((row[7]&&row[8])?'送信済み':'要確認'),version:1,legacy:{sourceId:plan.sourceId,values:row},operations:[]};
      if(!Number.isFinite(r.minutes))throw new Error('分数を確認してください。');
      const old=records.find(x=>x.id===r.id);if(old&&JSON.stringify(old.legacy)!==JSON.stringify(r.legacy))throw new Error('同じIDの異なる記録があります。上書きしません。');if(!old)pending.push(r);
    });
    pending.forEach(r=>srSave_('Records',r));
    const migrated=srAll_('Records').filter(r=>r.legacy&&r.legacy.sourceId===plan.sourceId);if(migrated.length!==plan.count)throw new Error('移行件数が一致しません。');
    plan.rows.forEach(row=>{const r=migrated.find(r=>r.id===row[0]);if(!r||JSON.stringify(r.legacy.values)!==JSON.stringify(row))throw new Error('移行内容が一致しません。');});
    p.deleteProperty('SR_MIGRATION_APPROVAL');return {count:migrated.length,added:pending.length,fingerprint:plan.fingerprint,backupId:backup.id};
  }finally{lock.releaseLock();}
}
/* Backup of the new store: run manually or through an explicitly approved trigger.
 * Contains personal data and password hashes: inherit private access only.
 */
function srBackupCurrent_(){return DriveApp.getFileById(srProps_().getProperty('SR_DATABASE_ID')).makeCopy('Study Room バックアップ '+srNow_()).getId();}
