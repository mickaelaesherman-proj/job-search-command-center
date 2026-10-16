// Run from the repository root: node tests/email_test.js
// All companies, people, requisition numbers and addresses below are FICTIONAL; the wording mirrors real
// employer emails so the classifier is tested on realistic language.
const fs = require('fs');
const path = require('path');
const SCRIPT = path.join(__dirname, '..', 'apps-script', 'JobSearch_Automation.gs');
const TEST_CONFIG = fs.readFileSync(path.join(__dirname, 'test_config.js'), 'utf8');
const src = fs.readFileSync(SCRIPT, 'utf8');
const m = src.match(/const EM = \{[\s\S]*?\n\};[\s\S]*?\/\/ END EMAIL-CHECK PURE/);
if (!m) throw new Error('block not found');
// load the real settings + pure functions straight from the file under test
const api = new Function(TEST_CONFIG + '\n' + m[0] + '\n; return { EM, emClassify_, emMatch_, emReqTokens_, emCompanyKeys_, emAutoApprove_, emActionFor_ };')();
const { emClassify_, emMatch_, emAutoApprove_, emActionFor_ } = api;

let pass = 0, fail = 0;
const check = (name, ok, extra) => { if (ok) pass++; else { fail++; console.log('FAIL  ' + name + (extra ? '  -> ' + extra : '')); } };

