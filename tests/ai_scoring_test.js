// Tests for AI_Scoring.gs. Run from the repository root: node tests/ai_scoring_test.js
// Uses a fake spreadsheet, fake job-board APIs and a fake Claude API: no network, no cost, no real data.
const fs = require('fs'), vm = require('vm'), crypto = require('crypto');
let pass = 0, fail = 0;
function check(name, cond, extra) { if (cond) pass++; else { fail++; console.log('FAIL: ' + name + (extra !== undefined ? '  -> ' + JSON.stringify(extra) : '')); } }

/* ---------------- mock spreadsheet ---------------- */
class Sheet {
  constructor(name) { this.name = name; this.cells = {}; this.hidden = new Set(); this.maxRows = 1000; this.validation = {}; }
  k(r, c) { return r + ',' + c; }
  get(r, c) { return this.cells[this.k(r, c)] || { v: '', f: '' }; }
  set(r, c, v, f) { this.cells[this.k(r, c)] = { v: v, f: f || '' }; }
  getLastRow() { let m = 0; for (const key in this.cells) { const [r] = key.split(',').map(Number); const x = this.cells[key]; if ((x.v !== '' && x.v != null) || x.f) m = Math.max(m, r); } return m; }
  getLastColumn() { let m = 0; for (const key in this.cells) { const [, c] = key.split(',').map(Number); const x = this.cells[key]; if ((x.v !== '' && x.v != null) || x.f) m = Math.max(m, c); } return m; }
  getMaxRows() { return this.maxRows; }
  insertRowsAfter(after, n) { this.maxRows += n; }
  getRange(r, c, nr, nc) { return new Range(this, r, c, nr || 1, nc || 1); }
  hideColumns(c, n) { for (let i = 0; i < n; i++) this.hidden.add(c + i); }
  showColumns(c, n) { for (let i = 0; i < n; i++) this.hidden.delete(c + i); }
  appendRow(vals) { const r = this.getLastRow() + 1; vals.forEach((v, i) => this.set(r, i + 1, v)); }
  setFrozenRows() {}
  getSheetId() { return this.gid; }
}
class Range {
  constructor(sh, r, c, nr, nc) { Object.assign(this, { sh, r, c, nr, nc }); }
  getValues() { const out = []; for (let i = 0; i < this.nr; i++) { const row = []; for (let j = 0; j < this.nc; j++) row.push(this.sh.get(this.r + i, this.c + j).v); out.push(row); } return out; }
  getValue() { return this.sh.get(this.r, this.c).v; }
  setValues(v) {
    v.forEach((row, i) => row.forEach((x, j) => {
      const val = this.sh.validation[this.k(i, j)];
      if (val && x !== '' && val.indexOf(String(x)) < 0) throw new Error('validation refused ' + x);
      this.sh.set(this.r + i, this.c + j, x);
    }));
  }
  k(i, j) { return (this.r + i) + ',' + (this.c + j); }
  setValue(x) { this.setValues([[x]]); }
  setFormula(f) { this.sh.set(this.r, this.c, '(formula)', f); }
  getFormulas() { return this.getValues().map((row, i) => row.map((_, j) => this.sh.get(this.r + i, this.c + j).f)); }
  clearDataValidations() { for (let i = 0; i < this.nr; i++) for (let j = 0; j < this.nc; j++) delete this.sh.validation[this.k(i, j)]; }
  copyTo(dest, type) {
    if (type === 'VALIDATION') for (let j = 0; j < this.nc; j++) { const v = this.sh.validation[this.r + ',' + (this.c + j)]; if (v) dest.sh.validation[dest.r + ',' + (dest.c + j)] = v; }
  }
  setFontWeight() { return this; }
}
class SS {
  constructor() { this.sheets = {}; }
  getSheetByName(n) { return this.sheets[n] || null; }
  insertSheet(n) { this.sheets[n] = new Sheet(n); this.sheets[n].gid = 1000 + Object.keys(this.sheets).length; return this.sheets[n]; }
  getUrl() { return 'https://docs.google.com/spreadsheets/d/TEST/edit'; }
  toast(m) { this.toasts = (this.toasts || []).concat(m); }
}

/* ---------------- fixture data ---------------- */
const PROFILE = [
  ['Candidate profile (input for Phase 3 AI fit-scoring, built from your resume)'],
  ['Strengths (product): drove a consumer technology platform 0-to-1 across iOS, Android, web and connected TV.'],
  ['Gaps to weigh: no fintech; no ML research.'],
  ['Rules-compliance Score (Open Roles column N): produced by the script.'],
  [''],
  ['AI fit-scoring rubric (version 2, approved 10/15/2026; version 1 ran 10/14-10/15)'],
  ['Claude scores each posting in Open Roles; you decide.'],
  ['AI scoring live from (decisions made before this date are not measured)', '10/14/2026'],
  ['Overall AI Fit Score (1-5): ... Gate 5 (skills): Skills evidence 1 = overall at most 2.'],
  ['1. Scope match. ...', '25%'], ['2. Skills evidence. ...', '20%'], ['3. Level reachability. ...', 0.15],
  ['4. Technical depth gap ...', '10%'], ['5. Career trajectory. ...', '15%'], ['6. Innovation and passion. ...', '15%'],
  ['Evidence rule: no numeric score without reading the posting text.'],
  ['Suggested Action (Open Roles column AB) combines the rules Recommendation (column Q) with the AI Fit Score:']
];
const OPEN_HEAD = ['Date Found', 'Company', 'Title', 'Link', 'AI Fit Score (1-5)', 'AI Rationale and Top Concern', 'Suggested Action',
  'YOUR FINAL DECISION', 'AI Dimension Scores', 'AI Confidence', 'AI Rubric Version'];
