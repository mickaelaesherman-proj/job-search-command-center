/**
 * Config.example.gs  -  TEMPLATE for the private Config.gs.
 *
 * Copy this file to apps-script/Config.gs and fill in your own values. Config.gs is listed in
 * .gitignore, so your real values never reach GitHub. This template lives outside apps-script/
 * so clasp never pushes it (two PRIVATE_CONFIG definitions would conflict).
 */
var PRIVATE_CONFIG = {
  // The Sheet the script is attached to (used only if the script runs detached from it).
  spreadsheetId: 'YOUR_SPREADSHEET_ID',

  // Scan: the companies scanned while DRY_RUN is true (testing mode).
  dryRunCompanies: ['Example Co'],

  // Email check: company names that are also ordinary words (for example a company called "Forward").
  // They are trusted only when they appear in the sender, never in the email text.
  genericCompanyNames: ['forward'],

  // Email check: your tracker spelling -> the words employer emails actually use.
  emailAliases: {
    'PayPath by Summit': ['summit']
  }
};