// ---------- CLASSIFICATION: realistic employer emails (fictional names) ("full" = whole body, "snip" = Gmail snippet only) ----------
const REJ = [
 ['Brightly (full)', 'Brightly Associate Product Manager Application Update', "Hi Jordan,\n\nThank you so much for applying to join our team at Brightly! We\u2019re honored that you were interested in our Associate Product Manager opportunity and took the time to share your experience, skills, and passions with us. Your application reflected the thought and effort you put into introducing yourself, and we truly appreciate it.\n\nWe're sorry to say that, after careful review of your application, we\u2019ve decided not to move forward at this time. At Brightly we assess each application individually focusing on alignment with the skills, behaviors, and values needed for the role, as well as our ability to grow together. For this particular position we\u2019re prioritizing a specific set of needs that didn\u2019t align with your application.\n\nWe understand this may not be the outcome you hoped for and we encourage you to explore future opportunities with Brightly as our team continues to grow."],
 ['Learning Guild (full)', 'Regarding your job application to Director, Delivery & Release Management', "Hi Jordan,\n\nThank you for taking the time to apply for the Director, Delivery & Release Management, Digital Product Operations position at the Learning Guild.\n\nAfter carefully considering your application, we\u2019ve decided to move forward with other candidates at this time. However, we encourage you to visit our careers website to see if there are other positions that may be a better fit.\n\nThanks again for your interest."],
 ['Evening Survey (full)', 'Follow-Up to your Evening Survey Application', "Hi Jordan,\n\nThank you for your interest in Evening Survey. There are a lot of great companies out there, and we appreciate that you considered us and our Product Manager position.\n\nWe have filled the role and are no longer accepting applications. However, we were impressed by your background and encourage you to stay connected with us for future opportunities that may be a better fit."],
 ['Echoly (snip)', 'Thank you for your interest in Echoly', "Hi Jordan, Thank you so much for your interest in joining Echoly, and for taking the time to apply for the Product Manager, Maintain Ops role. Unfortunately, your background isn't quite aligned"],
 ['Gamma (snip)', 'Thank you for your interest in a career with Gamma Airways, Inc.', "Hi Jordan, Thank you for your interest in the Product Owner, Reservations (#55234) opportunity with Gamma Airways, Inc.. We have reviewed your application and have decided that you will not advance"],
 ['Tool Barn (snip)', 'Thank You for Your Interest in The Tool Barn', "Dear Jordan, Thank you for applying for the Product Manager , Req481927 position with The Tool Barn. After careful consideration, we will not be moving you forward in the process for this position."],
 ['Ledgerly (snip)', 'Ledgerly Follow Up', "Dear Jordan, Thank you for your interest in the Commerce Product Consultant position. Unfortunately, after careful consideration, we have determined that our current position is not ideally suited to"],
 ['Lux (snip)', "We've got an update on your application", "Hi Jordan , Thanks so much for your interest in our position, Strategic Project/Program Manager - R302680136 with Lux Automotive - USA . Unfortunately, you haven't been selected to move forward"],
 ['SkillHall (snip)', 'Update from SkillHall', "Hello Jordan, Thank you for your interest in SkillHall and for taking the time to apply for the Program Manager position. We wanted to let you know that we have closed our search for this role and"],
 ['Vital Care (snip)', 'Regarding your application', "Hi Jordan, Thank you so much for your interest in Vital Care. At this time, we have filled the Program Manager, Product Operations role and are no longer interviewing candidates."],
 ['Zentra (snip)', 'Update to your Zentra Application', "Dear Jordan, , Thank you for your interest in the Product Program Manager role at Zentra. We appreciate you taking the time to apply. Unfortunately, at this time, we have made the decision to select"],
 ['Kelvo (snip)', 'Kelvo | Following Up', "Hi Jordan, We really appreciate your interest in joining us here at Kelvo and we want to thank you for the time you invested in your application. We regret to inform you that we have decided not to"],
 ['QueryWorks (snip)', 'Thank you for your interest', "Hi Jordan, Thank you for your interest in QueryWorks and taking the time to apply for the Senior Product Operations Manager role. After careful consideration, we will not be moving forward with your"],
 ['Lexora rejection (snip)', 'Thank You for Your Interest in the Program Manager, Engineering Ops at Lexora', "Dear Jordan, Thank you for your interest in the Program Manager, Engineering Ops position at Lexora. After careful consideration, we regret to inform you that we will not be moving forward with your"],
 ['Shieldon (snip)', 'Shieldon career opportunity update on Project Manager - Transformation', "Hello Jordan , Thank you for your interest in Project Manager - Transformation . In reviewing all candidate's backgrounds and career histories, we wanted to update you that another candidate has"],
 ['Globepay (snip)', 'Globepay Application Update', "Dear Jordan, Thank you for your time and interest in Globepay. Unfortunately, given the timing of your application, your resume wasn't reviewed prior to the hiring decision being made."],
 ['Meridian (snip)', 'Feedback from Meridian', "Hi Jordan Thank you so much for the time you spent applying to Meridian, we understand how tough the job search can be. Unfortunately we've decided to move forward with other candidates who have"],
 ['WolfWorks (subject)', 'Unfortunately, we have decided not to proceed', "Jordan , Thank you for your application for the Project Manager, PVD at WOLF Works. We really appreciate your interest in joining our company and we want to thank you for the time and energy you"],
 ['StarWave (snip)', 'Thank you from StarWave!', "Hi Jordan, Thank you for your interest in joining us at StarWave. Our team has reviewed your application for the Senior Technical Program Manager position, but unfortunately we have decided not to"],
 ['Hirewell (snip)', 'We have an update on your Technical Project Manager I, Engineering application at Hirewell', "Hi JORDAN, Thank you for taking the time to show your interest in the Technical Project Manager I, Engineering (Ref ID: 58337) position at Hirewell. We're sorry to say that we are no longer hiring"],
 ['Shelfwise human (snip)', 'Re: Following Up - Solutions Program Manager', "Hi Jordan, Thanks for checking in. I heard back from the hiring manager, and they are moving forward with other candidates. I think she wants more sales experience for this role."],
 ['VEX (snip)', 'VEX Application Update', "Dear Jordan, Thank you for your time and interest in VEX. At this time, we have decided to pursue other candidates who are more aligned with our requirements, but we'd like to thank you for"],
 ['Ribbon (snip)', 'Your application for our Strategic Programs Lead, New Markets role at Ribbon', "Hi Jordan, Thank you so much for your application and interest in Ribbon. We received applications from many qualified candidates and unfortunately are going in a direction that better fits our needs"],
 ['Evening Survey subject-only', 'Update', 'We have filled the role and are no longer accepting applications.'],
];
REJ.forEach(([n, s, b]) => { const c = emClassify_(s, b); check('REJECTION ' + n, c.type === 'Rejection', JSON.stringify(c)); });