const SCAN_HEAD = ['Date First Seen', 'Company', 'Title', 'Link', 'Req / Job ID', 'Found Via', 'Date Posted (employer)', 'Verified At', 'Reposted?',
  'Location', 'Role', 'Tier', 'Age When Seen (days)', 'Routing (system)', 'Reason'];
const EVAL_HEAD = ['#', 'Company', 'Title', 'Posting', 'Posting still open?', 'YOUR FIT (1-5)', 'Main reason for your rating', 'Notes (optional)',
  'Scan Log row', 'Rules: Role', 'Rules: Tier', 'Rules: age when seen (days)', 'Rules: routing', 'Rules: reason',
  'AI Fit Score (1-5)', 'AI Dimension Scores', 'AI Rationale and Top Concern', 'AI Confidence', 'AI scored on'];

const NOW = new Date('2026-10-19T14:00:00Z');
const day = (n) => new Date(NOW.getTime() - n * 86400000);
const uuid = (i) => ('00000000-0000-0000-0000-' + String(i).padStart(12, '0'));
const LONG = 'Responsibilities: lead cross-functional programs with product and engineering. '.repeat(20);

function buildWorld(opts) {
  opts = opts || {};
  const ss = new SS();
  const crit = ss.insertSheet('Criteria'); PROFILE.forEach((r, i) => { crit.set(i + 1, 1, r[0]); if (r[1] !== undefined) crit.set(i + 1, 2, r[1]); });
  const open = ss.insertSheet('Open Roles'); OPEN_HEAD.forEach((h, i) => open.set(5, i + 1, h));
  const orows = opts.openRows || [
    ['10/16', 'Acme', 'Program Manager', 'https://job-boards.greenhouse.io/acme/jobs/111', '', '', '', '', '', '', ''],
    ['10/16', 'Decided Co', 'TPM', 'https://job-boards.greenhouse.io/dec/jobs/222', '', '', '', 'Skipped', '', '', ''],
    ['10/16', 'Scored Co', 'PM', 'https://job-boards.greenhouse.io/sc/jobs/333', 4, 'old', '', '', '', '', ''],
    ['10/16', 'Workday Co', 'Program Manager', 'https://wd5.myworkdayjobs.com/x/job/1', '', '', '', 'Pending Decision', '', '', '']
  ];
  orows.forEach((r, i) => r.forEach((v, j) => open.set(6 + i, j + 1, v)));
  const scan = ss.insertSheet('Scan Log'); SCAN_HEAD.forEach((h, i) => scan.set(4, i + 1, h));
  const srows = opts.scanRows || defaultScanRows();
  srows.forEach((r, i) => { const row = 5 + i; [r.date, r.company, r.title, r.link, '', '', '', '', '', '', 'Role', r.tier, 3, r.routing, 'reason'].forEach((v, j) => scan.set(row, j + 1, v)); });
  const ev = ss.insertSheet('AI Eval Set'); EVAL_HEAD.forEach((h, i) => ev.set(5, i + 1, h));
  ev.set(6, 1, '1'); ev.set(6, 2, 'Anthropic'); ev.set(6, 3, 'Old'); ev.set(6, 6, 3); ev.set(6, 9, 5);
  ev.validation['6,5'] = ['Yes', 'No']; ev.validation['6,6'] = ['5', '4', '3', '2', '1']; ev.validation['6,7'] = ['Skills match', 'Level reachability'];
  ev.set(30, 1, 'Alt 3'); ev.set(30, 9, 6);
  return ss;
}
function defaultScanRows() {
  const rows = [];
  // Tier 1-2: Anthropic 6, OpenAI 3, Gamma 2, Delta 1 -> 12 ; Tier 3/Other: 8
  const top = [['Anthropic', 6], ['Security TPM', 3], ['Gamma', 2], ['Delta', 1]];
  let i = 0;
  top.forEach(([co, n]) => { for (let k = 0; k < n; k++) { i++; rows.push({ date: day(2), company: co, title: co + ' Program Manager ' + k, link: 'https://jobs.ashbyhq.com/' + co.toLowerCase() + '/' + uuid(i), tier: k % 2 ? 'Tier 2' : 'Tier 1', routing: 'Skipped' }); } });
  for (let k = 0; k < 8; k++) { i++; rows.push({ date: day(3), company: 'Other' + (k % 4), title: 'Ops role ' + k, link: 'https://jobs.lever.co/other' + (k % 4) + '/' + uuid(i), tier: k % 2 ? 'Tier 3' : 'Other', routing: 'Watch' }); }
  // Excluded: old, passed to Open Roles, non-ATS, already in eval (row 5 = first Anthropic? no: eval row 6 points to scan row 5)
  rows.push({ date: day(20), company: 'Old Co', title: 'PM', link: 'https://jobs.ashbyhq.com/old/' + uuid(90), tier: 'Tier 1', routing: 'Skipped' });
  rows.push({ date: day(1), company: 'Passed Co', title: 'PM', link: 'https://jobs.ashbyhq.com/passed/' + uuid(91), tier: 'Tier 1', routing: 'Open Roles' });
  rows.push({ date: day(1), company: 'Workday Inc', title: 'PM', link: 'https://wd1.myworkdayjobs.com/x/1', tier: 'Tier 1', routing: 'Skipped' });
  return rows;
}

