// Run from the repository root: node tests/rules_ranges_test.js
// CL-005 (10/30/2026): the scan reads experience ranges from the Criteria tab instead of its own copy.
// All data below is FICTIONAL. The test checks three things:
//   1. readYearsMax_ reads the Criteria track table, and reports (never hides) anything it can't read.
//   2. With the OLD ranges, the new routing gives exactly the same result as before on every test posting.
//   3. With Product widened to 4 years, the ONLY postings whose result changes are Product roles asking exactly 4 years.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const SCRIPT = path.join(__dirname, '..', 'apps-script', 'JobSearch_Automation.gs');

// Load the whole script with harmless stand-ins for Google's services (nothing here calls a live service).
function load(src) {
  const ctx = {
    Logger: { log: function () {} },
    Utilities: { formatDate: function (d) { return (d.getMonth() + 1) + '/' + d.getDate() + '/' + d.getFullYear(); } },
    Session: { getScriptTimeZone: function () { return 'America/New_York'; } },
    console: console
  };
  vm.createContext(ctx);
  vm.runInContext(src, ctx);
  return ctx;
}
const api = load(fs.readFileSync(SCRIPT, 'utf8'));
const CFG = vm.runInContext('CFG', api);   // the script's settings object (a const, so read it from inside)

let pass = 0, fail = 0;
const check = (name, ok, extra) => { if (ok) pass++; else { fail++; console.log('FAIL  ' + name + (extra ? '  -> ' + extra : '')); } };

// ---------- 1. Reading the Criteria table ----------
// A fictional Criteria tab laid out like the real one: label rows, then the track table, then a note.
function criteriaRows(table, extraRows) {
  const rows = [
    ['Search Criteria & Rules', '', '', '', '', ''],
    ['As-of date', new Date(2026, 9, 30), '', '', '', ''],
    ['Max posting age to apply (days)', 10, '', '', '', ''],
    ['Hard cutoff: never apply at or beyond (days)', 21, '', '', '', ''],
    ['Role tracks, pay bands and experience targets', '', '', '', '', ''],
    ['Track', 'Pay floor', 'Pay ceiling', 'Exp min (yrs)', 'Exp max (yrs)', 'Target titles']
  ].concat(table).concat([['Source: a note under the table', '', '', '', '', '']]).concat(extraRows || []);
  while (rows.length < 30) rows.push(['', '', '', '', '', '']);
  return rows;
}
const TABLE_NEW = [
  ['TPM / Program', 115000, 160000, 3, 5, ''],
  ['Product', 115000, 135000, 1, 4, ''],
  ['Operations', 115000, 135000, 3, 5, ''],
  ['Project', 115000, 135000, 3, 5, ''],
  ['AI Safety / Research Generalist', 115000, 135000, 0, 2, '']
];
let r = api.readYearsMax_(criteriaRows(TABLE_NEW));
check('reads Product max from the table', r.yearsMax['Product'] === 4, JSON.stringify(r.yearsMax));
check('reads TPM max from the table', r.yearsMax['TPM / Program'] === 5);
check('reads AI Safety max from the table', r.yearsMax['AI Safety / Research Generalist'] === 2);
check('"Other" uses the Operations range (same as the Sheet formula)', r.yearsMax['Other'] === r.yearsMax['Operations']);
check('no warnings when the table is complete', r.warnings.length === 0, JSON.stringify(r.warnings));

// The table drives the result: change a value on the "Criteria tab" and the script follows.
const TABLE_EDITED = TABLE_NEW.map(row => row[0] === 'Operations' ? ['Operations', 115000, 135000, 3, 6, ''] : row);
r = api.readYearsMax_(criteriaRows(TABLE_EDITED));
check('an edited Criteria value is picked up', r.yearsMax['Operations'] === 6 && r.yearsMax['Other'] === 6);

// Missing table: fallback is used AND reported.
const noTable = criteriaRows([]).map(row => row[0] === 'Track' ? ['Tracks and pay', '', '', '', '', ''] : row);
r = api.readYearsMax_(noTable);
check('missing table: a warning is reported', r.warnings.length === 1 && /not found/.test(r.warnings[0]), JSON.stringify(r.warnings));
check('missing table: fallback ranges are still used', r.yearsMax['Product'] === 4 && r.yearsMax['TPM / Program'] === 5);

// One track missing: fallback for that track, reported by name.
r = api.readYearsMax_(criteriaRows(TABLE_NEW.filter(row => row[0] !== 'Project')));
check('missing track: reported by name', r.warnings.length === 1 && /Project/.test(r.warnings[0]), JSON.stringify(r.warnings));
check('missing track: fallback used for it only', r.yearsMax['Project'] === 5 && r.yearsMax['Product'] === 4);

// A blank value ends the table rather than being read as 0.
r = api.readYearsMax_(criteriaRows([['TPM / Program', 115000, 160000, 3, '', '']].concat(TABLE_NEW.slice(1))));
check('blank value is not read as 0', r.yearsMax['TPM / Program'] === 5 && r.warnings.length === 1, JSON.stringify(r));

