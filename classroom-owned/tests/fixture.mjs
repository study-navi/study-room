import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomBytes,randomUUID} from 'node:crypto';
import {SqliteRepository} from '../sqlite-repository.mjs';
import {DRIVE_SCOPE} from '../registration.mjs';

export async function fixture(){
  const dir=mkdtempSync(join(tmpdir(),'sr-owned-')),repository=new SqliteRepository(join(dir,'private.sqlite'));
  const a=randomUUID(),b=randomUUID(),files=new Map(),sessions=new Map([['alice-session',{subject:'alice',email:'alice@example.invalid',csrf:'alice-csrf'}],['bob-session',{subject:'bob',email:'bob@example.invalid',csrf:'bob-csrf'}]]);
  const state={backups:0,writes:0,loseResponse:false,failBeforeWrite:false,loseBackupResponse:false,backupFiles:[],revoked:new Set()};
  for(const [id,owner,name] of [[a,'alice','森本校'],[b,'bob','尾西校']]){
    const classroom={id,ownerSubject:owner,name,fileId:'file-'+id,spreadsheetUrl:'https://docs.google.com/spreadsheets/d/file-'+id+'/edit',createdAt:new Date().toISOString()};
    await repository.withLock(owner,()=>repository.saveClassroom(classroom));
    files.set(classroom.fileId,{owner,id,tables:{Schools:[{row:2,value:{id,name,code:id,active:true,enrolled:80}}],Students:[],Admins:[],Records:[],Sessions:[]}});
  }
  const auth={session:raw=>sessions.get(raw),requireGoogleSession:async raw=>{const s=sessions.get(raw);if(!s)throw Object.assign(Error('ログインしてください。'),{code:'AUTH'});return {subject:s.subject,accessToken:s.subject,scopes:[DRIVE_SCOPE],offlineReady:true};},accountLocked:async subject=>{if(state.revoked.has(subject))throw Object.assign(Error('再ログインしてください。'),{code:'REAUTHORIZE'});return {subject,accessToken:subject};},logout:raw=>sessions.delete(raw)};
  const workspaceFactory=token=>({
    identity:async()=>({sub:token}),
    getSpreadsheet:async id=>{const f=files.get(id);return {id,ownedByMe:f?.owner===token,trashed:false,appProperties:{srClassroomId:f?.id}};},
    readTables:async id=>structuredClone(files.get(id).tables),
    writeCells:async(id,data)=>{state.writes++;if(state.failBeforeWrite){state.failBeforeWrite=false;throw Error('No known Google result');}const file=files.get(id);for(const cell of data){const [,table,row]=cell.range.match(/^'SR10_(\w+)'!A(\d+):/),number=Number(row),value=JSON.parse(cell.values[0][1]),rows=file.tables[table],old=rows.findIndex(r=>r.row===number);if(old<0)rows.push({row:number,value});else rows[old]={row:number,value};}if(state.loseResponse){state.loseResponse=false;throw Error('Response lost after Google saved');}},
    backup:async(fileId,name,tag)=>{state.backups++;const copy={fileId,tag,id:'backup-'+state.backups,webViewLink:'https://docs.google.com/spreadsheets/d/backup-'+state.backups+'/edit'};state.backupFiles.push(copy);if(state.loseBackupResponse){state.loseBackupResponse=false;throw Error('Lost backup response');}return copy;},
    findBackup:async(fileId,tag)=>state.backupFiles.filter(f=>f.fileId===fileId&&f.tag===tag)
  });
  return {repository,auth,workspaceFactory,a,b,files,state,sessions,close(){repository.close();rmSync(dir,{recursive:true,force:true});}};
}
