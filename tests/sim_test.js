// Run from the repository root: node tests/sim_test.js   (fictional companies and people)
const fs = require('fs'), vm = require('vm');
const path = require('path');
const SCRIPT = path.join(__dirname, '..', 'apps-script', 'JobSearch_Automation.gs');
const TEST_CONFIG = fs.readFileSync(path.join(__dirname, 'test_config.js'), 'utf8');
const code = fs.readFileSync(SCRIPT, 'utf8');

const DAY = 86400000, now = Date.now();
const daysAgo = (n) => new Date(now - n * DAY);
let passed = 0, failed = 0;
const check = (n, ok, x) => { if (ok) passed++; else { failed++; console.log('FAIL  ' + n + (x ? '  -> ' + x : '')); } };

// ---------------- in-memory Searchly services ----------------
class Sheet {
  constructor(name, id) { this.name = name; this.id = id; this.cells = {}; this.log = []; }
  put(r, c, v, f) { this.cells[r + ',' + c] = { v: v, f: f }; }
  getLastRow() { return Math.max(0, ...Object.keys(this.cells).map(k => +k.split(',')[0])); }
  getLastColumn() { return Math.max(0, ...Object.keys(this.cells).map(k => +k.split(',')[1])); }
  getMaxRows() { return 300; }
  getSheetId() { return this.id; }
  getRange(r, c, nr, nc) { const sh = this; nr = nr || 1; nc = nc || 1; return {
    getValues() { const out = []; for (let i = 0; i < nr; i++) { const row = []; for (let j = 0; j < nc; j++) { const x = sh.cells[(r + i) + ',' + (c + j)]; row.push(x === undefined || x.v === undefined ? '' : x.v); } out.push(row); } return out; },
    setValue(v) { sh.log.push({ r: r, c: c, v: v }); sh.put(r, c, v); },
    setFormula(f) { sh.log.push({ r: r, c: c, f: f }); sh.put(r, c, 'Open email', f); },
    setValues(a) { a.forEach((row, i) => row.forEach((v, j) => { sh.log.push({ r: r + i, c: c + j, v: v }); sh.put(r + i, c + j, v); })); }
  }; }
}
function makeWorld() {
  const tracker = new Sheet('Job Tracker', 1), tab = new Sheet('Email Scan Review', 8104);
  const trHead = ['Company', 'Title', 'Application Date', 'Entry Type', 'Channel', 'Reference Link', 'Website', 'Additional Notes'];
  trHead.forEach((h, i) => tracker.put(1, i + 1, h));
  const T = (row, co, title, applied, channel, link) => [co, title, applied, 'Job', channel, link || '', '', ''].forEach((v, i) => tracker.put(row, i + 1, v));
  T(2, 'Brightly', 'Associate Product Manager', daysAgo(30), 'Application');
  T(3, 'Tool Barn', 'Product Manager', daysAgo(36), 'Application', 'https://toolbarn.wd5.myworkdayjobs.com/en-US/CareerBarn/job/Product-Manager_Req481927-1');
  T(4, 'Tool Barn', 'Product Manager - Customer Order Management', daysAgo(23), 'Application', 'https://toolbarn.wd5.myworkdayjobs.com/en-US/CareerBarn/job/Customer-Order-Management_Req482345-1');
  T(5, 'Brevity', 'Product Manager', daysAgo(5), 'Application');
  T(6, 'Zentra', 'Product Program Manager', daysAgo(200), 'Application');
  T(7, 'Dana Recruiter', 'n/a', daysAgo(9), 'Networking');
  T(8, 'Gamma', 'Product Owner, Reservations', daysAgo(19), 'Application');
  T(9, 'Kelvo', 'Product Operations Manager', daysAgo(40), 'Application');
  T(10, 'Spark', 'Technical Product Manager', daysAgo(6), 'Application');
  const heads = ['Tracker row', 'Company', 'Role in your tracker', 'Applied', 'First response date', 'Response type', 'Confidence', 'Email subject (shortened)', 'Current First Response Date', 'Action', 'Notes', 'YOUR DECISION', 'Decision date (auto)', 'Days since applied', 'What happens', 'Latest email date', 'Latest email type', 'Writes: First Response Date', 'Writes: Last Updated', 'Writes: Outcome', 'Email link', 'Review status'];
  heads.forEach((h, i) => tab.put(4, i + 1, h));
  const R = (row, trackerRow, e, f, dec, g, j) => { tab.put(row, 1, trackerRow); tab.put(row, 5, e === undefined ? '' : e); tab.put(row, 6, f); tab.put(row, 7, g || ''); tab.put(row, 10, j || ''); tab.put(row, 12, dec || ''); };
  R(5, 2, undefined, 'No email found');
  R(6, 3, undefined, 'No email found');
  R(7, 4, undefined, 'No email found');
  R(8, 6, new Date(2026, 3, 2), 'Rejection', 'Approved', 'High', 'Fill');
  R(9, 8, daysAgo(10), 'Rejection', '', 'Medium', 'Review');          // a needs-you row (Medium)
  R(10, 9, daysAgo(12), 'Rejection', '', 'High', 'Fill');             // an already AUTO-APPROVED row
  tab.log.length = 0;

  const props = {}, mails = [];
  const msg = (id, date, from, subject, body) => ({ getId: () => id, getDate: () => date, getFrom: () => from, getSubject: () => subject, getPlainBody: () => body });
  const emails = [
    ['m1', daysAgo(1), 'Brightly <hello@brightly.example>', 'Brightly Associate Product Manager Application Update', "Thank you for applying to Brightly. We're sorry to say that, after careful review of your application, we\u2019ve decided not to move forward at this time for the Associate Product Manager role."],
    ['m2', daysAgo(8), 'The Tool Barn <toolbarn@myworkday.com>', 'Thank You for Your Interest in The Tool Barn', 'Thank you for applying for the Product Manager , Req481927 position with The Tool Barn. After careful consideration, we will not be moving you forward in the process.'],
    ['m3', daysAgo(1), 'Zentra <zentra@myworkday.com>', 'Next steps with Zentra', "Hi Jordan, we'd like to schedule a call to talk about the Product Program Manager role at Zentra."],
    ['m4', daysAgo(2), 'Gamma <talentacquisitiondonotreply@gammaair.com>', 'Next steps for Product Owner, Reservations at Gamma', "We'd like to schedule an interview for the Product Owner, Reservations (#55234) opportunity at Gamma Airways."],
    ['m5', daysAgo(3), 'Acme Staffing <jobs@acmestaffing.com>', 'Update on your application', 'Unfortunately we are not moving forward with your application.'],
    ['m6', daysAgo(2), 'LinkedIn <jobs-noreply@linkedin.com>', 'New jobs similar to Product Manager at Brevity', 'Jobs similar to Product Manager'],
    ['m7', daysAgo(2), 'Brevity <careers@brevity.com>', 'Next steps for the Product Manager role at Brevity', "Hi Jordan, we'd like to schedule a call to talk about the Product Manager role at Brevity."],
    ['m11', daysAgo(4), 'Spark <jobs@sparksaves.com>', 'Thank you for applying to Spark', 'Thank you for your interest. We have received your application and will review it.'],
    ['m12', daysAgo(1), 'Kelvo <no-reply@ashbyhq.com>', 'Kelvo | Next steps', "Hi Jordan, we'd like to schedule a call about the Product Operations Manager role at Kelvo."],
    ['m8', daysAgo(1), 'Me <me@example.com>', 'Re: Brightly', 'Unfortunately I am not moving forward with this.'],
    ['m9', daysAgo(4), 'Tool Barn Careers <careers@toolbarn.com>', 'An update from The Tool Barn', 'We have decided to move forward with other candidates for your application.'],
    ['m10', daysAgo(2), 'Glassdoor <info@glassdoor.com>', 'Unfortunately you missed this', 'Unfortunately jobs are closing']
  ].map(x => msg(...x));

  const threads = emails.map((m, i) => ({ getId: () => 'T' + i, _m: m }));
  const ctx = vm.createContext({
    console, Date, Math, JSON, Number, String, Object, Array, RegExp, Error, Intl,
    Logger: { log() {} },
    SpreadsheetApp: { getActive: () => ({ getSheetByName: n => ({ 'Job Tracker': tracker, 'Email Scan Review': tab })[n] || null, getUrl: () => 'https://sheet.example/', getSpreadsheetTimeZone: () => 'America/New_York', toast() {} }) },
    Utilities: { formatDate(d, tz, fmt) {
      const p = {}; new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true, weekday: 'short' }).formatToParts(d).forEach(x => p[x.type] = x.value);
      if (fmt === 'yyyy-M-d') return p.year + '-' + p.month + '-' + p.day;
      if (fmt === 'h:mm a') return p.hour + ':' + p.minute + ' ' + p.dayPeriod;
      if (fmt === 'M/d') return p.month + '/' + p.day;
      if (fmt === 'M/d h:mm a') return p.month + '/' + p.day + ' ' + p.hour + ':' + p.minute + ' ' + p.dayPeriod;
      if (fmt === 'EEE M/d') return p.weekday + ' ' + p.month + '/' + p.day;
      if (fmt === 'EEEE') return new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'long' }).format(d);
      if (fmt === 'EEEE M/d') return new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'long' }).format(d) + ' ' + p.month + '/' + p.day;
      if (fmt === 'H') return String(Number(new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', hourCycle: 'h23' }).format(d)));
      return String(d); } },
    Session: { getEffectiveUser: () => ({ getEmail: () => 'me@example.com' }), getScriptTimeZone: () => 'America/New_York' },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock() {} }) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: k => props[k] || null, setProperty: (k, v) => { props[k] = v; } }) },
    MailApp: { sendEmail: (o) => mails.push(o) },
    GmailApp: { search: (q, s, n) => { ctx._lastQuery = q; return threads.slice(s, s + n); }, getMessagesForThreads: ts => ts.map(t => [t._m]) }
  });
  vm.runInContext(TEST_CONFIG, ctx);
  vm.runInContext(code, ctx);
  return { ctx, tab, tracker, props, mails };
}
const run = (w, fn) => vm.runInContext(fn + '()', w.ctx);
const cellAt = (w, r, c) => (w.tab.cells[r + ',' + c] || {}).v;
const COL = { A: 1, E: 5, F: 6, G: 7, H: 8, J: 10, K: 11, L: 12, P: 16, Q: 17, U: 21 };