// The Criteria tab's range check line: MISMATCH is reported, OK is not.
r = api.readYearsMax_(criteriaRows(TABLE_NEW, [['MISMATCH: the rubric Level text and this table disagree.', '', '', '', '', '']]));
check('MISMATCH line on Criteria is reported', r.warnings.some(w => /MISMATCH/.test(w)), JSON.stringify(r.warnings));
r = api.readYearsMax_(criteriaRows(TABLE_NEW, [['OK: rubric Level ranges match this table', '', '', '', '', '']]));
check('OK line on Criteria is not reported', r.warnings.length === 0);

// ---------- 2 and 3. Routing: old behavior preserved; only Product @ 4 years changes ----------
// The "before" is the old built-in table, exactly as it was in the script before CL-005.
const OLD = { 'TPM / Program': 5, 'Product': 3, 'Project': 5, 'Operations': 5, 'Other': 5 };
const NEW = Object.assign({}, OLD, { 'Product': 4 });
const asOf = new Date(2026, 9, 30);
const rulesWith = m => ({ asOf: asOf, maxAge: 10, hardCutoff: 21, yearsMax: m, warnings: [] });

// The pre-CL-005 routing, reproduced from the old script: it read CFG.YEARS_BAND_MAX directly.
// We get it by running the new routeJob_ with the old values in CFG and no table values.
function routeOld(job, repost, size) {
  const saved = CFG.YEARS_BAND_MAX;
  CFG.YEARS_BAND_MAX = OLD;
  try { return api.routeJob_(job, { asOf: asOf, maxAge: 10, hardCutoff: 21 }, repost, size); }
  finally { CFG.YEARS_BAND_MAX = saved; }
}

const TITLES = ['Technical Program Manager', 'Senior Product Manager', 'Project Manager', 'Product Operations Manager',
                'Research Generalist', 'Program Lead', 'Staff Technical Program Manager'];
const YEARS = [null, 0, 1, 2, 3, 4, 5, 6, 7, 8, 10, 12];
const AGES = [3, 15, 25];
const PAYS = [[null, null], [90000, 110000], [130000, 170000]];
const LOCS = [['Remote - United States', ''], ['Atlanta, GA', 'Hybrid'], ['London, UK', '']];
let total = 0, changed = 0, sameAsBefore = 0, unexpected = [];
TITLES.forEach(title => YEARS.forEach(y => AGES.forEach(age => PAYS.forEach(pay => LOCS.forEach(loc => {
  const job = {
    title: title, text: y === null ? 'A great role on our team.' : 'You have ' + y + '+ years of relevant experience.',
    postedAt: new Date(asOf.getTime() - age * 86400000), dateSource: 'first_published',
    payMin: pay[0], payMax: pay[1], location: loc[0], workplace: loc[1], reqId: '', url: 'https://example.com/' + total
  };
  total++;
  const before = JSON.stringify(routeOld(job, false, 'Midsize'));
  const sameRanges = JSON.stringify(api.routeJob_(job, rulesWith(OLD), false, 'Midsize'));
  if (before === sameRanges) sameAsBefore++;
  else unexpected.push('old ranges gave a different result: ' + title + ', ' + y + ' years');
  const after = api.routeJob_(job, rulesWith(NEW), false, 'Midsize');
  if (before !== JSON.stringify(after)) {
    changed++;
    if (!(api.trackOf_(title) === 'Product' && y === 4)) unexpected.push('changed but should not: ' + title + ', ' + y + ' years');
  } else if (api.trackOf_(title) === 'Product' && y === 4) {
    const b = JSON.parse(before);
    if (b.rec !== 'Skip' || b.rating !== after.rating) unexpected.push('Product @ 4 years did not change: ' + title);
  }
})))));
check('old ranges reproduce the old result on every posting (' + total + ' postings)', sameAsBefore === total, unexpected.slice(0, 3).join(' | '));
check('with Product widened to 4, only Product roles asking 4 years change', unexpected.length === 0, unexpected.slice(0, 5).join(' | '));
check('some Product @ 4 postings do change (the change is real)', changed > 0, String(changed));

// What the change does to one Product role asking 4 years.
const pm4 = { title: 'Product Manager', text: 'You have 4+ years of product experience.', postedAt: new Date(asOf.getTime() - 3 * 86400000),
              dateSource: 'first_published', payMin: 120000, payMax: 140000, location: 'Remote - United States', workplace: '', reqId: '', url: 'x' };
const b4 = routeOld(pm4, false, 'Midsize'), a4 = api.routeJob_(pm4, rulesWith(NEW), false, 'Midsize');
check('Product @ 4 years: was flagged over the band', /above your Product band/.test(b4.rationale) && b4.rec === 'Review', b4.rationale);
check('Product @ 4 years: now within the band, score up by 2', !/above your Product band/.test(a4.rationale) && a4.rating === b4.rating + 2, a4.rationale);
const pm5 = Object.assign({}, pm4, { text: 'You have 5+ years of product experience.' });
check('Product @ 5 years: still over the band', /above your Product band/.test(api.routeJob_(pm5, rulesWith(NEW), false, 'Midsize').rationale));

// A rules object with no ranges (for example the weekly snapshot) still routes using the fallback.
check('no ranges supplied: fallback is used', api.yearsMaxFor_({}, 'Product') === 4 && api.yearsMaxFor_({}, 'Other') === 5);

console.log((fail ? 'FAILED' : 'ALL PASSED') + ': ' + pass + ' passed, ' + fail + ' failed  (' + total + ' fictional postings compared)');
process.exit(fail ? 1 : 0);