// soft rejections: must be Rejection, but only Medium confidence
[
 ['Pick-n-Go (snip)', 'Careers at Pick-n-Go', "Jordan, Thank you for the interest you have expressed in the Sr. Technical Program Lead, Customer Technology Solutions role at Pick-n-Go. We have received an overwhelming response for this position"],
 ['Taskora (snip)', 'Taskora Candidacy Update - Senior Technical Delivery Lead', "Hi Jordan, We would like to first start off by saying thank you for your interest in Taskora! The Senior Technical Delivery Lead had an overwhelming response and we have received multiple qualified"],
 ['Harbor (snip)', 'Thank you for your interest in Product Operations Manager at Harbor', "Hi Jordan, Thank you for your interest in Harbor! We received many applicants for the Product Operations Manager role, which is the greatest feedback an organization could receive."]
].forEach(([n, s, b]) => { const c = emClassify_(s, b); check('SOFT-REJECTION ' + n, c.type === 'Rejection' && c.conf === 'Medium', JSON.stringify(c)); });

// next steps
[
 ['Lexora invite (snip)', 'Lexora Application - Next Steps', "Hi Jordan, Thank you for your interest in exploring opportunities with Lexora! We'd like to schedule a 30-minute video call to learn more about your background and share details about the"],
 ['Shelfwise invite (snip)', 'Shelfwise - Solutions Program Manager - Next Steps', "Hi Jordan, We've reviewed your application for the role, and we'd like to move to the next step in the interview process! Could you please book a time for an intro call with us here: https://"]
].forEach(([n, s, b]) => { const c = emClassify_(s, b); check('NEXT-STEPS ' + n, c.type === 'Next steps' && c.conf === 'High', JSON.stringify(c)); });

