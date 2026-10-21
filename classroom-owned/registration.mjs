import {randomUUID} from 'node:crypto';

export const DRIVE_SCOPE='https://www.googleapis.com/auth/drive.file';
export class RegistrationError extends Error {
  constructor(code,message){super(message);this.code=code;}
}
const fail=(code,message)=>{throw new RegistrationError(code,message);};
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Server-side only. auth must verify its own session and load an encrypted offline grant.
 * repository.withLock must serialize all registrations for the same Google subject,
 * across server processes. In-memory implementations are for tests only.
 */
export class ClassroomRegistration {
  constructor({auth,repository,workspaceFactory,studentBaseUrl,newId=randomUUID,now=()=>new Date().toISOString()}){
    const base=new URL(studentBaseUrl);
    if(base.protocol!=='https:'||base.username||base.password||base.search||base.hash)throw Error('Use an HTTPS student base URL without credentials, query or fragment.');
    if(!auth?.requireGoogleSession||!repository?.withLock||!repository?.getOperation||!repository?.putOperation||!repository?.saveClassroom||!workspaceFactory)throw Error('Verified authentication and a durable repository are required.');
    Object.assign(this,{auth,repository,workspaceFactory,base,newId,now});
  }
  async register(session,input){
    if(!input||Array.isArray(input)||Object.keys(input).some(k=>!['name','requestId'].includes(k)))fail('INVALID','教室名と操作IDを確認してください。');
    if(typeof input.name!=='string'||typeof input.requestId!=='string'||!uuid.test(input.requestId))fail('INVALID','教室名と操作IDを確認してください。');
    const name=input.name.trim();if(!name||name.length>100||/[\x00-\x1f\x7f]/.test(name))fail('INVALID','教室名は100文字以内で入力してください。');
    const account=await this.auth.requireGoogleSession(session);
    if(!account?.subject||!account.accessToken)fail('AUTH','Googleでログインしてください。');
    if(!Array.isArray(account.scopes)||!account.scopes.includes(DRIVE_SCOPE)||account.offlineReady!==true)fail('CONSENT','保存先の作成・継続利用をGoogleで許可してください。');
    const workspace=this.workspaceFactory(account.accessToken);
    // Verify the actual bearer token belongs to the server-authenticated principal.
    if((await workspace.identity()).sub!==account.subject)fail('AUTH','Googleアカウントが一致しません。再ログインしてください。');
    return this.repository.withLock(account.subject,async()=>{
      let job=await this.repository.getOperation(account.subject,input.requestId);
      if(job&&(job.ownerSubject!==account.subject||job.name!==name))fail('CONFLICT','同じ操作IDで別の登録はできません。');
      if(!job){job={ownerSubject:account.subject,requestId:input.requestId,id:this.newId(),name,createdAt:this.now(),status:'new'};if(!uuid.test(job.id))throw Error('Invalid generated classroom ID.');await this.repository.putOperation(job);}
      if(job.status==='ready')return this.#result(job);
      if(['creating','uncertain'].includes(job.status)){
        const matches=await workspace.findRegistration(job);
        if(matches.length!==1)fail('RECONCILE','保存先の作成結果を確認中です。新しく作成し直さず、管理者へお問い合わせください。');
        this.#verifyFile(matches[0],job);job={...job,fileId:matches[0].id,spreadsheetUrl:matches[0].webViewLink,status:'initializing'};await this.repository.putOperation(job);
      }
      if(job.status==='new'){
        job={...job,status:'creating'};await this.repository.putOperation(job);
        try{
          const file=await workspace.createSpreadsheet(job);this.#verifyFile(file,job);
          job={...job,fileId:file.id,spreadsheetUrl:file.webViewLink,status:'initializing'};
          await this.repository.putOperation(job);
        }catch(error){
          // An unsuccessful response does not prove the file was not created.
          // The persisted 'creating' checkpoint survives even if this write fails.
          await this.repository.putOperation({...job,status:'uncertain'});
          fail('RECONCILE','保存先の作成結果を確認できませんでした。再読み込みして確認してください。');
        }
      }
      if(job.status!=='initializing')fail('CONFLICT','登録状態を確認してください。');
      this.#verifyFile(await workspace.getSpreadsheet(job.fileId),job);
      await workspace.initializeSpreadsheet(job);
      const completed={...job,status:'ready'};
      await this.repository.saveClassroom({id:job.id,name:job.name,ownerSubject:job.ownerSubject,fileId:job.fileId,spreadsheetUrl:job.spreadsheetUrl,createdAt:job.createdAt});
      await this.repository.putOperation(completed);
      return this.#result(completed);
    });
  }
  #verifyFile(file,job){
    if(!file||file.trashed||file.ownedByMe!==true||file.mimeType!=='application/vnd.google-apps.spreadsheet'||file.appProperties?.srClassroomId!==job.id||file.appProperties?.srRegistrationId!==job.requestId)fail('OWNERSHIP','この教室の専用保存先を確認できません。');
    const url=new URL(file.webViewLink);
    if(url.origin!=='https://docs.google.com'||url.pathname!==`/spreadsheets/d/${file.id}/edit`||url.username||url.password||url.hash||[...url.searchParams.keys()].some(k=>k!=='usp'))fail('OWNERSHIP','保存先URLを確認してください。');
  }
  #result(job){
    const url=new URL(this.base);url.searchParams.set('classroom',job.id);
    return {id:job.id,name:job.name,status:'ready',studentUrl:url.href,spreadsheetUrl:job.spreadsheetUrl};
  }
}
