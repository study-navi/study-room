import {DurableObject} from 'cloudflare:workers';
import {DurableRepository} from './repository.mjs';
import {TokenVault} from './token-vault.mjs';
import {GoogleAuth} from './google-auth.mjs';
import {createHandler} from './http-handler.mjs';
import {handleFetch} from './fetch-adapter.mjs';

export class StudyRoomRegistry extends DurableObject {
  constructor(ctx,env){
    super(ctx,env);
    const sql=ctx.storage.sql;
    const database={exec:statement=>sql.exec(statement).toArray(),prepare:statement=>({
      all:(...args)=>sql.exec(statement,...args).toArray(),
      get:(...args)=>sql.exec(statement,...args).toArray()[0],
      run:(...args)=>{sql.exec(statement,...args).toArray();return {changes:sql.exec('SELECT changes() AS count').toArray()[0].count};}
    })};
    const repository=new DurableRepository(database);
    const vault=new TokenVault(Buffer.from(env.SR_KEY,'base64'));
    const auth=new GoogleAuth({origin:env.SR_ORIGIN,clientId:env.GOOGLE_CLIENT_ID,clientSecret:env.GOOGLE_CLIENT_SECRET,repository,vault});
    this.handler=createHandler({origin:env.SR_ORIGIN,staging:env.SR_MODE!=='production',contactEmail:env.SR_CONTACT_EMAIL,repository,auth,getAsset:async name=>{
      const response=await env.ASSETS.fetch('https://assets.invalid/'+name);
      if(!response.ok)throw Error('Missing bundled asset.');
      return Buffer.from(await response.arrayBuffer());
    }});
  }
  fetch(request){return handleFetch(this.handler,request,{clientAddress:request.headers.get('CF-Connecting-IP')||'unknown'});}
}

export default {
  async fetch(request,env){
    if(!env.SR_ORIGIN||!env.GOOGLE_CLIENT_ID||!env.GOOGLE_CLIENT_SECRET||!env.SR_KEY)return new Response('Study Room の公開設定が完了していません。',{status:503,headers:{'Cache-Control':'no-store','Content-Type':'text/plain;charset=utf-8'}});
    if(env.SR_MODE==='production'&&(!env.SR_CONTACT_EMAIL||!env.SR_ORIGIN.startsWith('https://')))return new Response('Study Room の運営窓口と公開URLの設定が必要です。',{status:503,headers:{'Cache-Control':'no-store','Content-Type':'text/plain;charset=utf-8'}});
    try{return await env.REGISTRY.get(env.REGISTRY.idFromName('study-room-registry-v1')).fetch(request);}
    catch{return new Response('処理を完了できませんでした。入力内容は残っています。もう一度お試しください。',{status:503,headers:{'Cache-Control':'no-store','Content-Type':'text/plain;charset=utf-8'}});}
  }
};