// ============ 1. PREVIEW changes nothing ============
{
  const w = makeWorld();
  run(w, 'previewEmailCheck');
  check('preview: writes nothing to the Sheet', w.tab.log.length === 0, JSON.stringify(w.tab.log.slice(0, 3)));
  check('preview: saves no "already reported" memory', Object.keys(w.props).length === 0);
  check('preview: sends one summary labelled PREVIEW that says what WOULD be auto-approved', w.mails.length === 1 && /^\[PREVIEW\]/.test(w.mails[0].subject) && /WOULD BE AUTO-APPROVED/.test(w.mails[0].body), w.mails[0] && w.mails[0].subject);
  check('preview: Gmail query excludes sent mail and job-alert senders', /-in:sent/.test(w.ctx._lastQuery) && /glassdoor\.com/.test(w.ctx._lastQuery) && /newer_than:14d/.test(w.ctx._lastQuery), w.ctx._lastQuery);
}

// ============ 2. REAL RUN ============
const w = makeWorld();
run(w, 'checkEmailNow');
const log = w.tab.log;
check('Brightly row 5: first response date written (whole-day serial)', Number.isInteger(cellAt(w, 5, COL.E)) && cellAt(w, 5, COL.E) > 40000, String(cellAt(w, 5, COL.E)));
check('Brightly row 5: Rejection, High, Fill', cellAt(w, 5, COL.F) === 'Rejection' && cellAt(w, 5, COL.G) === 'High' && cellAt(w, 5, COL.J) === 'Fill', [cellAt(w, 5, COL.F), cellAt(w, 5, COL.G), cellAt(w, 5, COL.J)].join('|'));
check('Brightly row 5: link formula points at the thread in the right Gmail account', /^=HYPERLINK\("https:\/\/mail\.google\.com\/mail\/\?authuser=me%40example\.com#all\/T0","Open email"\)$/.test((w.tab.cells['5,21'] || {}).f || ''), (w.tab.cells['5,21'] || {}).f);
check('Brightly row 5: note explains how it matched', /Matched by/.test(cellAt(w, 5, COL.K)) && /Detected:/.test(cellAt(w, 5, COL.K)), cellAt(w, 5, COL.K));
check('Tool Barn: requisition number sends the reply to row 6 (tracker row 3), not row 7', cellAt(w, 6, COL.F) === 'Rejection' && cellAt(w, 7, COL.F) === 'No email found', [cellAt(w, 6, COL.F), cellAt(w, 7, COL.F)].join('|'));
check('Tool Barn row 6: confidence High because the requisition matched', cellAt(w, 6, COL.G) === 'High', cellAt(w, 6, COL.G));
check('Approved Zentra row 8: NOT touched', log.every(x => x.r !== 8), JSON.stringify(log.filter(x => x.r === 8)));
check('YOUR DECISION (column L) is never written', log.every(x => x.c !== COL.L), JSON.stringify(log.filter(x => x.c === COL.L)));
check('Formula columns (I, M-T except P/Q, V) are never written', log.every(x => ![9, 13, 14, 15, 18, 19, 20, 22].includes(x.c)), JSON.stringify(log.filter(x => [9, 13, 14, 15, 18, 19, 20, 22].includes(x.c))));
check('Gamma row 9 (undecided, older reply): newer email recorded as latest email', cellAt(w, 9, COL.Q) === 'Next steps' && Number.isInteger(cellAt(w, 9, COL.P)), [cellAt(w, 9, COL.P), cellAt(w, 9, COL.Q)].join('|'));
check('Gamma row 9: original first response left alone', cellAt(w, 9, COL.F) === 'Rejection');
check('Brevity invite creates row 11 (tracker row 5) as Next steps, High, Fill', cellAt(w, 11, COL.A) === 5 && cellAt(w, 11, COL.F) === 'Next steps' && cellAt(w, 11, COL.G) === 'High' && cellAt(w, 11, COL.J) === 'Fill', [cellAt(w, 11, COL.A), cellAt(w, 11, COL.F), cellAt(w, 11, COL.G), cellAt(w, 11, COL.J)].join('|'));
check('Spark (only an automatic confirmation) is added as an automatic row 12', cellAt(w, 12, COL.A) === 10 && cellAt(w, 12, COL.F) === 'No email found', [cellAt(w, 12, COL.A), cellAt(w, 12, COL.F)].join('|'));
check('Auto-approved Kelvo row 10: a newer email changes NOTHING in the row', w.tab.log.every(x => x.r !== 10), JSON.stringify(w.tab.log.filter(x => x.r === 10)));
check('Writes to the Latest-email columns happen only on rows that still need you (row 9)', w.tab.log.filter(x => x.c === COL.P || x.c === COL.Q).every(x => x.r === 9), JSON.stringify(w.tab.log.filter(x => x.c === COL.P || x.c === COL.Q)));
check('Networking entry is not added as an application', Object.keys(w.tab.cells).every(k => !(k.endsWith(',1') && w.tab.cells[k].v === 7)));
check('my own message is ignored (Brightly row 5 date came from the Brightly email only)', w.mails.length === 1);
const body = w.mails[0].body;
check('summary subject separates auto-approved from needs-you', /2 auto-approved, 1 needs your decision/.test(w.mails[0].subject), w.mails[0].subject);
check('summary: Brightly and Tool Barn are listed as AUTO-APPROVED', /AUTO-APPROVED[\s\S]*Brightly[\s\S]*NEEDS YOUR DECISION/.test(body) && /AUTO-APPROVED[\s\S]*Tool Barn[\s\S]*NEEDS YOUR DECISION/.test(body), body.slice(0, 500));
check('summary: tells you how to undo an auto-approval', /pick any option in column L/i.test(body));
check('summary: Brevity invite is under NEEDS YOUR DECISION and marked next-steps', /NEEDS YOUR DECISION[^\n]*\n- Brevity[^\n]*next-steps email/.test(body), body);
check('summary: flags the newer Zentra email on a row you decided', /Zentra/.test(body) && /ALREADY DECIDED/.test(body) && /you chose: Approved/.test(body));
check('summary: flags the newer Kelvo email on the AUTO-APPROVED row, without changing it', /Kelvo[^\n]*auto-approved earlier/.test(body), body);
check('summary: lists the unmatched sender (Acme) instead of guessing', /Acme Staffing/.test(body) && /MATCHED NO APPLICATION/.test(body));
check('summary: lists the ambiguous Tool Barn email with both candidates', /COULD BE MORE THAN ONE/.test(body) && /Product Manager - Customer Order Management/.test(body));
check('summary: Glassdoor noise is not reported', !/Glassdoor/.test(body) && !/missed this/.test(body));
check('summary: LinkedIn job alert is not reported', !/similar to Product Manager at Brevity/.test(body));
check('summary: Spark automatic confirmation is not reported as a reply', !/Spark.*(Rejection|Next steps)/.test(body));
const memory = JSON.parse(w.props.email_check_reported || '[]');
check('memory holds only message IDs (no email text)', Array.isArray(memory) && memory.every(x => /^m\d+$/.test(x)) && memory.length >= 4, JSON.stringify(memory));