// ---------- must NOT be treated as a reply: automatic confirmations, marketing, account emails ----------
[
 ['Horizon auto', 'Thank you for your application to Horizon AI', "Hi Jordan, Thank you for your interest in Horizon AI! We wanted to let you know we received your application, and we are delighted that you would consider joining our team. Our team will review your"],
 ['Brevity auto', 'Thank you for applying to Brevity', "Jordan, 1 big thing: Thank you for your interest in joining the Brevity mission by applying to our Product Manager role. Quick catch-up: You can learn more about our organization by Taking a look at"],
 ['Opal auto', 'Thank you for applying to Opal', "Hi Jordan, Thank you for applying to Opal! We have received your application and will review it promptly. If we think there is a good fit, we will contact you at this email address."],
 ['Tempo auto', 'Thanks for applying to Tempo!', "Hi Jordan, Thank you for applying for the Generalist (Special Projects) role at Tempo! We appreciate your interest in joining the team. We will review your application and get back to you if there"],
 ['Shieldon auto (has the words "next step")', 'Thank you for applying!', "Dear Jordan, Thank you for submitting your application for the Project Manager - Transformation . As a next step, we will review your experience and qualifications against the positions'"],
 ['Taskora auto (has "next steps in your career")', 'Thank you for applying to Taskora!', "Hi Jordan, Thank you for applying to Taskora! A lot of exciting companies are hiring, so we're thrilled that for the next steps in your career you've chosen us! We typically take about 7-10"],
 ['Ribbon auto', 'Thanks for applying to Ribbon!', "Hi Jordan, Thanks so much for submitting your application for the Strategic Programs Lead, New Markets role! Our Recruiting team will review what you've sent as soon as possible. We do our best"],
 ['QueryWorks auto', 'Thank you for applying to QueryWorks!', "Jordan, Thank you for applying to QueryWorks! Your application has been received, and it will be reviewed by the hiring team. If your application seems like a good fit for the position, we will reach"],
 ['Desk Mate auto', 'Thank you for applying to Desk Mate', "Jordan, Thank you for your interest in joining Desk Mate! We've received your application, and our Talent Acquisition team will be reviewing it soon. If your background is a match for the role,"],
 ['StarWave auto', 'Thank You for Applying to the Senior Technical Program Manager Opportunity at StarWave!', "Hi Jordan, We've received your application for the Senior Technical Program Manager position. Yes, this is an automated email, but there are real humans here at StarWave who are thrilled that you"],
 ['Lexora received', 'Application Received for Program Manager, Engineering Ops', "Dear Jordan, Thank you for your application for the position of Program Manager, Engineering Ops at Lexora. Your application will be carefully reviewed by our Talent Acquisition Team. Should your"],
 ['Ledgerly receipt', 'Thank you for applying to Ledgerly!', "Dear Jordan, Thank you for submitting an application for the position of Commerce Product Consultant, 469988. You can view the status of your application by navigating to the 'My Jobs'"],
 ['Paycircle promo', 'Build Scalable Tech That Impacts Billions', "At Paycircle, our Technology teams are at the forefront of innovation, driving the future with creativity and determination. Whether it's AI-driven fraud detection, cloud migrations, or"],
 ['LinkedIn alert', 'New jobs similar to Senior Product Operations Manager at QueryWorks', "Jobs similar to Senior Product Operations Manager at QueryWorks"],
 ['Verify account', 'Verify your candidate account', "Click this link to confirm your email address and complete setup for your candidate account"],
 ['Security code', 'Security code for your application to QueryWorks', "Hi Jordan, Copy and paste this code into the security code field on your application: kGsSqlUp After you enter the code, resubmit your application."],
 ['Steady auto', 'Thank you, we have received your application!!', "We are thrilled that you'd like to join us here at Steady, as we are growing and need good people like you. We are a small, but mighty team who are as eager as you are and we promise we will"],
 ['Auto with conditional rejection wording', 'Application received', "Thank you for applying. If you are not selected for this position, we will keep your resume on file for future roles."],
 ['Auto with volume disclaimer', 'Application received', "Thank you for applying. Unfortunately, due to the high volume of applications, we may not be able to respond to every applicant individually."],
 ['Auto with conditional scheduling', 'Application received', "Thank you for applying. If your qualifications match, a recruiter will contact you to schedule an interview."]
].forEach(([n, s, b]) => { const c = emClassify_(s, b); check('IGNORED ' + n, c.type === 'Received' || c.type === 'Other', JSON.stringify(c)); });


// ---------- FULL bodies (fictional names) ----------
[
 ['Pubco (full)', 'Thank you for your interest - Change Delivery Manager', "We appreciate your interest in our company and the time you\u2019ve invested in applying for the Change Delivery Manager opening.\n\nWe\u2019ve reviewed your application and have decided to move forward with other candidates we feel better align to the job requirements. This decision is only for the above referenced job and does not impact your application status as it relates to other job(s) for which you may have expressed interest.\n\nWe will be delighted if you\u2019ll keep us in mind as you look at opportunities to grow your career and we encourage you to apply again.\n\nWe wish you the very best in your job search."],
 ['Felix (full)', 'Your application to Felix Health', "Hi Jordan,\n\nWe appreciate your interest in Felix and the time you\u2019ve invested in applying for the Manager, Optimization position.\n\nWe have reviewed your application, and in an effort to find the best fit for our needs, we have decided to proceed with other candidates who are a closer match for the role\n\nWe encourage you to keep an eye on our website ( http://www.felixhealth.example/careers ) and apply to any other positions that match your interests and experience.\n\nThanks again for your interest in Felix and best of luck with your job search."],
 ['Payframe (full)', 'Important information about your application to Payframe', "Dear Jordan,\n\nThank you for taking the time to apply for the Client Operations Program Manager position with Payframe. We truly appreciate the effort and thought you put into your application and the opportunity to learn more about your skills and experiences.\n\nUnfortunately, the position has been filled. Your application and credentials will remain in our records, and we will reach out if a suitable opportunity matching your profile becomes available in the future. We encourage you to stay connected with us and explore future opportunities at Payframe."],
 ['ClassNest (full)', 'ClassNest: Update on the Strategy and Operations Lead, Tutor Role', "Dear Jordan,\n\nThank you so much for applying to ClassNest \u2014 we truly appreciate your interest and the time you took to apply to the Strategy and Operations Lead, Tutor role.\n\nWe understand it\u2019s been a while since you submitted your application, and we\u2019re grateful for your patience. At this time, we\u2019ve closed the role and are no longer moving forward with applications.\n\nWishing you all the best in your search."]
].forEach(([n, s, b]) => { const c = emClassify_(s, b); check('REJECTION ' + n, c.type === 'Rejection' && c.conf === 'High', JSON.stringify(c)); });

