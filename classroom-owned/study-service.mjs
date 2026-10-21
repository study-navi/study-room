import {dispatch} from './release/domain-engine.mjs';
import {randomBytes,createHash} from 'node:crypto';
import {RegistrationError} from './registration.mjs';

const publicActions=new Set(['registerStudent','history','stats','redeemStudentLink','addActive','checkout','update']);
const teacherActions=new Set(['me','students','saveStudent','issueStudentLink','mergeStudents','list','dashboard','listActive','delete','saveSchool']);
const mutationActions=new Set(['registerStudent','redeemStudentLink','addActive','checkout','update','saveStudent','issueStudentLink','mergeStudents','delete','saveSchool']);
const hash=value=>createHash('sha256').update(String(value)).digest('hex');
const fail=(code,message)=>{throw new RegistrationError(code,message);};
const japaneseTime=(date,format)=>{
  const parts=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(date).map(p=>[p.type,p.value]));
  return format==='HH:mm'?`${parts.hour}:${parts.minute}`:`${parts.year}-${parts.month}-${parts.day}`;
};

/** Runs the existing audited domain/dispatch against one registered owner's Sheets.
 * The durable write-ahead checkpoint is replayed before any next read/write. A lost
 * Google response cannot cause append duplicates, partial merge loss, or lost ops.
 */
