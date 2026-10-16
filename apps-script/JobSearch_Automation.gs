/**
 * JOB SEARCH AUTOMATION  -  scan (Mon/Wed/Fri) + email check (an hour later) + weekly snapshot (Fri 5 PM)   LIVE
 * ---------------------------------------------------------------------------
 * What it does, in plain words:
 *   1. Reads your Company Registry. Any row that is Active AND shows
 *      "Automated feed ready" is scanned. (Add a row, it is included next run.)
 *   2. Asks each company's public job feed for open jobs (read-only).
 *   3. Drops titles that are not your target roles, and obvious noise
 *      (for example revenue, sales or marketing "operations").
 *   4. Applies your rules: location, 10-day window, 21-day cutoff, repost,
 *      pay floor, years of experience.
 *   5. Logs every NEW job to the Scan Log (your audit trail).
 *   6. LIVE MODE ONLY: adds jobs that passed to Open Roles and updates the
 *      Registry's "Last checked".
 *   7. Emails you a short executive summary: the facts, your options, next steps.
 *
 * LIVE MODE (now): every Active, "Automated feed ready" company is scanned, passing
 * roles are added to Open Roles, and the Registry's "Last checked" is updated.
 * To go back to testing, set DRY_RUN to true (only the three test companies are
 * scanned, nothing is written to Open Roles or the Registry, rows are labeled "Dry run").
 *
 * ONE-TIME SETUP: Extensions > Apps Script > select ALL the existing code,
 * delete it, paste this file, save. Then in the Sheet: Job Search > Run scan now.
 * Project Settings: set the time zone to America/New_York.
 *
 * PRIVATE SETTINGS live in a separate file, Config.gs (see config/Config.example.gs).
 * It holds your Sheet ID and the company-name lists the email check uses. It stays
 * in your Apps Script project and is never committed to GitHub.
 */

// ============================== SETTINGS ===================================
const CFG = {
  // The Sheet ID is a private setting: PRIVATE_CONFIG.spreadsheetId in Config.gs (only used if the script is not attached to the Sheet).

  DRY_RUN: false,
  DRY_RUN_COMPANIES: [],              // used only while DRY_RUN is true; your list is PRIVATE_CONFIG.dryRunCompanies in Config.gs

  SHEET_REGISTRY: 'Company Registry',
  SHEET_SCANLOG: 'Scan Log',
  SHEET_OPENROLES: 'Open Roles',
  SHEET_CRITERIA: 'Criteria',
  HEADER_ROW_REGISTRY: 4,
  HEADER_ROW_SCANLOG: 4,
  HEADER_ROW_OPENROLES: 5,

  USER_AGENT: 'PersonalJobSearchTracker/1.0 (personal use; contact: your-email@example.com)',
  PAUSE_MS: 1000,                       // wait between requests (Lever lists a 1 second crawl delay)
  MAX_RUN_MS: 5 * 60 * 1000,            // stop starting new companies after 5 minutes (Google caps a run at 6)
  EMAIL_DIGEST: true,
  SCHEDULE: { days: ['MONDAY', 'WEDNESDAY', 'FRIDAY'], hour: 7 },

  // Titles worth looking at (the same words your sheet's Role/Tier scan uses).
  TITLE_REGEX: /program manage|project manage|product manage|operations|product ops|generalist|product owner|delivery manager|program lead|product specialist/i,
  // "Operations" jobs that are really other functions. Ignored to keep the noise down.
  OPS_NOISE_REGEX: /(sales|revenue|marketing|finance|financial|legal|people|talent|recruit|accounting|payroll|network|security operations|devops|site reliability|customer support|support operations)/i,
  SENIOR_REGEX: /\b(director|vp|vice president|head of|chief|principal|staff|distinguished)\b/i,

  PAY_FLOOR: 115000,
  YEARS_BAND_MAX: { 'TPM / Program': 5, 'Product': 3, 'Project': 5, 'Operations': 5, 'Other': 5 },
  DEFAULTS: { maxAgeApply: 10, hardCutoff: 21 }       // used only if the Criteria tab can't be read
};

// ============================== SHEET ACCESS ===============================
function ss_() {
  return SpreadsheetApp.getActive() || SpreadsheetApp.openById(emPrivate_().spreadsheetId);
}

function toast_(msg) {
  Logger.log(msg);
  try { ss_().toast(msg, 'Job Search', 8); } catch (e) { /* no window open: the log is enough */ }
}

// ============================== MENU =======================================
function onOpen() {
  SpreadsheetApp.getUi().createMenu('Job Search')
    .addItem('Run scan now', 'runScan')
    .addSeparator()
    .addItem('Install Mon/Wed/Fri schedule', 'installSchedule')
    .addItem('Remove schedule', 'removeSchedule')
    .addItem('Show schedule status', 'showScheduleStatus')
    .addSeparator()
    .addItem('Preview email check (changes nothing)', 'previewEmailCheck')
    .addItem('Check email for replies now', 'checkEmailNow')
    .addItem('Check email, look back 60 days', 'checkEmailLast60Days')
    .addSeparator()
    .addItem('Preview weekly snapshot email', 'previewWeeklySnapshot')
    .addItem('Install Friday 5 PM snapshot', 'installWeeklySnapshot')
    .addItem('Remove Friday snapshot', 'removeWeeklySnapshot')
    .addToUi();
}

// ============================== SCHEDULE ===================================
// A "trigger" is Google's own timer. This is what makes the process automatic.
function installSchedule() {
  removeSchedule();
  CFG.SCHEDULE.days.forEach(function (d) {
    ScriptApp.newTrigger('runScan').timeBased().onWeekDay(ScriptApp.WeekDay[d]).atHour(CFG.SCHEDULE.hour).create();
    ScriptApp.newTrigger('runEmailCheck').timeBased().onWeekDay(ScriptApp.WeekDay[d]).atHour(CFG.SCHEDULE.hour + 1).create();
  });
  toast_('Scan scheduled for Monday, Wednesday and Friday around ' + CFG.SCHEDULE.hour + ' am, and the email check an hour later.');
}

function removeSchedule() {                       // also your "kill switch"
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'runScan' || t.getHandlerFunction() === 'runEmailCheck') ScriptApp.deleteTrigger(t);
  });
}

function emailScheduleCount_() {
  return ScriptApp.getProjectTriggers().filter(function (t) { return t.getHandlerFunction() === 'runEmailCheck'; }).length;
}

function scheduleCount_() {
  return ScriptApp.getProjectTriggers().filter(function (t) { return t.getHandlerFunction() === 'runScan'; }).length;
}

function showScheduleStatus() {
  toast_(scheduleCount_() + ' scan run(s), ' + emailScheduleCount_() + ' email check run(s) and ' + weeklyScheduleCount_() + ' weekly snapshot installed. DRY_RUN is ' + CFG.DRY_RUN + '.');
}

function nextRunLabel_(now) {
  if (scheduleCount_() === 0) return 'No schedule is installed yet (Job Search > Install Mon/Wed/Fri schedule).';
  const names = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'];
  for (let i = 1; i <= 7; i++) {
    const d = new Date(now.getTime() + i * 86400000);
    if (CFG.SCHEDULE.days.indexOf(names[d.getDay()]) >= 0) {
      return Utilities.formatDate(d, Session.getScriptTimeZone(), 'EEEE M/d') + ' around ' + CFG.SCHEDULE.hour + ' am.';
    }
  }
  return '';
}

// ============================== MAIN =======================================
function runScan() {
  const lock = LockService.getScriptLock();               // never let two runs overlap
  if (!lock.tryLock(30000)) { Logger.log('Another run is in progress. Stopping.'); return; }

  const startedAt = Date.now();
  const s = {
    dryRun: CFG.DRY_RUN, companies: [], newCount: 0, passed: [], filtered: { cutoff: 0, window: 0, location: 0, repost: 0 },
    noise: 0, errors: [], notScanned: [], validation: [], awaiting: 0, links: {}, nextRun: '', dateLabel: ''
  };
  try {
    const rules = readRules_();
    const tz = Session.getScriptTimeZone();
    s.dateLabel = Utilities.formatDate(new Date(), tz, 'EEE M/d');
    const registryAll = readRegistry_();
    const registry = registryAll.scan;
    s.registryInfo = registryAll.info;
    const seen = loadSeen_();
    const logRows = [];
    const openRolesRows = [];

    registry.forEach(function (co) {
      if (Date.now() - startedAt > CFG.MAX_RUN_MS) { s.notScanned.push(co.name); return; }   // resume next run
      const line = { company: co.name, system: co.system, matched: 0, added: 0, latestPosted: null };
      try {
        const stats = { noise: 0 };
        const jobs = fetchJobs_(co, stats);
        s.noise += stats.noise;                              // noise dropped inside the fetcher (Greenhouse)
        jobs.forEach(function (job) {
          if (isNoise_(job.title)) { s.noise++; return; }
          line.matched++;
          if (job.postedAt && (!line.latestPosted || job.postedAt > line.latestPosted)) line.latestPosted = job.postedAt;
          const key = co.name + '|' + job.id;
          if (seen.ids[key]) {                              // already logged: never duplicate
            if (CFG.DRY_RUN && job.postedAt) s.validation.push(validationLine_(co.name, job, seen.ids[key]));
            return;
          }
          const titleKey = co.name + '|' + normTitle_(job.title) + '|' + normLoc_(job.location);
          const siblings = seen.titles[titleKey] || {};
          const repostSuspect = Object.keys(siblings).some(function (i) { return i !== job.id; });
          const res = routeJob_(job, rules, repostSuspect, co.size);
          logRows.push(buildLogRow_(co, job, res, rules.asOf));
          seen.ids[key] = { posted: job.postedAt };
          seen.titles[titleKey] = seen.titles[titleKey] || {};
          seen.titles[titleKey][job.id] = true;
          line.added++;
          if (res.rec === 'Skip') {
            res.skipCategories.forEach(function (c) { s.filtered[c] = (s.filtered[c] || 0) + 1; });
          } else {
            s.passed.push({ company: co.name, title: job.title, url: job.url, rec: res.rec, rating: res.rating,
                            exception: res.exceptionReason, rationale: res.rationale });
            openRolesRows.push(buildOpenRolesRow_(co, job, res, rules.asOf));
          }
        });
      } catch (err) {
        s.errors.push(co.name + ': ' + err.message);        // one bad company must not stop the rest
      }
      s.companies.push(line);
      Utilities.sleep(CFG.PAUSE_MS);
    });

    s.newCount = logRows.length;
    appendScanLog_(logRows).forEach(function (e) { s.errors.push(e); });
    if (!CFG.DRY_RUN) {
      appendOpenRoles_(openRolesRows).forEach(function (e) { s.errors.push(e); });
      updateRegistry_(s.companies, registry, rules.asOf);
    }
    s.awaiting = countAwaitingDecision_();
    const url = ss_().getUrl();
    s.links = {
      openRoles: url + '#gid=' + ss_().getSheetByName(CFG.SHEET_OPENROLES).getSheetId(),
      scanLog: url + '#gid=' + ss_().getSheetByName(CFG.SHEET_SCANLOG).getSheetId(),
      registry: url + '#gid=' + ss_().getSheetByName(CFG.SHEET_REGISTRY).getSheetId()
    };
    s.nextRun = nextRunLabel_(new Date());
  } catch (err) {
    s.errors.push('Run failed: ' + err.message);
  } finally {
    lock.releaseLock();
  }
  if (CFG.EMAIL_DIGEST) sendDigest_(s);
  Logger.log(JSON.stringify({ newRows: s.newCount, passed: s.passed.length, errors: s.errors }));
}

// ============================== READ THE SHEET =============================
// Columns are found by HEADER TEXT, not letter, so inserting a column later
// does not silently break the script. If a header is renamed, you get a clear error.
// Old header name -> new header name. Either spelling finds the same column, so renaming a header in the
// Sheet can never break the script (and pasting this script before or after the rename is equally safe).
const HEADER_ALIASES_ = {
  'Fit Score (1-5)': 'Rules-compliance Score (1-5)',
  'Fit Rationale': 'Rules-compliance Rationale'
};

function headerMap_(sheet, headerRow) {
  const values = sheet.getRange(headerRow, 1, 1, sheet.getLastColumn()).getValues()[0];
  const map = {};
  values.forEach(function (h, i) { if (h !== '') map[String(h).trim()] = i + 1; });
  Object.keys(HEADER_ALIASES_).forEach(function (oldName) {
    const newName = HEADER_ALIASES_[oldName];
    if (map[newName] && !map[oldName]) map[oldName] = map[newName];
    if (map[oldName] && !map[newName]) map[newName] = map[oldName];
  });
  return map;
}

function need_(map, name) {
  if (!map[name]) throw new Error('Column not found: "' + name + '". Was a header renamed?');
  return map[name];
}

function readRegistry_() {
  const sh = ss_().getSheetByName(CFG.SHEET_REGISTRY);
  const h = headerMap_(sh, CFG.HEADER_ROW_REGISTRY);
  const first = CFG.HEADER_ROW_REGISTRY + 1;
  const n = sh.getLastRow() - CFG.HEADER_ROW_REGISTRY;
  const out = { scan: [], info: { feedReady: 0, manual: 0 } };
  if (n < 1) return out;
  const data = sh.getRange(first, 1, n, sh.getLastColumn()).getValues();
  const col = function (name) { return need_(h, name) - 1; };
  data.forEach(function (r, i) {
    const name = String(r[col('Company')]).trim();
    if (!name) return;
    const active = String(r[col('Status')]).trim() === 'Active';
    const method = String(r[col('Scan method')]).trim();
    if (active && method === 'Automated feed ready') out.info.feedReady++;
    else if (active && method === 'Manual check') out.info.manual++;
    if (!active || method !== 'Automated feed ready') return;
    if (CFG.DRY_RUN && !(emPrivate_().dryRunCompanies || CFG.DRY_RUN_COMPANIES).some(function (c) { return c.toLowerCase() === name.toLowerCase(); })) return;
    const lc = r[col('Last checked')];
    out.scan.push({
      row: first + i, name: name,
      system: String(r[col('System used by scan (auto)')]).trim(),
      token: String(r[col('Token used by scan (auto)')]).trim(),
      size: String(r[col('Size')]).trim(),
      lastChecked: lc instanceof Date ? lc.getTime() : 0
    });
  });
  if (!CFG.DRY_RUN) out.scan.sort(function (a, b) { return a.lastChecked - b.lastChecked; });   // oldest-checked first
  return out;
}

