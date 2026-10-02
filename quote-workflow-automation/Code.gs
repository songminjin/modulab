/**
 * ModuLab 문의 → 견적 PDF → Gmail 초안 → 후속 연락 자동화
 *
 * 고객에게 메일을 자동 발송하지 않습니다. 반드시 Gmail 초안을 사람이 검토한 뒤 발송하세요.
 * 이 스크립트는 설치한 사용자의 Google 계정 안에서 실행됩니다.
 */

const QUOTE_SHEETS = {
  REQUESTS: '견적요청',
  ITEMS: '견적항목',
  PRICES: '단가표',
  SETTINGS: '설정',
};

const REQUEST_HEADERS = [
  '견적번호', '접수일', '고객명', '회사명', '이메일', '연락처', '상태', '유효기한',
  '다음연락일', '공급가액', '부가세', '합계', '견적PDF', 'Gmail초안ID', '생성일', '메모', '캘린더ID',
];

const ITEM_HEADERS = ['견적번호', '품목코드', '품목명', '수량', '단가', '공급가액', '과세'];
const PRICE_HEADERS = ['품목코드', '품목명', '기본단가', '과세', '사용'];

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('견적 자동화')
    .addItem('1. 최초 설정', 'setupQuoteSystem')
    .addSeparator()
    .addItem('선택 행 견적 만들기', 'createQuoteForActiveRow')
    .addItem('오늘 후속 연락 요약 보내기', 'sendDueQuoteDigest')
    .addItem('매일 오전 9시 요약 설치', 'installDailyReminder')
    .addToUi();
}

function setupQuoteSystem() {
  const ss = SpreadsheetApp.getActive();
  const requests = ensureSheet_(ss, QUOTE_SHEETS.REQUESTS, REQUEST_HEADERS);
  const items = ensureSheet_(ss, QUOTE_SHEETS.ITEMS, ITEM_HEADERS);
  const prices = ensureSheet_(ss, QUOTE_SHEETS.PRICES, PRICE_HEADERS);
  const settings = ensureSheet_(ss, QUOTE_SHEETS.SETTINGS, ['항목', '값']);

  styleSheet_(requests, REQUEST_HEADERS.length, '#1D4ED8');
  styleSheet_(items, ITEM_HEADERS.length, '#0F766E');
  styleSheet_(prices, PRICE_HEADERS.length, '#7C3AED');
  styleSheet_(settings, 2, '#334155');

  requests.getRange('G2:G').setDataValidation(
    SpreadsheetApp.newDataValidation()
      .requireValueInList(['접수', '검토 중', '견적 생성', '견적 발송', '재연락', '수주', '거절', '종료'], true)
      .setAllowInvalid(false)
      .build()
  );
  items.getRange('G2:G').setDataValidation(
    SpreadsheetApp.newDataValidation().requireValueInList(['Y', 'N'], true).setAllowInvalid(false).build()
  );
  prices.getRange('D2:E').setDataValidation(
    SpreadsheetApp.newDataValidation().requireValueInList(['Y', 'N'], true).setAllowInvalid(false).build()
  );
  requests.getRange('B2:B').setNumberFormat('yyyy-mm-dd hh:mm');
  requests.getRange('H2:I').setNumberFormat('yyyy-mm-dd');
  requests.getRange('J2:L').setNumberFormat('#,##0"원"');
  requests.getRange('O2:O').setNumberFormat('yyyy-mm-dd hh:mm');
  items.getRange('D2:F').setNumberFormat('#,##0');
  prices.getRange('C2:C').setNumberFormat('#,##0"원"');

  if (prices.getLastRow() < 2) {
    prices.getRange(2, 1, 3, 5).setValues([
      ['CONSULT-01', '기본 상담/진단', 100000, 'Y', 'Y'],
      ['BUILD-01', '맞춤 구축', 450000, 'Y', 'Y'],
      ['TRAIN-01', '사용자 교육', 100000, 'Y', 'Y'],
    ]);
  }

  const settingValues = getSettings_(settings);
  if (!settingValues['회사명']) {
    settings.getRange(2, 1, 7, 2).setValues([
      ['회사명', '회사명을 입력하세요'],
      ['대표자', '대표자명을 입력하세요'],
      ['이메일', Session.getEffectiveUser().getEmail()],
      ['전화번호', '연락처를 입력하세요'],
      ['부가세율', 0.1],
      ['견적유효일', 14],
      ['견적메일제목', '[{{회사명}}] 견적서 {{견적번호}} 전달드립니다'],
    ]);
  }

  const refreshed = getSettings_(settings);
  if (!refreshed['출력폴더ID']) {
    const folder = DriveApp.createFolder(`${ss.getName()}_견적서출력`);
    setSetting_(settings, '출력폴더ID', folder.getId());
  }
  if (!refreshed['문서템플릿ID']) {
    const doc = createQuoteTemplate_();
    setSetting_(settings, '문서템플릿ID', doc.getId());
  }

  if (requests.getLastRow() < 2) {
    const quoteNo = `Q${Utilities.formatDate(new Date(), ss.getSpreadsheetTimeZone(), 'yyyyMMdd')}-001`;
    const nextDate = new Date();
    nextDate.setDate(nextDate.getDate() + 2);
    requests.getRange(2, 1, 1, REQUEST_HEADERS.length).setValues([[
      quoteNo, new Date(), '김고객', '샘플상사', 'sample@example.com', '010-0000-0000', '접수',
      new Date(Date.now() + 14 * 86400000), nextDate, '', '', '', '', '', '', '샘플 데이터', '',
    ]]);
    items.getRange(2, 1, 2, ITEM_HEADERS.length).setValues([
      [quoteNo, 'CONSULT-01', '기본 상담/진단', 1, 100000, 100000, 'Y'],
      [quoteNo, 'BUILD-01', '맞춤 구축', 1, 450000, 450000, 'Y'],
    ]);
  }

  requests.autoResizeColumns(1, REQUEST_HEADERS.length);
  items.autoResizeColumns(1, ITEM_HEADERS.length);
  prices.autoResizeColumns(1, PRICE_HEADERS.length);
  settings.autoResizeColumns(1, 2);
  ss.setActiveSheet(requests);
  ss.toast('설정이 완료되었습니다. 샘플 행을 선택하고 “선택 행 견적 만들기”를 실행하세요.', '견적 자동화', 8);
}