export class StudyService {
  constructor({repository,auth,workspaceFactory}){Object.assign(this,{repository,auth,workspaceFactory});}
  async run(classroomId,q,session){
    if(!q||!q.data||typeof q.data!=='object'||Array.isArray(q.data)||typeof q.action!=='string')fail('INVALID','リクエストを確認してください。');
    const classroom=this.repository.getClassroom(classroomId);if(!classroom)fail('SCHOOL','教室が見つかりません。先生のURLを確認してください。');
    if(q.data.schoolId&&q.data.schoolId!==classroom.id)fail('FORBIDDEN','別の教室へアクセスできません。');
    const teacher=!!q.data.session||teacherActions.has(q.action);
    if(teacher&&session?.subject!==classroom.ownerSubject)fail('FORBIDDEN','この教室の管理権限がありません。');
    if(!publicActions.has(q.action)&&!teacherActions.has(q.action)&&q.action!=='schools')fail('FORBIDDEN','この操作は利用できません。');
    return this.repository.withLock(classroom.ownerSubject,async()=>{
      const account=await this.auth.accountLocked(classroom.ownerSubject),workspace=this.workspaceFactory(account.accessToken);
      const file=await workspace.getSpreadsheet(classroom.fileId);
      if(file.ownedByMe!==true||file.trashed||file.appProperties?.srClassroomId!==classroom.id)fail('OWNERSHIP','先生所有の専用保存先を確認できません。');
      const pending=await this.repository.getPendingWrite(classroom.ownerSubject);
      if(pending){
        const current=await workspace.readTables(pending.fileId);
        const matches=(cell,expected)=>{
          const [,table,row]=cell.range.match(/^'SR10_(\w+)'!A(\d+):/),value=current[table].find(r=>r.row===Number(row))?.value;
          return expected===null?!value:!!value&&JSON.stringify(value)===JSON.stringify(expected);
        };
        const committed=pending.data.every(cell=>matches(cell,JSON.parse(cell.values[0][1])));
        if(!committed){
          // Sheets has a 180s processing limit. Do not replay a timed-out write while
          // its first request may still commit later and overwrite newer changes.
          if(Date.now()<pending.retryAfter)fail('BUSY','前回の保存結果を確認中です。入力は保持しています。3分ほど待ってから再送してください。');
          if(!pending.before||!pending.data.every((cell,i)=>matches(cell,pending.before[i])))fail('CONFLICT','保存先が別の操作で変更されています。上書きせず停止しました。先生に確認してください。');
          await workspace.writeCells(pending.fileId,pending.data);
        }
        await this.repository.clearPendingWrite(classroom.ownerSubject);
      }
      const snapshot=await workspace.readTables(classroom.fileId);
      const tables=Object.fromEntries(Object.entries(snapshot).map(([table,rows])=>[table,structuredClone(rows.map(r=>r.value))]));
      if(tables.Schools.length!==1||tables.Schools[0].id!==classroom.id||tables.Records.some(r=>r.schoolId!==classroom.id)||tables.Students.some(s=>s.schoolId!==classroom.id))fail('SCHEMA','保存先に別教室の設定・記録が含まれています。書き込まず停止しました。');
      if(tables.Schools[0].name!==classroom.name)await this.repository.saveClassroom({...classroom,name:tables.Schools[0].name});
      if(q.action==='saveSchool'&&q.data.school?.id!==classroom.id)fail('FORBIDDEN','教室の追加は教室登録画面から行ってください。');
      const writes=new Map(),admin={id:'google-owner',role:'global',schoolIds:[classroom.id],active:true};
      const hooks={formatDate:(date,timezone,format)=>japaneseTime(date,format),today:()=>japaneseTime(new Date()),all:table=>tables[table],save:(table,value)=>{
        if(!tables[table])fail('SCHEMA','保存先を確認してください。');
        const index=tables[table].findIndex(r=>r.id===value.id);
        if(index<0)tables[table].push(value);else tables[table][index]=value;
        const existing=snapshot[table].find(r=>r.value.id===value.id);
        const row=existing?.row??writes.get(table+':'+value.id)?.row??Math.max(1,...snapshot[table].map(r=>r.row),...Array.from(writes.values()).filter(w=>w.table===table).map(w=>w.row))+1;
        writes.set(table+':'+value.id,{table,row,value:JSON.parse(JSON.stringify(value))});return value;
      },admin:()=>{if(!teacher)fail('AUTH','先生のログインが必要です。');return admin;},hash,token:()=>randomBytes(32).toString('hex')};
      const result=dispatch({action:q.action,requestId:q.requestId,data:{...q.data,schoolId:classroom.id,...(teacher?{session:'server-only'}:{})}},hooks);
      if(result.admin)result.admin={id:'google-owner',role:'school',schoolIds:[classroom.id],active:true};
      if(result.schools&&teacher)result.schools=result.schools.map(s=>({...s,adminIds:['Googleアカウント所有者']}));
      const data=[...writes.values()].map(w=>({range:`'SR10_${w.table}'!A${w.row}:B${w.row}`,values:[[w.value.id,JSON.stringify(w.value)]]}));
      if(data.length){
        if(!mutationActions.has(q.action))fail('INVALID','未対応の保存操作です。');
        // At most one automatic private Drive backup per owner/day, before mutations.
        const day=japaneseTime(new Date(),'yyyy-MM-dd'),key='backup:'+classroom.id+':'+day;
        const backup=await this.repository.getOperation(classroom.ownerSubject,key);
        if(!backup){
          await this.repository.putOperation({ownerSubject:classroom.ownerSubject,requestId:key,status:'creating'});
          try{const copy=await workspace.backup(classroom.fileId,`Study Room ${classroom.name} バックアップ ${day}`,day);await this.repository.putOperation({ownerSubject:classroom.ownerSubject,requestId:key,status:'ready',fileId:copy.id});}
          catch{fail('BACKUP','バックアップの作成結果を確認できません。先生に確認してください。記録は端末に保持しています。');}
        }else if(backup.status!=='ready'){
          const copies=await workspace.findBackup(classroom.fileId,day);
          if(copies.length!==1)fail('BACKUP','バックアップの確認が必要です。先生に連絡してください。');
          await this.repository.putOperation({...backup,status:'ready',fileId:copies[0].id});
        }
        const before=[...writes.values()].map(w=>snapshot[w.table].find(r=>r.row===w.row)?.value??null);
        await this.repository.putPendingWrite(classroom.ownerSubject,{fileId:classroom.fileId,data,before,retryAfter:Date.now()+190000});
        await workspace.writeCells(classroom.fileId,data);
        await this.repository.clearPendingWrite(classroom.ownerSubject);
        if(result.school)await this.repository.saveClassroom({...classroom,name:result.school.name});
      }
      return {result:'success',...JSON.parse(JSON.stringify(result))};
    });
  }
}
