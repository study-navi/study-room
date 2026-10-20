const vm=require('node:vm'),fs=require('node:fs'),crypto=require('node:crypto'),path=require('node:path');
function createHarness(){
  class Sheet {
    constructor(){this.rows=[['id','json']];}getLastRow(){return this.rows.length;}getLastColumn(){return Math.max(...this.rows.map(r=>r.length));}
    getRange(r,c,n=1,m=1){const self=this;return {getDisplayValues(){return Array.from({length:n},(_,i)=>Array.from({length:m},(_,j)=>String(self.rows[r+i-1]?.[c+j-1]??'')));},setValues(rows){rows.forEach((row,i)=>row.forEach((v,j)=>{(self.rows[r+i-1]||=[])[c+j-1]=v;}));}};}
    appendRow(row){this.rows.push(row);return this;}
  }
  const tables=Object.fromEntries(['Schools','Students','Admins','Records','Sessions'].map(t=>['SR10_'+t,new Sheet()]));
  const props=new Map([['SR_DATABASE_ID','staging']]);
  const c=vm.createContext({console,Date,Set,Map,JSON,Math,Error,Number,String,Array,Object,RegExp,Boolean,Utilities:{getUuid:crypto.randomUUID,DigestAlgorithm:{SHA_256:'sha256'},Charset:{UTF_8:'utf8'},computeDigest:(_,v)=>[...crypto.createHash('sha256').update(v).digest()],formatDate:(d,tz,fmt)=>{const iso=new Date(d.toLocaleString('en-US',{timeZone:tz}));const date=[iso.getFullYear(),String(iso.getMonth()+1).padStart(2,'0'),String(iso.getDate()).padStart(2,'0')].join('-');return fmt==='HH:mm'?String(iso.getHours()).padStart(2,'0')+':'+String(iso.getMinutes()).padStart(2,'0'):date;}},LockService:{getScriptLock:()=>({tryLock:()=>true,hasLock:()=>true,releaseLock(){}})},PropertiesService:{getScriptProperties:()=>({getProperty:k=>props.get(k)||null,setProperty:(k,v)=>props.set(k,v),deleteProperty:k=>props.delete(k)})},SpreadsheetApp:{openById:()=>({getSheetByName:n=>tables[n],insertSheet(n){return tables[n]=new Sheet();}}),flush(){}}});
  for(const f of ['Core.gs','Code.gs'])vm.runInContext(fs.readFileSync(path.join(__dirname,'..',f),'utf8'),c);
  // Node's verified implementation avoids 600k JS work on every test login; production file unchanged.
  c.srPbkdf2_=(password,salt,n)=>crypto.pbkdf2Sync(password,salt,n,32,'sha256').toString('hex');
  const save=(table,obj)=>c.srSave_(table,obj),all=table=>JSON.parse(JSON.stringify(c.srAll_(table)));
  const school=(id,name,enrolled=10)=>save('Schools',{id,name,code:id,active:true,enrolled,createdAt:new Date().toISOString()});
  school('school-a','大府柊山校');school('school-b','テスト教室',20);
  c.srSaveAdmin_({id:'global-admin',role:'global',schoolIds:[],password:'test-password-123'},null);
  c.srSaveAdmin_({id:'school-admin',role:'school',schoolIds:['school-a'],password:'test-password-456'},null);
  const call=(action,data={},requestId=crypto.randomUUID())=>JSON.parse(JSON.stringify(c.srApi({action,data,requestId})));
  return {c,call,save,all,tables,props,crypto};
}
module.exports={createHarness};