function readRules_() {
  const sh = ss_().getSheetByName(CFG.SHEET_CRITERIA);
  const rows = sh.getRange(1, 1, 30, 2).getValues();
  const find = function (prefix) {
    for (let i = 0; i < rows.length; i++) {
      if (String(rows[i][0]).toLowerCase().indexOf(prefix) === 0) return rows[i][1];
    }
    return null;
  };
  const asOf = find('as-of date');
  return {
    asOf: asOf instanceof Date ? asOf : new Date(),
    maxAge: Number(find('max posting age')) || CFG.DEFAULTS.maxAgeApply,
    hardCutoff: Number(find('hard cutoff')) || CFG.DEFAULTS.hardCutoff
  };
}

// The "memory": which jobs have we already logged? (first-seen tracking)
function loadSeen_() {
  const sh = ss_().getSheetByName(CFG.SHEET_SCANLOG);
  const h = headerMap_(sh, CFG.HEADER_ROW_SCANLOG);
  const out = { ids: {}, titles: {} };
  const n = sh.getLastRow() - CFG.HEADER_ROW_SCANLOG;
  if (n < 1) return out;
  const data = sh.getRange(CFG.HEADER_ROW_SCANLOG + 1, 1, n, sh.getLastColumn()).getValues();
  const cCo = need_(h, 'Company') - 1, cTi = need_(h, 'Title') - 1, cId = need_(h, 'Req / Job ID') - 1;
  const cLoc = need_(h, 'Location') - 1, cPosted = need_(h, 'Date Posted (employer)') - 1;
  data.forEach(function (r) {
    const co = String(r[cCo]).trim();
    if (!co) return;
    const id = String(r[cId]).trim();
    const posted = r[cPosted] instanceof Date ? r[cPosted] : null;
    if (id) out.ids[co + '|' + id] = { posted: posted };
    const tk = co + '|' + normTitle_(String(r[cTi])) + '|' + normLoc_(String(r[cLoc]));
    out.titles[tk] = out.titles[tk] || {};
    if (id) out.titles[tk][id] = true;
  });
  return out;
}

function countAwaitingDecision_() {
  const sh = ss_().getSheetByName(CFG.SHEET_OPENROLES);
  const h = headerMap_(sh, CFG.HEADER_ROW_OPENROLES);
  const first = CFG.HEADER_ROW_OPENROLES + 1;
  const n = sh.getLastRow() - CFG.HEADER_ROW_OPENROLES;
  if (n < 1) return 0;
  const cCo = need_(h, 'Company') - 1, cDec = need_(h, 'YOUR FINAL DECISION') - 1;
  let count = 0;
  sh.getRange(first, 1, n, sh.getLastColumn()).getValues().forEach(function (r) {
    if (String(r[cCo]).trim() === '') return;
    const d = String(r[cDec]).trim();
    if (d !== 'Apply' && d !== 'Skipped') count++;
  });
  return count;
}

// ============================== FETCH JOB FEEDS ============================
function fetchJobs_(co, stats) {
  if (co.system === 'Greenhouse') return fetchGreenhouse_(co.token, stats);
  if (co.system === 'Lever') return fetchLever_(co.token);
  if (co.system === 'Ashby') return fetchAshby_(co.token);
  throw new Error('No automated feed for system "' + co.system + '"');
}

function httpGetJson_(url) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    const res = UrlFetchApp.fetch(url, {
      muteHttpExceptions: true,
      headers: { 'User-Agent': CFG.USER_AGENT, 'Accept': 'application/json' }
    });
    const code = res.getResponseCode();
    if (code === 200) return JSON.parse(res.getContentText());
    if (code === 404) return null;
    if (code === 429 || code >= 500) { Utilities.sleep(2000 * attempt); continue; }   // back off and retry
    throw new Error('HTTP ' + code + ' from ' + url);
  }
  throw new Error('Gave up after 3 attempts: ' + url);
}

// Greenhouse: the job LIST only has updated_at (last edit). The real
// first_published date, requisition id and pay come from fetching each job.
function fetchGreenhouse_(token, stats) {
  const base = 'https://boards-api.greenhouse.io/v1/boards/' + encodeURIComponent(token);
  const list = httpGetJson_(base + '/jobs');
  if (!list) throw new Error('Greenhouse board not found: ' + token);
  const out = [];
  (list.jobs || []).forEach(function (j) {
    if (!CFG.TITLE_REGEX.test(j.title || '')) return;
    if (isNoise_(j.title)) { stats.noise++; return; }                         // skip noise BEFORE the extra request
    Utilities.sleep(CFG.PAUSE_MS);
    const d = httpGetJson_(base + '/jobs/' + j.id + '?pay_transparency=true') || {};
    let payMin = null, payMax = null;
    (d.pay_input_ranges || []).forEach(function (p) {
      const lo = p.min_cents / 100, hi = p.max_cents / 100;
      payMin = payMin === null ? lo : Math.min(payMin, lo);
      payMax = payMax === null ? hi : Math.max(payMax, hi);
    });
    out.push({
      id: String(j.id), reqId: d.requisition_id || '', title: j.title,
      location: (j.location && j.location.name) || '', workplace: '', url: j.absolute_url,
      postedAt: d.first_published ? new Date(d.first_published) : null, dateSource: 'first_published',
      text: htmlToText_(d.content || ''), payMin: payMin, payMax: payMax
    });
  });
  return out;
}

// Lever: the documented fields contain no posting date. Real responses
// reportedly include createdAt (undocumented), so we use it but label it.
function fetchLever_(site) {
  let list = httpGetJson_('https://api.lever.co/v0/postings/' + encodeURIComponent(site) + '?mode=json');
  if (!list || list.length === 0) list = httpGetJson_('https://api.eu.lever.co/v0/postings/' + encodeURIComponent(site) + '?mode=json');
  if (!list) throw new Error('Lever site not found: ' + site);
  return list.filter(function (p) { return CFG.TITLE_REGEX.test(p.text || ''); }).map(function (p) {
    const sr = p.salaryRange;
    const annual = sr && /year/i.test(sr.interval || '');
    return {
      id: String(p.id), reqId: '', title: p.text,
      location: (p.categories && p.categories.location) || '', workplace: p.workplaceType || '', url: p.hostedUrl,
      postedAt: p.createdAt ? new Date(p.createdAt) : null,
      dateSource: p.createdAt ? 'createdAt (undocumented)' : 'none',
      text: p.descriptionPlain || '', payMin: annual ? sr.min : null, payMax: annual ? sr.max : null
    };
  });
}

// Ashby: publishedAt means "when the job was LAST published", so it can reset
// when a company re-posts. We use it but never treat it as the original date.
function fetchAshby_(name) {
  const data = httpGetJson_('https://api.ashbyhq.com/posting-api/job-board/' + encodeURIComponent(name) + '?includeCompensation=true');
  if (!data) throw new Error('Ashby board not found: ' + name);
  return (data.jobs || []).filter(function (j) {
    return j.isListed !== false && CFG.TITLE_REGEX.test(j.title || '');
  }).map(function (j) {
    let payMin = null, payMax = null;
    const comps = (j.compensation && j.compensation.summaryComponents) || [];
    comps.forEach(function (c) {
      if (c.compensationType === 'Salary' && /year/i.test(c.interval || '')) { payMin = c.minValue; payMax = c.maxValue; }
    });
    return {
      id: String(j.id || (j.jobUrl || '').split('/').pop()), reqId: '', title: j.title,
      location: j.location || '', workplace: j.workplaceType || (j.isRemote ? 'Remote' : ''), url: j.jobUrl,
      postedAt: j.publishedAt ? new Date(j.publishedAt) : null, dateSource: 'publishedAt (last published)',
      text: j.descriptionPlain || '', payMin: payMin, payMax: payMax
    };
  });
}

// ============================== THE RULES ==================================
// Mirrors your sheet: location, 10-day window, 21-day cutoff, repost, pay, years.
// "Fit rating" here is RULES-BASED (5 minus a point for each unverified item or
// weak spot). It is not an AI judgment; AI scoring replaces it later.
function routeJob_(job, rules, repostSuspect, size) {
  const track = trackOf_(job.title), tier = tierOf_(job.title);
  const minYears = extractMinYears_(job.text);
  const ageDays = job.postedAt ? Math.floor((rules.asOf.getTime() - job.postedAt.getTime()) / 86400000) : null;
  const dateIsOriginal = /first_published|createdAt/.test(job.dateSource);
  const reposted = repostSuspect ? 'Y' : (dateIsOriginal ? 'N' : 'Unknown');
  const loc = locationInfo_(job, size);

  const skip = [];      // [category, text]  - fails a hard rule
  const review = [];    // blocking soft issues: need your judgment
  const minor = [];     // lower the rating only
  let penalty = 0, ageIssue = null;

  if (!loc.ok) skip.push(['location', loc.note]);
  if (ageDays === null) { review.push('no posting date available, verify the age at the employer'); penalty += 2; }
  else if (ageDays >= rules.hardCutoff) skip.push(['cutoff', ageDays + ' days old, past your ' + rules.hardCutoff + '-day cutoff']);
  else if (ageDays > rules.maxAge) ageIssue = ageDays;
  if (reposted === 'Y') skip.push(['repost', 'same title and location seen under another job ID, likely a repost']);
  else if (reposted === 'Unknown' && ageDays !== null) { review.push('repost status unconfirmed (' + job.dateSource + ')'); penalty += 1; }
  if (job.payMax === null) { minor.push('pay not listed'); penalty += 1; }
  else if (job.payMax < CFG.PAY_FLOOR) { review.push('posted pay ceiling $' + fmtMoney_(job.payMax) + ' is below your floor'); penalty += 2; }
  if (minYears === null) { minor.push('years of experience not stated'); penalty += 1; }
  else if (minYears > CFG.YEARS_BAND_MAX[track]) { review.push('asks for ' + minYears + '+ years, above your ' + track + ' band'); penalty += 2; }
  if (CFG.SENIOR_REGEX.test(job.title)) { minor.push('senior-level title'); penalty += 1; }
  if (tier === 'Other') { minor.push('title is not one of your Tier 1 to 3 titles'); penalty += 1; }
  const rating = Math.max(1, 5 - penalty);

  let rec, exception = false, exceptionReason = '';
  if (skip.length) rec = 'Skip';
  else if (ageIssue !== null) {
    // 11 to 20 days: only a strong match is raised as an exception, and you decide.
    if (review.length === 0 && rating >= 4 && (tier === 'Tier 1' || tier === 'Tier 2')) {
      rec = 'Review'; exception = true;
      exceptionReason = 'Posted ' + ageIssue + ' days ago, ' + (ageIssue - rules.maxAge) + ' past your ' + rules.maxAge +
        '-day window. Otherwise it passes every rule you set (' + loc.text + ', ' + tier + ' title, pay and experience in range or unstated), rules-based rating ' + rating + '/5.';
    } else {
      skip.push(['window', ageIssue + ' days old, past your ' + rules.maxAge + '-day window and not a strong enough match to raise as an exception']);
      rec = 'Skip';
    }
  } else rec = review.length ? 'Review' : 'Apply';

  // The facts, in one readable sentence.
  const bits = [loc.text];
  if (job.postedAt) bits.push('posted ' + fmtDate_(job.postedAt) + (ageDays !== null ? ' (' + ageDays + ' days ago)' : ''));
  if (job.payMin !== null) bits.push('pay $' + fmtMoney_(job.payMin) + ' to $' + fmtMoney_(job.payMax));
  if (minYears !== null) bits.push('asks for ' + minYears + '+ years');
  bits.push(tier === 'Other' ? 'title outside your tiers' : tier + ' title');
  let rationale = bits.join(', ') + '.';
  const toCheck = review.concat(minor);
  if (toCheck.length) rationale += ' To check: ' + toCheck.join('; ') + '.';

  const skipText = skip.map(function (x) { return x[1]; }).join('; ');
  const routing = CFG.DRY_RUN ? 'Dry run' : (rec === 'Skip' ? 'Skipped' : 'Open Roles');
  const logReason = (CFG.DRY_RUN ? 'DRY RUN, would be ' + rec.toUpperCase() + '. ' : rec.toUpperCase() + '. ') +
    (rec === 'Skip' ? skipText + '. ' : (exception ? 'Exception candidate. ' : '')) + 'Rules-based rating ' + rating + '/5. ' + rationale +
    (job.reqId ? ' Requisition ' + job.reqId + '.' : '');

  return {
    rec: rec, exception: exception, exceptionReason: exceptionReason, rating: rating, reposted: reposted,
    routing: routing, reason: logReason, rationale: rationale, track: track, tier: tier, minYears: minYears,
    arrangement: loc.arrangement, ageDays: ageDays,
    skipCategories: skip.map(function (x) { return x[0]; })
  };
}

function trackOf_(title) {
  const t = String(title).toLowerCase();
  if (t.indexOf('program manage') >= 0) return 'TPM / Program';
  if (t.indexOf('project manage') >= 0) return 'Project';
  if (t.indexOf('product manage') >= 0) return 'Product';
  if (/operations|product ops|generalist/.test(t)) return 'Operations';
  return 'Other';
}

// Same order of checks as the Tier column on your Job Tracker.
function tierOf_(title) {
  const t = String(title).toLowerCase();
  if (t.indexOf('associate product manage') >= 0) return 'Tier 2';
  if (t.indexOf('program manage') >= 0 || t.indexOf('product manage') >= 0) return 'Tier 1';
  if (/product operations|production operations|product ops|technical project manage|product owner|delivery manager|program lead|product specialist/.test(t)) return 'Tier 2';
  if (/project manage|operations|generalist/.test(t)) return 'Tier 3';
  return 'Other';
}

function isNoise_(title) {
  return trackOf_(title) === 'Operations' && CFG.OPS_NOISE_REGEX.test(title) && !/product ops|product operations/i.test(title);
}

