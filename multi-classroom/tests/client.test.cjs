const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../Client.js'),'utf8');
function setup(){
  const nodes=new Map();const pending=[];const notices=[];
  const sandbox={mcIdentity:{id:'student-a',schoolId:'school-a'},appState:{},STATE_KEY:'state',PROFILE_KEY:'profile',LOCAL_TOTAL_KEY:'totals',localStorage:{removeItem(){}},alert(){},mcRequire:r=>r,mcBusy:s=>notices.push(s),escapeHtml:String,
    $:id=>{if(!nodes.has(id))nodes.set(id,{textContent:'0',innerHTML:'',value:''});return nodes.get(id);},
    api:()=>new Promise((resolve,reject)=>pending.push({resolve,reject}))};
  vm.createContext(sandbox);
  vm.runInContext(source.slice(source.indexOf('function mcResetLocal(){'),source.indexOf('function mcSwitchUser()'))+source.slice(source.indexOf('updateAccurateStatsFromSheet=async'),source.indexOf('function mcClearAdmin()')),sandbox);
  return {sandbox,nodes,pending,notices};
}
test('switching student clears counts and ignores late history and statistics from previous identity',async()=>{
  const {sandbox:s,pending,notices}=setup();
  for(const id of ['todayUserCount','welcomeTodayUserCount','streakDays','welcomeStreakDays'])s.$(id).textContent='9';
  const stats=s.updateAccurateStatsFromSheet(),history=s.mcHistory();
  assert.equal(s.mcResetLocal(),true);
  s.mcIdentity={id:'student-b',schoolId:'school-b'};
  pending[0].resolve({todayUserCount:9,streakDays:7});
  pending[1].resolve({records:[{'日付':'2026-10-20','科目':'英語','自習分数':30,'学習内容':'previous private history','コメント':'private'}]});
  await Promise.all([stats,history]);
  for(const id of ['todayUserCount','welcomeTodayUserCount','streakDays','welcomeStreakDays'])assert.equal(s.$(id).textContent,'0');
  assert.equal(s.$('mcHistory').innerHTML,'');assert.deepEqual(notices,[]);
});
test('late errors from an old identity cannot replace the new student notice',async()=>{
  const {sandbox:s,pending,notices}=setup();const a=s.mcHistory(),b=s.updateAccurateStatsFromSheet();
  s.mcResetLocal();s.mcIdentity={id:'student-b'};
  pending.forEach(p=>p.reject(new Error('old request failed')));await Promise.all([a,b]);assert.deepEqual(notices,[]);
});
test('current identity still receives its own counts and history',async()=>{
  const {sandbox:s,pending}=setup();const a=s.mcHistory(),b=s.updateAccurateStatsFromSheet();
  pending[0].resolve({records:[{'日付':'2026-10-20','科目':'数学','自習分数':20,'学習内容':'own record','コメント':''}]});
  pending[1].resolve({todayUserCount:2,streakDays:3});await Promise.all([a,b]);
  assert.match(s.$('mcHistory').innerHTML,/own record/);assert.equal(s.$('todayUserCount').textContent,2);assert.equal(s.$('streakDays').textContent,3);
});