// conditional clause inside a real rejection must not hide it
{ const c = emClassify_('Update', "We have decided to move forward with other candidates, but if a similar role opens up we would love to hear from you."); check('REJECTION with trailing "but if" clause', c.type === 'Rejection', JSON.stringify(c)); }
// mixed wording is flagged Low
{ const c = emClassify_('Update', "We are not moving forward with your application. We would love to connect for future roles."); check('MIXED wording is Low confidence', c.mixed === true && c.conf === 'Low', JSON.stringify(c)); }


// conditional-sentence regressions
[
 ['If-first sentence with scheduling after the comma', 'Application received', 'Thank you for applying. If your qualifications match, a recruiter will contact you to schedule an interview.'],
 ['Trailing if with scheduling', 'Application received', 'Thank you for applying. A recruiter will contact you to schedule an interview if your qualifications match.'],
 ['Should-first sentence', 'Application received', 'Thank you for applying. Should we decide to move forward with other candidates, we will let you know.']
].forEach(([n, s, b]) => { const c = emClassify_(s, b); check('IGNORED ' + n, c.type === 'Received' || c.type === 'Other', JSON.stringify(c)); });

// ---------- MATCHING ----------
const D = (s) => new Date(s);
const A = (rowNum, company, title, applied, ref) => ({ rowNum, company, title, applied: D(applied), refText: (ref || '') + ' ' + title });
const apps = [
 A(92, 'Tool Barn', 'Product Manager', '2026-09-08', 'https://toolbarn.wd5.myworkdayjobs.com/en-US/CareerBarn/job/Product-Manager_Req481927-1'),
 A(106, 'Tool Barn', 'Product Manager - Customer Order Management', '2026-09-21', 'https://toolbarn.wd5.myworkdayjobs.com/en-US/CareerBarn/job/Customer-Order-Management_Req482345-1'),
 A(43, 'Gamma', 'Project Manager, Crew Mod Implementation', '2026-06-19'),
 A(108, 'Gamma', 'Product Owner, Reservations', '2026-09-25'),
 A(32, 'StarWave', 'Technical Program Manager', '2026-05-25'),
 A(64, 'StarWave', 'Senior Technical Program Manager', '2026-07-28'),
 A(58, 'Ribbon', 'Strategic Programs Lead, New Markets', '2026-07-19'),
 A(75, 'Ribbon', 'Operations Program Manager', '2026-08-17'),
 A(38, 'Searchly', 'Product Support Manager, Play Monetization', '2026-06-11'),
 A(40, 'Searchly', 'Program Manager', '2026-06-11'),
 A(93, 'Brightly', 'Associate Product Manager', '2026-09-09'),
 A(96, 'Evening Survey', 'Product Manager', '2026-09-09'),
 A(115, 'Echoly', 'Product Manager, Maintain Ops', '2026-10-06'),
 A(116, 'Ledgerly', 'Product Consultant', '2026-10-07'),
 A(78, 'Learning Guild', 'Director, Delivery & Release Management, Digital Product Operations', '2026-08-18'),
 A(30, 'BNW', 'Content Operations Strategy Manager, BNW', '2026-05-19'),
 A(69, 'PayPath by Summit', 'Project Manager', '2026-08-06'),
 A(81, 'Hirewel', 'Technical Project Manager I, Engineering', '2026-08-24'),
 A(22, 'Merdian', 'Founding Product Operations', '2026-04-28'),
 A(26, 'Vex Global', 'Analyst Sr Lead, Multi-Disciplinary', '2026-05-14'),
 A(21, 'QTech System', 'Program Manager (PMO / Delivery Execution)', '2026-04-27'),
 A(39, 'WolfWorks', 'Project Manager, PVD', '2026-06-11'),
 A(41, 'DeskMate', 'Operations Program Manager', '2026-06-11'),
 A(105, 'Pick-n-go', 'Sr. Technical Program Lead, Customer Technology Solutions', '2026-09-21'),
 A(73, 'Lux', 'Strategic Program Manager', '2026-08-11'),
 A(85, 'Harbor', 'Product Operations Manager', '2026-08-26'),
 A(95, "Nora's", 'Senior Product Manager', '2026-09-09'),
 A(19, 'Forward', 'Product Operations Manager / Sr. Product Operations Manager', '2026-04-10'),
 A(119, 'Brevity', 'Product Manager', '2026-10-09'),
];
const E = (date, fromName, fromAddr, subject, body) => ({ date: D(date), fromName, fromAddr, subject, body });
const expectRow = (name, em, row, conf) => {
  const r = emMatch_(em, apps);
  check('MATCH ' + name, r.status === 'ok' && r.app.rowNum === row && (!conf || r.conf === conf), JSON.stringify({ status: r.status, row: r.app && r.app.rowNum, conf: r.conf, by: r.by }));
};
expectRow('Tool Barn -> row 92 by requisition number', E('2026-10-08T04:50:17Z', 'The Tool Barn', 'toolbarn@myworkday.com', 'Thank You for Your Interest in The Tool Barn', 'Dear Jordan, Thank you for applying for the Product Manager , Req481927 position with The Tool Barn.'), 92, 'High');
expectRow('Gamma -> row 108 by role title', E('2026-10-03T14:41:43Z', '', 'talentacquisitiondonotreply@gammaair.com', 'Thank you for your interest in a career with Gamma Airways, Inc.', 'Thank you for your interest in the Product Owner, Reservations (#55234) opportunity with Gamma Airways, Inc..'), 108, 'Medium');
expectRow('StarWave 7/3 -> row 32 (the later application is excluded by date)', E('2026-07-03T15:29:56Z', '', 'starwaveradio+email+m9fz-b2cae23e45@talent.icims.com', 'Thank you from StarWave!', 'Our team has reviewed your application for the Technical Program Manager position'), 32, 'High');
expectRow('StarWave 8/6 -> row 64 (Senior role)', E('2026-08-06T13:27:11Z', '', 'starwaveradio+email+mmkl-228d351e1c@talent.icims.com', 'Thank you from StarWave!', 'Our team has reviewed your application for the Senior Technical Program Manager position'), 64, 'Medium');
expectRow('Ribbon 7/22 -> row 58', E('2026-07-22T02:13:50Z', '', 'no-reply@ribbon.com', 'Your application for our Strategic Programs Lead, New Markets role at Ribbon', 'Thank you so much for your application and interest in Ribbon.'), 58, 'High');
expectRow('BNW (sent by Bridgeway via Workday)', E('2026-07-18T09:56:35Z', '', 'bridgeway@myworkday.com', 'An update about your application for Content Operations Strategy Manager, BNW \u2014 R000204421', 'Thank you for your time in applying for the position at Bridgeway Media.'), 30, 'High');
expectRow('Summit alias -> PayPath by Summit (company only in the text)', E('2026-09-25T05:00:15Z', '', 'sbcard@myworkday.com', 'Thank you for your interest, Jordan', 'Thank you for your interest in joining our team at Summit. We know that a lot of time and energy goes into a job search'), 69, 'Medium');
expectRow('Hirewell alias -> "Hirewel"', E('2026-09-30T15:57:35Z', '', 'donotreplytalentacquisition@hirewell.com', 'We have an update on your Technical Project Manager I, Engineering application at Hirewell', 'Thank you for taking the time to show your interest in the Technical Project Manager I, Engineering (Ref ID: 58337) position at Hirewell.'), 81, 'High');
expectRow('Meridian alias -> "Merdian"', E('2026-04-29T19:57:02Z', '', 'no-reply@ashbyhq.com', 'Feedback from Meridian', 'Thank you so much for the time you spent applying to Meridian'), 22, 'Medium');
expectRow('VEX alias (short name, matched as a whole word)', E('2026-05-16T10:51:28Z', '', 'workday@vexglobal.com', 'VEX Application Update - Jordan Lee - JR0405610 Analyst Sr Lead, Multi-Disciplinary (C6364563)', 'Thank you for your time and interest in VEX.'), 26, 'High');
expectRow('QTech alias (name only in the body)', E('2026-04-30T13:37:01Z', '', 'noreply@msg.jobylon.com', 'Thanks for your application', 'Thank you for your interest in working with us at QTech Systems, a part of Halvorsen.'), 21, 'Medium');
expectRow('Wolf Works (name written as one word in the sender)', E('2026-06-14T04:51:03Z', '', 'wolfworks@myworkday.com', 'Unfortunately, we have decided not to proceed', 'Thank you for your application for the Project Manager, PVD at WOLF Works.'), 39, 'High');
expectRow('Desk Mate alias', E('2026-06-14T00:25:07Z', '', 'no-reply@us.greenhouse-mail.io', 'Thank You for Your Interest in Desk Mate!', 'Thank you for applying to our Operations Program Manager role at Desk Mate!'), 41, 'High');
expectRow('Pick-n-Go (hyphenated name inside a long sender address)', E('2026-09-30T20:23:48Z', '', 'pickngo+email+23kvh-443de3749a@talent.icims.com', 'Careers at Pick-n-Go', 'Thank you for the interest you have expressed in the Sr. Technical Program Lead, Customer Technology Solutions role at Pick-n-Go.'), 105, 'High');
expectRow("Nora's (apostrophe in the name)", E('2026-09-23T22:23:15Z', '', 'jobs@norasandfriendsjobs.com', "About your Senior, Product Management application with Nora's", 'Thank you for applying to the Senior, Product Management position.'), 95);
expectRow('Lux (three-letter name)', E('2026-09-12T04:55:16Z', '', 'lux@myworkday.com', "We've got an update on your application to Lux Automotive - USA", 'Strategic Project/Program Manager - R302680136 with Lux Automotive - USA'), 73);
expectRow('Harbor (ordinary-word name, trusted because it is the sender)', E('2026-08-27T07:01:16Z', 'Harbor', 'harbor@myworkday.com', 'Thank you for your interest in Product Operations Manager at Harbor', 'We received many applicants for the Product Operations Manager role'), 85);
expectRow('Searchly -> "Program Manager" row by title', E('2026-07-01T12:00:00Z', 'Searchly Careers', 'noreply@searchly.com', 'Your application to Searchly', 'Thank you for applying to the Program Manager role at Searchly.'), 40, 'Medium');