function locationInfo_(job, size) {
  const text = (job.location + ' ' + job.workplace).toLowerCase();
  const atl = /atlanta/.test(text);
  const remote = /remote/.test(text);
  if (remote) {
    const nonUs = /(canada|united kingdom|\buk\b|london|europe|emea|india|germany|france|ireland|australia|latam|brazil|singapore)/.test(text);
    const us = /(united states|\bus\b|usa)/.test(text);
    if (nonUs && !us && !atl) return { ok: false, arrangement: 'Remote', text: 'remote', note: 'remote but outside the US (' + job.location + ')' };
    return { ok: true, arrangement: 'Remote', text: 'remote' };
  }
  if (atl) {
    const onsite = /on-?site|in.?office/.test(text);
    if (onsite && size !== 'Enterprise') return { ok: false, arrangement: 'On-Site Atlanta', text: 'on-site Atlanta', note: 'on-site in Atlanta is only accepted at enterprise companies' };
    return onsite ? { ok: true, arrangement: 'On-Site Atlanta', text: 'on-site Atlanta' }
                  : { ok: true, arrangement: 'Hybrid Atlanta', text: 'Atlanta (hybrid assumed, confirm it is not on-site)' };
  }
  return { ok: false, arrangement: '', text: job.location || 'unknown location', note: 'location outside your criteria (' + (job.location || 'unknown') + ')' };
}

function extractMinYears_(text) {
  const m = /(\d{1,2})\s*\+?\s*(?:-|to|–)?\s*\d{0,2}\s*\+?\s*years?/i.exec(String(text || ''));
  return m ? Number(m[1]) : null;
}

function htmlToText_(html) {
  return String(html).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ').replace(/<[^>]*>/g, ' ');
}