/* ---------------- mock services ---------------- */
function makeEnv(ss, fetchRouter) {
  const props = {}, mails = [], apiCalls = [], triggers = [], apiHeaders = [];
  const env = {
    __params: [],
    SpreadsheetApp: { getActive: () => ss, getUi: () => { throw new Error('no UI'); }, CopyPasteType: { PASTE_FORMAT: 'FORMAT', PASTE_DATA_VALIDATION: 'VALIDATION' } },
    PropertiesService: { getScriptProperties: () => ({ getProperty: k => (k in props ? props[k] : null), setProperty: (k, v) => { props[k] = String(v); }, deleteProperty: k => { delete props[k]; } }) },
    UrlFetchApp: { fetch: (url, params) => { if (url.indexOf('api.anthropic.com') >= 0) { apiCalls.push(JSON.parse(params.payload)); apiHeaders.push(params.headers); } return fetchRouter(url, params); } },
    Utilities: {
      computeDigest: (alg, s) => Array.from(crypto.createHash('sha256').update(s, 'utf8').digest()).map(b => (b > 127 ? b - 256 : b)),
      DigestAlgorithm: { SHA_256: 'sha256' }, Charset: { UTF_8: 'utf8' }, sleep: () => {},
      formatDate: (d, tz, p) => {
        const Y = d.getFullYear(), M = d.getMonth() + 1, D = d.getDate();
        if (p === 'yyyyMMdd') return '' + Y + String(M).padStart(2, '0') + String(D).padStart(2, '0');
        if (p === 'yyyy-MM') return Y + '-' + String(M).padStart(2, '0');
        if (p === 'M/d/yyyy') return M + '/' + D + '/' + Y;
        return M + '/' + D + '/' + Y + ' 10:00 AM';
      }
    },
    Session: { getScriptTimeZone: () => 'America/New_York', getEffectiveUser: () => ({ getEmail: () => 'me@example.com' }) },
    MailApp: { sendEmail: (to, subj, body, opt) => mails.push({ to, subj, body, html: opt && opt.htmlBody }) },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock: () => {} }) },
    ScriptApp: {
      getProjectTriggers: () => triggers.slice(), deleteTrigger: t => triggers.splice(triggers.indexOf(t), 1),
      WeekDay: { MONDAY: 'MON', WEDNESDAY: 'WED', FRIDAY: 'FRI' },
      newTrigger: fn => { const t = { getHandlerFunction: () => fn }; const chain = { timeBased: () => chain, onWeekDay: () => chain, atHour: () => chain, forSpreadsheet: () => chain, onOpen: () => chain, create: () => { triggers.push(t); return t; } }; return chain; }
    },
    Logger: { log: () => {} },
    console, JSON, Math, Date: class extends Date { constructor(...a) { if (a.length) super(...a); else super(NOW.getTime()); } static now() { return NOW.getTime(); } },
    encodeURIComponent, String, Number, Array, Object, RegExp, Error
  };
  env.Date.prototype = Date.prototype;
  vm.createContext(env);
  const path = require('path');
  const gsPath = [path.join(__dirname, 'AI_Scoring.gs'), path.join(__dirname, '..', 'apps-script', 'AI_Scoring.gs')].find(p => fs.existsSync(p));
  vm.runInContext(fs.readFileSync(gsPath, 'utf8'), env);
  return { env, props, mails, apiCalls, triggers, apiHeaders };
}

// default router: postings OK, Claude returns given dims
function router(dimsFor, opts) {
  opts = opts || {};
  let apiCount = 0;
  return (url) => {
    const res = (code, obj) => ({ getResponseCode: () => code, getContentText: () => (typeof obj === 'string' ? obj : JSON.stringify(obj)) });
    if (url.indexOf('api.anthropic.com') >= 0) {
      apiCount++;
      if (opts.api && opts.api(apiCount)) return opts.api(apiCount);
      const d = dimsFor(apiCount);
      const input = { years_asked: '5+', top_concern: 'level', confidence: 'High', confidence_reason: 'full posting' };
      ['scope', 'skills', 'level', 'depth', 'trajectory', 'passion'].forEach((k, i) => { input[k] = d[i]; input[k + '_reason'] = 'because ' + k; });
      return res(200, { content: [{ type: 'tool_use', name: 'record_fit_score', input }], usage: { input_tokens: 5000, output_tokens: 600 } });
    }
    if (url.indexOf('boards-api.greenhouse.io') >= 0) return res(200, { title: 'x', content: '&lt;p&gt;' + LONG + '&lt;/p&gt;&lt;ul&gt;&lt;li&gt;Jira &amp;amp; Agile&lt;/li&gt;&lt;/ul&gt;' });
    if (url.indexOf('api.lever.co') >= 0) return res(200, { descriptionPlain: LONG, lists: [{ text: 'Requirements', content: '<li>3+ years</li>' }], additionalPlain: '' });
    if (url.indexOf('api.ashbyhq.com') >= 0) {
      const board = url.split('/').pop();
      const ids = []; for (let i = 1; i <= 100; i++) ids.push(uuid(i));
      if (opts.closedBoards && opts.closedBoards.includes(board)) return res(200, { jobs: [] });
      return res(200, { jobs: ids.map(id => ({ id, descriptionPlain: LONG })) });
    }
    return res(404, 'not found');
  };
}
const K = (p) => ({ ANTHROPIC_API_KEY: 'sk-test-abcd1234', ...p });

/* ================== 1. scoring math ================== */
{
  const { env } = makeEnv(buildWorld(), router(() => [3, 3, 3, 3, 3, 3]));
  const w = { scope: .25, skills: .20, level: .15, depth: .10, trajectory: .15, passion: .15 };
  const cases = [
    ['Cloud TPM', [4, 2, 4, 2, 4, 4], 2], ['Fintech card PM', [4, 1, 3, 4, 4, 3], 2], ['SaaS product ops', [5, 4, 3, 5, 5, 4], 4], ['Creator project mgr', [5, 5, 4, 5, 2, 3], 4],
    ['Security TPM', [3, 2, 3, 1, 3, 4], 2], ['AI research PM', [4, 4, 3, 4, 3, 5], 4], ['Marketing ops PgM', [4, 3, 1, 5, 2, 2], 2], ['CS ops project mgr', [3, 3, 5, 4, 2, 2], 3],
    ['Scope 1 gate', [1, 3, 3, 3, 3, 3], 1], ['Exactly .5 rounds up', [4, 4, 4, 4, 2, 3], 4]
  ];
  cases.forEach(([n, a, want]) => {
    const d = {}; ['scope', 'skills', 'level', 'depth', 'trajectory', 'passion'].forEach((k, i) => d[k] = a[i]);
    const r = env.aisComputeOverall_(d, w);
    check('overall ' + n, r.overall === want, { got: r.overall, weighted: r.weighted });
  });
  const d = { scope: 4, skills: 2, level: 4, depth: 2, trajectory: 4, passion: 4 };
  check('dims text shows gate', env.aisDimsText_(d, env.aisComputeOverall_(d, w)) === 'Scope 4, Skills 2, Level 4, Depth 2, Trajectory 4, Passion 4 | weighted 3.40, gated at 2 (Gate 4)');
}