// negative / safety matching tests
{ const r = emMatch_(E('2026-09-02T12:00:00Z', 'Brightly', 'mary@brightly.io', 'Update', 'Brightly'), apps); check('MATCH date guard: email before the application is not matched', r.status === 'none', JSON.stringify(r)); }
{ const r = emMatch_(E('2026-10-01T12:00:00Z', 'Ribbon Recruiting', 'no-reply@ribbon.com', 'Thanks for your interest in Ribbon', 'We have an update on your application.'), apps); check('MATCH ambiguity: two Ribbon applications, no title -> not guessed', r.status === 'ambiguous' && r.cands.length === 2, JSON.stringify({ s: r.status, n: r.cands && r.cands.length })); }
{ const r = emMatch_(E('2026-10-05T12:00:00Z', 'Acme Staffing', 'jobs@acmestaffing.com', 'Update on your application', 'Unfortunately we are not moving forward.'), apps); check('MATCH unknown company -> unmatched (reported, not guessed)', r.status === 'none', JSON.stringify(r)); }
{ const r = emMatch_(E('2026-10-05T12:00:00Z', 'Recruiting', 'jobs@acmestaffing.com', 'Update on the role you applied for', 'Unfortunately we are not moving forward. You applied last week.'), apps); check('MATCH ordinary word "forward" in an email does NOT match the company "Forward"', r.status === 'none', JSON.stringify(r)); }
{ const r = emMatch_(E('2026-10-05T12:00:00Z', 'Sarah', 'sarah@unrelated.example', 'Hello', 'Thanks for your note.'), apps); check('MATCH sender and text mention none of your companies -> none', r.status === 'none', JSON.stringify(r)); }


