/*
Study Room Apps Script 修正版
重要：
- doGet / doPost 対応
- list は getDisplayValues() を使うため、時刻が 1899/12/30 のように表示されるバグを防ぎます。
- SPREADSHEET_ID は現在のスプレッドシートIDに設定済みです。
*/

const SPREADSHEET_ID = '1o_-tNipZyK8o3Pkiaky7oMED92bybYjOOou2sf3nrA8';
const SHEET_NAME = '自習室ログ';

const TEACHER_ID = 'teacher';
const TEACHER_PASS = '1234';

const HEADERS = [
  'ID',
  '送信日時',
  '日付',
  '名前',
  '学年',
  '科目',
  '入室時間',
  '退室時間',
  '自習分数',
  '集中度',
  '達成度',
  '学習内容',
  'コメント'
];

function doGet(e) {
  return handleRequest_(e);
}

function doPost(e) {
  return handleRequest_(e);
}

function handleRequest_(e) {
  const p = (e && e.parameter) ? e.parameter : {};
  const action = p.action || 'ping';
  const callback = p.callback || '';

  try {
    const data = parseData_(p.data);
    let result;

    if (action === 'add') {
      result = addRecord_(data);
    } else if (action === 'update') {
      result = updateRecord_(data);
    } else if (action === 'delete') {
      result = deleteRecord_(data);
    } else if (action === 'list') {
      result = listRecords_(data);
    } else if (action === 'teacherLogin') {
      result = teacherLogin_(data);
    } else if (action === 'ping') {
      result = { result: 'success', message: 'connected' };
    } else {
      result = { result: 'error', message: 'unknown action: ' + action };
    }

    return output_(result, callback);
  } catch (err) {
    return output_({ result: 'error', message: String(err && err.message ? err.message : err) }, callback);
  }
}

function parseData_(raw) {
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch (err) {
    return {};
  }
}

function output_(obj, callback) {
  const text = callback
    ? callback + '(' + JSON.stringify(obj) + ');'
    : JSON.stringify(obj);

  return ContentService
    .createTextOutput(text)
    .setMimeType(callback ? ContentService.MimeType.JAVASCRIPT : ContentService.MimeType.JSON);
}

function getSheet_() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  let sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) sheet = ss.insertSheet(SHEET_NAME);

  if (sheet.getLastRow() === 0) {
    sheet.appendRow(HEADERS);
  } else {
    const firstRow = sheet.getRange(1, 1, 1, HEADERS.length).getValues()[0];
    if (firstRow[0] !== 'ID') {
      sheet.insertRows(1);
      sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
    }
  }

  return sheet;
}

function addRecord_(data) {
  const sheet = getSheet_();
  const id = Utilities.getUuid();

  sheet.appendRow([
    id,
    new Date(),
    data.date || '',
    data.name || '',
    data.grade || '',
    data.subject || '',
    data.startTime || '',
    data.endTime || '',
    Number(data.minutes || 0),
    data.focus || '',
    data.achievement || '',
    data.content || '',
    data.comment || ''
  ]);

  return { result: 'success', id: id };
}

function teacherLogin_(data) {
  if ((data.teacherId || '') === TEACHER_ID && (data.teacherPass || '') === TEACHER_PASS) {
    return {
      result: 'success',
      session: Utilities.base64EncodeWebSafe(TEACHER_ID + ':' + Date.now())
    };
  }
  return { result: 'error', message: 'IDまたはパスワードが違います。' };
}

function listRecords_(data) {
  const sheet = getSheet_();
  const lastRow = sheet.getLastRow();
  const lastCol = Math.max(sheet.getLastColumn(), HEADERS.length);

  if (lastRow <= 1) {
    return { result: 'success', records: [] };
  }

  const headers = sheet.getRange(1, 1, 1, lastCol).getDisplayValues()[0];
  const values = sheet.getRange(2, 1, lastRow - 1, lastCol).getDisplayValues();

  const records = values.map(row => {
    const obj = {};
    headers.forEach((h, i) => {
      if (!h) return;
      obj[h] = normalizeDisplay_(h, row[i]);
    });
    return obj;
  });

  return { result: 'success', records: records };
}

function normalizeDisplay_(header, value) {
  value = value == null ? '' : String(value);

  if (header === '入室時間' || header === '退室時間') {
    return normalizeTimeText_(value);
  }

  if (header === '自習分数') {
    const n = Number(value);
    if (!isNaN(n)) return String(Math.round(n));
    return value;
  }

  return value;
}

function normalizeTimeText_(value) {
  if (!value) return '';

  const m = value.match(/(\d{1,2}):(\d{2})/);
  if (m) {
    return ('0' + Number(m[1])).slice(-2) + ':' + m[2];
  }

  return value;
}


function findRowById_(id) {
  if (!id) return -1;
  const sheet = getSheet_();
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return -1;

  const ids = sheet.getRange(2, 1, lastRow - 1, 1).getDisplayValues();
  for (let i = 0; i < ids.length; i++) {
    if (String(ids[i][0]) === String(id)) {
      return i + 2;
    }
  }
  return -1;
}

function updateRecord_(data) {
  const row = findRowById_(data.id);
  if (row < 0) return { result: 'error', message: '対象の記録が見つかりません。' };

  const sheet = getSheet_();
  sheet.getRange(row, 3, 1, 11).setValues([[
    data.date || '',
    data.name || '',
    data.grade || '',
    data.subject || '',
    data.startTime || '',
    data.endTime || '',
    Number(data.minutes || 0),
    data.focus || '',
    data.achievement || '',
    data.content || '',
    data.comment || ''
  ]]);

  return { result: 'success', id: data.id };
}

function deleteRecord_(data) {
  const row = findRowById_(data.id);
  if (row < 0) return { result: 'error', message: '対象の記録が見つかりません。' };

  const sheet = getSheet_();
  sheet.deleteRow(row);
  return { result: 'success', id: data.id };
}
