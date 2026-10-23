import {RegistrationError} from './registration.mjs';

const FILE_FIELDS='id,mimeType,ownedByMe,trashed,appProperties,webViewLink';
const TABLES=['Schools','Students','Admins','Records','Sessions'];
/** No browser tokens or arbitrary endpoint URLs. Created files are never shared publicly. */
export class GoogleWorkspace {
  #token;#fetch;
  constructor(accessToken,{fetchImpl=fetch}={}){
    if(typeof accessToken!=='string'||!accessToken||/[\s\r\n]/.test(accessToken))throw Error('Invalid server-side bearer token.');
    this.#token=accessToken;this.#fetch=(...args)=>fetchImpl(...args);
  }
  async #request(url,{method='GET',body}={}){
    let response;
    try{response=await this.#fetch(url,{method,headers:{Authorization:`Bearer ${this.#token}`,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),redirect:'manual',cache:'no-store',signal:AbortSignal.timeout(20000)});}
    catch{throw new RegistrationError('GOOGLE_UNAVAILABLE','Googleとの通信を確認できません。しばらくしてから再試行してください。');}
    if(!response.ok){
      const code=response.status===401?'REAUTHORIZE':response.status===403?'PERMISSION':response.status===429?'RATE':'GOOGLE_UNAVAILABLE';
      throw new RegistrationError(code,response.status===401?'Googleとの接続が切れました。再ログインしてください。':response.status===429?'Googleの利用上限に達しました。1分ほど待ってから、もう一度お試しください。入力内容は残っています。':'Googleの保存先を利用できません。権限と接続状況を確認してください。');
    }
    try{return await response.json();}catch{throw new RegistrationError('GOOGLE_UNAVAILABLE','Googleの応答を確認できません。');}
  }
  identity(){return this.#request('https://openidconnect.googleapis.com/v1/userinfo');}
  createSpreadsheet(job){
    return this.#request(`https://www.googleapis.com/drive/v3/files?fields=${encodeURIComponent(FILE_FIELDS)}`,{method:'POST',body:{name:`Study Room ${job.name}`,mimeType:'application/vnd.google-apps.spreadsheet',appProperties:{srClassroomId:job.id,srRegistrationId:job.requestId,srSchema:'1'}}});
  }
  getSpreadsheet(id){return this.#request(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}?fields=${encodeURIComponent(FILE_FIELDS)}`);}
  async readTables(fileId){
    const params=new URLSearchParams({valueRenderOption:'UNFORMATTED_VALUE'});
    for(const table of TABLES)params.append('ranges',`'SR10_${table}'!A:B`);
    const result=await this.#request(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(fileId)}/values:batchGet?${params}`);
    if(result.valueRanges?.length!==TABLES.length)throw new RegistrationError('SCHEMA','保存先のテーブルを確認してください。');
    const tables={};
    TABLES.forEach((table,i)=>{
      const rows=result.valueRanges[i].values||[];
      if(JSON.stringify(rows[0])!==JSON.stringify(['id','json']))throw new RegistrationError('SCHEMA','保存先の列構成が異なります。');
      const seen=new Set();tables[table]=rows.slice(1).map((row,index)=>{
        if(!row?.length)return null;
        let value;try{value=JSON.parse(row[1]);}catch{throw new RegistrationError('SCHEMA','保存先の記録形式を確認してください。');}
        if(!row[0]||value.id!==row[0]||seen.has(value.id))throw new RegistrationError('SCHEMA','保存先のIDが重複または不一致です。');
        seen.add(value.id);return {row:index+2,value};
      }).filter(Boolean);
    });return tables;
  }
  async writeCells(fileId,data){
    if(!data.length)return;
    return this.#request(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(fileId)}/values:batchUpdate`,{method:'POST',body:{valueInputOption:'RAW',data}});
  }
  backup(fileId,name,tag){
    return this.#request(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}/copy?fields=${encodeURIComponent(FILE_FIELDS)}`,{method:'POST',body:{name,appProperties:{srClassroomId:'backup',srRegistrationId:'backup',srBackupFor:fileId,srBackupTag:tag}}});
  }
  async findBackup(fileId,tag){
    const escape=s=>String(s).replace(/\\/g,'\\\\').replace(/'/g,"\\'");
    const q=`trashed = false and appProperties has { key='srBackupFor' and value='${escape(fileId)}' } and appProperties has { key='srBackupTag' and value='${escape(tag)}' }`;
    const result=await this.#request('https://www.googleapis.com/drive/v3/files?'+new URLSearchParams({q,fields:`files(${FILE_FIELDS}),nextPageToken`,pageSize:'100'}));
    if(result.nextPageToken)return [];return (result.files||[]).filter(f=>f.ownedByMe&&!f.trashed&&f.mimeType==='application/vnd.google-apps.spreadsheet');
  }
  async findRegistration(job){
    // Both values are server-generated / validated UUIDs, never arbitrary Drive queries.
    const q=`trashed = false and appProperties has { key='srClassroomId' and value='${job.id}' } and appProperties has { key='srRegistrationId' and value='${job.requestId}' }`;
    const params=new URLSearchParams({q,fields:`files(${FILE_FIELDS}),nextPageToken`,pageSize:'100',spaces:'drive'});
    const result=await this.#request(`https://www.googleapis.com/drive/v3/files?${params}`);
    if(result.nextPageToken)throw new RegistrationError('RECONCILE','保存先候補を一意に確認できません。');
    return result.files||[];
  }
  async initializeSpreadsheet(job){
    const base=`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(job.fileId)}`;
    const meta=await this.#request(base+'?fields=sheets.properties');
    const properties=(meta.sheets||[]).map(s=>s.properties),titles=new Set(properties.map(p=>p.title));
    let sheetId=Math.max(0,...properties.map(p=>p.sheetId))+1;
    const requests=[];
    for(const table of TABLES){
      const title='SR10_'+table;
      if(titles.has(title)){
        const header=await this.#request(base+'/values/'+encodeURIComponent(`'${title}'!A1:B1`));
        if(JSON.stringify(header.values)!==JSON.stringify([['id','json']]))throw new RegistrationError('SCHEMA','保存先の列構成が異なります。初期化せず停止しました。');
      }else{
        const id=sheetId++;
        requests.push({addSheet:{properties:{sheetId:id,title,gridProperties:{frozenRowCount:1}}}},{updateCells:{start:{sheetId:id,rowIndex:0,columnIndex:0},rows:[{values:[{userEnteredValue:{stringValue:'id'}},{userEnteredValue:{stringValue:'json'}}]}],fields:'userEnteredValue'}});
      }
    }
    if(requests.length)await this.#request(base+':batchUpdate',{method:'POST',body:{requests}});
    const range=encodeURIComponent("'SR10_Schools'!A2:B2");
    const existing=await this.#request(base+'/values/'+range);
    if(existing.values?.length){
      let school;try{school=JSON.parse(existing.values[0][1]);}catch{throw new RegistrationError('SCHEMA','教室設定を確認してください。');}
      if(existing.values[0][0]!==job.id||school.id!==job.id||school.name!==job.name)throw new RegistrationError('SCHEMA','別の教室設定は上書きしません。');
    }else{
      const school={id:job.id,name:job.name,code:job.id,active:true,enrolled:null,createdAt:job.createdAt};
      await this.#request(base+'/values/'+range+'?valueInputOption=RAW',{method:'PUT',body:{range:"'SR10_Schools'!A2:B2",majorDimension:'ROWS',values:[[job.id,JSON.stringify(school)]]}});
    }
  }
}
