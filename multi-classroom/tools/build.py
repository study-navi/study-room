"""Build a self-contained GAS App from the untouched latest v9 index."""
from pathlib import Path
import re
root=Path(__file__).resolve().parents[2]
p=root/'multi-classroom'
s=(root/'index.html').read_text()
# Remove the legacy transport entirely; do not leave a fallback to production.
s=re.sub(r"const GAS_URL = .*?;\n",'',s)
s=re.sub(r'function api\(action, data=\{\}, attempt=0\)\{.*?\n\}\n\nfunction displayTimeValue', 'function api(){ throw new Error("安全な通信を準備中です。"); }\n\nfunction displayTimeValue',s,flags=re.S)
for old,new in [('studyRoomV9State','sr10State:new'),('studyRoomV9Profile','sr10Profile:new'),('studyRoomV9LocalTotal','sr10Totals:new'),('studyRoomV9TeacherSession','sr10AdminSession')]:s=s.replace(old,new)
s=s.replace('const STATE_KEY','let STATE_KEY').replace('const PROFILE_KEY','let PROFILE_KEY').replace('const LOCAL_TOTAL_KEY','let LOCAL_TOTAL_KEY')
s=s.replace("'lastCompleteSummary'","'sr10Summary'")
s=s.replace("Number(localTotals()[todayISO()] || 0) + minutes", "Number(localTotals()[todayISO()] || 0)")
# Never discard an unsent reflection when the application reloads.
s=s.replace('  cleanFinishedStateOnLoad();','')
s=s.replace("if(appState.startAt && !appState.endAt && (appState.status === 'studying' || appState.status === 'break')) {\n    goScreen('timerScreen');", "if(appState.startAt) {\n    goScreen(appState.endAt?'reviewScreen':'timerScreen');")
# Initialize key namespace before the original init reads local storage.
s=s.replace('function init(){\n', 'function init(){\n  mcStorageKeys();\n')
s=s.replace("const CR_CLASSROOM_ID = 'main';", "const CR_CLASSROOM_ID = ''; // v10 uses the authenticated school selector")
s=s.replace('<section id="welcome" class="card">','''<div class="card mcContext"><strong id="mcSchoolLabel">教室を選択してください</strong><span id="mcNetwork" role="status" aria-live="polite"></span><p id="mcNotice" role="status" aria-live="polite"></p></div>
<section id="welcome" class="card">
<label for="mcSchool">所属教室</label><select id="mcSchool"><option value="">読み込み中…</option></select>
<div class="row"><button class="btn light" onclick="mcSwitchUser()">利用者を切り替える</button><button class="btn light" onclick="mcHistory()">自分の学習履歴</button></div>
<p class="small">プロフィールと履歴キーをこの端末に保存します。共用端末では利用後に「利用者を切り替える」を押してください。同じ端末を操作できる人には履歴が見えるため、私物端末での利用をおすすめします。</p><div id="mcHistory"></div><details><summary>先生に確認した履歴を引き継ぐ</summary><label>引継ぎコード<input id="mcLinkCode" autocomplete="off"></label><button class="btn light" onclick="mcRedeemLink()">この端末に引き継ぐ</button></details>''')
s=s.replace('onclick="startApp()">スタート', 'id="mcStart" onclick="startApp()">スタート')
s=s.replace('onclick="teacherLogin()">ログ確認へ進む','id="mcLogin" onclick="teacherLogin()">管理者ログイン')
s=s.replace('ログ確認</h2>','管理画面</h2>').replace('>確認ID<','>管理者ID<').replace('placeholder="確認ID"','placeholder="管理者ID"')
s=s.replace('<div id="teacherPanel" class="hide">','''<div id="teacherPanel" class="hide">
<div class="row"><b id="mcRole"></b><button class="btn light" onclick="mcLogout()">ログアウト</button></div>
<div class="grid2"><div><label>対象教室<select id="mcAdminSchool"></select></label></div><div><label>期間の開始<input id="mcFrom" type="date"></label><label>期間の終了<input id="mcTo" type="date"></label></div></div>
<div id="mcDashboard"></div><button class="btn light" onclick="mcManageStudents()">生徒の履歴引継ぎ・重複確認</button><div id="mcStudentEditor"></div>
<div id="mcGlobal" class="hide"><div class="row"><button class="btn light" onclick="mcEditSchools()">教室の追加・編集</button><button class="btn light" onclick="mcEditAdmins()">管理者の登録・権限設定</button></div><div id="mcSchoolEditor"></div><div id="mcAdminEditor"></div></div>''')
s=s.replace('<input id="crName"','<label>登録済みの生徒<select id="mcRoster"><option value="">読み込み中…</option></select></label><p class="small">同姓同名は末尾の生徒IDで区別します。新規の場合のみ下の名前を入力してください。</p><input id="crName"')
s=s.replace('onclick="crSubmitCheckin()"','id="mcCrEnter" onclick="crSubmitCheckin()"')
# Ranking groups by immutable identity, including school, rather than display name.
s=s.replace("const name = r['名前'] || '未入力';", "const name = (r['名前'] || '未入力') + '（' + (r['教室']||'') + '／' + (r['生徒ID']||'').slice(0,8) + '）';")
# Preserve source PWA references as Pages absolute assets. GAS cannot register a Pages worker.
s=s.replace("if('serviceWorker' in navigator){", "if(location.hostname==='study-navi.github.io' && 'serviceWorker' in navigator){")
s=s.replace("if('serviceWorker' in navigator) {", "if(location.hostname==='study-navi.github.io' && 'serviceWorker' in navigator) {")
s=s.replace('href="./','href="https://study-navi.github.io/study-room/').replace('src="./icons/','src="https://study-navi.github.io/study-room/icons/')
s=s.replace('</head>','''<style>
body:has(#teacher:not(.hide)) .wrap{max-width:1240px!important}#teacher table{min-width:1000px} .mcContext{margin:12px 0;padding:14px!important}.mcContext strong{display:block;font-size:20px}.mcContext p:empty{display:none}.mcItem{padding:12px;border-bottom:1px solid #dbe3ef;overflow-wrap:anywhere}.mcItem p{margin:6px 0}.mcCheck{display:flex;align-items:center;gap:8px}.mcCheck input{width:22px;min-height:22px}#mcDashboard h3{margin-top:24px}#mcDashboard .statGrid{grid-template-columns:repeat(4,minmax(0,1fr))}#mcSchoolEditor,#mcAdminEditor{margin:20px 0}.btn{min-height:44px}#mcNetwork{font-size:13px}#mcNotice{color:#9b3410}#mcHistory{max-height:55vh;overflow:auto}.statGrid{grid-template-columns:repeat(auto-fit,minmax(150px,1fr))}
@media(max-width:720px){#mcDashboard .statGrid{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media(max-width:480px){.statGrid{grid-template-columns:repeat(2,minmax(0,1fr))}.stat b{font-size:21px!important;overflow-wrap:anywhere}.row .btn{flex:1}#mcSchoolLabel{font-size:19px}}
</style></head>''')
# Add the pure domain helpers and integration before DOMContentLoaded fires.
s=s.replace('</body>','<script>\n'+(p/'Core.gs').read_text()+'\n'+(p/'Transport.js').read_text()+'\n'+(p/'Client.js').read_text()+'\n</script></body>')
(p/'App.html').write_text(s)
print('Built multi-classroom/App.html from v9')
