# AI Governance

*Version 0.2 · 11/13/2026 · Owner: Mickaela Sherman*

This document describes how the job search system is governed: who decides what, what the AI and automation are allowed to do, how risks are controlled, and where the evidence lives. Each section ends with the Responsible AI and AI safety principles it addresses; section 9 summarizes them. Evidence for each change is in the Change Log (`docs/change-log.md`), cited by entry number (CL-…).

**Contents**
1. Scope and ownership
2. Decision rights
3. AI inventory
4. Risks and controls
5. Evaluation and monitoring
6. Change management
7. Incidents
8. Data and security
9. Responsible AI and safety at a glance

---

## 1. Scope and ownership

**Scope.** A human-in-the-loop job search system for my own search. It uses rule-based automation and AI judgment to find new roles at employers I choose to watch, track applications and next steps, and measure what works.

**Accountability.** I am accountable for every decision the system makes, including the ones it makes automatically, because I set the rules that allow them and can override any of them.

**Components and their roles**
- **Scripts** (Google Apps Script) execute my rules the same way every time.
- **The AI fit scorer** (Claude API) judges how well a role fits my background, within gates the script enforces.
- **Claude in chat** researches, analyzes, writes code and edits the Sheet at my request. Code goes live only when I deploy it.

**Principles addressed:** Accountability

---

## 2. Decision rights

**Principle.** I should only be in the loop where the decision matters, but there should always be an audit trail so I can see how decisions were made.

**Autonomy levels**

| Level | Meaning |
|---|---|
| Human only | I decide with no system input |
| 1 Shadow | The system's output is recorded but hidden while I decide |
| 2 Advisory | The system recommends; I decide |
| 3 Act with override | The system decides and acts; my override always wins |
| 4 Autonomous | Not used |

**Decision list**

| Decision | Who decides | Level | Why |
|---|---|---|---|
| Purpose, goals and instructions | Me | Human only | Everything else in the system serves these |
| Which companies are scanned | Me; Claude in chat may suggest companies on request | 2 | I add each company to the Registry. On request, Claude in chat runs a web search for aligned roles at companies outside the Registry, within the no-scraping rule; I decide what to add |
| Changing the rules or the rubric | Me; Claude in chat may propose | 2 | Rules define what the system may do, so only I change them. Every change is recorded |
| Whether a posting passes the rules | System (rule-based) | 3 | It applies my rules identically every time. Every posting is logged with its reason in the Scan Log, so I can review and add any filtered role |
| Apply or Skip | Me | 2 | I see the rules recommendation and AI score, but a wrong choice could cost a real opportunity |
| AI fit score | AI scores six dimensions; the script computes the overall | 2 in Open Roles; 1 in the AI Eval Set | Informational while under evaluation. The Rules-compliance Score is my primary basis for decisions |
| Clear rejection email | System (rule-based) | 3 | Earned on evidence: I approved 34 of 36 proposals by hand. A wrong rejection is cheap and reversible |
| Next-steps or uncertain email | Me | 2 | The system finds, matches and proposes. A mishandled invite could cost an opportunity |
| Offer email | Me | 2 | Always comes to me and is never approved automatically. Approving records the outcome In process; accepting an offer is recorded by me |
| "Couldn't tell" email | Me | 2 | An email the rules can't read, from a company I applied to and with application wording, comes to me instead of being dropped (CL-007, CL-009) |
| Ghosting at 45 days | System (rule-based) | 3 | Applies when no reply is found. Manual Override blocks it. Depends on the email check finding replies |
| Releasing code changes | Me | Human only | Claude writes code; I run the tests and deploy |
| Edits to the live Sheet (mine) | Me | Human only | I enter and update data directly as part of normal use |
| Edits to the live Sheet (Claude in chat) | Claude in chat, at my request | 3 | Takes effect immediately under written operating rules. Version history can reverse any edit |

**Earning and losing autonomy.** Every change in a component's level is recorded in the Change Log with the evidence behind it.

- **Email auto-approval** (level 3)
  - **Review** after 1 override of an auto-approved row.
  - **Pause** after 2 overrides within a rolling 14 days. That decision returns to level 2; the email check keeps running.
  - **Restore** when the cause is fixed, a test covers it, and 2 consecutive runs are clean.
