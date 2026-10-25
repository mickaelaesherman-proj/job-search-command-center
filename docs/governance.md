# AI Governance

*Version 0.1 (draft) · 10/25/2026 · Owner: Mickaela Sherman*

This document describes how the job search system is governed: who decides what, what the AI and automation are allowed to do, how risks are controlled, and where the evidence lives. Each section ends with the Responsible AI and AI safety principles it addresses; section 9 summarizes them.

**Contents**
1. Scope and ownership
2. Decision rights
3. AI inventory *(to come)*
4. Risks and controls *(to come)*
5. Evaluation and monitoring *(to come)*
6. Change management *(to come)*
7. Incidents *(to come)*
8. Data and security *(to come)*
9. Responsible AI and safety at a glance *(to come)*

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
  - **Until then**, I monitor whether my decisions follow the AI score.

**Hard limits.** Regardless of evidence:
1. The system never makes the final Apply or Skip decision.
2. Interview invites and next-steps emails always come to me.
3. Every posting scanned is logged with the reason it passed or was filtered out.
4. Only High-confidence rejections are approved automatically. Anything ambiguous comes to me.
5. Job boards are never scraped.
6. The system never contacts employers or applies on my behalf. Its only outgoing email is reports to me.
7. The AI never sees my ratings before it scores.
8. AI spending cannot exceed the hard cap.

**Principles addressed:** Accountability · Human oversight · Safety: limits on unsupervised action (autonomy levels, hard limits)

---

## Revision history

| Version | Date | Change |
|---|---|---|
| 0.1 | 10/25/2026 | Sections 1 and 2 drafted |