// ============ 3. SCHEDULED RUN right after: quiet and idempotent ============
const writesBefore = w.tab.log.length, mailsBefore = w.mails.length;
run(w, 'runEmailCheck');
check('2nd scheduled run: no duplicate rows or rewrites', w.tab.log.length === writesBefore, JSON.stringify(w.tab.log.slice(writesBefore)));
check('2nd scheduled run: stays quiet when there is nothing new', w.mails.length === mailsBefore, w.mails.slice(mailsBefore).map(m => m.subject).join(' / '));

// ============ 4. a failure is reported, not swallowed ============
{
  const w2 = makeWorld();
  w2.ctx.GmailApp.search = () => { throw new Error('Service invoked too many times'); };
  run(w2, 'runEmailCheck');
  check('failure: you get a [Needs attention] email', w2.mails.length === 1 && /\[Needs attention\]/.test(w2.mails[0].subject) && /too many times/.test(w2.mails[0].body), w2.mails[0] && w2.mails[0].subject);
  check('failure: nothing was written', w2.tab.log.length === 0);
}

// ============ 5. snapshot label + backlog count ============
{
  const w3 = makeWorld();
  const lab = (iso, installed) => { w3.ctx.weeklyScheduleCount_ = () => installed; return vm.runInContext('nextSnapshotLabel_(new Date("' + iso + '"))', w3.ctx); };
  check('label: Tuesday 10/13 -> Friday 10/16 around 5 PM (was wrongly "Tuesday 10/20")', lab('2026-10-13T16:00:00-04:00', 1) === 'Friday 10/16 around 5 PM', lab('2026-10-13T16:00:00-04:00', 1));
  check('label: Friday 9 AM -> same day', lab('2026-10-16T09:00:00-04:00', 1) === 'Friday 10/16 around 5 PM', lab('2026-10-16T09:00:00-04:00', 1));
  check('label: Friday 6 PM -> next Friday', lab('2026-10-16T18:00:00-04:00', 1) === 'Friday 10/23 around 5 PM', lab('2026-10-16T18:00:00-04:00', 1));
  check('label: not installed -> empty (email says it is not scheduled)', lab('2026-10-13T16:00:00-04:00', 0) === '');
}
console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