- **AI fit score** (level 2, informational)
  - **Promotion** requires its expanded role to be defined, and blind batches to meet target in 3 consecutive batches: at least 80% within one point, and zero cases of AI 4-5 where I rated 1.
  - **Demotion** criteria are set at the time of promotion.
  - **Until then**, I monitor whether my decisions follow the AI score. Checked 11/12/2026: no conclusion yet (CL-015).

**Hard limits.** Regardless of evidence:
1. The system never makes the final Apply or Skip decision.
2. Interview invites, next-steps and offer emails always come to me.
3. Every posting scanned is logged with the reason it passed or was filtered out.
4. Only High-confidence rejections are approved automatically. Anything ambiguous comes to me. Emails the rules can't read, from a company I applied to, come to me; none are dropped silently.
5. Job boards are never scraped.
6. The system never contacts employers or applies on my behalf. Its only outgoing email is reports to me.
7. The AI never sees my ratings before it scores.
8. AI spending cannot exceed the hard cap.

**Principles addressed:** Accountability · Human oversight · Safety: limits on unsupervised action (autonomy levels, hard limits)

---

## 3. AI inventory

Two components use AI. Everything else is rule-based automation: it does exactly what its rules say and can be fully tested. I keep them separate because they fail differently. Rules fail the same way every time, so tests catch them. AI can fail differently on similar inputs, so it needs ongoing evaluation. Rule-based is not risk-free: tests only cover the inputs someone thought of, so the rules also get a periodic audit (section 5).

**AI components**

| Component | What it does | What it receives | What it produces | Level | How it is checked |
|---|---|---|---|---|---|
| **AI fit scorer** (Claude API, model `claude-sonnet-5-5`, pinned in the code) | Judges how well one posting fits my background | The posting text; my profile and rubric from the Criteria tab. **Never my ratings** | Six dimension scores (1-5), a rationale and a confidence level. The script computes the overall score from my weights and five gates | 2 in Open Roles; 1 in the AI Eval Set | Blind batches (System Metrics section 1). Every score records its rubric version; every call is logged with its cost and model (AI Score Log) |
| **Claude in chat** | Research, analysis, drafting, code, Sheet edits at my request | What I share, the Project files, and the connected tools I allow (Google Sheets; Gmail, read only, when I approve) | Proposals, code, Sheet edits, Change Log entries | 2 for code (I test and deploy); 3 for Sheet edits under written operating rules | Tests before every deploy; readback after every Sheet write; criteria set before results |

**Cost limit.** The scorer stops calling the API when its monthly estimate passes $5. The spending limit in the Anthropic Console is the hard cap.

**Rule-based automation (not AI)**

| Component | What it does | Level |
|---|---|---|
| **Scan** | Checks the public job feeds of companies in my Registry (no scraping) and applies my rules: age, reposts, pay, location, experience. Every posting is logged with its reason | 3 |
| **Email check** | Phrase rules classify replies; a matcher links them to applications. Auto-approves High-confidence rejections; sends next steps, offers and unreadable emails to me | 3 for clear rejections; 2 for everything else |
| **Ghosting** | Marks an application ghosted at 45 days with no reply found | 3 |
| **Reports** | Run summaries, the Friday snapshot and the Dashboard | Informational |

**Principles addressed:** Transparency · Accountability · Safety: cost limits and logging

---

## 4. Risks and controls

Each risk lists what prevents it, what detects it and what corrects it, plus the risk that remains. Every control eventually fails, so each risk needs an answer to "how would we know?": a risk with only prevention fails silently.

