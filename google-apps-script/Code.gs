const SCORE_LOG_SHEET = 'Score Log';
const LATEST_SCORES_SHEET = 'Latest Scores';
const HEADERS = [
  'Event ID',
  'Submitted At',
  'Team ID',
  'Team Name',
  'Category ID',
  'Category Name',
  'Table',
  'Judge ID',
  'Judge Name',
  'Impact',
  'Innovation',
  'Execution',
  'Presentation',
  'Weighted Score',
  'Notes'
];

function doPost(e) {
  try {
    const envelope = JSON.parse(e.postData.contents || '{}');
    const sharedSecret = PropertiesService.getScriptProperties().getProperty('SHARED_SECRET');
    if (!sharedSecret) throw new Error('Apps Script shared secret is not configured.');
    if (typeof envelope.payload !== 'string' || typeof envelope.signature !== 'string') throw new Error('Invalid signed request.');

    const expected = Utilities.base64EncodeWebSafe(
      Utilities.computeHmacSha256Signature(envelope.payload, sharedSecret)
    ).replace(/=+$/u, '');
    if (!constantTimeEqual_(expected, envelope.signature)) throw new Error('Invalid request signature.');

    const command = JSON.parse(envelope.payload);
    if (!Number.isFinite(command.timestamp) || Math.abs(Date.now() - command.timestamp) > 5 * 60 * 1000) throw new Error('Request expired.');
    if (!/^[A-Za-z0-9_-]{16,64}$/u.test(command.nonce || '')) throw new Error('Invalid request nonce.');

    const cache = CacheService.getScriptCache();
    if (cache.get(command.nonce)) throw new Error('Request has already been processed.');
    cache.put(command.nonce, '1', 300);

    if (command.action === 'submit') return json_({ ok: true, data: submitScore_(command.data) });
    if (command.action === 'snapshot') return json_({ ok: true, data: latestScores_() });
    throw new Error('Unknown action.');
  } catch (error) {
    console.error(error);
    return json_({ ok: false, error: error.message || 'Google Sheets request failed.' });
  }
}

function setupSpreadsheet() {
  const spreadsheet = spreadsheet_();
  const scoreLog = sheet_(spreadsheet, SCORE_LOG_SHEET);
  const latest = sheet_(spreadsheet, LATEST_SCORES_SHEET);
  initialiseSheet_(scoreLog);
  initialiseSheet_(latest);
  refreshLatestSheet_(latestScores_());
}

function submitScore_(data) {
  validateScore_(data);
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) throw new Error('The score sheet is busy. Please retry.');
  try {
    const log = sheet_(spreadsheet_(), SCORE_LOG_SHEET);
    initialiseSheet_(log);
    log.appendRow(rowFromScore_(data));
    refreshLatestSheet_(latestScoresFromSheet_(log));
    return { submitted_at: data.submitted_at };
  } finally {
    lock.releaseLock();
  }
}

function latestScores_() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) throw new Error('The score sheet is busy. Please retry.');
  try {
    const log = sheet_(spreadsheet_(), SCORE_LOG_SHEET);
    initialiseSheet_(log);
    return latestScoresFromSheet_(log);
  } finally {
    lock.releaseLock();
  }
}

function latestScoresFromSheet_(sheet) {
  const values = sheet.getDataRange().getValues();
  const latest = {};
  for (let index = 1; index < values.length; index += 1) {
    const row = values[index];
    if (!row[2] || !row[7]) continue;
    const score = {
      event_id: String(row[0]),
      submitted_at: serialiseDate_(row[1]),
      team_id: String(row[2]),
      team_name: String(row[3]),
      category_id: String(row[4]),
      category_name: String(row[5]),
      table: String(row[6]),
      judge_id: String(row[7]),
      judge_name: String(row[8]),
      impact: Number(row[9]),
      innovation: Number(row[10]),
      execution: Number(row[11]),
      presentation: Number(row[12]),
      weighted_score: Number(row[13]),
      notes: String(row[14] || '')
    };
    latest[`${score.team_id}:${score.judge_id}`] = score;
  }
  return Object.values(latest);
}

function refreshLatestSheet_(scores) {
  const sheet = sheet_(spreadsheet_(), LATEST_SCORES_SHEET);
  sheet.clearContents();
  sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
  if (scores.length) sheet.getRange(2, 1, scores.length, HEADERS.length).setValues(scores.map(rowFromScore_));
  formatSheet_(sheet);
}

function rowFromScore_(score) {
  return [
    safeText_(score.event_id),
    safeText_(score.submitted_at),
    safeText_(score.team_id),
    safeText_(score.team_name),
    safeText_(score.category_id),
    safeText_(score.category_name),
    safeText_(score.table),
    safeText_(score.judge_id),
    safeText_(score.judge_name),
    Number(score.impact),
    Number(score.innovation),
    Number(score.execution),
    Number(score.presentation),
    Number(score.weighted_score),
    safeText_(score.notes || '')
  ];
}

function validateScore_(score) {
  const requiredText = ['event_id', 'submitted_at', 'team_id', 'team_name', 'category_id', 'judge_id', 'judge_name'];
  requiredText.forEach(key => {
    if (!String(score && score[key] || '').trim()) throw new Error(`Missing score field: ${key}`);
  });
  ['impact', 'innovation', 'execution', 'presentation'].forEach(key => {
    if (!Number.isInteger(score[key]) || score[key] < 0 || score[key] > 10) throw new Error(`Invalid score field: ${key}`);
  });
  if (!Number.isFinite(score.weighted_score) || score.weighted_score < 0 || score.weighted_score > 10) throw new Error('Invalid weighted score.');
  if (String(score.notes || '').length > 1000) throw new Error('Notes are too long.');
}

function spreadsheet_() {
  const spreadsheetId = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  if (!spreadsheetId) throw new Error('SPREADSHEET_ID is not configured.');
  return SpreadsheetApp.openById(spreadsheetId);
}

function sheet_(spreadsheet, name) {
  return spreadsheet.getSheetByName(name) || spreadsheet.insertSheet(name);
}

function initialiseSheet_(sheet) {
  if (sheet.getLastRow() === 0) sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
  formatSheet_(sheet);
}

function formatSheet_(sheet) {
  sheet.setFrozenRows(1);
  sheet.getRange(1, 1, 1, HEADERS.length).setFontWeight('bold').setBackground('#9a6a2f').setFontColor('#ffffff');
  sheet.autoResizeColumns(1, HEADERS.length);
  sheet.setColumnWidth(15, 320);
}

function safeText_(value) {
  const text = String(value == null ? '' : value);
  return /^[=+\-@]/u.test(text) ? `'${text}` : text;
}

function serialiseDate_(value) {
  return value instanceof Date ? value.toISOString() : String(value);
}

function constantTimeEqual_(left, right) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return difference === 0;
}

function json_(value) {
  return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON);
}
