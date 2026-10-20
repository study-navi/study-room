/* Explicit transports only. Never put credentials in URLs or use JSONP/no-cors. */
const SRTransport = (() => {
  function endpoint(value){
    const u=new URL(String(value));
    if(u.origin!=='https://script.google.com'||!/^\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(u.pathname)||u.search||u.hash||u.username||u.password)throw new Error('接続先の設定を管理者に確認してください。');
    return u.href;
  }
  async function send(request,options={}){
    const timeout=options.timeoutMs||120000;
    if(options.rpc)return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>reject(new Error('通信がタイムアウトしました。入力は保持しています。同じ操作を再送できます。')),timeout);
      options.rpc.withSuccessHandler(r=>{clearTimeout(timer);resolve(r);}).withFailureHandler(()=>{clearTimeout(timer);reject(new Error('通信できません。入力は保持しています。接続後に再送してください。'));}).srApi(request);
    });
    if(!options.endpoint)throw new Error('接続先の設定が完了していません。管理者に連絡してください。');
    const url=endpoint(options.endpoint),controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeout);
    try{
      const response=await (options.fetchImpl||fetch)(url,{method:'POST',mode:'cors',credentials:'omit',cache:'no-store',redirect:'follow',referrerPolicy:'no-referrer',headers:{'Content-Type':'text/plain;charset=UTF-8'},body:JSON.stringify(request),signal:controller.signal});
      if(!response.ok||response.type==='opaque')throw new Error('接続先の公開設定を管理者に確認してください。');
      let data;try{data=await response.json();}catch(e){throw new Error('サーバーの応答を確認できません。入力は保持しています。管理者に連絡してください。');}
      if(!data||!['success','error'].includes(data.result))throw new Error('サーバーの応答形式が不正です。入力は保持しています。');
      return data;
    }catch(e){if(e.name==='AbortError')throw new Error('通信がタイムアウトしました。入力は保持しています。同じ操作を再送できます。');throw e;}
    finally{clearTimeout(timer);}
  }
  return {endpoint,send};
})();