| Risk | Prevent | Detect | Correct | Remaining risk |
|---|---|---|---|---|
| **A reply is missed silently** (Company A, Company B, Company F) | Phrase rules read contractions; unreadable emails from companies I applied to come to me instead of being dropped (CL-007, CL-009) | 60-day preview audit after any email-check change; missed-reply log and known-errors count (CL-010, CL-011) | I record the reply by hand; the row stops auto-ghosting while unresolved | Unlikely by design, not impossible: a reply with no recognizable wording from an unrecognized sender is still missed |
| **Noise reaches me and I start ignoring it** | Job-alert senders blocked; "Couldn't tell" needs application wording; quoted history ignored (CL-009) | "Couldn't tell" precision on System Metrics; hand count at each audit | Tune senders and wording; each change is a Change Log entry | New alert formats can slip through until added |
| **A wrong automatic rejection** | Only High-confidence rejections are auto-approved; anything mixed or uncertain comes to me | Override count on System Metrics and in the Friday snapshot | Auto-approval pauses after 2 overrides in 14 days (section 2) | Low; a wrong rejection is cheap and reversible |
| **The AI overrates fit** (it leans generous on blind batches) | Five gates cap the overall score; the AI is informational only; the final Apply or Skip is always mine | Blind batches: within one point, signed average, average distance (CL-013) | Rubric and gate changes, tested before and after (CL-002, CL-005, CL-006) | Known: the AI can still overrate depth and domain fit |
| **The AI score steers my decisions** (automation bias) | The rules-compliance score is my primary basis; the AI is labeled informational | Hand check, 11/12/2026: no conclusion yet (CL-015) | A blind decision check if a pattern appears | Can't be measured from inside; a small sample |
| **Instructions hidden in a posting manipulate the AI** (prompt injection) | The prompt marks posting text as untrusted data, wrapped in delimiters, and tells the model to ignore instructions inside it. The AI can only return six scores through a fixed tool; the script computes the overall score and applies the gates | No adversarial test yet (parked) | n/a | Untested |
| **Rules drift from what I intend** (Product range drift) | Rules live on the Criteria tab, changed only through the Change Log | Range test compares the rules against 2,268 fictional postings (CL-005) | Fix and re-test | Low |
| **A code change breaks something live** | Tests run before every deploy; criteria set before results; staged and report-only releases | Readback and live checks after deploy | Redeploy the previous version from Git | Changes can reach live data before their after-deploy check (the 11/10 noise incident) |
| **A finding is linked to the wrong application** | Matching by company and role; ambiguous matches come to me | Weekly tie-out check on the Dashboard | Manual Override | Links use row numbers; a permanent Entry ID is parked |
| **A posting is filtered out wrongly** | Every posting is logged with its reason | I can review the Scan Log | I add any filtered role by hand | Board errors and the scan time-out (parked) |
| **AI cost overrun** | Script stops at a $5/month estimate | Every call is logged with its cost | Console spend limit is the hard cap | Very low |
| **The vendor changes the model's behavior** | Model version pinned in the code | Blind batches would show a shift | Re-evaluate before trusting new scores | Covered further in section 6 |

**Principles addressed:** Safety · Reliability · Human oversight · Accountability

---

## 5. Evaluation and monitoring

**Principle.** Every component is checked by a method suited to how it fails: rules by tests, the AI by blind evaluation, and both by monitoring once live. Success criteria are written before results are seen, including what counts as inconclusive, and are written so the test can actually fail.

**The AI fit scorer: blind batches**
- **Method.** Each week a random, seeded draw of up to 10 postings (at most 2 per company). I rate each one blind; the AI's scores stay sealed until I've rated every posting. Closed postings are excluded.
- **Targets.** At least 80% within one point of my rating; signed average between −0.5 and +0.5; zero cases of AI 4-5 where I rated 1. Average distance (signs ignored) is reported beside the signed average, with no target yet, because misses in opposite directions cancel in an average.
- **Results as of 11/13/2026**

  | Set | Postings | Within one point | Signed average | Average distance | Meets all targets |
  |---|---|---|---|---|---|
  | Training (10/15) | 21 | 62% | +1.57 | 1.57 | No |
  | Batch 1 | 9 | 100% | +0.56 | 0.78 | No |
  | Batch 2 | 7 | 86% | +1.00 | 1.00 | No |
  | Batch 3 | 10 | 90% | +0.50 | 0.90 | No |

- **Reading.** The AI leans generous. Batch 2's misses all went one way (signed average equals distance); Batch 3's went both ways and partly cancelled. Promotion beyond informational needs 3 consecutive batches meeting all targets (section 2).

**Rules and code: tests and before/after checks**
- Seven test files run before every deploy, including a private file of real emails that never reaches the repository. New tests are run against the old code first, to prove they can fail.
- Rule changes are tested on sealed past scores before they go live (for example, CL-002 on Batches 2 and 3).
- The range test compares the rules against 2,268 fictional postings (CL-005).

**The email check: tests plus audit**
- Tests cover phrasing, contractions, quoted history and job-board formats.
- The 60-day preview is the audit: it reads real mail and writes nothing. It is run after any change to the email check, and it found what tests couldn't (CL-007, CL-009).

