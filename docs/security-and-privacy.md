# Security and privacy

## What the system can access

| Access | Why | Limits |
|---|---|---|
| The Google Sheet | System of record | Container-bound script; no spreadsheet ID in code |
| Gmail (read) | Match employer replies to applications | Remembers message IDs only, never email text; never sends from, trashes or labels mail |
| Send email | Summaries to the owner only | Only when there is news |
| Public job feeds | Read postings | Read-only, one request per company per scan; never submits applications |
| Claude API | Score fit | Key stored in Script Properties, never in the Sheet or code |

## What is sent to the AI

Posting text, the candidate profile and the rubric. Never her ratings, emails, application history or contact details. Posting text is marked as untrusted data, and instructions inside it are ignored.

## Cost controls

- A monthly spend limit in the Claude Console (the hard cap).
- A script budget that stops calls past an estimated monthly amount.
- Each posting is scored once; decided roles are never scored.

## Never committed to this repository

API keys, spreadsheet IDs or URLs, email content, personal contact details, real application data, or handoff notes containing any of these. `.gitignore` blocks common cases; every commit is also reviewed by hand.