function normTitle_(t) { return String(t).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(); }
function normLoc_(l) { return String(l).toLowerCase().replace(/\(.*?\)/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim(); }
function fmtMoney_(n) { return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
function fmtDate_(d) { return Utilities.formatDate(d, 'America/New_York', 'M/d/yyyy'); }

function validationLine_(company, job, seenInfo) {
  const had = seenInfo && seenInfo.posted ? fmtDate_(seenInfo.posted) : 'none recorded';
  const now = fmtDate_(job.postedAt);
  return company + ' "' + job.title + '": feed says ' + now + ' (' + job.dateSource + '), Scan Log has ' + had + ' ' + (had === now ? '(match)' : '(DIFFERENT)');
}

// ============================== WRITE RESULTS ==============================
function buildLogRow_(co, job, res, asOf) {
  return {
    'Date First Seen': asOf,
    'Company': co.name,
    'Title': job.title,
    'Link': job.url,
    'Req / Job ID': job.id,
    'Found Via': 'Feed script (' + co.system + ')',
    'Date Posted (employer)': job.postedAt ? job.postedAt : '',
    'Verified At': job.postedAt ? 'Employer ATS' : 'Not verified',
    'Reposted?': res.reposted,
    'Location': job.location + (job.workplace ? ' (' + job.workplace + ')' : ''),
    'Reason': res.reason,
    'Routing (system)': res.routing
  };
}

// Open Roles gets only the INPUT columns. Recommendation, Why, and your decision
// columns are formulas or yours, so the script never touches them.
function buildOpenRolesRow_(co, job, res, asOf) {
  const sizes = ['Startup', 'Midsize', 'Enterprise'];
  return {
    'Date Found': asOf,
    'Company': co.name,
    'Title': job.title,
    'Link': job.url,
    'Source': 'Feed script (' + co.system + ')',
    'Date Posted': job.postedAt ? job.postedAt : '',
    'Reposted? (Y/N)': res.reposted === 'Unknown' ? '' : res.reposted,       // blank on purpose: the sheet then says "Need repost check"
    'Pay Min': job.payMin !== null ? job.payMin : '',
    'Pay Max': job.payMax !== null ? job.payMax : '',
    'Location': res.arrangement,
    'Company Size': sizes.indexOf(co.size) >= 0 ? co.size : '',
    'Track': res.track === 'Other' ? 'Operations' : res.track,
    'Yrs Exp Asked (min)': res.minYears !== null ? res.minYears : '',
    'Fit Score (1-5)': res.rating,
    'Fit Rationale': 'Rules-based rating from the script (not an AI judgment). ' + res.rationale,
    'Exception Reason': res.exceptionReason
  };
}

function nextEmptyRow_(sh, headerRow, companyCol) {
  const first = headerRow + 1;
  const maxRows = sh.getMaxRows();
  const vals = sh.getRange(first, companyCol, maxRows - first + 1, 1).getValues();
  let last = -1;
  vals.forEach(function (r, i) { if (String(r[0]).trim() !== '') last = i; });
  return first + last + 1;
}

function writeColumns_(sh, h, startRow, rows, label) {
  // Column by column, so formula columns are never overwritten. A refused write
  // (for example a strict dropdown) is reported, not swallowed.
  const errors = [];
  Object.keys(rows[0]).forEach(function (field) {
    try {
      const c = need_(h, field);
      sh.getRange(startRow, c, rows.length, 1).setValues(rows.map(function (r) { return [r[field]]; }));
    } catch (err) {
      errors.push('Could not write "' + field + '" in ' + label + ': ' + err.message);
    }
  });
  return errors;
}

function appendScanLog_(rows) {
  if (!rows.length) return [];
  const sh = ss_().getSheetByName(CFG.SHEET_SCANLOG);
  const h = headerMap_(sh, CFG.HEADER_ROW_SCANLOG);
  const start = nextEmptyRow_(sh, CFG.HEADER_ROW_SCANLOG, need_(h, 'Company'));
  if (start + rows.length - 1 > sh.getMaxRows()) sh.insertRowsAfter(sh.getMaxRows(), rows.length);
  return writeColumns_(sh, h, start, rows, 'Scan Log');
}

function appendOpenRoles_(rows) {
  if (!rows.length) return [];
  const sh = ss_().getSheetByName(CFG.SHEET_OPENROLES);
  const h = headerMap_(sh, CFG.HEADER_ROW_OPENROLES);
  const cLink = need_(h, 'Link');
  const first = CFG.HEADER_ROW_OPENROLES + 1;
  const existing = {};
  sh.getRange(first, cLink, sh.getMaxRows() - first + 1, 1).getValues().forEach(function (r) { if (r[0]) existing[String(r[0])] = true; });
  const fresh = rows.filter(function (r) { return !existing[String(r['Link'])]; });     // never add the same link twice
  if (!fresh.length) return [];
  const start = nextEmptyRow_(sh, CFG.HEADER_ROW_OPENROLES, need_(h, 'Company'));
  return writeColumns_(sh, h, start, fresh, 'Open Roles');
}

function updateRegistry_(lines, registry, asOf) {
  const sh = ss_().getSheetByName(CFG.SHEET_REGISTRY);
  const h = headerMap_(sh, CFG.HEADER_ROW_REGISTRY);
  const cChecked = need_(h, 'Last checked'), cSeen = need_(h, 'Last matching role seen');
  lines.forEach(function (line) {
    const co = registry.filter(function (c) { return c.name === line.company; })[0];
    if (!co) return;
    sh.getRange(co.row, cChecked).setValue(asOf);
    if (line.latestPosted) sh.getRange(co.row, cSeen).setValue(line.latestPosted);
  });
}

// ============================== THE EMAIL ==================================
// Reads like: the facts, your options, next steps. Only roles that PASSED are
// listed. Everything else is a count plus a link to the Scan Log.
function esc_(t) { return String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

function buildDigest_(s) {
  const nPass = s.passed.length;
  const nApply = s.passed.filter(function (p) { return p.rec === 'Apply'; }).length;
  const nReview = nPass - nApply;
  const nExc = s.passed.filter(function (p) { return p.exception; }).length;
  const matched = s.companies.reduce(function (a, c) { return a + c.matched; }, 0);
  const nFiltered = s.newCount - nPass;
  const tag = (s.dryRun ? '[DRY RUN] ' : '') + (s.errors.length ? '[Needs attention] ' : '');

  let subject;
  if (s.newCount === 0) subject = tag + 'Job scan ' + s.dateLabel + ': no new postings since the last scan';
  else if (nPass === 0) subject = tag + 'Job scan ' + s.dateLabel + ': no roles passed (' + s.newCount + ' new postings checked)';
  else subject = tag + 'Job scan ' + s.dateLabel + ': ' + nPass + ' role' + (nPass === 1 ? '' : 's') + ' ready for your review (' + nApply + ' Apply, ' + nReview + ' Review)';

  // ---- THE FACTS
  const facts = [];
  facts.push('Scanned ' + s.companies.length + ' compan' + (s.companies.length === 1 ? 'y' : 'ies') + ' (' + matched + ' postings matched your target titles; ' + s.newCount + ' were new since the last scan).');
  if (s.noise) facts.push(s.noise + ' posting' + (s.noise === 1 ? '' : 's') + ' with titles outside your target functions (such as sales or revenue operations) were ignored.');
  if (s.newCount > 0) {
    if (nPass === 0) facts.push('None of the new postings passed your rules.');
    else facts.push(nPass + ' passed your rules: ' + nApply + ' Apply, ' + nReview + ' Review' + (nExc ? ' (including ' + nExc + ' exception' + (nExc === 1 ? '' : 's') + ')' : '') + '.');
    if (nFiltered > 0) {
      const lab = { cutoff: 'past your 21-day cutoff', window: 'past your 10-day window', location: 'outside your locations', repost: 'likely reposts' };
      const parts = Object.keys(lab).filter(function (k) { return s.filtered[k]; }).map(function (k) { return s.filtered[k] + ' ' + lab[k]; });
      facts.push(nFiltered + ' filtered out' + (parts.length ? ': ' + parts.join(', ') : '') + '.');
    }
  }
  facts.push(s.awaiting + ' role' + (s.awaiting === 1 ? '' : 's') + ' already in Open Roles ' + (s.awaiting === 1 ? 'is' : 'are') + ' still waiting for your decision.');
  if (s.dryRun && s.validation.length) facts.push('Date check against what we verified by hand: ' + s.validation.join(' | '));
  if (s.notScanned.length) facts.push('Ran out of time before scanning ' + s.notScanned.length + ' compan' + (s.notScanned.length === 1 ? 'y' : 'ies') + ' (' + s.notScanned.join(', ') + '). They go first next run.');
  if (s.errors.length) facts.push('PROBLEMS: ' + s.errors.join(' | '));

  // ---- OPTIONS
  const options = [];
  if (nPass > 0) {
    if (nApply) options.push('Apply (' + nApply + '): open each link, apply if you agree, then set YOUR FINAL DECISION in Open Roles to Apply.');
    if (nReview) options.push('Review (' + nReview + '): check the items marked "To check", then choose Apply or Skipped.' + (nExc ? ' Exceptions are past your 10-day window, so they need your explicit yes.' : ''));
    options.push('Disagree with a recommendation? Choose Skipped and grade it (column GRADE MY RECOMMENDATION) so the scoring improves.');
  } else {
    options.push('Nothing needs a decision this time.');
    options.push('To widen coverage, add companies to the Registry (' + (s.registryInfo ? s.registryInfo.feedReady : 0) + ' are on automated feeds, ' + (s.registryInfo ? s.registryInfo.manual : 0) + ' need a manual check).');
    options.push('Companies on their own career pages, and the job boards, are not covered by this script. Ask me for a chat scan.');
  }
  if (s.dryRun) options.push('This was a dry run: nothing was added to Open Roles.');

  // ---- NEXT STEPS
  const next = [];
  if (nPass > 0) next.push('Open the Open Roles tab and make a decision on the new rows.');
  else next.push('No action needed.');
  next.push('Next scheduled scan: ' + s.nextRun);
  if (s.dryRun) next.push('When you are happy with this format and the date checks, switch DRY_RUN to false so passing roles are added to Open Roles automatically.');

  // ---- plain text
  const T = [];
  T.push('EXECUTIVE SUMMARY', '', 'THE FACTS'); facts.forEach(function (f) { T.push('- ' + f); });
  if (nPass > 0) {
    T.push('', 'ROLES READY FOR YOUR REVIEW');
    s.passed.forEach(function (p) {
      T.push('- ' + p.company + ': ' + p.title + ' | ' + p.rec + ' | Fit ' + p.rating + '/5 (rules-based) | Exception: ' + (p.exception || 'none'));
      T.push('  Rationale: ' + p.rationale); T.push('  ' + p.url);
    });
  }
  T.push('', 'YOUR OPTIONS'); options.forEach(function (o) { T.push('- ' + o); });
  T.push('', 'NEXT STEPS'); next.forEach(function (n, i) { T.push((i + 1) + '. ' + n); });
  T.push('', 'Open Roles: ' + s.links.openRoles, 'Full scan results (not listed here): ' + s.links.scanLog);

  // ---- HTML
  const li = function (arr) { return '<ul style="margin:6px 0 14px 18px;padding:0">' + arr.map(function (x) { return '<li style="margin:3px 0">' + esc_(x) + '</li>'; }).join('') + '</ul>'; };
  const h2 = function (t) { return '<h3 style="margin:18px 0 4px;font-size:13px;letter-spacing:.5px;color:#1F3864;text-transform:uppercase">' + t + '</h3>'; };
  let H = '<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#222;max-width:760px">';
  H += '<div style="font-size:18px;font-weight:bold;color:#1F3864">Executive summary</div>';
  H += h2('The facts') + li(facts);
  if (nPass > 0) {
    H += h2('Roles ready for your review');
    H += '<table style="border-collapse:collapse;width:100%;font-size:13px"><tr style="background:#1F3864;color:#fff;text-align:left">' +
      ['Company', 'Title', 'Recommendation', 'Fit rating', 'Exception and rationale'].map(function (c) { return '<th style="padding:6px 8px">' + c + '</th>'; }).join('') + '</tr>';
    s.passed.forEach(function (p) {
      const color = p.rec === 'Apply' ? '#C6E0B4' : '#FFE699';
      H += '<tr style="border-bottom:1px solid #ddd;vertical-align:top">' +
        '<td style="padding:6px 8px"><b>' + esc_(p.company) + '</b></td>' +
        '<td style="padding:6px 8px"><a href="' + esc_(p.url) + '">' + esc_(p.title) + '</a></td>' +
        '<td style="padding:6px 8px"><span style="background:' + color + ';padding:2px 8px;border-radius:3px"><b>' + p.rec + '</b></span></td>' +
        '<td style="padding:6px 8px">' + p.rating + '/5<br><span style="font-size:11px;color:#666">rules-based</span></td>' +
        '<td style="padding:6px 8px">' + (p.exception ? '<b>Exception:</b> ' + esc_(p.exception) + '<br>' : '') + esc_(p.rationale) + '</td></tr>';
    });
    H += '</table>';
  }
  H += h2('Your options') + li(options);
  H += h2('Next steps') + '<ol style="margin:6px 0 14px 18px;padding:0">' + next.map(function (n) { return '<li style="margin:3px 0">' + esc_(n) + '</li>'; }).join('') + '</ol>';
  H += '<div style="font-size:12px;color:#555;margin-top:10px"><a href="' + s.links.openRoles + '">Open Roles</a> &nbsp;|&nbsp; <a href="' + s.links.scanLog + '">Full scan results (not listed here)</a> &nbsp;|&nbsp; <a href="' + s.links.registry + '">Company Registry</a></div></div>';

  return { subject: subject, text: T.join('\n'), html: H };
}

function sendDigest_(s) {
  const mail = buildDigest_(s);
  MailApp.sendEmail({ to: Session.getEffectiveUser().getEmail(), subject: mail.subject, body: mail.text, htmlBody: mail.html });
}

// ============================================================================
// EMAIL CHECK  -  finds company replies in your Gmail and PROPOSES them to you
// ============================================================================
// What it does, in plain words:
//   1. Searches your Gmail (read-only) for messages from the last 14 days. It
//      skips job-alert newsletters and anything you sent.
//   2. Reads each message and decides: Rejection, Next steps, or neither
//      (automatic "we received your application" emails are ignored).
//   3. Matches each reply to ONE application in your Job Tracker (company name,
//      requisition number, role title). If it cannot tell which, it does not guess.
//   4. Writes what it found into the Email Scan Review tab: first response date,
//      type, confidence, subject, a note on how it matched, and a link to the email.
//   5. Adds a row for any application that is not in the tab yet.
//   6. Emails you a short summary, but only when there is something to tell you.
//
// WHAT IT NEVER DOES: it never writes YOUR DECISION (column L) and never changes a
// row you decided or that was auto-approved. It does not write the Job Tracker or
// Dashboard directly: the Sheet's own formulas do that from what it proposes. It
// stores no email text anywhere; it only remembers message IDs it already reported.
//
// WHO DECIDES WHAT (the human-in-the-loop rules)
//   AUTO-APPROVED  A REJECTION that is High confidence: explicit rejection wording,
//                  matched to exactly one application (company plus role title or
//                  requisition number), and the email date does not clash with a date
//                  you entered. Written through to the tracker without a click, listed
//                  in the summary, undone by choosing any option in column L.
//   NEEDS YOU      Everything less certain: a next-steps / interview email, Medium or
//                  Low confidence, mixed wording, an application matched only by role
//                  title among several at one company, or an email date that differs
//                  from a date you entered.
//   AUTOMATIC      No reply found: handled as No Match Found, Ghosted on day 45.
//   FLAGGED        A newer email on a row you decided or that was auto-approved is
//                  listed in the summary; the row itself is never changed.
//   UNMATCHED      An email that looks like a reply but matches no application, or more
//                  than one, is listed with a link; nothing is written.
// The same auto-approve test lives in the Sheet's formulas (see emAutoApprove_) and
// must stay identical in both places.
//
// Menu: "Preview email check" changes nothing and shows what it WOULD do. Run it
// first. The scheduled run happens about an hour after each job scan.

const EM = {
  SHEET_TRACKER: 'Job Tracker', HEADER_TRACKER: 1,
  SHEET_SCAN: 'Email Scan Review', HEADER_SCAN: 4, FIRST_SCAN_ROW: 5, LAST_SCAN_ROW: 300,
  LOOKBACK_DAYS: 14, BACKFILL_DAYS: 60,
  MAX_THREADS: 300, BODY_CHARS: 2500, MAX_RUN_MS: 4.5 * 60 * 1000,
  // Job-alert and newsletter senders: ignored completely.
  NOISE_SENDERS: ['glassdoor.com', 'ziprecruiter.com', 'remotehunter.com', 'theladders.com', 'wellfound.com', 'indeedemail.com', 'calendar-notification@google.com'],
  NOISE_SUBJECT: /\bnew jobs?\b|jobs? (similar|for you|you may)|job alert|recommended (jobs|for you)|talent community|newsletter|security code|verify your|confirm your email|password/i,
  // Company names that are also ordinary words: only trusted when they appear in the sender or subject.
  // Your real list is PRIVATE_CONFIG.genericCompanyNames in Config.gs; this default is used only without one.
  GENERIC_NAMES: [],
  // Tracker spelling -> words the emails actually use. Your real list is PRIVATE_CONFIG.emailAliases in
  // Config.gs: add a line THERE when an email does not match. This default is used only without one.
  ALIASES: {},
  STATE_KEY: 'email_check_reported'
};

// BEGIN EMAIL-CHECK PURE  (no Google services below this line until END: tested outside Apps Script)
const EM_CONDITIONAL = /\b(if|should|once|unless|in the event|in case|provided that)\b/;
const EM_COND_START = /^\s*(if|should|once|unless|in the event|in case|provided that)\b/;
const EM_DISCLAIMER = /(not be able to|unable to|cannot|can't|won't be able to)\s+(respond|reply|contact|get back|follow up|provide feedback)/;
const EM_REJ_EXPLICIT = [
  ['unfortunately', /\bunfortunately\b/],
  ['not moving forward', /\b(not|n't)\s+(be\s+)?(moving|move|proceeding|proceed|advancing|advance|progressing|progress|going\s+to\s+(move|proceed|advance))\b/],
  ['decided not to proceed', /\bnot\s+to\s+(proceed|move|advance|continue|pursue)\b/],
  ['other candidates', /\b(other|another)\s+(qualified\s+)?(candidates?|applicants?)\b/],
  ['role filled or search closed', /\b(position|role|job|opening|search|requisition)\b[^.]{0,40}\b(has|have|had|is|was)\s+(now\s+)?(been\s+)?(filled|closed)\b|\b(filled|closed)\s+(the|this|our)\b[^.]{0,40}\b(role|position|search|opening)\b/],
  ['no longer hiring or considering', /\bno\s+longer\s+(under\s+consideration|being\s+considered|hiring|accepting|available|interviewing|open|recruiting)\b/],
  ['not selected', /\b(not|n't|weren't|wasn't|haven't\s+been)\s+(been\s+)?selected\b/],
  ['regret to inform', /\bregret\s+to\s+inform\b|\bwe\s+regret\b/],
  ['hiring decision made', /\bhiring\s+decision\b/],
  ['not a match', /\bnot\s+(quite\s+|ideally\s+|the\s+right\s+)?(aligned|a\s+(good\s+)?(match|fit)|suited)\b|\bisn't\s+quite\s+aligned\b/],
  ['going a different direction', /\b(going|moving|heading)\s+in\s+a\s+(different\s+)?direction\b/]
];
const EM_REJ_SOFT = [
  ['high volume of applicants', /\boverwhelming\s+(response|number|interest)\b|\breceived\s+(a\s+)?(large|high)\s+number\b|\breceived\s+(so\s+)?many\s+(qualified\s+)?(applicants?|applications?|responses?)\b|\bmultiple\s+qualified\b/]
];
const EM_NEXT = [
  ['asks to schedule a call or interview', /\b(schedule|scheduling|set\s+up|arrange|book|booking)\b[^.]{0,50}\b(call|interview|chat|conversation|meeting|screen|screening|intro|time|slot)\b/, 'High'],
  ['next step in the interview process', /\bnext\s+(step|stage|round)s?\s+(in|of)\s+(the\s+|our\s+)?(interview|hiring|selection|recruiting|recruitment)\s+process\b|\bmove\s+(you\s+)?(forward\s+)?to\s+the\s+next\s+(step|stage|round)\b|\bmove\s+to\s+the\s+next\s+step\b/, 'High'],
  ['invites you to talk', /\binvit(e|ing|ation)\s+you\s+to\s+(an?\s+)?(interview|call|chat|speak|meet|connect)\b|\b(would|love|d)\s+(like\s+)?to\s+(speak|talk|chat|connect|meet|learn\s+more\s+about\s+you|discuss)\b/, 'High'],
  ['phone or video screen', /\b(phone|video|recruiter|initial|intro|introductory)\s+(screen|screening|call|interview)\b/, 'High'],
  ['scheduling link or availability', /calendly\.com|goodtime\.io|cal\.com\/|\bpick\s+a\s+time\b|\bselect\s+a\s+time\b|\byour\s+availability\b/, 'Medium']
];
const EM_RECEIVED = /(received|got) your application|application (has been |was |is )?(received|submitted)|thank(s| you) (so much )?for (applying|submitting|your application)|we('ve| have) received/;
const EM_TITLE_STOP = { and: 1, the: 1, of: 1, for: 1, in: 1, to: 1, at: 1, a: 1, an: 1, or: 1 };
const EM_RANK = { Low: 0, Medium: 1, High: 2 };

function emNorm_(s) {
  return ' ' + String(s || '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim() + ' ';
}
function emCompact_(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ''); }
function emMinConf_(a, b) { return EM_RANK[a] <= EM_RANK[b] ? a : b; }

// Decide what an email is. Sentences with "if / should / once / unless" are ignored for the
// decision, because automatic confirmations are full of "if you are not selected..." lines.
function emClassify_(subject, body) {
  const text = (String(subject || '') + '. ' + String(body || '').substring(0, EM.BODY_CHARS)).replace(/[\u2018\u2019]/g, "'").replace(/\s+/g, ' ').toLowerCase();
  const hits = { rej: [], soft: [], next: [] };
  text.split(/[.!?]+\s+/).forEach(function (sentence, pos) {
    if (EM_DISCLAIMER.test(sentence)) return;
    if (EM_COND_START.test(sentence)) return;                       // "If X, then Y": the whole sentence is conditional
    const live = sentence.split(/\s*(?:,|;|\bbut\b)\s*/).filter(function (c) { return !EM_CONDITIONAL.test(c); }).join(', ');
    if (!live) return;
    EM_REJ_EXPLICIT.forEach(function (p) { if (p[1].test(live)) hits.rej.push({ label: p[0], pos: pos }); });
    EM_REJ_SOFT.forEach(function (p) { if (p[1].test(live)) hits.soft.push({ label: p[0], pos: pos }); });
    EM_NEXT.forEach(function (p) { if (p[1].test(live)) hits.next.push({ label: p[0], pos: pos, conf: p[2] }); });
  });
  const rej = hits.rej.concat(hits.soft), nx = hits.next;
  if (rej.length && !nx.length) {
    return { type: 'Rejection', conf: hits.rej.length ? 'High' : 'Medium', label: (hits.rej[0] || hits.soft[0]).label, mixed: false };
  }
  if (nx.length && !rej.length) {
    const strong = nx.filter(function (n) { return n.conf === 'High'; });
    return { type: 'Next steps', conf: strong.length ? 'High' : 'Medium', label: (strong[0] || nx[0]).label, mixed: false };
  }
  if (nx.length && rej.length) {
    const firstRej = Math.min.apply(null, rej.map(function (x) { return x.pos; }));
    const firstNx = Math.min.apply(null, nx.map(function (x) { return x.pos; }));
    const isRej = firstRej <= firstNx;
    return { type: isRej ? 'Rejection' : 'Next steps', conf: 'Low', label: (isRej ? rej[0] : nx[0]).label, mixed: true };
  }
  return { type: EM_RECEIVED.test(text) ? 'Received' : 'Other', conf: 'Low', label: '', mixed: false };
}

// The auto-approve test. MIRRORED in the Email Scan Review formulas (columns O, R, S, T, V):
// type = Rejection, confidence = High, action is not Review, and there is an email date to write.
function emAutoApprove_(type, conf, action, hasDate) {
  return String(type).trim() === 'Rejection' && String(conf).trim() === 'High' && String(action).trim() !== 'Review' && !!hasDate;
}
// "Fill" = tracker has no first response yet; "Matches existing" = same day as the date you entered;
// "Review" = lower confidence, or the email date differs from a date you entered.
function emActionFor_(conf, curDay, emailDay) {
  if (conf !== 'High') return 'Review';
  if (curDay === null || curDay === undefined) return 'Fill';
  return curDay === emailDay ? 'Matches existing' : 'Review';
}

// Private settings (Config.gs). Read when needed, never at load time, so file order in the project does not matter.
function emPrivate_() { return (typeof PRIVATE_CONFIG !== 'undefined' && PRIVATE_CONFIG) || {}; }
function emAliases_() { return emPrivate_().emailAliases || EM.ALIASES; }
function emGenericNames_() { return emPrivate_().genericCompanyNames || EM.GENERIC_NAMES; }

function emCompanyKeys_(company) {
  const raw = String(company || '').replace(/\(.*?\)/g, ' ').trim();
  const keys = [];
  const base = emNorm_(raw).trim().replace(/\b(inc|llc|ltd|corp|corporation|co|company|group|the)\b/g, ' ').replace(/\s+/g, ' ').trim();
  if (base) keys.push(base);
  (emAliases_()[String(company || '').trim()] || []).forEach(function (a) {
    const k = emNorm_(a).trim();
    if (k && keys.indexOf(k) < 0) keys.push(k);
  });
  return keys;
}

function emCompanyScore_(app, ctx) {
  let best = 0, how = '';
  emCompanyKeys_(app.company).forEach(function (k) {
    const generic = emGenericNames_().indexOf(k) >= 0;      // ordinary-word names: trusted only in the sender
    const ck = k.replace(/ /g, '');
    if (generic) {
      if (ctx.fromNorm.indexOf(' ' + k + ' ') >= 0 && best < 2) { best = 2; how = 'the company name "' + k + '" in the sender'; }
      return;
    }
    const inStrong = ctx.strongNorm.indexOf(' ' + k + ' ') >= 0 || (ck.length >= 5 && ctx.strongCompact.indexOf(ck) >= 0);
    if (inStrong) { if (best < 2) { best = 2; how = 'the company name "' + k + '" in the sender or subject'; } }
    else if (ctx.bodyNorm.indexOf(' ' + k + ' ') >= 0) { if (best < 1) { best = 1; how = 'the company name "' + k + '" in the email text'; } }
  });
  return { score: best, how: how };
}

function emTitleTokens_(title) {
  const seen = {}, out = [];
  emNorm_(title).trim().split(' ').forEach(function (t) {
    if (t.length >= 3 && !EM_TITLE_STOP[t] && !seen[t]) { seen[t] = true; out.push(t); }
  });
  return out;
}
function emTitleHits_(title, textNorm) {
  const toks = emTitleTokens_(title);
  const hit = toks.filter(function (t) { return textNorm.indexOf(' ' + t + ' ') >= 0; }).length;
  return { hit: hit, total: toks.length, frac: toks.length ? hit / toks.length : 0 };
}
function emReqTokens_(text) {
  const found = String(text || '').match(/\b[A-Za-z]{0,3}[-_ ]?\d{4,}\b/g) || [];
  const seen = {}, out = [];
  found.forEach(function (f) { const t = emCompact_(f); if (t.length >= 5 && !seen[t]) { seen[t] = true; out.push(t); } });
  return out;
}

// em: { date: Date, fromName, fromAddr, subject, body }   apps: [{ rowNum, company, title, applied: Date|'', refText }]
function emMatch_(em, apps) {
  const strongText = em.fromName + ' ' + em.fromAddr + ' ' + em.subject;
  const bodyShort = String(em.body || '').substring(0, 1500);
  const ctx = { strongNorm: emNorm_(strongText), strongCompact: emCompact_(strongText), fromNorm: emNorm_(em.fromName + ' ' + em.fromAddr), bodyNorm: emNorm_(bodyShort) };
  const titleText = emNorm_(em.subject + ' ' + bodyShort);
  const reqs = emReqTokens_(em.subject + ' ' + bodyShort);
  const t = em.date.getTime();
  const cands = [];
  apps.forEach(function (a) {
    if (a.applied instanceof Date && a.applied.getTime() - 86400000 > t) return;     // email is older than the application
    const cs = emCompanyScore_(a, ctx);
    if (cs.score > 0) cands.push({ app: a, score: cs.score, how: cs.how });
  });
  if (!cands.length) return { status: 'none' };
  const top = Math.max.apply(null, cands.map(function (c) { return c.score; }));
  const pool = cands.filter(function (c) { return c.score === top; });
  pool.forEach(function (c) {
    const ref = emCompact_(c.app.refText);
    c.reqHit = reqs.some(function (r) { return ref.indexOf(r) >= 0; });
    c.th = emTitleHits_(c.app.title, titleText);
  });
  const ok = function (c, conf, by) {
    return { status: 'ok', app: c.app, how: c.how, by: by, conf: conf, titleSeen: c.th.hit >= 1 || c.reqHit };
  };
  if (pool.length === 1) {
    const c = pool[0];
    return ok(c, (c.score === 2 && (c.th.hit >= 1 || c.reqHit)) ? 'High' : 'Medium', c.reqHit ? 'requisition number' : (c.th.hit >= 1 ? 'company and role title' : 'company only'));
  }
  const byReq = pool.filter(function (c) { return c.reqHit; });
  if (byReq.length === 1) return ok(byReq[0], top === 2 ? 'High' : 'Medium', 'requisition number');
  pool.sort(function (a, b) { return (b.th.hit - a.th.hit) || (b.th.frac - a.th.frac); });
  const best = pool[0], second = pool[1];
  if (best.th.hit >= 1 && (best.th.hit - second.th.hit >= 1 || best.th.frac - second.th.frac >= 0.25)) {
    return ok(best, 'Medium', 'role title (company has several applications)');
  }
  return { status: 'ambiguous', cands: pool.map(function (c) { return c.app; }) };
}
// END EMAIL-CHECK PURE

// ---------------------------- reading Gmail and the Sheet --------------------
function emReadApps_() {
  return readRows_(EM.SHEET_TRACKER, EM.HEADER_TRACKER, {
    company: 'Company', title: 'Title', applied: 'Application Date', channel: 'Channel',
    link: 'Reference Link', site: 'Website', notes: 'Additional Notes'
  }).filter(function (r) { return r.channel === 'Application' && String(r.company).trim() !== ''; }).map(function (r) {
    return { rowNum: r.rowNum, company: String(r.company).trim(), title: String(r.title).trim(), applied: r.applied,
             refText: [r.link, r.site, r.notes, r.title].join(' ') };
  });
}

function emTz_() { return 'America/New_York'; }
function emSerial_(d) {      // a whole-day spreadsheet date, in Eastern time
  const p = Utilities.formatDate(d, emTz_(), 'yyyy-M-d').split('-').map(Number);
  return Math.round(Date.UTC(p[0], p[1] - 1, p[2]) / 86400000) + 25569;
}
function emCellDay_(v) {
  return v instanceof Date ? emSerial_(v) : (typeof v === 'number' ? Math.floor(v) : null);
}

function emReadTab_(sh) {
  const h = headerMap_(sh, EM.HEADER_SCAN);
  const n = Math.max(sh.getLastRow(), EM.FIRST_SCAN_ROW) - EM.FIRST_SCAN_ROW + 1;
  const vals = sh.getRange(EM.FIRST_SCAN_ROW, 1, n, sh.getLastColumn()).getValues();
  const c = function (name) { return need_(h, name) - 1; };
  const col = { row: c('Tracker row'), e: c('First response date'), f: c('Response type'), g: c('Confidence'), j: c('Action'),
                cur: c('Current First Response Date'), dec: c('YOUR DECISION'), p: c('Latest email date'), q: c('Latest email type') };
  const rows = {};
  let lastData = EM.FIRST_SCAN_ROW - 1;
  vals.forEach(function (r, i) {
    if (typeof r[col.row] !== 'number') return;
    const dec = String(r[col.dec]).trim();
    rows[r[col.row]] = { sheetRow: EM.FIRST_SCAN_ROW + i, e: r[col.e], f: String(r[col.f]).trim(), cur: r[col.cur],
                         dec: dec, p: r[col.p], q: String(r[col.q]).trim(),
                         auto: dec === '' && emAutoApprove_(r[col.f], r[col.g], r[col.j], emCellDay_(r[col.e]) !== null) };
    lastData = EM.FIRST_SCAN_ROW + i;
  });
  return { h: h, rows: rows, nextRow: lastData + 1 };
}

function emGatherEmails_(days, me, r) {
  const q = 'newer_than:' + days + 'd -in:sent -in:drafts -in:spam -in:trash -from:(' + EM.NOISE_SENDERS.join(' OR ') + ')';
  let threads = [], start = 0;
  while (threads.length < EM.MAX_THREADS) {
    const batch = GmailApp.search(q, start, Math.min(100, EM.MAX_THREADS - threads.length));
    if (!batch.length) break;
    threads = threads.concat(batch);
    start += batch.length;
    if (batch.length < 100) break;
  }
  if (threads.length >= EM.MAX_THREADS) r.truncated = true;
  const cutoff = Date.now() - days * 86400000;
  const out = [];
  for (let i = 0; i < threads.length; i += 40) {
    const chunk = threads.slice(i, i + 40);
    GmailApp.getMessagesForThreads(chunk).forEach(function (msgs, j) {
      msgs.forEach(function (m) {
        const date = m.getDate();
        if (date.getTime() < cutoff) return;
        const from = String(m.getFrom());
        const mm = /^(.*?)\s*<([^>]+)>\s*$/.exec(from);
        const fromAddr = (mm ? mm[2] : from).toLowerCase();
        if (fromAddr.indexOf(me) >= 0) return;                                   // my own messages
        if (EM.NOISE_SENDERS.some(function (nz) { return fromAddr.indexOf(nz) >= 0; })) return;
        const subject = m.getSubject() || '';
        if (EM.NOISE_SUBJECT.test(subject)) { r.ignored++; return; }
        out.push({ id: m.getId(), date: date, fromName: mm ? mm[1].replace(/"/g, '') : '', fromAddr: fromAddr, subject: subject,
                   body: m.getPlainBody().substring(0, EM.BODY_CHARS),
                   link: 'https://mail.google.com/mail/?authuser=' + encodeURIComponent(me) + '#all/' + chunk[j].getId() });
      });
    });
  }
  r.scanned = out.length;
  return out;
}

function emLoadReported_() {
  try { return JSON.parse(PropertiesService.getScriptProperties().getProperty(EM.STATE_KEY) || '[]'); } catch (e) { return []; }
}
function emSaveReported_(ids) {
  PropertiesService.getScriptProperties().setProperty(EM.STATE_KEY, JSON.stringify(ids.slice(-400)));
}

// ---------------------------- the run ----------------------------------------
// Works out Action and whether the Sheet will auto-approve this finding (the same answer in preview and for real).
function emPrepare_(it, curVal) {
  it.action = emActionFor_(it.conf, emCellDay_(curVal), emSerial_(it.em.date));
  it.auto = emAutoApprove_(it.cls.type, it.conf, it.action, true);
  return it;
}

function emWriteFinding_(sh, h, sheetRow, it, curVal) {
  const put = function (name, v) { sh.getRange(sheetRow, need_(h, name)).setValue(v); };
  emPrepare_(it, curVal);
  put('First response date', emSerial_(it.em.date));
  put('Response type', it.cls.type);
  put('Confidence', it.conf);
  put('Email subject (shortened)', String(it.em.subject).substring(0, 90));
  put('Action', it.action);
  put('Notes', emNote_(it));
  sh.getRange(sheetRow, need_(h, 'Email link')).setFormula('=HYPERLINK("' + it.em.link + '","Open email")');
}

function emNote_(it) {
  return 'Detected: ' + it.cls.label + '. Arrived ' + Utilities.formatDate(it.em.date, emTz_(), 'h:mm a') + ' Eastern on ' +
    Utilities.formatDate(it.em.date, emTz_(), 'M/d') + '. Matched by ' + it.m.by + ' (' + it.m.how + ').' +
    (it.m.titleSeen ? '' : ' The role title was not in the email, so confirm it is this application.') +
    (it.cls.mixed ? ' The email also contains wording of the other kind, so read it.' : '');
}

function emailCheck_(opts) {
  const preview = !!opts.preview, days = opts.days || EM.LOOKBACK_DAYS;
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) { Logger.log('Another run is in progress. Stopping.'); return null; }
  const r = { preview: preview, days: days, newReplies: [], laterEmail: [], flagged: [], unmatched: [], ambiguous: [],
              addedRows: [], scanned: 0, ignored: 0, truncated: false, errors: [], link: '' };
  const startedAt = Date.now();
  let reported = emLoadReported_();
  const fresh = [];
  try {
    const me = Session.getEffectiveUser().getEmail().toLowerCase();
    const apps = emReadApps_();
    const sh = ss_().getSheetByName(EM.SHEET_SCAN);
    r.link = ss_().getUrl() + '#gid=' + sh.getSheetId();
    const tab = emReadTab_(sh);
    const emails = emGatherEmails_(days, me, r);

    const byApp = {};
    emails.forEach(function (em) {
      if (Date.now() - startedAt > EM.MAX_RUN_MS) { r.truncated = true; return; }
      const cls = emClassify_(em.subject, em.body);
      if (cls.type !== 'Rejection' && cls.type !== 'Next steps') { if (cls.type === 'Received') r.ignored++; return; }
      const m = emMatch_(em, apps);
      if (m.status === 'ok') {
        const it = { em: em, cls: cls, m: m, conf: emMinConf_(cls.conf, m.conf), app: m.app };
        (byApp[m.app.rowNum] = byApp[m.app.rowNum] || []).push(it);
      } else if (reported.indexOf(em.id) < 0) {
        (m.status === 'ambiguous' ? r.ambiguous : r.unmatched).push({ em: em, cls: cls, cands: m.cands || [] });
        fresh.push(em.id);
      }
    });

    const wr = function (fn) { if (!preview) fn(); };
    Object.keys(byApp).forEach(function (key) {
      const rowNum = Number(key);
      const items = byApp[key].sort(function (a, b) { return a.em.date - b.em.date; });
      const first = items[0], last = items[items.length - 1];
      const tr = tab.rows[rowNum];
      if (!tr) {                                                                  // application not in the tab yet
        if (tab.nextRow > EM.LAST_SCAN_ROW) { r.errors.push('The Email Scan Review tab is full (row ' + EM.LAST_SCAN_ROW + ').'); return; }
        const at = tab.nextRow++;
        emPrepare_(first, '');
        wr(function () { sh.getRange(at, need_(tab.h, 'Tracker row')).setValue(rowNum); emWriteFinding_(sh, tab.h, at, first, ''); });
        r.newReplies.push(first);
      } else if (tr.dec === '' && !tr.auto) {
        if (tr.f === 'No email found' || tr.f === '') {                           // automatic row: now has a reply
          emPrepare_(first, tr.cur);
          wr(function () { emWriteFinding_(sh, tab.h, tr.sheetRow, first, tr.cur); });
          r.newReplies.push(first);
        }
        const known = Math.max(emCellDay_(tr.e) || 0, emCellDay_(tr.p) || 0);
        const lastDay = emSerial_(last.em.date);
        const firstWritten = (tr.f === 'No email found' || tr.f === '');
        const laterThanFirst = lastDay > emSerial_(first.em.date);
        if (!firstWritten && lastDay > known) {                                  // undecided row with an older reply: a newer one arrived
          wr(function () {
            sh.getRange(tr.sheetRow, need_(tab.h, 'Latest email date')).setValue(lastDay);
            sh.getRange(tr.sheetRow, need_(tab.h, 'Latest email type')).setValue(last.cls.type);
          });
          r.laterEmail.push(last);
        } else if (firstWritten && laterThanFirst && last.cls.type !== first.cls.type) {
          wr(function () {
            sh.getRange(tr.sheetRow, need_(tab.h, 'Latest email date')).setValue(lastDay);
            sh.getRange(tr.sheetRow, need_(tab.h, 'Latest email type')).setValue(last.cls.type);
          });
        }
      } else if (tr.dec !== 'Manual Override') {                                  // you decided, or it was auto-approved: never change it, just tell you
        const known = tr.dec === 'No Match Found' ? null : Math.max(emCellDay_(tr.e) || 0, emCellDay_(tr.p) || 0);
        items.forEach(function (it) {
          if (reported.indexOf(it.em.id) >= 0) return;
          if (known === null || emSerial_(it.em.date) > known) { r.flagged.push({ it: it, decision: tr.dec, auto: tr.dec === '' }); fresh.push(it.em.id); }
        });
      }
    });

    // applications that are not in the tab yet and had no reply: add them as automatic rows
    apps.forEach(function (a) {
      if (tab.rows[a.rowNum] || byApp[a.rowNum]) return;
      if (tab.nextRow > EM.LAST_SCAN_ROW) return;
      const at = tab.nextRow++;
      r.addedRows.push(a);
      wr(function () {
        sh.getRange(at, need_(tab.h, 'Tracker row')).setValue(a.rowNum);
        sh.getRange(at, need_(tab.h, 'Response type')).setValue('No email found');
        sh.getRange(at, need_(tab.h, 'Confidence')).setValue('-');
        sh.getRange(at, need_(tab.h, 'Action')).setValue('No email found');
        sh.getRange(at, need_(tab.h, 'Notes')).setValue('Added automatically by the email check. No reply found yet.');
      });
    });
  } catch (err) {
    r.errors.push('Email check failed: ' + err.message);
  } finally {
    lock.releaseLock();
  }
  if (!preview && fresh.length) { try { emSaveReported_(reported.concat(fresh)); } catch (e) { r.errors.push('Could not save the reported list: ' + e.message); } }
  return r;
}

function emSummary_(r) {
  const tz = emTz_(), label = Utilities.formatDate(new Date(), tz, 'EEE M/d');
  const autoItems = r.newReplies.filter(function (it) { return it.auto; });
  const needItems = r.newReplies.filter(function (it) { return !it.auto; });
  const nAuto = autoItems.length, need = needItems.length;
  const headline = (nAuto ? nAuto + ' auto-approved' : '') + (nAuto && need ? ', ' : '') + (need ? need + (need === 1 ? ' needs' : ' need') + ' your decision' : '');
  const subject = (r.preview ? '[PREVIEW] ' : '') + (r.errors.length ? '[Needs attention] ' : '') +
    'Email check ' + label + ': ' + (headline || 'nothing new needs your decision');
  const when = function (d) { return Utilities.formatDate(d, tz, 'M/d h:mm a'); };
  const line = function (it) { return it.app.company + ': ' + it.app.title + ' | ' + it.cls.type + ' | ' + it.conf + ' confidence | ' + when(it.em.date) + ' | ' + it.em.link; };
  const T = [r.preview ? 'PREVIEW: nothing below was written to your Sheet.' : '', 'EMAIL CHECK (last ' + r.days + ' days, ' + r.scanned + ' messages read)', ''];
  if (nAuto) {
    T.push((r.preview ? 'WOULD BE AUTO-APPROVED' : 'AUTO-APPROVED') + ' (High-confidence rejections, written to your tracker; nothing to do unless one is wrong)');
    autoItems.forEach(function (it) { T.push('- ' + line(it)); });
    T.push('  To undo one, pick any option in column L of that row (Pending Verification holds it).', '');
  }
  if (need) { T.push((r.preview ? 'WOULD NEED YOUR DECISION' : 'NEEDS YOUR DECISION') + ' (Email Scan Review, orange in column V)'); needItems.forEach(function (it) { T.push('- ' + line(it) + ' | ' + (it.cls.type !== 'Rejection' ? 'next-steps email' : it.conf + ' confidence')); }); T.push(''); }
  if (r.laterEmail.length) { T.push('NEWER EMAIL ON A ROW STILL WAITING FOR YOU'); r.laterEmail.forEach(function (it) { T.push('- ' + line(it)); }); T.push(''); }
  if (r.flagged.length) {
    T.push('NEW EMAIL ON AN APPLICATION YOU ALREADY DECIDED OR THAT WAS AUTO-APPROVED (that decision was not changed)');
    r.flagged.forEach(function (f) { T.push('- ' + line(f.it) + ' | ' + (f.auto ? 'auto-approved earlier' : 'you chose: ' + f.decision)); });
    T.push('  If a reply changes the outcome, update that row or tell Claude.', '');
  }
  if (r.ambiguous.length) {
    T.push('LOOKS LIKE A REPLY BUT COULD BE MORE THAN ONE APPLICATION (nothing written)');
    r.ambiguous.forEach(function (a) { T.push('- ' + a.em.subject + ' | ' + a.cls.type + ' | could be: ' + a.cands.map(function (c) { return c.company + ' - ' + c.title; }).join(' / ') + ' | ' + a.em.link); });
    T.push('');
  }
  if (r.unmatched.length) {
    T.push('LOOKS LIKE A REPLY BUT MATCHED NO APPLICATION (nothing written; add a spelling to emailAliases in Config.gs if it is yours)');
    r.unmatched.forEach(function (u) { T.push('- ' + u.em.fromName + ' <' + u.em.fromAddr + '> | ' + u.em.subject + ' | ' + u.cls.type + ' | ' + when(u.em.date) + ' | ' + u.em.link); });
    T.push('');
  }
  if (r.addedRows.length) T.push((r.preview ? 'WOULD ADD ' : 'ADDED ') + r.addedRows.length + ' application' + (r.addedRows.length === 1 ? '' : 's') + ' to the tab as automatic rows: ' + r.addedRows.map(function (a) { return a.company; }).join(', ') + '.', '');
  if (r.truncated) T.push('NOTE: the run hit its size or time limit, so some messages were not read. It will catch up next run.', '');
  if (r.errors.length) T.push('PROBLEMS: ' + r.errors.join(' | '), '');
  T.push('Email Scan Review: ' + r.link);
  const text = T.filter(function (x, i) { return !(x === '' && i === 0); }).join('\n');
  const html = '<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#222;max-width:760px"><pre style="white-space:pre-wrap;font-family:inherit">' + esc_(text) + '</pre></div>';
  const hasNews = nAuto || need || r.laterEmail.length || r.flagged.length || r.ambiguous.length || r.unmatched.length || r.errors.length || r.truncated;
  return { subject: subject, text: text, html: html, hasNews: !!hasNews };
}

// ---------------------------- entry points ------------------------------------
function runEmailCheck() { emRun_({ days: EM.LOOKBACK_DAYS, preview: false, always: false }); }       // scheduled: quiet unless there is news
function checkEmailNow() { emRun_({ days: EM.LOOKBACK_DAYS, preview: false, always: true }); }
function checkEmailLast60Days() { emRun_({ days: EM.BACKFILL_DAYS, preview: false, always: true }); }
function previewEmailCheck() { emRun_({ days: EM.LOOKBACK_DAYS, preview: true, always: true }); }

function emRun_(opts) {
  const r = emailCheck_(opts);
  if (!r) return;
  const mail = emSummary_(r);
  if (opts.always || mail.hasNews) {
    MailApp.sendEmail({ to: Session.getEffectiveUser().getEmail(), subject: mail.subject, body: mail.text, htmlBody: mail.html });
  }
  toast_(mail.subject);
  Logger.log(JSON.stringify({ newReplies: r.newReplies.length, flagged: r.flagged.length, unmatched: r.unmatched.length, ambiguous: r.ambiguous.length, errors: r.errors }));
}


// ============================================================================
// WEEKLY SNAPSHOT  -  an executive summary every Friday around 5 PM
// ============================================================================
// What it does:
//   1. Reads the Dashboard's "Overall" and "By route" sections exactly as shown.
//   2. Works out what CHANGED this week by comparing today's Job Tracker with a
//      saved copy from last Friday (so it finds moves to interview, rejections and
//      new contacts even if you never typed a date). The first run has no saved
//      copy, so it falls back to the dates in your tracker.
//   3. Counts what the scan found (passed roles are listed, failed roles are only
//      counted, with a link to the Scan Log).
//   4. Lists every action that needs you, a health rating, and a short recommendation.
//   5. Adds one row to the Weekly Log (your audit trail of week-over-week numbers).
// "Preview weekly snapshot email" sends the same email but saves nothing, so you
// can test it any time without disturbing the real Friday comparison.

const WK = {
  SHEET_TRACKER: 'Job Tracker', SHEET_DASH: 'Dashboard', SHEET_WEEKLY: 'Weekly Log', SHEET_EMAILSCAN: 'Email Scan Review',
  HEADER_TRACKER: 1, HEADER_WEEKLY: 4, HEADER_EMAILSCAN: 4,
  WINDOW_DAYS: 7,            // "this week" = the last 7 days
  GHOST_WATCH_DAYS: 7,       // flag applications that reach the ghosted line within this many days
  MAX_LIST: 8,               // longest list shown before "+N more"
  SEND_DAY: 'FRIDAY', SEND_HOUR: 17,
  CONTACTED: ['Contacted - no response', 'Responded', 'Actively talking'],
  RESPONDED: ['Responded', 'Actively talking'],
  STATE_KEY: 'weekly_snapshot_state'
};

// ---------------------------- schedule -------------------------------------
function installWeeklySnapshot() {
  removeWeeklySnapshot();
  ScriptApp.newTrigger('sendWeeklySnapshot').timeBased().onWeekDay(ScriptApp.WeekDay[WK.SEND_DAY]).atHour(WK.SEND_HOUR).create();
  toast_('Weekly snapshot scheduled for Friday, sometime between 5 and 6 PM.');
}

function removeWeeklySnapshot() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'sendWeeklySnapshot') ScriptApp.deleteTrigger(t);
  });
}

// "Friday around 5 PM" for the NEXT Friday (today counts only if it is still before 5 PM). Empty if not installed.
function nextSnapshotLabel_(now) {
  if (weeklyScheduleCount_() === 0) return '';
  const tz = Session.getScriptTimeZone();
  const names = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'];
  const target = names.indexOf(WK.SEND_DAY);
  const today = names.indexOf(Utilities.formatDate(now, tz, 'EEEE').toUpperCase());
  let ahead = (target - today + 7) % 7;
  if (ahead === 0 && Number(Utilities.formatDate(now, tz, 'H')) >= WK.SEND_HOUR) ahead = 7;
  const when = new Date(now.getTime() + ahead * 86400000);
  return Utilities.formatDate(when, tz, 'EEEE M/d') + ' around ' + (WK.SEND_HOUR % 12 || 12) + ' ' + (WK.SEND_HOUR >= 12 ? 'PM' : 'AM');
}

function weeklyScheduleCount_() {
  return ScriptApp.getProjectTriggers().filter(function (t) { return t.getHandlerFunction() === 'sendWeeklySnapshot'; }).length;
}

// ---------------------------- entry points ---------------------------------
function sendWeeklySnapshot() { runWeekly_(false); }          // the real one: sends, logs, and remembers
function previewWeeklySnapshot() { runWeekly_(true); }        // same email, saves nothing

function runWeekly_(preview) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) { Logger.log('Another run is in progress. Stopping.'); return; }
  let d = null, mail;
  try {
    d = gatherWeekly_();
    d.preview = preview;
    mail = buildWeeklyEmail_(d);
  } catch (err) {
    mail = {
      subject: '[Needs attention] Weekly snapshot could not be built',
      text: 'The weekly snapshot failed: ' + err.message,
      html: '<p>The weekly snapshot failed: ' + esc_(err.message) + '</p>'
    };
    d = null;
  } finally {
    lock.releaseLock();
  }
  MailApp.sendEmail({ to: Session.getEffectiveUser().getEmail(), subject: mail.subject, body: mail.text, htmlBody: mail.html });
  if (d && !preview) {                                          // send first, then save, so a failed send never uses up the week
    try { saveWeekly_(d); }
    catch (err) {
      MailApp.sendEmail({ to: Session.getEffectiveUser().getEmail(), subject: '[Needs attention] Weekly snapshot was sent but not saved',
                          body: 'The email went out, but saving the Weekly Log row or the comparison copy failed: ' + err.message +
                                '\nNext week the comparison will cover two weeks instead of one.' });
    }
  }
}

// ---------------------------- reading the Sheet ----------------------------
function readRows_(sheetName, headerRow, fields) {
  const sh = ss_().getSheetByName(sheetName);
  if (!sh) throw new Error('Tab not found: "' + sheetName + '"');
  const h = headerMap_(sh, headerRow);
  const n = sh.getLastRow() - headerRow;
  if (n < 1) return [];
  const data = sh.getRange(headerRow + 1, 1, n, sh.getLastColumn()).getValues();
  const cols = {};
  Object.keys(fields).forEach(function (k) { cols[k] = need_(h, fields[k]) - 1; });
  return data.map(function (r, i) {
    const o = { rowNum: headerRow + 1 + i };
    Object.keys(cols).forEach(function (k) { o[k] = r[cols[k]]; });
    return o;
  });
}

function criteriaNumber_(prefix, fallback) {
  const rows = ss_().getSheetByName(CFG.SHEET_CRITERIA).getRange(1, 1, 30, 2).getValues();
  for (let i = 0; i < rows.length; i++) {
    if (String(rows[i][0]).toLowerCase().indexOf(prefix) === 0) return Number(rows[i][1]) || fallback;
  }
  return fallback;
}

// Dashboard sections are read as they appear: heading, then labels, values, captions.
function readTiles_(sheet, headingStart) {
  const vals = sheet.getRange(1, 2, 40, 6).getDisplayValues();            // columns B to G
  for (let r = 0; r < vals.length; r++) {
    if (String(vals[r][0]).indexOf(headingStart) === 0) {
      const labels = vals[r + 1], values = vals[r + 2], captions = vals[r + 3];
      return labels.map(function (l, i) { return { label: l, value: values[i], caption: captions[i] }; })
                   .filter(function (t) { return t.label !== ''; });
    }
  }
  throw new Error('Dashboard section not found: "' + headingStart + '"');
}

function readCheckLine_(sheet) {
  const vals = sheet.getRange(1, 2, 30, 1).getDisplayValues();
  for (let r = 0; r < vals.length; r++) {
    if (/^check (passed|failed)/i.test(String(vals[r][0]))) return { ok: /passed/i.test(String(vals[r][0])), text: String(vals[r][0]) };
  }
  return { ok: null, text: '' };
}

function hash_(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}
function outcomeCode_(o) { return { 'Rejected': 'R', 'Ghosted': 'G', 'Waiting': 'W', 'Interviewing': 'I', 'In process': 'P', 'Offer': 'O' }[o] || 'X'; }
function outreachCode_(s) { return WK.RESPONDED.indexOf(s) >= 0 ? 'R' : (WK.CONTACTED.indexOf(s) >= 0 ? 'C' : 'N'); }
function isoDay_(d) { return d instanceof Date ? d.toISOString().slice(0, 10) : ''; }

function loadWeeklyState_() {
  const raw = PropertiesService.getScriptProperties().getProperty(WK.STATE_KEY);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch (e) { return null; }
}

// ---------------------------- gathering the facts --------------------------
function gatherWeekly_() {
  const rules = readRules_();
  const asOf = rules.asOf, DAY = 86400000;
  const ghostDays = criteriaNumber_('ghosted threshold', 45);
  const tz = Session.getScriptTimeZone();
  const inWin = function (d, days) { return d instanceof Date && d.getTime() > asOf.getTime() - (days || WK.WINDOW_DAYS) * DAY && d.getTime() <= asOf.getTime() + DAY; };
  const ss = ss_();
  const url = ss.getUrl();
  const gid = function (name) { return url + '#gid=' + ss.getSheetByName(name).getSheetId(); };

  const dash = ss.getSheetByName(WK.SHEET_DASH);
  const tilesOverall = readTiles_(dash, 'Overall (every entry');
  const tilesRoute = readTiles_(dash, 'By route (how');
  const check = readCheckLine_(dash);

  const prev = loadWeeklyState_();
  const hasPrev = !!prev;

  // ---- Job Tracker
  const rows = readRows_(WK.SHEET_TRACKER, WK.HEADER_TRACKER, {
    company: 'Company', contact: 'Contact', title: 'Title', applied: 'Application Date', entryType: 'Entry Type', outcome: 'Outcome',
    reached: 'Reached Interview (1/0)', days: 'Days Since Applied', stage: 'Interview Stage Reached', outreach: 'Outreach Status',
    channel: 'Channel', route: 'Route', lastUpdated: 'Last Updated', followUp: 'Follow-Up Due (1/0)'
  }).filter(function (r) { return String(r.entryType).trim() !== ''; }).map(function (r) {
    r.name = String(r.company).trim() || String(r.contact).trim() || '(company not entered)';
    r.titleText = String(r.title).trim();
    r.reachedFlag = Number(r.reached) === 1;
    r.daysNum = Number(r.days);
    r.key = hash_(r.name + '|' + r.titleText + '|' + isoDay_(r.applied));
    const p = hasPrev ? prev.rows[r.key] : undefined;
    r.prev = p ? { outcome: p.charAt(0), reached: p.charAt(1) === '1', outreach: p.charAt(2) } : null;
    return r;
  });
  const apps = rows.filter(function (r) { return r.channel === 'Application'; });

  const newEntries = hasPrev ? rows.filter(function (r) { return !r.prev; }) : rows.filter(function (r) { return inWin(r.applied); });
  const moved = rows.filter(function (r) { return r.reachedFlag && (hasPrev ? (!r.prev || !r.prev.reached) : inWin(r.lastUpdated)); });
  const rejected = rows.filter(function (r) { return r.outcome === 'Rejected' && (hasPrev ? (!r.prev || r.prev.outcome !== 'R') : inWin(r.lastUpdated)); });
  const ghosted = rows.filter(function (r) { return r.outcome === 'Ghosted' && (hasPrev ? (!r.prev || r.prev.outcome !== 'G') : inWin(r.lastUpdated)); });
  const contacted = rows.filter(function (r) { return WK.CONTACTED.indexOf(r.outreach) >= 0 && (hasPrev ? (!r.prev || r.prev.outreach === 'N') : inWin(r.applied)); });
  const responded = hasPrev ? rows.filter(function (r) { return WK.RESPONDED.indexOf(r.outreach) >= 0 && (!r.prev || r.prev.outreach !== 'R'); }) : [];
  const ghostWatch = apps.filter(function (r) { return r.outcome === 'Waiting' && r.daysNum >= ghostDays - WK.GHOST_WATCH_DAYS && r.daysNum < ghostDays; })
                         .sort(function (a, b) { return b.daysNum - a.daysNum; });
  const followUps = rows.filter(function (r) { return Number(r.followUp) === 1; }).length;

  // ---- pace: this week's applications vs the previous four weeks
  const countApps = function (from, to) { return apps.filter(function (r) { return r.applied instanceof Date && r.applied.getTime() > asOf.getTime() - to * DAY && r.applied.getTime() <= asOf.getTime() - from * DAY; }).length; };
  const newApps = apps.filter(function (r) { return inWin(r.applied); }).length;
  const avg4 = (countApps(7, 14) + countApps(14, 21) + countApps(21, 28) + countApps(28, 35)) / 4;

  // ---- routes (for the recommendation)
  const route = function (name) { const g = apps.filter(function (r) { return r.route === name; }); return { n: g.length, iv: g.filter(function (r) { return r.reachedFlag; }).length }; };
  const alone = route('Application alone'), assisted = route('Application + my outreach');

  // ---- Open Roles
  const orRows = readRows_(CFG.SHEET_OPENROLES, CFG.HEADER_ROW_OPENROLES, {
    found: 'Date Found', company: 'Company', title: 'Title', link: 'Link', fit: 'Fit Score (1-5)', rec: 'Recommendation',
    exception: 'Exception Reason', decision: 'YOUR FINAL DECISION', grade: 'GRADE MY RECOMMENDATION (1-5)'
  }).filter(function (r) { return String(r.company).trim() !== ''; });
  const decided = function (r) { return r.decision === 'Apply' || r.decision === 'Skipped'; };
  const newRoles = orRows.filter(function (r) { return inWin(r.found); });
  const awaitingRoles = orRows.filter(function (r) { return !decided(r); });
  const oldestAwaiting = awaitingRoles.reduce(function (m, r) { return r.found instanceof Date ? Math.max(m, Math.floor((asOf.getTime() - r.found.getTime()) / DAY)) : m; }, 0);
  const ungraded = orRows.filter(function (r) { return decided(r) && String(r.grade).trim() === ''; }).length;
  const rolesLast14 = orRows.filter(function (r) { return inWin(r.found, 14); }).length;

  // ---- Scan Log: failed roles are only counted
  const logRows = readRows_(CFG.SHEET_SCANLOG, CFG.HEADER_ROW_SCANLOG, { seen: 'Date First Seen', routing: 'Routing (system)' });
  const failedCount = logRows.filter(function (r) { return inWin(r.seen) && r.routing === 'Skipped'; }).length;
  const passedCount = logRows.filter(function (r) { return inWin(r.seen) && /^Open Roles/.test(String(r.routing)); }).length;

  // ---- Email Scan Review
  const scanRows = readRows_(WK.SHEET_EMAILSCAN, WK.HEADER_EMAILSCAN, { trackerRow: 'Tracker row', decision: 'YOUR DECISION', respType: 'Response type', conf: 'Confidence', action: 'Action', firstDate: 'First response date', curFirst: 'Current First Response Date' })
    .filter(function (r) { return typeof r.trackerRow === 'number'; });
  const scannedSet = {};
  scanRows.forEach(function (r) { scannedSet[r.trackerRow] = true; });
  // Rows with no email found and no first-response date you entered yourself are handled automatically by the sheet
  // (treated as No Match Found), so they are not waiting on you. Everything else with a blank decision is.
  const isAutoNoMatch_ = function (r) { return String(r.decision).trim() === '' && String(r.respType).trim() === 'No email found' && (r.curFirst === '' || r.curFirst === null || r.curFirst === undefined); };
  const isAutoApprovable_ = function (r) { return emAutoApprove_(r.respType, r.conf, r.action, r.firstDate instanceof Date || typeof r.firstDate === 'number'); };
  const emailAwaiting = scanRows.filter(function (r) { return String(r.decision).trim() === '' && !isAutoNoMatch_(r) && !isAutoApprovable_(r); }).length;
  // audit trail of the auto-approve rule: how many it handled, and how many you overrode (the trust measure)
  const emailAutoApproved = scanRows.filter(function (r) { return String(r.decision).trim() === '' && isAutoApprovable_(r); }).length;
  const emailOverridden = scanRows.filter(function (r) { const dd = String(r.decision).trim(); return dd !== '' && dd !== 'Approved' && isAutoApprovable_(r); }).length;
  const emailPending = scanRows.filter(function (r) { return r.decision === 'Pending Verification'; }).length;
  const appsNotScanned = apps.filter(function (r) { return !scannedSet[r.rowNum]; }).length;

  // ---- Registry
  const reg = readRows_(CFG.SHEET_REGISTRY, CFG.HEADER_ROW_REGISTRY, {
    name: 'Company', status: 'Status', added: 'Date added', cover: 'Included in next scan?', checked: 'Last checked'
  }).filter(function (r) { return String(r.name).trim() !== ''; });
  const regActive = reg.filter(function (r) { return r.status === 'Active'; });
  const feedReady = regActive.filter(function (r) { return /^Yes: automated/.test(String(r.cover)); });
  const manualCheck = regActive.filter(function (r) { return /^Yes: manual/.test(String(r.cover)); }).length;
  const notScannable = regActive.filter(function (r) { return /^No:/.test(String(r.cover)); }).map(function (r) { return r.name; });
  const regAdded = hasPrev ? Math.max(0, reg.length - (prev.regCount || reg.length)) : reg.filter(function (r) { return inWin(r.added); }).length;
  const lastScan = feedReady.reduce(function (m, r) { return r.checked instanceof Date && (!m || r.checked > m) ? r.checked : m; }, null);
  const daysSinceScan = lastScan ? Math.floor((asOf.getTime() - lastScan.getTime()) / DAY) : null;

  // ---- health: each issue is something in your control, and the rules are visible
  const issues = [];
  if (newApps === 0) issues.push('No new applications this week.');
  else if (avg4 >= 2 && newApps < avg4 * 0.5) issues.push('Applications are well below your 4-week average (' + newApps + ' vs ' + avg4.toFixed(1) + ').');
  if (awaitingRoles.length > 0 && oldestAwaiting >= 7) issues.push(awaitingRoles.length + ' role' + (awaitingRoles.length === 1 ? '' : 's') + ' waiting on your decision, the oldest for ' + oldestAwaiting + ' days.');
  if (check.ok === false) issues.push('The Dashboard check is failing (usually a row with no Channel).');
  if (emailAwaiting > 10) issues.push('Email scan backlog: ' + emailAwaiting + ' rows undecided.');
  if (daysSinceScan !== null && daysSinceScan > 5) issues.push('The scheduled scan has not updated the Registry in ' + daysSinceScan + ' days.');
  if (rolesLast14 === 0) issues.push('No new roles reached Open Roles in 14 days: the Registry may be too narrow.');
  const health = issues.length === 0 ? { label: 'On track', color: '#2E7D32' } : (issues.length <= 2 ? { label: 'Watch', color: '#B26A00' } : { label: 'Needs attention', color: '#B71C1C' });

  // ---- actions: everything that needs you, stated plainly
  const actions = [];
  if (awaitingRoles.length) actions.push({ text: 'Decide on ' + awaitingRoles.length + ' role' + (awaitingRoles.length === 1 ? '' : 's') + ' in Open Roles (column YOUR FINAL DECISION).', url: gid(CFG.SHEET_OPENROLES) });
  if (ungraded) actions.push({ text: 'Grade ' + ungraded + ' decided role' + (ungraded === 1 ? '' : 's') + ' (column GRADE MY RECOMMENDATION, notes beside it) so we can measure quality.', url: gid(CFG.SHEET_OPENROLES) });
  if (emailAwaiting || emailPending) actions.push({ text: 'Update the Email Scan Review tab: ' + emailAwaiting + ' row' + (emailAwaiting === 1 ? '' : 's') + ' awaiting a decision' + (emailPending ? ' and ' + emailPending + ' on Pending Verification' : '') + '.', url: gid(WK.SHEET_EMAILSCAN) });
  if (appsNotScanned) actions.push({ text: 'Ask Claude to re-run the email scan: ' + appsNotScanned + ' application' + (appsNotScanned === 1 ? ' is' : 's are') + ' not in the Email Scan tab yet.', url: gid(WK.SHEET_EMAILSCAN) });
  if (regAdded === 0) actions.push({ text: 'Expand the search: add companies to the Company Registry (paste the job-board URL, set Status to Active). None were added this week.', url: gid(CFG.SHEET_REGISTRY) });
  if (notScannable.length) actions.push({ text: 'Fix ' + notScannable.length + ' Registry row' + (notScannable.length === 1 ? '' : 's') + ' that cannot be scanned yet: ' + notScannable.join(', ') + '.', url: gid(CFG.SHEET_REGISTRY) });
  if (followUps) actions.push({ text: 'Send follow-ups: ' + followUps + ' item' + (followUps === 1 ? ' has' : 's have') + ' been waiting 14+ days (see the Dashboard follow-up queue).', url: gid(WK.SHEET_DASH) });
  if (check.ok === false) actions.push({ text: 'Fix the Dashboard check: ' + check.text, url: gid(WK.SHEET_DASH) });

  // ---- recommendation: the top three, most important first, with the numbers behind each
  const recs = [];
  if (awaitingRoles.length) recs.push('Decide on the open roles first. Postings lose value fast under your 10-day rule.');
  if (ghostWatch.length) recs.push(ghostWatch.length + ' application' + (ghostWatch.length === 1 ? '' : 's') + ' reach the ' + ghostDays + '-day ghosted line within a week. If you have heard nothing, send a follow-up now.');
  if (assisted.n >= 5 && alone.n >= 5 && assisted.iv / assisted.n > alone.iv / alone.n) {
    recs.push('Pair each application with a message to someone at the company. Applications with outreach convert ' + Math.round(100 * assisted.iv / assisted.n * 10) / 10 + '% (' + assisted.iv + ' of ' + assisted.n + ') versus ' + Math.round(100 * alone.iv / alone.n * 10) / 10 + '% (' + alone.iv + ' of ' + alone.n + ') on their own.');
  }
  if (newApps === 0) recs.push('Send at least a few applications this week' + (avg4 >= 1 ? ' (your 4-week average is ' + avg4.toFixed(1) + ' a week)' : '') + '.');
  if (rolesLast14 === 0 || regAdded === 0) recs.push('Add three to five companies to the Registry so the Monday, Wednesday and Friday scans have more to find.');
  if (emailAwaiting > 0) recs.push('Clear the Email Scan Review backlog so your response times and outcomes are accurate.');
  if (!recs.length) recs.push('Keep the current pace. Nothing is flagged.');

  return {
    asOf: asOf, hasPrev: hasPrev, ghostDays: ghostDays,
    dateLabel: Utilities.formatDate(new Date(), tz, 'EEE M/d'),
    tilesOverall: tilesOverall, tilesRoute: tilesRoute, check: check,
    newEntries: newEntries, moved: moved, rejected: rejected, ghosted: ghosted, contacted: contacted, responded: responded,
    ghostWatch: ghostWatch, newRoles: newRoles, awaiting: awaitingRoles.length, failedCount: failedCount, passedCount: passedCount,
    newApps: newApps, avg4: avg4, issues: issues, health: health, actions: actions, recs: recs.slice(0, 3),
    emailAuto: { approved: emailAutoApproved, overridden: emailOverridden, awaiting: emailAwaiting },
    nextScan: nextRunLabel_(new Date()), nextSnapshot: nextSnapshotLabel_(new Date()),
    links: { tracker: gid(WK.SHEET_TRACKER), dashboard: gid(WK.SHEET_DASH), openRoles: gid(CFG.SHEET_OPENROLES), scanLog: gid(CFG.SHEET_SCANLOG), registry: gid(CFG.SHEET_REGISTRY), emailScan: gid(WK.SHEET_EMAILSCAN) },
    counts: {
      applications: apps.length,
      rejectedApps: apps.filter(function (r) { return r.outcome === 'Rejected' || r.outcome === 'Ghosted'; }).length,
      reached: rows.filter(function (r) { return r.reachedFlag; }).length,
      offers: rows.filter(function (r) { return r.outcome === 'Offer'; }).length,
      waitingApps: apps.filter(function (r) { return r.outcome === 'Waiting'; }).length
    },
    state: { regCount: reg.length, rows: rows.reduce(function (m, r) { m[r.key] = outcomeCode_(r.outcome) + (r.reachedFlag ? '1' : '0') + outreachCode_(r.outreach); return m; }, {}) }
  };
}

// ---------------------------- saving (real Friday run only) ----------------
function saveWeekly_(d) {
  const sh = ss_().getSheetByName(WK.SHEET_WEEKLY);
  const h = headerMap_(sh, WK.HEADER_WEEKLY);
  const cDate = need_(h, 'Snapshot Date');
  const first = WK.HEADER_WEEKLY + 1;
  const dates = sh.getRange(first, cDate, sh.getMaxRows() - first + 1, 1).getValues();
  let row = -1, last = -1;
  dates.forEach(function (r, i) {
    if (r[0] !== '') last = i;
    if (r[0] instanceof Date && isoDay_(r[0]) === isoDay_(d.asOf)) row = first + i;     // same day: overwrite, never duplicate
  });
  if (row < 0) row = first + last + 1;
  const note = 'Auto snapshot. ' + (d.hasPrev ? '' : 'First automatic snapshot (changes came from tracker dates). ') + 'Rejected now includes ghosted.';
  const vals = {
    'Snapshot Date': d.asOf, 'Applications': d.counts.applications, 'Rejected (applications)': d.counts.rejectedApps,
    'Reached Interview (all routes)': d.counts.reached, 'Offers': d.counts.offers, 'Waiting (applications)': d.counts.waitingApps, 'Notes': note
  };
  Object.keys(vals).forEach(function (f) { sh.getRange(row, need_(h, f)).setValue(vals[f]); });   // columns G to I are formulas: never touched
  PropertiesService.getScriptProperties().setProperty(WK.STATE_KEY, JSON.stringify({ savedAt: d.asOf.toISOString(), regCount: d.state.regCount, rows: d.state.rows }));
}

// ---------------------------- the email ------------------------------------
function buildWeeklyEmail_(d) {
  const plural = function (n, w) { return n + ' ' + w + (n === 1 ? '' : 's'); };
  const tag = d.preview ? '[PREVIEW] ' : '';
  const subject = tag + 'Weekly snapshot ' + d.dateLabel + ': ' + d.health.label + ' | ' +
    (d.actions.length ? plural(d.actions.length, 'action') : 'no actions') + ' | ' + plural(d.awaiting, 'role') + ' awaiting your decision' +
    (d.moved.length ? ' | ' + d.moved.length + ' moved to interview' : '');

  const nm = function (r) { return r.name + (r.titleText ? ': ' + r.titleText : ''); };
  const items = function (arr, fn) { return arr.slice(0, WK.MAX_LIST).map(fn); };
  const more = function (arr) { return arr.length > WK.MAX_LIST ? arr.length - WK.MAX_LIST : 0; };
  const S = [];

  // ---- bottom line
  const bl = [];
  bl.push({ type: 'p', text: 'Overall health: ' + d.health.label + '.', health: d.health });
  bl.push({ type: 'ul', items: (d.issues.length ? d.issues : ['No issues flagged this week.']).map(function (t) { return { text: t }; }) });
  S.push({ title: 'Bottom line', blocks: bl });

  // ---- the facts
  const f = [];
  if (!d.hasPrev) f.push({ type: 'note', text: 'First automatic snapshot: this week\u2019s changes come from the dates in your tracker. From next Friday they are exact comparisons with this week.' });
  f.push({ type: 'h', text: 'Overall (every entry, regardless of route)' });
  f.push({ type: 'tiles', tiles: d.tilesOverall });
  f.push({ type: 'h', text: 'By route (how each route is performing)' });
  f.push({ type: 'tiles', tiles: d.tilesRoute });
  f.push({ type: 'h', text: 'This week' });
  const wk = [];
  wk.push({ text: plural(d.newEntries.length, 'new entry').replace('entrys', 'entries') + ' added to your tracker' + (d.newEntries.length ? ':' : '.') , sub: items(d.newEntries, function (r) { return { text: nm(r) }; }), more: more(d.newEntries), moreUrl: d.links.tracker });
  wk.push({ text: 'Roles the scan found: ' + d.passedCount + ' passed' + (d.newRoles.length ? ':' : '.'),
            sub: items(d.newRoles, function (r) { return { text: r.company + ': ' + r.title + ' | ' + r.rec + ', fit ' + r.fit + '/5 (rules-based)' + (String(r.exception).trim() ? ' | Exception: ' + r.exception : ''), url: String(r.link) }; }),
            more: more(d.newRoles), moreUrl: d.links.openRoles });
  wk.push({ text: d.failedCount + ' did not pass your rules.', url: d.links.scanLog, linkText: 'See them in the Scan Log' });
  wk.push({ text: plural(d.moved.length, 'role') + ' moved to an interview' + (d.moved.length ? ':' : '.'), sub: items(d.moved, function (r) { return { text: nm(r) + (r.stage ? ' | ' + r.stage : '') }; }), more: more(d.moved), moreUrl: d.links.tracker });
  wk.push({ text: plural(d.rejected.length, 'role') + ' rejected' + (d.rejected.length ? ':' : '.'), sub: items(d.rejected, function (r) { return { text: nm(r) }; }), more: more(d.rejected), moreUrl: d.links.tracker });
  wk.push({ text: 'Email replies handled automatically: ' + d.emailAuto.approved + ' rejection' + (d.emailAuto.approved === 1 ? '' : 's') + ' auto-approved, ' + d.emailAuto.overridden + ' overridden by you; ' + d.emailAuto.awaiting + ' waiting for your decision.', url: d.links.emailScan, linkText: 'Review them' });
  wk.push({ text: plural(d.ghosted.length, 'role') + ' newly ghosted' + (d.ghosted.length ? ':' : '.'), sub: items(d.ghosted, function (r) { return { text: nm(r) }; }), more: more(d.ghosted), moreUrl: d.links.tracker });
  wk.push({ text: plural(d.contacted.length, 'person').replace('persons', 'people') + ' contacted' + (d.hasPrev ? ' (' + d.responded.length + ' new response' + (d.responded.length === 1 ? '' : 's') + ')' : '') + (d.contacted.length ? ':' : '.'), sub: items(d.contacted, function (r) { return { text: nm(r) }; }), more: more(d.contacted), moreUrl: d.links.tracker });
  f.push({ type: 'ul', items: wk });
  f.push({ type: 'h', text: 'Coming up on the ' + d.ghostDays + '-day ghosted line (within 7 days)' });
  f.push(d.ghostWatch.length
    ? { type: 'ul', items: items(d.ghostWatch, function (r) { return { text: nm(r) + ' | day ' + r.daysNum + ' of ' + d.ghostDays }; }).concat(more(d.ghostWatch) ? [{ text: '+' + more(d.ghostWatch) + ' more', url: d.links.tracker }] : []) }
    : { type: 'p', text: 'None this week.' });
  S.push({ title: 'The facts', blocks: f });

  // ---- actions
  S.push({ title: 'Action required from you', blocks: [d.actions.length
    ? { type: 'ol', items: d.actions.map(function (a) { return { text: a.text, url: a.url, linkText: 'Open' }; }) }
    : { type: 'p', text: 'No action required this week.' }] });

  // ---- recommendation and next steps
  S.push({ title: 'Recommendation (rules-based)', blocks: [{ type: 'ul', items: d.recs.map(function (t) { return { text: t }; }) }] });
  S.push({ title: 'Next steps', blocks: [{ type: 'ol', items: [
    { text: d.actions.length ? 'Work through the actions above, starting with the first.' : 'Nothing to do on your side right now.' },
    { text: 'Automatic: the next scan is ' + d.nextScan },
    { text: d.nextSnapshot ? 'Automatic: the next snapshot arrives ' + d.nextSnapshot + '.' : 'The weekly snapshot is not scheduled yet: use Job Search > Install Friday 5 PM snapshot.' }] }] });

  return renderEmail_(subject, S, d);
}

function renderEmail_(subject, sections, d) {
  const e = esc_;
  const link = function (t, u) { return u ? '<a href="' + e(u) + '">' + e(t) + '</a>' : e(t); };
  const li = function (it) {
    let h = '<li style="margin:3px 0">' + (it.url && !it.linkText ? link(it.text, it.url) : e(it.text)) + (it.url && it.linkText ? ' ' + link('(' + it.linkText + ')', it.url) : '');
    if (it.sub && it.sub.length) {
      h += '<ul style="margin:3px 0 3px 16px;padding:0">' + it.sub.map(function (s) { return '<li style="margin:2px 0;font-size:13px">' + (s.url ? link(s.text, s.url) : e(s.text)) + '</li>'; }).join('') +
           (it.more ? '<li style="font-size:13px">' + link('+' + it.more + ' more', it.moreUrl) + '</li>' : '') + '</ul>';
    }
    return h + '</li>';
  };
  let H = '<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#222;max-width:780px">';
  H += '<div style="font-size:18px;font-weight:bold;color:#1F3864">Weekly job search snapshot</div>';
  const T = ['WEEKLY JOB SEARCH SNAPSHOT'];
  sections.forEach(function (sec) {
    H += '<h3 style="margin:20px 0 4px;font-size:13px;letter-spacing:.5px;color:#1F3864;text-transform:uppercase;border-bottom:1px solid #ddd;padding-bottom:3px">' + e(sec.title) + '</h3>';
    T.push('', sec.title.toUpperCase());
    sec.blocks.forEach(function (b) {
      if (b.type === 'p') {
        H += '<p style="margin:6px 0">' + (b.health ? '<span style="background:' + b.health.color + ';color:#fff;padding:3px 10px;border-radius:3px;font-weight:bold">' + e(b.text) + '</span>' : e(b.text)) + '</p>';
        T.push(b.text);
      } else if (b.type === 'note') {
        H += '<p style="margin:6px 0;font-size:12px;color:#666;font-style:italic">' + e(b.text) + '</p>'; T.push('(' + b.text + ')');
      } else if (b.type === 'h') {
        H += '<div style="margin:12px 0 2px;font-weight:bold">' + e(b.text) + '</div>'; T.push('', b.text);
      } else if (b.type === 'tiles') {
        let rows = '';
        for (let i = 0; i < b.tiles.length; i += 3) {
          rows += '<tr>' + b.tiles.slice(i, i + 3).map(function (t) {
            return '<td style="width:33%;padding:8px 10px;border:1px solid #e0e0e0;vertical-align:top"><div style="font-size:11px;color:#666">' + e(t.label) + '</div><div style="font-size:20px;font-weight:bold;color:#1F3864">' + e(t.value) + '</div><div style="font-size:11px;color:#555">' + e(t.caption) + '</div></td>';
          }).join('') + '</tr>';
        }
        H += '<table style="border-collapse:collapse;width:100%;margin:6px 0 10px">' + rows + '</table>';
        b.tiles.forEach(function (t) { T.push('- ' + t.label + ': ' + t.value + ' (' + t.caption + ')'); });
      } else if (b.type === 'ul' || b.type === 'ol') {
        const tag = b.type;
        H += '<' + tag + ' style="margin:6px 0 10px 18px;padding:0">' + b.items.map(li).join('') + '</' + tag + '>';
        b.items.forEach(function (it, i) {
          T.push((tag === 'ol' ? (i + 1) + '. ' : '- ') + it.text + (it.url ? ' ' + it.url : ''));
          (it.sub || []).forEach(function (s) { T.push('    - ' + s.text + (s.url ? ' ' + s.url : '')); });
          if (it.more) T.push('    - +' + it.more + ' more ' + it.moreUrl);
        });
      }
    });
  });
  H += '<div style="font-size:12px;color:#555;margin-top:16px;border-top:1px solid #ddd;padding-top:8px">' +
       link('Dashboard', d.links.dashboard) + ' | ' + link('Job Tracker', d.links.tracker) + ' | ' + link('Open Roles', d.links.openRoles) + ' | ' +
       link('Scan Log', d.links.scanLog) + ' | ' + link('Company Registry', d.links.registry) + ' | ' + link('Email Scan Review', d.links.emailScan) + '</div></div>';
  return { subject: subject, text: T.join('\n'), html: H };
}