/* ================== 2. criteria parsing ================== */
{
  const { env } = makeEnv(buildWorld(), router(() => [3, 3, 3, 3, 3, 3]));
  const ctx = env.aisContext_();
  check('version parsed', ctx.version === 'v2', ctx.version);
  check('weights parsed (text % and number)', ctx.weights.scope === 0.25 && ctx.weights.level === 0.15, ctx.weights);
  check('profile includes gaps, stops before rules score', /Gaps to weigh/.test(ctx.profile) && !/Rules-compliance/.test(ctx.profile));
  check('rubric excludes suggested action + live-from row', !/Suggested Action/.test(ctx.rubric) && !/live from/.test(ctx.rubric) && /Evidence rule/.test(ctx.rubric));
  const bad = buildWorld(); bad.getSheetByName('Criteria').set(14, 2, '30%');
  const e2 = makeEnv(bad, router(() => [3, 3, 3, 3, 3, 3]));
  let msg = ''; try { e2.env.aisContext_(); } catch (e) { msg = e.message; }
  check('weights not summing to 100% is caught', /add up to 115%/.test(msg), msg);
}

/* ================== 3. ATS parsing and text ================== */
{
  const { env } = makeEnv(buildWorld(), router(() => [3, 3, 3, 3, 3, 3]));
  check('greenhouse new', env.aisParseAts_('https://job-boards.greenhouse.io/examplestudio/jobs/6098242004').id === '6098242004');
  check('greenhouse old', env.aisParseAts_('https://boards.greenhouse.io/examplecorp/jobs/6186168004').board === 'examplecorp');
  check('lever', env.aisParseAts_('https://jobs.lever.co/example-lab/9abe93df-26a3-4bd4-9253-d2ef9b011d51').system === 'lever');
  check('ashby', env.aisParseAts_('https://jobs.ashbyhq.com/examplepay/3139d69b-43a2-4dbd-811b-81b300bd8cef').board === 'examplepay');
  check('unsupported', env.aisParseAts_('https://careers.example.com/job/7603861-technical-project-manager') === null);
  const t = env.aisHtmlToText_('&lt;p&gt;Hello &amp;amp; welcome&lt;/p&gt;&lt;ul&gt;&lt;li&gt;Jira&lt;/li&gt;&lt;/ul&gt;');
  check('greenhouse double-escaped html to text', t === 'Hello & welcome\n\n- Jira', t);
}

/* ================== 4. Open Roles scoring ================== */
{
  const ss = buildWorld();
  const w = makeEnv(ss, router(() => [4, 2, 4, 2, 4, 4]));
  Object.assign(w.props, K());
  w.env.aiScheduledScore();
  const o = ss.getSheetByName('Open Roles');
  check('one API call (only the undecided, unscored, readable role)', w.apiCalls.length === 1, w.apiCalls.length);
  check('score written, gated at 2', o.get(6, 5).v === 2, o.get(6, 5).v);
  check('rationale written', /^AI judgment \(rubric v2, API\)\. Scope 4: because scope\./.test(o.get(6, 6).v) && /Gate 4/.test(o.get(6, 6).v), o.get(6, 6).v);
  check('dims, confidence, version written', /gated at 2/.test(o.get(6, 9).v) && o.get(6, 10).v === 'High' && /^v2 .* \(API, claude-sonnet-5-5\)$/.test(o.get(6, 11).v), [o.get(6, 9).v, o.get(6, 11).v]);
  check('decided role untouched', o.get(7, 5).v === '');
  check('already-scored role untouched', o.get(8, 5).v === 4 && o.get(8, 6).v === 'old');
  check('unreadable posting marked, no score', /^Not scored: posting text unavailable \(not a Greenhouse, Lever or Ashby link\)/.test(o.get(9, 6).v) && o.get(9, 5).v === '');
  const p = w.apiCalls[0];
  check('prompt offers the tool without forcing it (auto) and names the model', p.model === 'claude-sonnet-5-5' && p.tool_choice.type === 'auto' && p.tools[0].name === 'record_fit_score' && /calling the record_fit_score tool exactly once/.test(p.messages[0].content), p.tool_choice);
  check('prompt carries profile, rubric, injection warning', /Gaps to weigh/.test(p.system) && /Gate 5/.test(p.system) && /untrusted data/.test(p.system));
  check('prompt contains posting text (decoded)', /Jira & Agile/.test(p.messages[0].content));
  check('prompt never contains her ratings', !/YOUR FIT|Main reason for your rating/.test(JSON.stringify(p)));
  check('summary email sent', w.mails.length === 1 && /Acme - Program Manager: AI score 2 \(High confidence\)/.test(w.mails[0].body), w.mails[0] && w.mails[0].body);
  check('scoring email: subject asks for your decision', w.mails[0].subj === 'Job Search AI: 1 new AI score ready for your decision', w.mails[0].subj);
  check('scoring email: ready-for-review wording', /^AI scores are ready for your review\. Please make your decisions at your convenience\./.test(w.mails[0].body));
  const orGid = ss.getSheetByName('Open Roles').getSheetId();
  check('scoring email: clickable link to the Open Roles tab', w.mails[0].html.indexOf('<a href="https://docs.google.com/spreadsheets/d/TEST/edit#gid=' + orGid + '"') >= 0 && /Open the Open Roles tab/.test(w.mails[0].html), w.mails[0].html);
  check('scoring email: unreadable role listed separately', /Could not be scored, posting text unavailable/.test(w.mails[0].body));
  const log = ss.getSheetByName('AI Score Log');
  check('log row with cost and snapshot', log && log.get(2, 2).v === 'Open Roles' && log.get(2, 11).v === 0.016 && log.get(2, 14).v.length > 500, log && [log.get(2, 11).v]);
  check('spend tracked', Math.abs(Number(w.props['AIS_SPEND_2026-10']) - 0.016) < 1e-9);
  // second run: nothing new to score, no API call, no email (the unreadable role is reported once only)
  w.env.aiScheduledScore();
  check('second run makes no calls', w.apiCalls.length === 1);
  check('second run sends no email', w.mails.length === 1, w.mails.length);
  w.env.aiScoreOpenRolesNow();
  const logged = w.props['AIS_LAST_RUN'] || '';
  check('menu run explains the decided-but-unscored role', /Nothing new to score/.test(logged), logged);
}