**Monitoring once live**
- **System Metrics:** blind-batch results; the email share **with its known errors** (missed replies, "Couldn't tell" precision, overridden auto-approvals); AI cost; time saved.
- **Dashboard:** summary line (the email share is never shown without its known missed replies) and weekly tie-out check.
- **Friday snapshot email:** week-over-week changes and actions for me.

**When results are inconclusive.** Each test states in advance what counts as too little data and what happens next (for example, CL-002 needed 4 qualifying postings; with 3, it pools Batches 3 and 4, decided before Batch 4 was seen).

**Known limits.** One rater (me), so no inter-rater agreement. Small samples (7-10 postings per batch). Agreement on live decisions can't separate shared judgment from influence (CL-015).

**Principles addressed:** Reliability · Transparency · Accountability · Fairness to my own judgment (blind rating)

---

## 6. Change management

**What counts as a change:** code; rules and the rubric; Sheet formulas and structure; the AI model; autonomy levels; data sources (including which email senders are ignored); and test expectations (CL-008).

**How a change is made**
1. **Log it first:** what changes, why, and acceptance criteria, including what counts as inconclusive. Dated, before any results.
2. **Approve:** I approve every change.
3. **Build and test:** new tests are run against the old code first, to prove they can fail.
4. **Release:** I deploy. Larger changes are staged (for example, Sheet formulas before the code that writes new values). New behavior that writes to live data is released in report-only mode first, and writes only after a clean preview (lesson of the 11/10 noise incident).
5. **Verify:** readback and the entry's after-deploy criteria.
6. **Record the result honestly,** including criteria not met as written.
7. **Roll back** if needed: every entry states how.

**One change per entry.** A change to a test's expected result is its own entry, not a footnote to the change it supports (CL-008).

**Freeze windows.** During a data cut (11/9-11/13/2026), nothing is deployed except fixes for real breaks, recorded as mid-cut changes so the numbers can be read correctly.

**Corrections.** Errors in the record are corrected openly with a note, never silently (for example, dates corrected 11/10/2026).

**Vendor and model changes.** The AI model is pinned in the code (`claude-sonnet-5-5`), and every score records which model produced it. Before switching models, or when the vendor retires one: log the change, re-run a blind batch, and compare before trusting new scores. Claude in chat may also change over time; tests, readback and written operating rules keep its work checkable whatever the model.

**Principles addressed:** Accountability · Reliability · Transparency

---

## 7. Incidents

**What counts as an incident:** anything that produced a wrong result, lost information, or let a control fail, including mistakes by me or by Claude.

**Response:** contain the harm, fix it, record it (date, impact, cause, how it was detected), then add a control or a regression test so it can't recur unnoticed. An incident isn't closed until that control exists, or is parked with a date.

**Severity:** **High** could cost an opportunity · **Medium** wrong data recorded or shown · **Low** cosmetic, or caught before any harm.

| Date | Incident | Severity | Detected by | Cause | Control added |
|---|---|---|---|---|---|
| ~10/20 | Tracker rows inserted with no formulas (second time) | Medium | Missing Dashboard entry | The never-insert rule depends on memory | Formulas restored; a missing-formula check is parked |
| 10/22 | Company A rejection missed, then auto-ghosted | Medium (High had it been an invite) | Me | "won't" not read | CL-007; regression test on the real email |
| 10/23 | Email finding shown on the wrong application | Medium | Me | Findings linked by row number; row 122 reused | Row reset; a permanent Entry ID is parked |
| 10/26 | Company B rejection missed | Medium | Me (~11/2) | Same as 10/22 | CL-007 |
| 10/30 | Dashboard tie-out check failing | Low | The tie-out check | New row with no Channel | Fixed by me |
| 11/2 | Product experience range drifted | Medium | Me | One change reached one of three copies | CL-005: one source of truth, a range test |
| Before deploy | AI Safety range conflict | Low | Me, before deploying | Conflicting ranges | Caught in review |
| 11/5 | Company F application update dropped | Medium | 60-day preview (11/10) | Wellfound blocked as a whole sender | CL-009 |
| 11/8 | Change Log entries misdated (by Claude) | Low | Same day | Date taken from a file name | Rule: dates come from the system |
| 11/10 | Five noise "Couldn't tell" rows written | Medium | Sheet check after the preview | CL-007 went live before its noise check | CL-009; report-only-first rule (section 6) |
| 11/10 | Change Log entries misdated (by Claude) | Low | Claude, from an email's date | Date assumed, not confirmed | Corrected openly; date confirmed with me |
| 11/13 | Private test file offered for commit on the governance branch | Low (caught before commit) | My check of the Changes list | The ignore rule existed only on main | Rule broadened to `PRIVATE_*` in every folder; main merged into governance |

