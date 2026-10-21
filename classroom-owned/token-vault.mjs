import {createCipheriv,createDecipheriv,randomBytes} from 'node:crypto';

/** Server-side encryption only. The key must be stored outside the token database. */
export class TokenVault {
  #key;#keyId;
  constructor(key,{keyId='v1'}={}){
    if(!Buffer.isBuffer(key)||key.length!==32)throw Error('A 32-byte server encryption key is required.');
    this.#key=Buffer.from(key);this.#keyId=keyId;
  }
  seal(subject,grant){
    if(typeof subject!=='string'||!subject||typeof grant?.refreshToken!=='string'||!grant.refreshToken)throw Error('A Google subject and offline grant are required.');
    const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',this.#key,iv);
    cipher.setAAD(Buffer.from(JSON.stringify(['study-room-google-grant',this.#keyId,subject])));
    const encrypted=Buffer.concat([cipher.update(JSON.stringify(grant),'utf8'),cipher.final()]);
    return JSON.stringify({v:1,keyId:this.#keyId,iv:iv.toString('base64url'),tag:cipher.getAuthTag().toString('base64url'),data:encrypted.toString('base64url')});
  }
  open(subject,envelope){
    try{
      const x=JSON.parse(envelope);if(!subject||x.v!==1||x.keyId!==this.#keyId)throw Error();
      const iv=Buffer.from(x.iv,'base64url'),tag=Buffer.from(x.tag,'base64url');if(iv.length!==12||tag.length!==16)throw Error();
      const decipher=createDecipheriv('aes-256-gcm',this.#key,iv);
      decipher.setAAD(Buffer.from(JSON.stringify(['study-room-google-grant',this.#keyId,subject])));decipher.setAuthTag(tag);
      const grant=JSON.parse(Buffer.concat([decipher.update(Buffer.from(x.data,'base64url')),decipher.final()]).toString('utf8'));
      if(typeof grant.refreshToken!=='string'||!grant.refreshToken)throw Error();return grant;
    }catch{throw Error('Google認証情報を復元できません。再接続してください。');}
  }
}