{
  const ss = buildWorld({ openRows: [['x', 'Wrapbook', 'Sr PM II', 'https://jobs.ashbyhq.com/wrapbook/' + uuid(5), '', '', '', 'Skipped', '', '', '']] });
  const w = makeEnv(ss, router(() => [3, 3, 3, 3, 3, 3])); Object.assign(w.props, K());
  let shown = ''; w.env.SpreadsheetApp.getUi = () => ({ alert: (t, m) => { shown = m; }, ButtonSet: { OK: 1 } });
  w.env.aiScoreOpenRolesNow();
  check('decided-before-score role is explained, not silent', /Left unscored on purpose: 1 role you decided before an AI score existed/.test(shown) && w.apiCalls.length === 0, shown);
}

/* ================== 5. API failures and budget ================== */
{
  const ss = buildWorld({ openRows: [
    ['x', 'A', 'PM', 'https://job-boards.greenhouse.io/a/jobs/1', '', '', '', '', '', '', ''],
    ['x', 'B', 'PM', 'https://job-boards.greenhouse.io/b/jobs/2', '', '', '', '', '', '', '']] });
  const w = makeEnv(ss, router(() => [3, 3, 3, 3, 3, 3], { api: () => ({ getResponseCode: () => 401, getContentText: () => '{"error":{"message":"invalid x-api-key"}}' }) }));
  Object.assign(w.props, K());
  w.env.aiScheduledScore();
  check('401 stops the run after one call', w.apiCalls.length === 1 && /STOPPED: API 401: The API key was rejected/.test(w.mails[0].body), w.mails[0] && w.mails[0].body);

  const ss2 = buildWorld({ openRows: [['x', 'A', 'PM', 'https://job-boards.greenhouse.io/a/jobs/1', '', '', '', '', '', '', '']] });
  const w2 = makeEnv(ss2, router(() => [4, 4, 4, 4, 4, 4], { api: n => (n === 1 ? { getResponseCode: () => 529, getContentText: () => '{"error":{"message":"overloaded"}}' } : null) }));
  Object.assign(w2.props, K());
  w2.env.aiScheduledScore();
  check('529 retried once then succeeds', w2.apiCalls.length === 2 && ss2.getSheetByName('Open Roles').get(6, 5).v === 4);

  const w3 = makeEnv(buildWorld(), router(() => [4, 4, 4, 4, 4, 4], { api: () => ({ getResponseCode: () => 400, getContentText: () => '{"error":{"message":"Your credit balance is too low to access the Anthropic API."}}' }) }));
  Object.assign(w3.props, K());
  w3.env.aiScheduledScore();
  check('out of credit is reported plainly', /Out of API credit/.test(w3.mails[0].body), w3.mails[0].body);

  const w4 = makeEnv(buildWorld(), router(() => [4, 4, 4, 4, 4, 4]));
  Object.assign(w4.props, K({ 'AIS_SPEND_2026-10': '5.01' }));
  w4.env.aiScheduledScore();
  check('budget reached: no API call', w4.apiCalls.length === 0 && /Monthly AI budget/.test(w4.mails[0].body));

  const w5 = makeEnv(buildWorld(), router(() => [4, 4, 4, 4, 4, 4]));
  w5.env.aiScheduledScore();
  check('missing key: clear message, no call', w5.apiCalls.length === 0 && /No API key found/.test(w5.mails[0].body), w5.mails[0] && w5.mails[0].body);
}

/* ================== 5b. Workspace-scoped key ================== */
{
  const ss = buildWorld({ openRows: [
    ['x', 'A', 'PM', 'https://job-boards.greenhouse.io/a/jobs/1', '', '', '', '', '', '', ''],
    ['x', 'B', 'PM', 'https://job-boards.greenhouse.io/b/jobs/2', '', '', '', '', '', '', '']] });
  const msg = 'This API key is not scoped to a workspace, so this request must include the anthropic-workspace-id header with the ID of the workspace to use.';
  const w = makeEnv(ss, router(() => [3, 3, 3, 3, 3, 3], { api: () => ({ getResponseCode: () => 400, getContentText: () => JSON.stringify({ error: { message: msg } }) }) }));
  Object.assign(w.props, K());
  w.env.aiScheduledScore();
  check('workspace error stops after one call (no repeat per role)', w.apiCalls.length === 1, w.apiCalls.length);
  check('workspace error explained plainly', /STOPPED: API 400: The API key is not tied to a workspace/.test(w.mails[0].body), w.mails[0].body);
  check('no workspace header unless set', !('anthropic-workspace-id' in w.apiHeaders[0]));
  const w2 = makeEnv(buildWorld(), router(() => [4, 4, 4, 4, 4, 4]));
  Object.assign(w2.props, K({ ANTHROPIC_WORKSPACE_ID: ' wrkspc_123 ' }));
  w2.env.aiScheduledScore();
  check('workspace header sent when the property is set', w2.apiHeaders[0]['anthropic-workspace-id'] === 'wrkspc_123', w2.apiHeaders[0]);
}

