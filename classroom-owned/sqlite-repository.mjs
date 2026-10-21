import {DatabaseSync} from 'node:sqlite';
import {AsyncLocalStorage} from 'node:async_hooks';
import {randomUUID} from 'node:crypto';
import {mkdirSync,chmodSync} from 'node:fs';
import {dirname} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {RegistrationError} from './registration.mjs';

/** Reference durable repository for a single persistent Node host.
 * Do not use a temporary/serverless filesystem for production storage.
 * Cross-process leases guard tenant registration; all data methods require that lease.
 */
export class SqliteRepository {
  #db;#context=new AsyncLocalStorage();#leaseMs;#waitMs;
  constructor(file,{leaseMs=300000,waitMs=5000}={}){
    if(!file||file===':memory:')throw Error('A persistent private database path is required.');
    if(leaseMs<300||waitMs<0)throw Error('Invalid registration lease settings.');
    mkdirSync(dirname(file),{recursive:true,mode:0o700});
    this.#db=new DatabaseSync(file);chmodSync(file,0o600);this.#leaseMs=leaseMs;this.#waitMs=waitMs;
    this.#db.exec(`PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS leases(owner TEXT PRIMARY KEY, token TEXT NOT NULL, expires INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS operations(owner TEXT NOT NULL, request_id TEXT NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(owner,request_id));
      CREATE TABLE IF NOT EXISTS classrooms(id TEXT PRIMARY KEY, owner TEXT NOT NULL, payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS grants(owner TEXT PRIMARY KEY, envelope TEXT NOT NULL);`);
  }
  #assert(owner){
    const ctx=this.#context.getStore();
    const row=this.#db.prepare('SELECT token,expires FROM leases WHERE owner=?').get(owner);
    if(!ctx||ctx.owner!==owner||ctx.lost||row?.token!==ctx.token||row.expires<=Date.now())throw new RegistrationError('LOCK','教室登録が中断されました。再試行してください。');
  }
  async withLock(owner,fn){
    if(typeof owner!=='string'||!owner||owner.length>255)throw new RegistrationError('AUTH','Googleアカウントを確認してください。');
    if(this.#context.getStore())throw Error('Nested registration locks are not supported.');
    const token=randomUUID(),deadline=Date.now()+this.#waitMs;
    for(;;){
      const now=Date.now(),result=this.#db.prepare('INSERT INTO leases(owner,token,expires) VALUES(?,?,?) ON CONFLICT(owner) DO UPDATE SET token=excluded.token,expires=excluded.expires WHERE leases.expires<=?').run(owner,token,now+this.#leaseMs,now);
      if(result.changes===1)break;
      if(now>=deadline)throw new RegistrationError('BUSY','同じ教室の登録を処理中です。少し待ってから再試行してください。');
      await delay(25);
    }
    const ctx={owner,token,lost:false};
    const timer=setInterval(()=>{try{const result=this.#db.prepare('UPDATE leases SET expires=? WHERE owner=? AND token=? AND expires>?').run(Date.now()+this.#leaseMs,owner,token,Date.now());if(result.changes!==1)ctx.lost=true;}catch{ctx.lost=true;}},Math.max(50,Math.floor(this.#leaseMs/3)));
    timer.unref();
    try{return await this.#context.run(ctx,async()=>{const value=await fn();this.#assert(owner);return value;});}
    finally{clearInterval(timer);this.#db.prepare('DELETE FROM leases WHERE owner=? AND token=?').run(owner,token);}
  }
  async getOperation(owner,id){this.#assert(owner);const row=this.#db.prepare('SELECT payload FROM operations WHERE owner=? AND request_id=?').get(owner,id);return row?JSON.parse(row.payload):undefined;}
  async putOperation(job){this.#assert(job.ownerSubject);this.#db.prepare('INSERT INTO operations(owner,request_id,payload) VALUES(?,?,?) ON CONFLICT(owner,request_id) DO UPDATE SET payload=excluded.payload').run(job.ownerSubject,job.requestId,JSON.stringify(job));}
  async saveClassroom(classroom){
    this.#assert(classroom.ownerSubject);
    const result=this.#db.prepare('INSERT INTO classrooms(id,owner,payload) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload WHERE classrooms.owner=excluded.owner').run(classroom.id,classroom.ownerSubject,JSON.stringify(classroom));
    if(result.changes!==1)throw new RegistrationError('OWNERSHIP','別の先生の教室は変更できません。');
  }
  async listClassrooms(owner){this.#assert(owner);return this.#db.prepare('SELECT payload FROM classrooms WHERE owner=? ORDER BY id').all(owner).map(r=>JSON.parse(r.payload));}
  async putGrant(owner,envelope){
    this.#assert(owner);let parsed;try{parsed=JSON.parse(envelope);}catch{}
    if(parsed?.v!==1||typeof parsed.data!=='string'||typeof parsed.iv!=='string'||typeof parsed.tag!=='string'||'refreshToken' in parsed)throw Error('Persist only encrypted offline grants.');
    this.#db.prepare('INSERT INTO grants(owner,envelope) VALUES(?,?) ON CONFLICT(owner) DO UPDATE SET envelope=excluded.envelope').run(owner,envelope);
  }
  async getGrant(owner){this.#assert(owner);return this.#db.prepare('SELECT envelope FROM grants WHERE owner=?').get(owner)?.envelope;}
  close(){this.#db.close();}
}
