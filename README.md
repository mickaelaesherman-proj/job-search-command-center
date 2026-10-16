# Job Search Command Center

A rules-based job search workflow with a measured AI judgment layer, built on Google Sheets and Google Apps Script.

I built this to run my own job search and to build hands-on fluency in workflow automation and AI agents. The system finds and checks job postings, tracks employer replies, reports weekly, and uses the Claude API to judge how well each role fits me. The AI's judgment is tested blind against my own ratings every week, and it earns more responsibility only when the evidence says it should.

> Built by Mickaela Sherman. Code written with Claude (Anthropic) as an AI coding partner: I set the requirements, rules, design decisions and acceptance criteria, and reviewed and tested every change.

## The problem

A job search produces a lot of repetitive admin: checking whether a posting is fresh, in my pay range and in an acceptable location; tracking which employers replied; sweeping email for missed replies; and pulling weekly numbers together. It also needs judgment: is this role a real fit? I wanted to automate the admin, keep a human in the loop where decisions matter, and find out how far AI judgment can be trusted.

## What it does

| Component | What it does | Who decides |
|---|---|---|
| **Scan** (Mon/Wed/Fri) | Reads public job feeds from a registry of employers, applies my rules (title tier, freshness, reposts, pay, location, experience) and logs every posting with a reason | Rules route; I decide |
| **Email check** (Mon/Wed/Fri) | Matches employer replies in Gmail to applications. Clear rejections are auto-approved; anything uncertain is escalated to me | Escalate by exception |
| **AI fit scoring** (Mon/Wed/Fri) | Scores every undecided role against a six-dimension rubric using the Claude API; suggests an action | AI suggests; I decide |
| **Blind evaluation** (weekly) | Draws up to 10 postings, seals the AI's scores, and reveals them only after I rate every posting | Measures the AI |
| **Weekly snapshot** (Friday) | Emails a summary and logs the week | Reporting |
| **Dashboard and System Metrics** | Job search outcomes; AI accuracy, monitoring, cost and time saved | Live formulas |

## Design principles

- **Rules first, AI second.** Fixed, auditable rules handle everything a rule can decide. The AI judges only what rules cannot: fit.
- **The AI never decides.** It suggests; I decide; both are recorded and frozen at decision time.
- **Escalate by exception.** The system handles routine cases and asks me only about uncertain ones, after I found that approving every result kept the workload the same.
- **Measure before trusting.** AI accuracy is measured only on blind tests. Suggestions I see before deciding are tracked for drift, not counted as accuracy.
- **Honest metrics.** Time saved counts only work after discovery (job boards stay manual for compliance reasons), subtracts my own review time, and labels every figure as measured or estimated.
- **Source compliance.** Job boards are browsed manually only. Automation reads employer pages and public job feeds, read-only.

## How the AI judgment works

The AI gives six dimension scores (scope, skills, level, technical depth, career trajectory, passion), each 1-5. The script, not the AI, computes the overall score from weights on the Criteria tab and applies five **gates**, ceilings that encode dealbreakers (for example, a level well above my experience caps the overall at 2). Prompts contain only the posting text, my profile and the rubric; posting text is treated as untrusted data.

Rubric version 1 was tested blind on 21 postings: it scored higher than me 19 times, landing within one point only 62% of the time. Version 2 adds the gates and stricter skills scoring, and is now being validated on weekly blind batches. See [docs/ai-evaluation.md](docs/ai-evaluation.md).

## Repository layout

```
apps-script/                  The Apps Script project (what clasp pushes to Google)
  JobSearch_Automation.gs     Scan, rules engine, email check, weekly snapshot
  AI_Scoring.gs               AI fit scoring, blind batches, reveal, logging
  Config.gs                   PRIVATE settings: not in this repository (see config/)
config/Config.example.gs      Template for the private settings file
tests/                        Node.js and Python tests with fictional data
docs/                         Architecture, AI evaluation method, security and privacy
```

Personal settings (the Sheet ID and the company-name lists the email check uses) live in a private `Config.gs` that stays in the Apps Script project and is excluded by `.gitignore`.

## Running the tests

Requires Node.js 18 or later (and Python 3 for the evaluation script). No network access, API key or real data is used. About 240 automated checks in total; see [tests/README.md](tests/README.md).

```
node tests/ai_scoring_test.js
node tests/email_test.js
node tests/sim_test.js
```

## Security and privacy

No API keys, spreadsheet IDs, email content, application history or personal contact details are stored in this repository. Test data is fictional. The API key lives in Apps Script's Script Properties. See [docs/security-and-privacy.md](docs/security-and-privacy.md).

## Status

In active use since October 2026. Live results (AI accuracy by batch, time saved, automation share) are tracked on the System Metrics tab and summarized in the portfolio case study.