function createQuoteForActiveRow() {
  const ss = SpreadsheetApp.getActive();
  const sheet = ss.getActiveSheet();
  if (sheet.getName() !== QUOTE_SHEETS.REQUESTS) {
    throw new Error(`“${QUOTE_SHEETS.REQUESTS}” 시트에서 견적을 만들 행을 선택하세요.`);
  }
  const row = sheet.getActiveRange().getRow();
  if (row < 2) throw new Error('헤더가 아닌 견적요청 행을 선택하세요.');

  let values = sheet.getRange(row, 1, 1, REQUEST_HEADERS.length).getValues()[0];
  let quoteNo = String(values[0] || '').trim();
  if (!quoteNo) {
    quoteNo = `Q${Utilities.formatDate(new Date(), ss.getSpreadsheetTimeZone(), 'yyyyMMdd')}-${String(row - 1).padStart(3, '0')}`;
    sheet.getRange(row, 1).setValue(quoteNo);
    values[0] = quoteNo;
  }

  const customerName = String(values[2] || '').trim();
  const clientCompany = String(values[3] || '').trim();
  const recipient = String(values[4] || '').trim();
  if (!customerName) throw new Error('고객명을 입력하세요.');
  if (!recipient || !recipient.includes('@')) throw new Error('견적서 초안을 만들 이메일 주소를 확인하세요.');

  const itemSheet = ss.getSheetByName(QUOTE_SHEETS.ITEMS);
  const itemRows = itemSheet.getLastRow() < 2
    ? []
    : itemSheet.getRange(2, 1, itemSheet.getLastRow() - 1, ITEM_HEADERS.length).getValues();
  const matched = itemRows.filter(r => String(r[0]).trim() === quoteNo);
  if (!matched.length) throw new Error(`“${quoteNo}” 견적항목이 없습니다.`);

  const settings = getSettings_(ss.getSheetByName(QUOTE_SHEETS.SETTINGS));
  const vatRate = Number(settings['부가세율'] || 0.1);
  const normalizedItems = matched.map(r => {
    const quantity = Number(r[3] || 0);
    const unitPrice = Number(r[4] || 0);
    const amount = quantity * unitPrice;
    return { code: r[1], name: r[2], quantity, unitPrice, amount, taxable: String(r[6]).toUpperCase() !== 'N' };
  });
  const supply = normalizedItems.reduce((sum, item) => sum + item.amount, 0);
  const tax = normalizedItems.reduce((sum, item) => sum + (item.taxable ? Math.round(item.amount * vatRate) : 0), 0);
  const total = supply + tax;
  sheet.getRange(row, 10, 1, 3).setValues([[supply, tax, total]]);

  const templateId = String(settings['문서템플릿ID'] || '');
  const outputFolderId = String(settings['출력폴더ID'] || '');
  if (!templateId || !outputFolderId) throw new Error('최초 설정을 먼저 실행하세요.');
  const folder = DriveApp.getFolderById(outputFolderId);
  const copy = DriveApp.getFileById(templateId).makeCopy(`${quoteNo}_${clientCompany || customerName}_견적서`, folder);
  const doc = DocumentApp.openById(copy.getId());
  const body = doc.getBody();
  const validUntil = values[7] instanceof Date ? values[7] : new Date(Date.now() + Number(settings['견적유효일'] || 14) * 86400000);

  replaceText_(body, '{{견적번호}}', quoteNo);
  replaceText_(body, '{{작성일}}', formatDate_(new Date(), ss));
  replaceText_(body, '{{유효기한}}', formatDate_(validUntil, ss));
  replaceText_(body, '{{고객명}}', customerName);
  replaceText_(body, '{{고객회사}}', clientCompany || '-');
  replaceText_(body, '{{공급회사}}', settings['회사명'] || '-');
  replaceText_(body, '{{대표자}}', settings['대표자'] || '-');
  replaceText_(body, '{{공급이메일}}', settings['이메일'] || '-');
  replaceText_(body, '{{공급전화}}', settings['전화번호'] || '-');
  replaceText_(body, '{{공급가액}}', formatWon_(supply));
  replaceText_(body, '{{부가세}}', formatWon_(tax));
  replaceText_(body, '{{합계}}', formatWon_(total));
  insertItemTable_(body, normalizedItems);
  doc.saveAndClose();

  const pdfBlob = copy.getAs(MimeType.PDF).setName(`${quoteNo}_${clientCompany || customerName}_견적서.pdf`);
  const pdfFile = folder.createFile(pdfBlob);
  const subjectTemplate = settings['견적메일제목'] || '[{{회사명}}] 견적서 {{견적번호}} 전달드립니다';
  const subject = subjectTemplate.replace(/{{회사명}}/g, settings['회사명'] || '견적').replace(/{{견적번호}}/g, quoteNo);
  const mailBody = `${customerName}님, 안녕하세요.\n\n요청하신 견적서를 첨부드립니다.\n견적번호: ${quoteNo}\n합계: ${formatWon_(total)}원\n유효기한: ${formatDate_(validUntil, ss)}\n\n내용을 확인하신 뒤 궁금한 점은 회신 부탁드립니다.\n\n${settings['회사명'] || ''}\n${settings['전화번호'] || ''}`;
  const draft = GmailApp.createDraft(recipient, subject, mailBody, { attachments: [pdfBlob], name: settings['회사명'] || '견적 담당자' });

  let calendarId = String(values[16] || '');
  const followUpDate = values[8];
  if (followUpDate instanceof Date && !calendarId) {
    const event = CalendarApp.getDefaultCalendar().createAllDayEvent(
      `견적 후속 연락 · ${clientCompany || customerName}`,
      followUpDate,
      { description: `견적번호 ${quoteNo}\n고객 ${customerName}\n연락처 ${values[5] || '-'}\n견적 ${formatWon_(total)}원\n${pdfFile.getUrl()}` }
    );
    calendarId = event.getId();
  }

  sheet.getRange(row, 7).setValue('견적 생성');
  sheet.getRange(row, 13, 1, 5).setValues([[pdfFile.getUrl(), draft.getId(), new Date(), values[15] || '', calendarId]]);
  ss.toast('견적 PDF와 Gmail 초안이 생성되었습니다. Gmail에서 반드시 검토한 뒤 발송하세요.', '완료', 8);
}

