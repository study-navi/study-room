import {randomBytes,createHash} from 'node:crypto';
import {OAuth2Client} from 'google-auth-library';
import {DRIVE_SCOPE,RegistrationError} from './registration.mjs';

export const digest=value=>createHash('sha256').update(String(value||'')).digest('hex');
const secret=()=>randomBytes(32).toString('base64url');
const denied=()=>new RegistrationError('AUTH','Googleでログインし直してください。');

/** All credentials remain server-side. The injectable client is used by offline tests only. */
export class GoogleAuth {
  #access=new Map();
  constructor({clientId,clientSecret,origin,repository,vault,clientFactory}){
    this.clientId=clientId;this.origin=origin;this.repository=repository;this.vault=vault;
    this.makeClient=clientFactory||(()=>new OAuth2Client(clientId,clientSecret,origin+'/auth/callback'));
  }
  async begin(){
    const client=this.makeClient(),state=secret(),binding=secret(),nonce=secret();
    const {codeVerifier,codeChallenge}=await client.generateCodeVerifierAsync();
    this.repository.putOAuthState(digest(state),digest(binding),{nonce,codeVerifier},Date.now()+600000);
    return {binding,url:client.generateAuthUrl({scope:['openid','email',DRIVE_SCOPE],access_type:'offline',prompt:'consent',state,nonce,code_challenge:codeChallenge,code_challenge_method:'S256',include_granted_scopes:false})};
  }
  async complete({state,binding,code,previousSession}){
    if(!state||!binding||!code||code.length>4096)throw denied();
    const pending=this.repository.consumeOAuthState(digest(state),digest(binding));if(!pending)throw denied();
    const client=this.makeClient();let tokens,payload;
    try{
      ({tokens}=await client.getToken({code,codeVerifier:pending.codeVerifier,redirect_uri:this.origin+'/auth/callback'}));
      const ticket=await client.verifyIdToken({idToken:tokens.id_token,audience:this.clientId});payload=ticket.getPayload();
    }catch{throw denied();}
    if(!payload?.sub||payload.nonce!==pending.nonce||payload.email_verified!==true)throw denied();
    const scopes=String(tokens.scope||'').split(' ');if(!scopes.includes(DRIVE_SCOPE))throw new RegistrationError('CONSENT','保存先を作成する権限を許可してください。');
    await this.repository.withLock(payload.sub,async()=>{
      const old=this.repository.getGrant?await this.repository.getGrant(payload.sub):undefined;
      const refreshToken=tokens.refresh_token||(old&&this.vault.open(payload.sub,old).refreshToken);
      if(!refreshToken)throw new RegistrationError('CONSENT','継続利用を許可してGoogleに再接続してください。');
      await this.repository.putGrant(payload.sub,this.vault.seal(payload.sub,{refreshToken,scopes}));
    });
    this.#access.delete(payload.sub);
    if(previousSession)this.repository.deleteSession(digest(previousSession));
    const session=secret(),csrf=secret();
    this.repository.putSession(digest(session),{subject:payload.sub,email:payload.email||'',csrf},Date.now()+6*3600000);
    return {session};
  }
  session(raw){return raw?this.repository.getSession(digest(raw)):undefined;}
  async requireGoogleSession(raw){
    const session=this.session(raw);if(!session)throw denied();
    return this.repository.withLock(session.subject,()=>this.accountLocked(session.subject));
  }
  async accountLocked(subject){
    const cached=this.#access.get(subject);if(cached?.until>Date.now())return cached.account;
    const envelope=await this.repository.getGrant(subject);if(!envelope)throw denied();
    let grant;try{grant=this.vault.open(subject,envelope);}catch{throw denied();}
    const client=this.makeClient();client.setCredentials({refresh_token:grant.refreshToken});
    let token;
    try{token=(await client.getAccessToken()).token;}catch{throw new RegistrationError('REAUTHORIZE','Googleとの接続が切れました。先生が再ログインしてください。');}
    if(!token)throw denied();
    if(client.credentials?.refresh_token&&client.credentials.refresh_token!==grant.refreshToken)await this.repository.putGrant(subject,this.vault.seal(subject,{...grant,refreshToken:client.credentials.refresh_token}));
    const account={subject,accessToken:token,scopes:grant.scopes,offlineReady:true};
    for(const [key,value] of this.#access)if(value.until<=Date.now())this.#access.delete(key);
    this.#access.set(subject,{account,until:Math.min(Date.now()+300000,client.credentials?.expiry_date?client.credentials.expiry_date-60000:Infinity)});return account;
  }
  logout(raw){this.repository.deleteSession(digest(raw));}
}
