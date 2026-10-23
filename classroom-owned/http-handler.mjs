import QRCode from 'qrcode';
import {digest} from './google-auth.mjs';
import {GoogleWorkspace} from './google-workspace.mjs';
import {ClassroomRegistration,RegistrationError} from './registration.mjs';
import {StudyService} from './study-service.mjs';

const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const publicCodes=new Set(['INVALID','AUTH','FORBIDDEN','NOT_FOUND','RATE','SCHOOL','SCHEMA','CONFLICT','BUSY','LOCK','OWNERSHIP','CONSENT','REAUTHORIZE','PERMISSION','RECONCILE','GOOGLE_UNAVAILABLE','BACKUP','SETUP']);
const json=(res,value,status=200)=>{res.writeHead(status,{'Content-Type':'application/json;charset=utf-8'});res.end(JSON.stringify(value));};
const cookieValue=(req,name)=>{const v=String(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith(name+'='));return v?.slice(name.length+1)||'';};
const error=(code,message)=>{throw new RegistrationError(code,message);};
// Only same-site teacher entry pages may be returned to after Google login (no open redirect).
const returnPattern=/^\/study\?classroom=[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}&manage=1(?:&mode=classroom)?$/i;
const safeReturn=value=>{try{const v=decodeURIComponent(String(value||''));return returnPattern.test(v)?v:'';}catch{return '';}};

