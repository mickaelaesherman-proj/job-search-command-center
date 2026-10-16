// Run from the repository root: node tests/snapshot_test.js
const fs = require('fs'), path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'apps-script', 'JobSearch_Automation.gs'), 'utf8');
// pull the snapshot's own counting lines straight out of the script under test
const a = src.indexOf('// Rows with no email found and no first-response date');
const b = src.indexOf('const emailPending');
if (a < 0 || b < 0) throw new Error('snapshot lines not found');
const pure = src.match(/function emAutoApprove_[\s\S]*?\n\}/)[0];
const fn = new Function('scanRows', pure + '\n' + src.slice(a, b) + '\nreturn { emailAwaiting, emailAutoApproved, emailOverridden };');

const D = new Date();
const row = (decision, respType, conf, action, firstDate, curFirst) => ({ decision, respType, conf, action, firstDate: firstDate === undefined ? '' : firstDate, curFirst: curFirst === undefined ? '' : curFirst });
const rows = [
  row('', 'Rejection', 'High', 'Fill', D),                    // auto-approved
  row('', 'Rejection', 'High', 'Matches existing', D, D),     // auto-approved
  row('', 'Rejection', 'Medium', 'Review', D),                // needs you
  row('', 'Next steps', 'High', 'Fill', D),                   // needs you
  row('', 'Rejection', 'High', 'Review', D, D),               // needs you (date clash)
  row('', 'No email found', '-', 'No email found', ''),       // automatic
  row('', 'No email found', '-', 'No email found', '', D),    // needs you (you entered a date)
  row('Approved', 'Rejection', 'High', 'Fill', D),            // your own earlier approval: agreement, not an override
  row('Pending Verification', 'Rejection', 'High', 'Fill', D),// you undid an auto-eligible row: override
  row('No Match Found', 'Rejection', 'High', 'Fill', D),      // override
  row('Manual Override', 'Next steps', 'Medium', 'Review', D) // not auto-eligible, not an override of the rule
];
const r = fn(rows);
let ok = true; const eq = (n, got, want) => { const p = got === want; ok = ok && p; console.log((p ? 'PASS' : 'FAIL') + '  ' + n + ': ' + got + (p ? '' : ' (wanted ' + want + ')')); };
eq('rows waiting for you (matches the sheet header "NEEDS YOUR DECISION")', r.emailAwaiting, 4);
eq('auto-approved rows', r.emailAutoApproved, 2);
eq('overrides of the auto-approve rule', r.emailOverridden, 2);
console.log(ok ? 'ALL PASS' : 'FAILURES'); process.exit(ok ? 0 : 1);