**Principles addressed:** Accountability · Transparency · Safety: learning from failures

---

## 8. Data and security

**What the system handles**

| Data | Where it lives | Who can see it |
|---|---|---|
| Tracker, decisions, notes, Change Log | Google Sheet | Me (private) |
| Email | My Gmail. The email check reads replies matching its search and records the date, subject and a link in the Sheet. It sends only reports to me | Me |
| Job postings | Public job feeds of companies in my Registry. Job boards are never scraped | Public data |
| My profile and rubric | Criteria tab. Only the profile and rubric blocks are sent with each posting to the AI fit scorer; the pay floors on the same tab are not | Me; the AI vendor under its API terms |
| Code and tests | Public GitHub repository, containing only code, fictional test data and redacted documents | Anyone |
| Real email text used in tests | `PRIVATE_` files on my computer only, excluded from the repository in every folder | Me |

**What the AI receives.** The scorer receives my name, my profile (strengths, tools, years of experience, gaps) and my rubric, plus the posting's company, title, link and text. It never receives my pay, my ratings, my email or my tracker. Claude in chat reads the Sheet and, when I approve, Gmail (read only), to do work I ask for.

**Secrets.** The API key lives in the script's private settings (Script Properties), never in code or the repository. Private configuration (`Config.gs`) and every `PRIVATE_` file are excluded by `.gitignore`.

**What may be made public.** Nothing public contains real company names, people's names other than mine, email addresses, pay amounts or my home city.
- **Consistent placeholders:** employers become letters (Company A…), agencies become Agency X. A private key keeps the letters consistent across every document, so no two documents can be compared to recover a name.
- **Redact the source, never instruct:** screenshots and data are redacted before any AI or tool builds with them. An instruction to blur can be missed; a redacted file can't leak what it no longer contains.
- **Scan after redacting:** each redacted file is checked against the list of real names before release.
- **Snapshots, not live links:** shared dashboards use a fixed, redacted copy. A live connection would show real data to every reader.
- **Fictional test data:** public tests use fictional names that keep the original wording.

**Controls that depend on habit.** An ignore rule only protects the branches that have it, and only files named to match it (the 11/13 incident). The real control is checking GitHub Desktop's Changes list before every commit.

**Principles addressed:** Privacy · Security · Transparency

---

## 9. Responsible AI and safety at a glance

| Principle | How the system meets it | Where |
|---|---|---|
| **Accountability** | I own every decision, including automatic ones; every change is logged with criteria and approval | Sections 1, 6; Change Log |
| **Human oversight** | Autonomy levels; hard limits; the final Apply or Skip is always mine; my override always wins | Section 2 |
| **Transparency** | Every posting logged with its reason; every AI score shows its rationale, rubric version and model; known errors shown beside every success rate | Sections 3, 5 |
| **Reliability** | Tests that are proven able to fail; blind evaluation; audits; staged and report-only releases | Sections 5, 6 |
| **Safety: limits on unsupervised action** | The system never contacts employers or applies for me; only clear rejections are automatic; anything uncertain comes to me | Section 2 |
| **Learning from failure** | Every incident ends in a control or regression test, including my mistakes and Claude's | Section 7 |
| **Privacy and security** | Secrets outside code; private files excluded; redaction before anything is public | Section 8 |
| **Fairness** | The system judges roles, not people, for one candidate. The fairness risk is to my own judgment: the AI could anchor it. Blind rating protects the evaluation; the influence on live decisions is not yet measurable (CL-015) | Sections 2, 5 |
| **Cost control** | Script budget plus the vendor's hard spending cap | Section 3 |

---

## Revision history

| Version | Date | Change |
|---|---|---|
| 0.1 | 10/25/2026 | Sections 1 and 2 drafted |
| 0.2 | 11/13/2026 | Sections 3-9 added; section 2 updated for offer and "Couldn't tell" emails, hard limits 2 and 4, and the 11/12 automation-bias check (CL-015) |