export function createHandler({getAsset,contactEmail,staging=true,origin,repository,auth,workspaceFactory=token=>new GoogleWorkspace(token),secureCookies=true,registration,service}={}){
  const base=new URL(origin);
  if(base.origin!==origin||base.username||base.password||(base.protocol!=='https:'&&(secureCookies||!['localhost','127.0.0.1'].includes(base.hostname))))throw Error('Use an exact HTTPS origin; local HTTP requires an explicit local-only test configuration.');
  const sessionName=secureCookies?'__Host-sr_session':'sr_local_session',bindingName=secureCookies?'__Host-sr_oauth':'sr_local_oauth',returnName=secureCookies?'__Host-sr_return':'sr_local_return';
  const cookie=(name,value,maxAge)=>`${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secureCookies?'; Secure':''}`;
  const decorate=html=>staging?String(html).replace('<body>','<body><aside role="note" style="padding:14px 18px;background:#fff1c5;color:#583c00;font-weight:700;line-height:1.7">検証用 Study Room — 架空データのみ。本番へは移行しません。</aside>'):html;
  registration??=new ClassroomRegistration({auth,repository,workspaceFactory,studentBaseUrl:(base.protocol==='https:'?origin:'https://localhost')+'/study'});
  service??=new StudyService({auth,repository,workspaceFactory});
  const classroomResult=c=>({id:c.id,name:c.name,spreadsheetUrl:c.spreadsheetUrl,studentUrl:origin+'/study?classroom='+encodeURIComponent(c.id),manageUrl:origin+'/study?classroom='+encodeURIComponent(c.id)+'&manage=1'});
  return async(req,res)=>{
    res.setHeader('Cache-Control','no-store, max-age=0');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('X-Frame-Options','DENY');
    res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; media-src 'self' blob:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
    if(secureCookies)res.setHeader('Strict-Transport-Security','max-age=31536000');
    try{
      const url=new URL(req.url,origin),sessionRaw=cookieValue(req,sessionName),session=auth.session(sessionRaw);
      if(url.origin!==origin||req.url.length>6000)error('INVALID','URLを確認してください。');
      repository.rateLimit(digest(req.socket.remoteAddress||'unknown'),{limit:300});
      const requireTeacher=()=>{if(!session)error('AUTH','先生がGoogleでログインしてください。');return session;};
      const ownerClassroom=id=>{requireTeacher();const c=repository.getClassroom(id);if(!c||c.ownerSubject!==session.subject)error('FORBIDDEN','この教室の管理権限がありません。');return c;};
      let data;
      if(req.method==='POST'){
        if(req.headers.origin!==origin||req.headers['sec-fetch-site']==='cross-site')error('FORBIDDEN','この画面から操作し直してください。');
        if(!/^application\/json(?:;|$)/i.test(req.headers['content-type']||''))error('INVALID','JSON形式で送信してください。');
        const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>40000)error('INVALID','入力が長すぎます。');chunks.push(chunk);}
        try{data=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{error('INVALID','入力形式を確認してください。');}
        if(!data||typeof data!=='object'||Array.isArray(data))error('INVALID','入力形式を確認してください。');
        if(url.pathname!=='/api/study'||data.data?.session){requireTeacher();if(req.headers['x-csrf-token']!==session.csrf)error('FORBIDDEN','画面を再読み込みしてください。');}
      }else if(req.method!=='GET')error('INVALID','この操作は利用できません。');
      if(req.method==='GET'&&url.pathname==='/auth/google'){
        repository.rateLimit('oauth:'+digest(req.socket.remoteAddress),{limit:10,windowMs:600000});
        const result=await auth.begin(),back=safeReturn(url.searchParams.get('return'));res.setHeader('Set-Cookie',[cookie(bindingName,result.binding,600),cookie(returnName,back?encodeURIComponent(back):'',back?600:0)]);res.writeHead(302,{Location:result.url});res.end();return;
      }
      if(req.method==='GET'&&url.pathname==='/auth/callback'){
        try{const result=await auth.complete({state:url.searchParams.get('state'),code:url.searchParams.get('code'),binding:cookieValue(req,bindingName),previousSession:sessionRaw});res.setHeader('Set-Cookie',[cookie(sessionName,result.session,21600),cookie(bindingName,'',0),cookie(returnName,'',0)]);res.writeHead(303,{Location:safeReturn(cookieValue(req,returnName))||'/teacher'});}
        catch(error){res.setHeader('Set-Cookie',cookie(bindingName,'',0));res.writeHead(303,{Location:error?.code==='CONSENT'?'/teacher?authError=consent':'/teacher?authError=1'});}res.end();return;
      }
      if(req.method==='POST'&&url.pathname==='/auth/logout'){auth.logout(sessionRaw);res.setHeader('Set-Cookie',cookie(sessionName,'',0));json(res,{ok:true});return;}
      if(req.method==='GET'&&url.pathname==='/api/me'){json(res,session?{signedIn:true,email:session.email,csrf:session.csrf}:{signedIn:false});return;}
      if(url.pathname==='/api/classrooms'){
        requireTeacher();
        if(req.method==='POST'){const result=await registration.register(sessionRaw,data);json(res,{...result,...classroomResult(result)});}
        else{const classrooms=await repository.withLock(session.subject,()=>repository.listClassrooms(session.subject));json(res,{classrooms:classrooms.map(classroomResult)});}return;
      }
      if(req.method==='POST'&&url.pathname==='/api/study'){
        if(!uuid.test(data.classroom||'')||data.action==='teacherLogin'||data.action==='logout')error('INVALID','教室URLと操作を確認してください。');
        if(data.data?.session&&(!session||req.headers['x-csrf-token']!==session.csrf))error('AUTH','先生がGoogleでログインしてください。');
        // Private actions require CSRF too, even when the client omits the marker.
        if(!['schools','registerStudent','history','stats','redeemStudentLink','addActive','checkout','update'].includes(data.action)){
          requireTeacher();if(req.headers['x-csrf-token']!==session.csrf)error('FORBIDDEN','画面を再読み込みしてください。');
        }
        json(res,await service.run(data.classroom,{action:data.action,data:data.data,requestId:data.requestId},session));return;
      }
      if(req.method==='GET'&&url.pathname==='/api/qr'){
        const c=ownerClassroom(url.searchParams.get('classroom'));const svg=await QRCode.toString(classroomResult(c).studentUrl,{type:'svg',errorCorrectionLevel:'M',margin:4,width:400});
        res.writeHead(200,{'Content-Type':'image/svg+xml','Content-Disposition':`inline; filename="StudyRoom-${c.id}.svg"`});res.end(svg);return;
      }
      if(req.method==='POST'&&url.pathname==='/api/backup'){
        const c=ownerClassroom(data.classroom);if(!uuid.test(data.requestId||''))error('INVALID','操作IDを確認してください。');
        const result=await repository.withLock(session.subject,async()=>{
          const key='manual-backup:'+data.requestId,old=await repository.getOperation(session.subject,key);
          if(old?.classroom&&old.classroom!==c.id)error('FORBIDDEN','教室を確認してください。');
          if(old?.status==='ready')return old;
          const account=await auth.accountLocked(session.subject),workspace=workspaceFactory(account.accessToken),file=await workspace.getSpreadsheet(c.fileId);
          if(file.ownedByMe!==true||file.appProperties?.srClassroomId!==c.id)error('OWNERSHIP','保存先を確認してください。');
          let copy;
          if(old){const copies=await workspace.findBackup(c.fileId,data.requestId);if(copies.length!==1)error('RECONCILE','バックアップの作成結果を確認中です。時間をおいて再送してください。');copy=copies[0];}
          else{await repository.putOperation({ownerSubject:session.subject,requestId:key,classroom:c.id,status:'creating'});copy=await workspace.backup(c.fileId,`Study Room ${c.name} 手動バックアップ ${new Date().toISOString()}`,data.requestId);}
          const done={ownerSubject:session.subject,requestId:key,classroom:c.id,status:'ready',url:copy.webViewLink||`https://docs.google.com/spreadsheets/d/${encodeURIComponent(copy.id)}/edit`};await repository.putOperation(done);return done;
        });json(res,{url:result.url});return;
      }
      if(req.method!=='GET')error('NOT_FOUND','ページが見つかりません。');
      if(url.pathname==='/'||url.pathname==='/teacher'){
        res.writeHead(200,{'Content-Type':'text/html;charset=utf-8'});res.end(decorate(await getAsset('portal.html')));return;
      }
      if(url.pathname==='/open'){
        const id=url.searchParams.get('classroom');if(!uuid.test(id||'')||!repository.getClassroom(id))error('NOT_FOUND','教室URLが見つかりません。先生から案内されたURLを確認してください。');
        const target='/study?classroom='+id+'&manage=1'+(url.searchParams.get('mode')==='classroom'?'&mode=classroom':'');
        const owner=session&&repository.getClassroom(id).ownerSubject===session.subject;
        res.writeHead(302,{Location:owner?target:'/auth/google?return='+encodeURIComponent(encodeURIComponent(target))});res.end();return;
      }
      if(url.pathname==='/dashboard'){res.writeHead(200,{'Content-Type':'text/html;charset=utf-8'});res.end(decorate(await getAsset('dashboard.html')));return;}
      if(url.pathname==='/privacy'){
        const contact=contactEmail&&/^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(contactEmail)?contactEmail:'検証中のため、利用中の教室へお問い合わせください。';
        const escaped=contact.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
        res.writeHead(200,{'Content-Type':'text/html;charset=utf-8'});res.end(String(await getAsset('privacy.html')).replace('{{CONTACT}}',escaped));return;
      }
      if(url.pathname==='/study'){
        const id=url.searchParams.get('classroom');if(!uuid.test(id||'')||!repository.getClassroom(id))error('NOT_FOUND','教室URLが見つかりません。先生から案内されたURLを確認してください。');
        const html=String(await getAsset('study.html'));res.writeHead(200,{'Content-Type':'text/html;charset=utf-8'});res.end(decorate(html.replace('href="/manifest.webmanifest"',`href="/manifest.webmanifest?classroom=${id}"`)));return;
      }
      if(url.pathname==='/manifest.webmanifest'){
        const manifest=JSON.parse(String(await getAsset('manifest.webmanifest'))),id=url.searchParams.get('classroom');
        if(uuid.test(id||'')&&repository.getClassroom(id))manifest.start_url='/study?classroom='+id;
        json(res,manifest);return;
      }
      if(url.pathname==='/sw.js'||url.pathname==='/apple-touch-icon.png'||/^\/icons\/[a-zA-Z0-9_-]+\.png$/.test(url.pathname)){
        const bytes=await getAsset(url.pathname.slice(1));res.writeHead(200,{'Content-Type':url.pathname.endsWith('.js')?'text/javascript':'image/png'});res.end(bytes);return;
      }
      error('NOT_FOUND','ページが見つかりません。');
    }catch(e){const safe=publicCodes.has(e.code),status=!safe?503:['AUTH','REAUTHORIZE'].includes(e.code)?401:e.code==='FORBIDDEN'?403:e.code==='NOT_FOUND'?404:e.code==='RATE'?429:400;json(res,{result:'error',code:safe?e.code:'SERVER',message:safe?e.message:'処理を完了できませんでした。入力を保持して再試行してください。'},status);}
  };
}