function installDailyReminder() {
  const functionName = 'sendDueQuoteDigest';
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === functionName)
    .forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger(functionName).timeBased().everyDays(1).atHour(9).create();
  SpreadsheetApp.getActive().toast('매일 오전 9시 후속 연락 요약이 설치되었습니다.', '견적 자동화', 5);
}

function sendDueQuoteDigest() {
  const ss = SpreadsheetApp.getActive();
  const sheet = ss.getSheetByName(QUOTE_SHEETS.REQUESTS);
  if (!sheet || sheet.getLastRow() < 2) return;
  const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, REQUEST_HEADERS.length).getValues();
  const today = new Date();
  today.setHours(23, 59, 59, 999);
  const closed = new Set(['수주', '거절', '종료']);
  const due = rows.filter(r => r[8] instanceof Date && r[8] <= today && !closed.has(String(r[6])));
  if (!due.length) return;
  const lines = due.map(r => `• ${r[3] || r[2]} / ${r[2]} / ${formatDate_(r[8], ss)} / ${formatWon_(Number(r[11] || 0))}원 / ${r[12] || 'PDF 미생성'}`);
  const settings = getSettings_(ss.getSheetByName(QUOTE_SHEETS.SETTINGS));
  const recipient = String(settings['이메일'] || Session.getEffectiveUser().getEmail() || '').trim();
  if (!recipient || !recipient.includes('@')) {
    throw new Error('설정 시트의 이메일을 확인하세요. 후속 연락 요약을 받을 주소가 필요합니다.');
  }
  GmailApp.sendEmail(recipient, `[견적 후속 연락] 오늘 확인할 ${due.length}건`, `오늘 확인할 견적입니다.\n\n${lines.join('\n')}\n\n${ss.getUrl()}`);
}