/* ================== 5c. Today's failure: unsupported tool_choice, breaker, text fallback ================== */
{
  const bad = { getResponseCode: () => 400, getContentText: () => JSON.stringify({ error: { message: 'tool_choice: type "tool" and "any" are not supported for this model.' } }) };
  const ss = buildWorld();
  const w = makeEnv(ss, router(() => [3, 3, 3, 3, 3, 3], { api: () => bad }));
  Object.assign(w.props, K());
  w.env.aiScheduledDraw();
  check('batch draw stops after 3 identical errors (not 170)', w.apiCalls.length === 3, w.apiCalls.length);
  check('stop is explained once, plainly', /Stopped after the same error 3 times in a row/.test(w.mails[0].body) && (w.mails[0].body.match(/^Error:/gm) || []).length === 3, w.mails[0].body);
  check('no-batch message says nothing was charged and how to retry', /Nothing was charged for failed requests/.test(w.mails[0].body) && /Draw this week's blind batch now/.test(w.mails[0].body));
  check('no batch written, nothing sealed', w.env.aisFindBatches_(ss.getSheetByName('AI Eval Set')).length === 0 && !Object.keys(w.props).some(k => /^AIS_SEAL_/.test(k)));
  check('last-draw date not advanced, so the retry sees the same postings', !w.props['AIS_LAST_DRAW']);

  const ss2 = buildWorld({ openRows: [1, 2, 3, 4, 5].map(i => ['x', 'Co' + i, 'PM', 'https://job-boards.greenhouse.io/c' + i + '/jobs/' + i, '', '', '', '', '', '', '']) });
  const w2 = makeEnv(ss2, router(() => [3, 3, 3, 3, 3, 3], { api: () => bad }));
  Object.assign(w2.props, K());
  w2.env.aiScheduledScore();
  check('Open Roles scoring also stops after 3 identical errors', w2.apiCalls.length === 3, w2.apiCalls.length);

  // different errors do not trip the breaker; a success resets it
  let n = 0;
  const flaky = (k) => { n++; return (k % 2 === 1) ? { getResponseCode: () => 400, getContentText: () => JSON.stringify({ error: { message: 'odd error ' + k } }) } : null; };
  const ss3 = buildWorld({ openRows: [1, 2, 3, 4, 5].map(i => ['x', 'Co' + i, 'PM', 'https://job-boards.greenhouse.io/c' + i + '/jobs/' + i, '', '', '', '', '', '', '']) });
  const w3 = makeEnv(ss3, router(() => [4, 4, 4, 4, 4, 4], { api: flaky }));
  Object.assign(w3.props, K());
  w3.env.aiScheduledScore();
  check('varied or intermittent errors do not stop the run', w3.apiCalls.length === 5, w3.apiCalls.length);

  // model answers in text with JSON instead of calling the tool
  const ss4 = buildWorld({ openRows: [['x', 'TextCo', 'PM', 'https://job-boards.greenhouse.io/t/jobs/9', '', '', '', '', '', '', '']] });
  const json = { scope: 5, scope_reason: 'r', skills: 4, skills_reason: 'r', level: 3, level_reason: 'r', depth: 5, depth_reason: 'r', trajectory: 5, trajectory_reason: 'r', passion: 4, passion_reason: 'r', years_asked: '5+', top_concern: 'level', confidence: 'High', confidence_reason: 'full posting' };
  const textAns = { getResponseCode: () => 200, getContentText: () => JSON.stringify({ content: [{ type: 'text', text: 'Here are the scores:\n```json\n' + JSON.stringify(json) + '\n```' }], usage: { input_tokens: 5000, output_tokens: 600 } }) };
  const w4 = makeEnv(ss4, router(() => [1, 1, 1, 1, 1, 1], { api: () => textAns }));
  Object.assign(w4.props, K());
  w4.env.aiScheduledScore();
  check('text-with-JSON answer is still scored correctly', ss4.getSheetByName('Open Roles').get(6, 5).v === 4, ss4.getSheetByName('Open Roles').get(6, 5).v);
}

/* ================== 6. Blind batch draw ================== */
let batchWorld;
{
  const ss = buildWorld();
  const w = makeEnv(ss, router(n => [((n * 7) % 5) + 1, 3, 4, 3, 4, 4], {}));
  Object.assign(w.props, K());
  w.env.aiScheduledDraw();
  const ev = ss.getSheetByName('AI Eval Set');
  const batches = w.env.aisFindBatches_(ev);
  check('one batch created', batches.length === 1 && batches[0].n === 1 && batches[0].sealed, batches);
  const rows = batches[0].rows;
  check('10 postings', rows.length === 10, rows.length);
  const cos = rows.map(r => ev.get(r.row, 2).v), tiers = rows.map(r => ss.getSheetByName('Scan Log').get(ev.get(r.row, 9).v, 12).v);
  const per = {}; cos.forEach(c => per[c] = (per[c] || 0) + 1);
  check('max 2 per company', Math.max(...Object.values(per)) <= 2, per);
  check('batch spans at least 5 companies', Object.keys(per).length >= 5, per);
  check('7 Tier 1-2 and 3 others', tiers.filter(t => t === 'Tier 1' || t === 'Tier 2').length === 7, tiers);
  check('excluded old / passed / non-ATS / already-in-eval', !cos.some(c => ['Old Co', 'Passed Co', 'Workday Inc'].includes(c)) && !rows.some(r => ev.get(r.row, 9).v === 5 || ev.get(r.row, 9).v === 6));
  const r0 = rows[0].row;
  check('score column is sealed, no number', /^SEALED \(fingerprint [0-9a-f]{10}\)$/.test(ev.get(r0, 15).v), ev.get(r0, 15).v);
  check('dims, rationale, confidence empty while sealed', rows.every(r => ev.get(r.row, 16).v === '' && ev.get(r.row, 17).v === '' && ev.get(r.row, 18).v === ''));
  check('sealed scores stored in script properties', rows.every(r => !!w.props['AIS_SEAL_' + ev.get(r.row, 1).v]));
  check('your rating cells empty, dropdowns copied', ev.get(r0, 6).v === '' && ev.validation[r0 + ',6'] && ev.validation[r0 + ',5']);
  check('posting link formula and rules formulas', /^=HYPERLINK\("https:\/\//.test(ev.get(r0, 4).f) && /INDEX\('Scan Log'!\$N\$1:\$N\$5000/.test(ev.get(r0, 13).f), ev.get(r0, 13).f);
  check('rules and AI columns hidden', [9, 10, 13, 15, 19].every(c => ev.hidden.has(c)));
  check('email has no scores', w.mails.length === 1 && !/[Ss]core[sd]?:? [1-5]\b/.test(w.mails[0].body.replace(/Scored: \d+/, '')) && /Blind batch 1 is ready for your input\. Please rate the 10 postings at your convenience\./.test(w.mails[0].body), w.mails[0].body);
  check('batch email: subject asks for ratings', w.mails[0].subj === 'Job Search AI: blind batch 1 is ready for your ratings', w.mails[0].subj);
  check('batch email: clickable link to the AI Eval Set tab', w.mails[0].html.indexOf('#gid=' + ev.getSheetId() + '"') >= 0 && /Open the AI Eval Set tab/.test(w.mails[0].html), w.mails[0].html);
  check('batch log rows say SEALED', ss.getSheetByName('AI Score Log').get(2, 12).v.indexOf('SEALED') === 0);
  check('10 API calls for 10 postings', w.apiCalls.length === 10, w.apiCalls.length);
  check('no batch prompt contains ratings', w.apiCalls.every(p => !/YOUR FIT/.test(JSON.stringify(p))));

  // determinism: same day + same data -> same draw
  const ss2 = buildWorld(); const w2 = makeEnv(ss2, router(() => [3, 3, 3, 3, 3, 3], {}));
  Object.assign(w2.props, K()); w2.env.aiScheduledDraw();
  const ev2 = ss2.getSheetByName('AI Eval Set');
  check('same seed reproduces the draw', w2.env.aisFindBatches_(ev2)[0].rows.map(r => ev2.get(r.row, 3).v).join('|') === rows.map(r => ev.get(r.row, 3).v).join('|'));

  // second draw while sealed: no calls
  w.env.aiScheduledDraw();
  check('no new batch while sealed', w.apiCalls.length === 10 && w.env.aisFindBatches_(ev).length === 1 && /still waiting for your ratings/.test(w.mails[1].body) && w.mails[1].subj === 'Job Search AI: reminder, blind batch 1 is waiting for your ratings');
  batchWorld = { ss, w, ev, rows };
}

/* ================== 7. Reveal ================== */
{
  const { ss, w, ev, rows } = batchWorld;
  ev.set(rows[0].row, 6, 4);
  w.env.aiRevealBatch();
  check('reveal refused while ratings missing', /^SEALED/.test(ev.get(rows[0].row, 15).v) && !!w.props['AIS_SEAL_' + ev.get(rows[0].row, 1).v]);
  rows.forEach((r, i) => { if (i === 9) ev.set(r.row, 5, 'No'); else { ev.set(r.row, 5, 'Yes'); ev.set(r.row, 6, (i % 5) + 1); } });
  // tamper with one sealed record
  const tk = 'AIS_SEAL_' + ev.get(rows[1].row, 1).v; const rec = JSON.parse(w.props[tk]); rec.overall = 5; w.props[tk] = JSON.stringify(rec);
  const expected = rows.map(r => JSON.parse(w.props['AIS_SEAL_' + ev.get(r.row, 1).v]).overall);
  w.env.aiRevealBatch();
  check('scores revealed as numbers', rows.every((r, i) => ev.get(r.row, 15).v === expected[i]), rows.map(r => ev.get(r.row, 15).v));
  check('dims and rationale revealed', /weighted/.test(ev.get(rows[0].row, 16).v) && /^AI judgment/.test(ev.get(rows[0].row, 17).v));
  check('untouched rows verified', /fingerprint verified/.test(ev.get(rows[0].row, 19).v));
  check('tampered row flagged', /FINGERPRINT MISMATCH/.test(ev.get(rows[1].row, 19).v), ev.get(rows[1].row, 19).v);
  check('sealed properties deleted', rows.every(r => !w.props['AIS_SEAL_' + ev.get(r.row, 1).v]));
  const h = w.env.aisFindBatches_(ev)[0];
  check('batch marked revealed', !h.sealed && /^REVEALED/.test(ev.get(h.headerRow, 3).v));
  const pairs = rows.slice(0, 9).map((r, i) => ({ ai: expected[i], you: (i % 5) + 1 }));
  const within = pairs.filter(p => Math.abs(p.ai - p.you) <= 1).length;
  check('stats exclude the closed posting', ev.get(h.headerRow, 4).v === 'Within one point: ' + within + ' of 9 (' + Math.round(within / 9 * 100) + '%), target 80%+', ev.get(h.headerRow, 4).v);
  check('ratings recorded at reveal', ev.get(h.headerRow, 9).v === 'Ratings at reveal: 1,2,3,4,5,1,2,3,4,', ev.get(h.headerRow, 9).v);
  check('tamper-check formula on header', /TEXTJOIN\(",",FALSE,F\d+:F\d+\)=SUBSTITUTE\(I\d+/.test(ev.get(h.headerRow, 8).f), ev.get(h.headerRow, 8).f);
  check('AI columns shown after reveal, rules still hidden', !ev.hidden.has(15) && !ev.hidden.has(19) && ev.hidden.has(13));
  check('header validations cleared (text accepted)', ev.get(h.headerRow, 6).v.indexOf('Big misses') === 0);

  // next week: new batch draws again, excludes already-used postings
  w.props['AIS_LAST_DRAW'] = new Date(NOW.getTime() - 8 * 86400000).toISOString();
  w.env.aiScheduledDraw();
  const all = w.env.aisFindBatches_(ev);
  check('second batch drawn after reveal', all.length === 2 && all[1].n === 2 && all[1].sealed, all.map(b => b.n));
  const used1 = new Set(rows.map(r => ev.get(r.row, 9).v));
  check('second batch reuses no posting', all[1].rows.every(r => !used1.has(ev.get(r.row, 9).v)));
}

/* ================== 8. Empty week and short week ================== */
{
  const ss = buildWorld({ scanRows: [{ date: day(30), company: 'Old', title: 'PM', link: 'https://jobs.ashbyhq.com/old/' + uuid(1), tier: 'Tier 1', routing: 'Skipped' }] });
  const w = makeEnv(ss, router(() => [3, 3, 3, 3, 3, 3])); Object.assign(w.props, K());
  w.env.aiScheduledDraw();
  check('empty week: no batch, no calls', w.apiCalls.length === 0 && w.env.aisFindBatches_(ss.getSheetByName('AI Eval Set')).length === 0 && /No new batch: no eligible postings/.test(w.mails[0].body));
  const filler = [8, 9].map(i => ({ date: day(30), company: 'F' + i, title: 'x', link: 'https://jobs.ashbyhq.com/f/' + uuid(i), tier: 'Tier 1', routing: 'Skipped' }));
  const rows = filler.concat([1, 2, 3].map(i => ({ date: day(1), company: 'Co' + i, title: 'PM ' + i, link: 'https://jobs.ashbyhq.com/co' + i + '/' + uuid(i), tier: 'Tier 1', routing: 'Skipped' })));
  const ss2 = buildWorld({ scanRows: rows }); const w2 = makeEnv(ss2, router(() => [3, 3, 3, 3, 3, 3])); Object.assign(w2.props, K());
  w2.env.aiScheduledDraw();
  check('short week: batch of 3', w2.env.aisFindBatches_(ss2.getSheetByName('AI Eval Set'))[0].rows.length === 3);
}

/* ================== 8b. Closed postings are replaced, never scored ================== */
{
  const ss = buildWorld();
  const w = makeEnv(ss, router(() => [3, 3, 3, 3, 3, 3], { closedBoards: ['gamma', 'delta'] })); Object.assign(w.props, K());
  w.env.aiScheduledDraw();
  const ev = ss.getSheetByName('AI Eval Set'), b = w.env.aisFindBatches_(ev)[0];
  const cos = b.rows.map(r => ev.get(r.row, 2).v);
  check('closed postings replaced by others', b.rows.length === 10 && !cos.includes('Gamma') && !cos.includes('Delta'), cos);
  check('replacements listed in the email', (w.mails[0].body.match(/Replaced \(posting closed\)/g) || []).length === 3, w.mails[0].body);
  check('no AI call for closed postings', w.apiCalls.length === 10);
}

/* ================== 9. Pick logic edge: fills from other group ================== */
{
  const { env } = makeEnv(buildWorld(), router(() => [3, 3, 3, 3, 3, 3]));
  const c = []; for (let i = 0; i < 12; i++) c.push({ company: 'C' + i, tier: 'Tier 1' });
  c.push({ company: 'X', tier: 'Tier 3' });
  const got = env.aisPick_(c, 42, { size: 10, top: 7, cap: 3 }, () => true);
  check('fills to 10 with more Tier 1-2 when Tier 3 is short', got.length === 10 && got.filter(x => x.tier === 'Tier 3').length === 1);
  const stopAt = env.aisPick_(c, 42, { size: 10, top: 7, cap: 3 }, (x) => (x.company === c[0].company ? 'stop' : true));
  check('stop signal ends the draw', stopAt.length < 10);
}

/* ================== 10. Schedule install ================== */
{
  const ssI = buildWorld();
  const w = makeEnv(ssI, router(() => [3, 3, 3, 3, 3, 3]));
  let uiCalls = 0; w.env.SpreadsheetApp.getUi = () => { uiCalls++; return { alert: () => {}, ButtonSet: {}, createMenu: () => ({ addItem() { return this; }, addSeparator() { return this; }, addToUi() {} }) }; };
  w.env.aiInstallSchedule(); w.env.aiInstallSchedule();
  check('install never opens a blocking pop-up (no getUi call)', uiCalls === 0, uiCalls);
  check('install shows a toast instead', (ssI.toasts || []).length === 2);
  const names = w.triggers.map(t => t.getHandlerFunction()).sort().join(',');
  check('install is idempotent: 3 score + 1 draw + 1 menu', names === 'aiAddMenu,aiScheduledDraw,aiScheduledScore,aiScheduledScore,aiScheduledScore', names);
  w.env.aiRemoveSchedule();
  check('remove clears only AI triggers', w.triggers.length === 0);
}

console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
