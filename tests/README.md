# Tests

Run from the repository root with Node.js 18 or later (Python 3 for the last one). No network, API key, Google account or real data is used: Google's services and the Claude API are replaced by in-memory fakes.

| Command | What it checks |
|---|---|
| `node tests/ai_scoring_test.js` | AI scoring: gates and math, prompts never contain your ratings, sealed blind batches, reveal and fingerprints, API errors and budget, email wording (97 checks) |
| `node tests/email_test.js` | Email check: classifying rejection, next-steps and automatic emails; matching a reply to one application; the auto-approve rule (97 checks) |
| `node tests/sim_test.js` | The whole email check run against a fake Gmail and a fake spreadsheet, including preview mode and failures (41 checks) |
| `node tests/snapshot_test.js` | The weekly snapshot's backlog and auto-approval counts agree with the Sheet's rule |
| `node tests/alias_test.js` | Renamed headers still resolve in either order |
| `python3 tests/eval_analysis.py` | The rubric v1 evaluation (21 rated postings, numbers only) and the what-if rubric tests |

All companies, people, requisition numbers and email addresses in the tests are fictional. The email wording mirrors real employer emails so the classifier is tested on realistic language. `test_config.js` stands in for the private `Config.gs`.

These tests mock Google's services, so a change still needs one real run (the Preview menu items) before you rely on it.