function ensureSheet_(ss, name, headers) {
  const sheet = ss.getSheetByName(name) || ss.insertSheet(name);
  if (sheet.getLastColumn() < headers.length) sheet.insertColumnsAfter(sheet.getLastColumn(), headers.length - sheet.getLastColumn());
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  return sheet;
}

function styleSheet_(sheet, columnCount, color) {
  sheet.setFrozenRows(1);
  sheet.setHiddenGridlines(true);
  sheet.getRange(1, 1, 1, columnCount)
    .setBackground(color)
    .setFontColor('#FFFFFF')
    .setFontWeight('bold')
    .setHorizontalAlignment('center')
    .setVerticalAlignment('middle');
  sheet.getRange(1, 1, Math.max(sheet.getMaxRows(), 2), columnCount).setVerticalAlignment('middle');
}

function getSettings_(sheet) {
  if (!sheet || sheet.getLastRow() < 2) return {};
  return sheet.getRange(2, 1, sheet.getLastRow() - 1, 2).getValues().reduce((acc, row) => {
    if (row[0] !== '') acc[String(row[0])] = row[1];
    return acc;
  }, {});
}

function setSetting_(sheet, key, value) {
  const values = sheet.getLastRow() < 2 ? [] : sheet.getRange(2, 1, sheet.getLastRow() - 1, 2).getValues();
  const index = values.findIndex(r => String(r[0]) === key);
  if (index >= 0) sheet.getRange(index + 2, 2).setValue(value);
  else sheet.appendRow([key, value]);
}

function createQuoteTemplate_() {
  const doc = DocumentApp.create('ModuLab_견적서_템플릿');
  const body = doc.getBody();
  body.appendParagraph('견 적 서').setHeading(DocumentApp.ParagraphHeading.TITLE).setAlignment(DocumentApp.HorizontalAlignment.CENTER);
  body.appendParagraph('견적번호  {{견적번호}}');
  body.appendParagraph('작성일  {{작성일}}    유효기한  {{유효기한}}');
  body.appendHorizontalRule();
  body.appendParagraph('받는 분').setHeading(DocumentApp.ParagraphHeading.HEADING2);
  body.appendParagraph('{{고객회사}}  {{고객명}} 님');
  body.appendParagraph('아래와 같이 견적드립니다.');
  body.appendParagraph('{{ITEM_TABLE}}');
  body.appendParagraph('공급가액  {{공급가액}}원').setAlignment(DocumentApp.HorizontalAlignment.RIGHT);
  body.appendParagraph('부가세  {{부가세}}원').setAlignment(DocumentApp.HorizontalAlignment.RIGHT);
  body.appendParagraph('합계  {{합계}}원').setHeading(DocumentApp.ParagraphHeading.HEADING2).setAlignment(DocumentApp.HorizontalAlignment.RIGHT);
  body.appendHorizontalRule();
  body.appendParagraph('{{공급회사}} / 대표 {{대표자}}');
  body.appendParagraph('{{공급이메일}} / {{공급전화}}');
  doc.saveAndClose();
  return doc;
}

function insertItemTable_(body, items) {
  const found = body.findText('\\{\\{ITEM_TABLE\\}\\}');
  if (!found) return;
  const paragraph = found.getElement().getParent().asParagraph();
  const index = body.getChildIndex(paragraph);
  paragraph.removeFromParent();
  const data = [['품목', '수량', '단가', '공급가액']].concat(items.map(item => [
    String(item.name || item.code),
    String(item.quantity),
    `${formatWon_(item.unitPrice)}원`,
    `${formatWon_(item.amount)}원`,
  ]));
  const table = body.insertTable(index, data);
  const header = table.getRow(0);
  for (let i = 0; i < header.getNumCells(); i += 1) {
    header.getCell(i).editAsText().setBold(true);
  }
}

function replaceText_(body, token, value) {
  const pattern = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const replacement = String(value == null ? '' : value).replace(/\\/g, '\\\\').replace(/\$/g, '\\$');
  body.replaceText(pattern, replacement);
}

function formatWon_(number) {
  return Number(number || 0).toLocaleString('ko-KR');
}

function formatDate_(date, ss) {
  return Utilities.formatDate(date instanceof Date ? date : new Date(date), ss.getSpreadsheetTimeZone(), 'yyyy-MM-dd');
}
