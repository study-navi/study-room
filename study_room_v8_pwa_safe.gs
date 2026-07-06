/*
自習室記録アプリ v8 Apps Script
先生ID・パスワードはこのApps Script側だけに保存。
HTMLには先生パスワードを入れません。
*/

const SPREADSHEET_ID = '1o_-tNipZyK8o3Pkiaky7oMED92bybYjOOou2sf3nrA8';
const SHEET_NAME = '自習室ログ';

const TEACHERS = {
  'teacher': '1234'
};

const SESSION_TTL_SECONDS = 8 * 60 * 60;

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
  const p = e && e.parameter ? e.parameter : {};
  const action = p.action || 'list';
  const callback = p.callback || '';

  try {
    const data = parseData_(p.data);
    let result;

    if (action === 'add') {
      result = addRecord_(data);
    } else if (action === 'teacherLogin') {
      result = teacherLogin_(data);
    } else if (action === 'list') {
      result = requireTeacher_(data, listRecords_);
    } else if (action === 'update') {
      result = requireTeacher_(data, function() { return updateRecord_(data); });
    } else if (action === 'delete') {
      result = requireTeacher_(data, function() { return deleteRecord_(data); });
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

function teacherLogin_(data) {
  const id = String(data.teacherId || '');
  const pass = String(data.teacherPass || '');

  if (!TEACHERS[id] || TEACHERS[id] !== pass) {
    return { result: 'error', message: '先生IDまたはパスワードが違います' };
  }

  const session = Utilities.getUuid() + Utilities.getUuid();
  CacheService.getScriptCache().put('teacher_session_' + session, id, SESSION_TTL_SECONDS);

  return { result: 'success', session: session };
}

function requireTeacher_(data, fn) {
  const session = String(data.session || '');
  if (!session) {
    return { result: 'error', message: '先生ログインが必要です' };
  }

  const id = CacheService.getScriptCache().get('teacher_session_' + session);
  if (!id) {
    return { result: 'error', message: 'ログイン期限が切れました。もう一度ログインしてください' };
  }

  return fn();
}

function getSheet_() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  let sheet = ss.getSheetByName(SHEET_NAME);

  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
  }

  if (sheet.getLastRow() === 0) {
    sheet.appendRow(HEADERS);
  } else {
    const firstRow = sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), HEADERS.length)).getValues()[0];
    if (firstRow[0] !== 'ID') {
      sheet.clear();
      sheet.appendRow(HEADERS);
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
    data.minutes || '',
    data.focus || '',
    data.achievement || '',
    data.content || '',
    data.comment || ''
  ]);

  SpreadsheetApp.flush();
  return { result: 'success', id: id };
}

function listRecords_() {
  const sheet = getSheet_();
  const values = sheet.getDataRange().getValues();

  if (values.length <= 1) {
    return { result: 'success', records: [] };
  }

  const headers = values[0];

  const records = values.slice(1).map(row => {
    const obj = {};
    headers.forEach((header, i) => {
      let value = row[i];
      if (value instanceof Date) {
        if (header === '送信日時') {
          value = Utilities.formatDate(value, 'Asia/Tokyo', 'yyyy/MM/dd HH:mm:ss');
        } else {
          value = Utilities.formatDate(value, 'Asia/Tokyo', 'yyyy-MM-dd');
        }
      }
      obj[header] = value;
    });
    return obj;
  });

  return { result: 'success', records: records };
}

function updateRecord_(data) {
  const sheet = getSheet_();
  const values = sheet.getDataRange().getValues();

  for (let i = 1; i < values.length; i++) {
    if (String(values[i][0]) === String(data.id)) {
      sheet.getRange(i + 1, 3, 1, 11).setValues([[
        data.date || '',
        data.name || '',
        data.grade || '',
        data.subject || '',
        data.startTime || '',
        data.endTime || '',
        data.minutes || '',
        data.focus || '',
        data.achievement || '',
        data.content || '',
        data.comment || ''
      ]]);
      SpreadsheetApp.flush();
      return { result: 'success' };
    }
  }

  return { result: 'error', message: '対象データが見つかりません' };
}

function deleteRecord_(data) {
  const sheet = getSheet_();
  const values = sheet.getDataRange().getValues();

  for (let i = 1; i < values.length; i++) {
    if (String(values[i][0]) === String(data.id)) {
      sheet.deleteRow(i + 1);
      SpreadsheetApp.flush();
      return { result: 'success' };
    }
  }

  return { result: 'error', message: '対象データが見つかりません' };
}

function output_(obj, callback) {
  const json = JSON.stringify(obj);

  if (callback) {
    return ContentService
      .createTextOutput(callback + '(' + json + ');')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }

  return ContentService
    .createTextOutput(json)
    .setMimeType(ContentService.MimeType.JSON);
}