// ---------- AUTO-APPROVE RULE (must equal the Sheet's formula: Rejection + High + Action not Review + an email date) ----------
[
 ['High rejection, nothing entered (Fill)',          ['Rejection', 'High', 'Fill', true],             true],
 ['High rejection, same day as your date',            ['Rejection', 'High', 'Matches existing', true], true],
 ['High rejection but email date clashes (Review)',   ['Rejection', 'High', 'Review', true],           false],
 ['Medium rejection (e.g. title-only match)',         ['Rejection', 'Medium', 'Review', true],         false],
 ['Medium rejection even if Action says Fill',        ['Rejection', 'Medium', 'Fill', true],           false],
 ['Low confidence (mixed wording)',                   ['Rejection', 'Low', 'Review', true],            false],
 ['Next steps are NEVER auto-approved',               ['Next steps', 'High', 'Fill', true],            false],
 ['No email found',                                   ['No email found', '-', 'No email found', false], false],
 ['High rejection but no date to write',              ['Rejection', 'High', 'Fill', false],            false],
 ['whitespace tolerated',                             [' Rejection ', ' High ', ' Fill ', true],       true]
].forEach(([n, a, want]) => check('AUTO-APPROVE ' + n, emAutoApprove_(...a) === want, JSON.stringify(a)));
check('ACTION High + no date entered -> Fill', emActionFor_('High', null, 46300) === 'Fill');
check('ACTION High + same day -> Matches existing', emActionFor_('High', 46300, 46300) === 'Matches existing');
check('ACTION High + different day -> Review', emActionFor_('High', 46290, 46300) === 'Review');
check('ACTION Medium -> Review whatever the date', emActionFor_('Medium', null, 46300) === 'Review');
// the matcher feeds the rule: a title-only match among several applications can never be High
{ const r = emMatch_(E('2026-10-03T14:41:43Z', '', 'talentacquisitiondonotreply@gammaair.com', 'Thank you for your interest in a career with Gamma Airways, Inc.', 'Thank you for your interest in the Product Owner, Reservations (#55234) opportunity'), apps);
  check('Gamma (two applications, title-only) is Medium, so it is never auto-approved', r.status === 'ok' && r.conf === 'Medium' && !emAutoApprove_('Rejection', r.conf, 'Review', true), JSON.stringify({ c: r.conf })); }
{ const r = emMatch_(E('2026-10-08T04:50:17Z', 'The Tool Barn', 'toolbarn@myworkday.com', 'Thank You for Your Interest in The Tool Barn', 'Thank you for applying for the Product Manager , Req481927 position'), apps);
  check('Tool Barn (two applications, requisition match) is High and qualifies', r.status === 'ok' && r.conf === 'High' && emAutoApprove_('Rejection', r.conf, 'Fill', true)); }

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
