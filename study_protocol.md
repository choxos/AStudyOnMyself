# A Study On Myself: Protocol for an N-of-1 Bayesian Study of Momentary Mood and Daily Satisfaction

## Administrative Information

| Item | Details |
|---|---|
| Protocol version | 3.1, final |
| Date | 19 September 2026 |
| Investigator and participant | Ahmad Sofi-Mahmudi (one person in both roles), conducting the study privately in Canada, not as part of work for any institution. Contact: https://choxos.github.io |
| Status | Finalized on 19 September 2026 as version 3.0 and corrected as version 3.1 the same day, before the study start (Revision History). The pilot ran on 19 September 2026 (Section 2.12). Confirmatory data collection starts on 20 September 2026, the day after finalization; that date is recorded in the software as the study start, and reports made before it never enter a model. |
| Registration | Not registered in a trial registry. Each version of the protocol is published with the record of its review and the SHA-256 hash of the protocol file at https://choxos.github.io/astudyonmyself/protocol.html; the public commit history of that site dates each version, which serves the purpose of registration: a public record, fixed in time, of what was planned (Section 3.3). |
| Funding and sponsor | None. The study is self-funded and has no sponsor. |
| Competing interests | None declared. |
| Roles | The participant designed the study, built the software, collects and analyzes the data, and will write the reports. There is no steering committee, data monitoring committee or other oversight group (Section 2.11). |
| Use of AI tools | AI tools helped write the study software and revise this protocol. Two AI models reviewed the protocol; their reports and the responses are published with it (Section 3.4). |

## Revision History

| Version | Date | Changes |
|---|---|---|
| 1.0 | August 2025 | First version. |
| 2.0 | September 2026 | Revised together with the study software: the outcome redefined as momentary mood, with a secondary evening rating of the day; the Bayesian ordinal model specified; timing rules for the factors; the local, encrypted infrastructure described; a public results page and its privacy rules added; confirmatory hypotheses and embedded N-of-1 experiments specified; citations that did not support their statements corrected or replaced. The software was then rewritten as a TypeScript web application with the analysis in R and Stan; the model was unchanged. |
| 3.0 | September 2026 | Completed against the applicable items of SPIRIT 2025 and SPENT 2019 (Appendix B); objectives aligned with the analysis plan; automatic collection from the Ultrahuman Partner API, Apple Health and an Amazon Smart Air Quality Monitor, with a data dictionary (Appendix A); indoor air quality added as exploratory factors; the carry-over parameter allowed to take either sign, so that hypothesis 5 can be tested; screen time other than social media modeled for hypothesis 3; the confirmatory factors given their own priors after the design analysis showed that the shared shrinkage prior halved their estimates; yes/no factors compared as yes against no; decision rules applied to unrounded probabilities; a convergence gate before publication and longer sampling; pilot data excluded from every model (model version ordinal-ar1-stan-v4); reminders sent as push notifications; the day satisfaction model specified and implemented; a prior predictive check and a design analysis added; weekly adherence, a safety rule, monitoring, privacy boundaries and ethics clarified; reviewed by two AI models in four rounds and finalized on 19 September 2026 (Section 3.4). |
| 3.1 | September 2026 | Corrected on 19 September 2026, before the study start, after the first check of the Ultrahuman connector against the live service: the night's heart rate variability is the Partner API's `avg_sleep_hrv`, its average during sleep, and not `hrv.avg`, which averages the whole calendar day and so includes readings taken after the day's reports. The factor's definition is unchanged. The Partner API is the source of the ring's values from the study start. Not sent for review (Section 3.4). |

## Abstract

**Introduction:** Most of what is known about mood and well-being comes from comparisons between people, which need not describe how mood varies within one person. This N-of-1 study estimates, for one person, which daily factors go with momentary mood, and prepares randomized N-of-1 experiments to test the most promising ones.

**Methods and analysis:** For 12 months, the participant rates momentary mood three times a day on three ordered levels (Sad, Meh, Happy) and rates each day in the evening (0 to 10). Sleep, overnight physiology and activity come automatically from an Ultrahuman Ring and Apple Health; weather, outdoor air quality and indoor air quality are also collected automatically; screen time, social contact, caffeine, alcohol and context are optional evening entries. A Bayesian cumulative logit model with time of day and weekday effects, a latent daily mood that follows a stationary first-order autoregressive process, weakly informative priors on the confirmatory factors and a hierarchical shrinkage prior on the others is refitted as data arrive. Last night's sleep and physiology and the previous day's behavior are known before the day's reports; same-day weather and context enter as adjustment covariates. Five directional hypotheses are judged at 12 months, with an interim look at 6 months, by a prespecified posterior probability rule; everything else is exploratory.

**Ethics and dissemination:** This is a private self-study with no other person's data. The data stay on the participant's own devices and the services that record them; only model estimates are published, as they update, together with this protocol, the record of its review and the study software.

## 1. Introduction

### 1.1 Background and Rationale

Well-being research has mostly compared people with each other (Diener et al., 2017). Associations found between people describe a population and need not hold within any one person, whose mood may respond to sleep, activity, company or weather in ways the average hides (Molenaar, 2004; Hamaker, 2012). A person who wants to know what goes with their own mood therefore needs repeated measurements of themselves, analyzed as the time series of one person.

Two developments make such a study practical. Ecological momentary assessment records experience as it happens, which reduces recall bias (Shiffman et al., 2008; Stone et al., 2002), and consumer wearables record sleep, heart rate and activity passively, although their accuracy varies by metric and device (Evenson et al., 2015; de Zambotti et al., 2019; Chinoy et al., 2021). Self-tracking is widespread (Li et al., 2010; Swan, 2013), but it rarely comes with a prespecified analysis that handles ordinal ratings, autocorrelation, missing values and the order of events in time.

This study applies the standards of N-of-1 research to self-tracking (Kravitz et al., 2014; Porcino et al., 2020). Outcomes, factors, timing rules, the model, hypotheses and decision rules are fixed in this protocol before the confirmatory data are collected. Associations from the observational phase rank candidate factors, and randomized N-of-1 experiments then test those the participant can change (Vohra et al., 2015). Bayesian methods suit this setting because they quantify uncertainty directly, handle missing values within the model and allow the estimates to be updated as data accumulate (Gelman et al., 2013).

### 1.2 Objectives

The primary objective is to estimate, in one person, the associations between daily factors and momentary mood, and to test five directional hypotheses (Section 1.3).

The secondary objectives are:

1. to estimate the same associations for the evening rating of the day (day satisfaction);
2. to estimate mood dynamics, meaning the carry-over of the latent daily mood from one day to the next and the size of its day-to-day fluctuations, and the differences in mood by time of day and weekday;
3. to rank the factors the participant can change as candidates for randomized N-of-1 experiments, and to run those experiments (Section 2.10);
4. to assess feasibility: adherence to the mood prompts and the completeness of each data source over 12 months;
5. to monitor harms: periods of persistently low mood (Section 2.11).

The study software is open source (Section 3.3), so that others can run self-studies of this kind.

### 1.3 Hypotheses

Five directional hypotheses about the primary outcome are confirmatory. They are judged by the rule in Section 2.9.5.

1. H1: Longer sleep last night goes with higher mood.
2. H2: More steps yesterday go with higher mood.
3. H3a: More screen time other than social media yesterday goes with lower mood. H3b: More social media time yesterday goes with lower mood. Each is judged with the other held fixed (Section 2.9.4).
4. H4: More time in person with friends or family yesterday goes with higher mood.
5. H5: The latent daily mood carries over from one day to the next: φ > 0 in Section 2.9.1.

## 2. Methods

### 2.1 Study Design

This is a single-subject (N-of-1), intensive longitudinal observational study with continuous data collection, analyzed idiographically: the target of inference is the within-person process of one individual, not a population (Molenaar, 2004; Hamaker, 2012). Randomized N-of-1 experiments follow the observational phase; this protocol fixes the observational phase and the template that each experiment's amendment will follow (Section 2.10). The protocol addresses the items of the SPIRIT 2025 statement (Chan et al., 2025) and its N-of-1 extension (Porcino et al., 2020) that apply to an observational N-of-1 study (Appendix B); the experiments will be reported following CENT 2015 (Vohra et al., 2015).

Confirmatory data collection runs for 12 months from the study start, so that seasonal variation in day length and temperature can be separated from the other factors. The confirmatory hypotheses are judged at 12 months, with an interim look at 6 months (Section 2.9.10). Because the design is observational, the primary analysis estimates associations conditional on the measured factors; causal claims are left to the experiments.

### 2.2 Participant, Setting and Involvement

The participant is one adult, the investigator, in their ordinary daily life in Canada, at home, at work and while traveling. There are no other eligibility criteria and no recruitment. The study tests no treatment and involves no clinical population. There is no separate patient or public involvement: the participant is the investigator and the only person the results concern. The participant knows the hypotheses and can see the estimates as they update, which Section 4.2 discusses.

### 2.3 Outcomes

#### 2.3.1 Primary Outcome: Momentary Mood

The primary outcome is a single momentary mood report on three ordered levels: 1 (Sad), 2 (Meh) and 3 (Happy). The item measures momentary affect, the emotional quality of the present moment, rather than life evaluation; the two are distinct components of subjective well-being with different correlates (Kahneman & Deaton, 2010; Diener et al., 2017). It is not a validated instrument. Three levels keep the burden low enough for a year of use at the cost of resolution, so floor and ceiling effects are likely. The responses are analyzed as ordinal, because treating ordinal responses as interval scaled can distort effect estimates and even reverse their sign (Liddell & Kruschke, 2018; Bürkner & Vuorre, 2019).

Reports are made in a web app on the phone's Home Screen: one tap per report, with an optional free-text note in which words marked with # become tags. Each report stores the moment it was made (taken on the phone, so a report made while the server is unreachable keeps its true time), the phone's time zone, the moment the server received it, and a unique client identifier that makes retries idempotent. Reports are never edited; a mistaken report is deleted.

Each report is assigned to a study day and a time-of-day slot in the local time zone at the moment of the report, so travel across time zones is handled. The study day runs from 4 AM to 4 AM, so a report at 1 AM belongs to the previous evening. Slots are morning (4 AM to noon), afternoon (noon to 6 PM) and evening (6 PM to 4 AM). The target is one report per slot per day; additional reports are kept and analyzed, so the estimand is defined over reports and days with more reports weigh more (Section 2.9.4), and a sensitivity analysis keeps one report per slot (Section 2.9.9).

Reminders are push notifications from the app, one per slot at a fixed time the participant sets (by default 10:30, 15:30 and 21:00), sent only while that slot has no report and only while the computer is awake; a slot that came due while it slept is reminded when it wakes, if the slot is still open, and a phone automation can open the rating page as a fallback. Fixed schedules can couple mood with the activities habitually done at those moments; signal-contingent random prompting (Killingsworth & Gilbert, 2010; Myin-Germeys et al., 2018) is the stronger design and can replace the fixed schedule later without changes to the analysis. Retrospective entry, a known source of bias in diary studies (Stone et al., 2002), is limited: the app stamps each report at the moment of the tap, and the programming interface accepts earlier times only up to 14 days back (for reports queued on the phone) and rejects anything older. The report time and the receipt time are both stored, so the delay can be computed and late entries excluded in a sensitivity analysis. Every reminder sent is recorded, so a report made within an hour after a reminder in its slot counts as answering it and other reports as spontaneous.

#### 2.3.2 Secondary Outcomes

Day satisfaction: once each evening, "All things considered, how satisfied were you with today?" on a 0 to 10 scale. This single item evaluates the day as a whole and is the closest daily analogue of life evaluation; single-item life satisfaction measures show acceptable reliability and validity (Lucas & Donnellan, 2012; Cheung & Lucas, 2014), although those studies concern global rather than daily judgments.

Mood dynamics: the autoregressive coefficient φ of the latent daily mood and the standard deviation σ of its daily innovations, both conditional on the factors and estimated by the primary model (Section 2.9.1). φ describes day-to-day carry-over; it is analogous to, but not the same as, the moment-to-moment emotional inertia studied by Kuppens et al. (2010). The model-adjusted differences by time of day and weekday are also reported.

#### 2.3.3 Process Measures

Adherence is the share of slots with at least one report, among the slots that have begun since the study start, computed per week (Monday to Sunday). The private dashboard shows it per week and over the last 14 days, and the 6- and 12-month reports give it for every week. Completeness is the share of study days with a value for each factor, by data source.

### 2.4 Factors and Data Sources

| Domain | Factor | Unit | Source | Collection | Enters the model as |
|---|---|---|---|---|---|
| Sleep and physiology | Sleep duration | hours | Ultrahuman Ring, through the Ultrahuman Partner API or Apple Health | automatic | last night |
| | Sleep efficiency | % | as above | automatic | last night |
| | Heart rate variability | ms | as above; one metric for the whole study | automatic | last night |
| | Resting heart rate | beats/min | as above | automatic | last night |
| | Skin temperature deviation | °C | Ultrahuman Partner API; otherwise the evening log | automatic with API access | last night |
| Activity | Steps | count | Ultrahuman Partner API, or iPhone and Apple Watch through Apple Health | automatic | yesterday |
| | Exercise | min | Apple Health exercise minutes (Apple Watch) | automatic | yesterday |
| | Time outdoors | min | Apple Health time in daylight (Apple Watch); otherwise the evening log | automatic with a watch | yesterday |
| Social | Time in person with friends or family | min | evening log | manual, optional | yesterday |
| Digital | Screen time; social media time | min | iPhone Screen Time, copied into the evening log | manual, optional | yesterday |
| Intake | Caffeine | mg | evening log, or Apple Health if logged there | manual, optional | yesterday |
| | Alcohol | standard drinks | evening log, or Apple Health if logged there | manual, optional | yesterday |
| Context | Work day; away from home; sick | yes/no | evening log | manual, optional | same day (adjustment) |
| Outdoor environment | Mean temperature; precipitation; sunshine; day length | °C; mm; h; h | Open-Meteo (reanalysis and forecast models), for the home location | automatic | same day (adjustment) |
| | Outdoor PM2.5 | µg/m³ | Open-Meteo air quality (CAMS), for the home location | automatic | same day (adjustment) |
| Indoor environment | Indoor PM2.5; volatile organic compounds | µg/m³; index | Amazon Smart Air Quality Monitor, through the Alexa web service | automatic | yesterday (daily mean) |
| Moment | Tags in the report's note | presence | mood report | manual, optional | descriptive only |

Appendix A defines each factor: its source, time window, aggregation and unit.

The factors cover mechanisms with prior evidence: sleep, autonomic function measured by heart rate variability (Thayer & Lane, 2009), physical activity, social connection (Holt-Lunstad et al., 2010), social media use (Hunt et al., 2018; Primack et al., 2017), seasonal light (Rosenthal et al., 1984), and air pollution, which has been linked with anxiety (Power et al., 2015). Time of day and weekday enter the model as effects of their own, because expressed mood follows daily and weekly rhythms (Golder & Macy, 2011).

Timing rule: last night's sleep and overnight physiology, and the previous day's behavior and indoor air, are complete before the day's first report, so they are predictors in the strict sense. Behavior that accumulates during the day (steps, exercise, time outdoors, screen time, caffeine, alcohol, social time) can be a consequence of the day's mood as easily as a cause, so it enters as the previous day's value; same-day totals are exploratory (Section 2.9.7). Indoor air depends partly on what the participant does at home, such as cooking, cleaning or opening windows, so it also enters as the previous day's mean. Two groups of same-day factors are exceptions and serve as adjustment covariates, not as predictors known in advance. Weather and outdoor air are summaries of the whole day, so a morning report is modeled together with the afternoon's rain; they enter on the same day because mood cannot change the weather. The work, travel and sick flags describe the day's status and are recorded in the evening; a work day or a trip is usually known in advance, but a sick day can follow the day's mood. None of the exceptions is a confirmatory factor. Weather is fetched for the home location even on days away from home, which the travel flag marks.

Automatic collection: collection is automatic wherever a data source allows it. Ultrahuman issues a personal token for its Partner API; with it, an hourly job on the participant's computer fetches the ring's nightly and daily metrics for the last three days, so that later fetches correct values that were still incomplete. The token was in place at the study start, so the Partner API is the source of the ring's values for the whole study; exercise and time in daylight come from Apple Health, which a daily iPhone automation reads and posts. The same hourly job fetches weather for the last complete days in the participant's time zone and reads the indoor air monitor's current values through the Alexa web service. Amazon offers no public interface for the monitor, so the connector uses the unofficial interface that home automation software uses, and it can stop working when Amazon changes its service. Indoor readings are sampled hourly while the computer is awake, so a day's mean usually covers waking hours rather than 24 hours; it is recorded only when at least 12 hours of that calendar day were sampled. Appendix A describes both connectors. Both are implemented, tested with synthetic responses shaped like the services' formats, and checked against the live services during the pilot; the check of the Ultrahuman connector led to the correction in version 3.1 (Revision History).

Screen time and social media time have no programming interface on the iPhone, and time with people, caffeine, alcohol and the context flags have no sensor. They are optional entries in the evening log; iPhone Screen Time keeps daily totals for recent days, so a missed evening can be filled in within the week, and caffeine and alcohol can also come from Apple Health if logged there. Optional factors enter the model only when recorded often enough (Section 2.9.3), which matters for H3 and H4 (Section 2.9.5).

Wearable measurement: consumer sleep trackers detect sleep well but wake poorly when compared with polysomnography (epoch-by-epoch specificity 0.18 to 0.54 across seven devices; Chinoy et al., 2021), and their proprietary algorithms change with firmware updates (de Zambotti et al., 2019). A systematic review of Fitbit and Jawbone trackers, covering studies up to 2015, found step counts the most valid of their metrics and sleep and energy expenditure the least (Evenson et al., 2015). A PubMed search for "Ultrahuman" in all fields on 19 September 2026 returned 33 records, of which two concern Ultrahuman products; both are by authors employed by the manufacturer (a study of its glucose monitor and an analysis of a ring-derived fitness age), and none validates the ring against polysomnography or electrocardiography. Device values are therefore treated as noisy proxies, with two rules. First, the source chosen for each factor at the study start is kept for the whole study; Apple Health stores heart rate variability as SDNN while ring apps usually report RMSSD, and the two are not interchangeable. If Partner API access is granted after the start, switching a factor to it is a protocol amendment (Section 3.4) and is modeled as a break. Second, device, app or firmware changes are noted in the daily log so that they can be modeled as breaks.

Not collected, although listed in the first version of this protocol: smart scale body composition, YouTube and YouTube Music history (watch history is not available through the YouTube Data API; a Google Takeout import is possible later), and calendar or location traces (left out for privacy).

### 2.5 Participant Timeline

| When | What | How |
|---|---|---|
| Three times a day | Momentary mood | Push reminder in each slot, only if the slot has no report; one tap |
| Each evening | Day satisfaction; optional factors; notes | Evening log in the app |
| Each night | Sleep and overnight physiology | Ring, automatic |
| Each day | Apple Health values | iPhone automation, automatic |
| Each hour | Ultrahuman metrics, weather, indoor air; model refit when the data have changed; public estimates after a fit that passes the convergence checks | Scheduled job on the computer, automatic |
| Each day | Encrypted backup, once a key is configured | Scheduled job, automatic |
| Whenever the dashboard is opened | Safety rule (Section 2.11) | App, automatic |
| From 19 September 2026 to the study start | Pilot: checks of the reminders, data flows and evening log | Participant |
| Each month | Review of adherence, completeness, connector errors, backups and the safety rule | Participant |
| Month 6 | Interim confirmatory analysis | Participant |
| Month 12 | Final confirmatory, secondary and sensitivity analyses | Participant |
| After month 12 | Embedded N-of-1 experiments | Participant |

### 2.6 Sample Size and Study Length

Study length is set by precision rather than by a significance test. With three prompts a day and about 80% of them answered, six months yield about 430 reports on 180 days and twelve months about 870 reports on 365 days. The precision target is a 95% credible interval no wider than 0.6 on the log-odds scale per standard deviation of each confirmatory factor at 12 months.

A design analysis (`analysis/design.R`) simulated studies of 180 and 365 days with all 23 factors of the real study, their correlations and day-to-day autocorrelation, seasonal weather, nights without the ring (10%), evenings without the log (30%, removing all optional factors that day), missing activity data (5%) and missing indoor air (25%). Two scenarios were simulated: an "effects" scenario with true effects on the confirmatory factors of 0.4 per hour of sleep, 0.3 per 2,500 steps, -0.2 per 60 minutes of other screen time, -0.2 per 30 minutes of social media and 0.3 per hour with people (about 0.2 to 0.37 on the log-odds scale per standard deviation) and φ = 0.5, and a "null" scenario with no effect of any factor and φ = 0. True effects were converted to the fitted scale in every simulated study.

A first run, with every factor under the shared shrinkage prior and chains of 500 draws, showed the problem the analysis was designed to find. The estimates of the confirmatory effects averaged 39% to 56% of their true values for H1, H2 and H4 and 49% to 73% for H3a and H3b, and their 95% intervals contained the true value in as few as 49% of simulated studies (sleep at 12 months). At 12 months the rule supported H1 in 85% of studies, but H2, H3a, H3b and H4 in only 21% to 52% (33 studies with effects and 32 under the null at 12 months, 50 per condition at 6 months). Under the null, no confirmatory factor was ever supported, and φ > 0 was supported in 3% of studies. The confirmatory factors were therefore given their own priors (Section 2.9.2) before the analysis was run again; the first run's results are kept with the software (`analysis/design-v3-shared-prior/`).

The second run used the final model (version ordinal-ar1-stan-v4), with chains of 1,000 draws after 1,000 warmup iterations, half the production length, so that its 180 fits could be completed: 50 simulated studies per scenario at 6 months and 40 at 12 months, where one fit took about four minutes. The simulated studies had on average 435 reports at 6 months and 880 at 12 months. With the effects present, the estimates of the confirmatory effects averaged 90% to 105% of their true values, and the 95% intervals contained the true value in 92.5% to 100% of simulated studies, for every hypothesis at both lengths. At 12 months the intervals of the confirmatory factors were on average 0.39 wide and never wider than 0.46, so the precision target was met in every simulated study; at 6 months they were on average 0.55 wide, and 14% were wider than 0.6.

The table gives the proportion of simulated studies in which the decision rule (Section 2.9.5) supported each hypothesis, and at least one of them, counting every fit. The Monte Carlo standard error of each proportion is at most 0.08.

| Scenario | Length | H1 | H2 | H3a | H3b | H4 | H5 | At least one |
|---|---|---|---|---|---|---|---|---|
| Effects | 6 months | 0.86 | 0.46 | 0.18 | 0.22 | 0.50 | 0.22 | 1.00 |
| Effects | 12 months | 1.00 | 0.88 | 0.55 | 0.58 | 0.80 | 0.63 | 1.00 |
| Null | 6 months | 0.02 | 0 | 0 | 0.02 | 0 | 0 | 0.04 |
| Null | 12 months | 0.03 | 0 | 0.05 | 0 | 0.05 | 0 | 0.10 |

With the effects present, no hypothesis was contradicted in any simulated study. At the effect sizes simulated, a 12-month study supports H1 almost always and H2 and H4 in most cases, but H3a, H3b and H5 in only about half, so an inconclusive result for these three is weak evidence that the effect is absent. With no effect present, each hypothesis was supported in at most 5% of simulated studies and contradicted in at most 5%, and at least one of the six was supported in 4% of studies at 6 months (2 of 50) and 10% at 12 months (4 of 40, standard error 0.05), a rate expected from six directional tests at a threshold of 0.975 without adjustment (Section 2.9.5). Of the 18 exploratory factors without an effect, fewer than 0.5% reached a posterior probability of 0.975 in either direction.

At this chain length, 52 of the 180 fits failed the convergence checks of Section 2.9.8: with the effects present, 8 of 50 at 6 months and 11 of 40 at 12 months; in the null scenario, where φ = 0, 13 of 50 and 20 of 40. Four failed 12-month fits, two from each scenario, were refitted with the production settings (`analysis/design-checks.txt`): three passed, and the fourth, which had 7 divergent transitions, passed when rerun as Section 2.9.5 prescribes. In every refit, σ had the smallest effective sample size. The table counts every fit, because the real procedure reruns a fit that fails instead of dropping it; the rerun itself was not simulated, for its cost. Among the fits that passed, the rates were similar (at least one hypothesis was supported under the null in 2 of 37 studies at 6 months and 1 of 20 at 12 months), except that H5 was supported more often when the effects were present (0.79 at 12 months). Fits therefore fail most often when the carry-over is weak.

### 2.7 Data Collection Infrastructure

The study software is a local web application (TypeScript on Node.js, using its built-in SQLite in write-ahead logging mode) running on the participant's own computer as background services; the statistical analysis runs separately in R and only reads the database. The database, logs, encrypted backups, posterior draws and the Amazon sign-in live in a private folder outside the code repository, and the disk is encrypted with FileVault.

The server listens on the loopback interface only. The phone reaches it through Tailscale Serve, which limits access to the participant's own devices over WireGuard; its HTTPS certificate publishes the computer's name in public certificate transparency logs, although the server cannot be reached from outside the participant's devices. The web interface requires a password, locks sign in after repeated failures, and sends a strict Content Security Policy with no third-party scripts. Phone automations authenticate with device tokens that are stored as hashes; a token can add reports and set daily values but cannot read stored data, and the responses to its requests acknowledge only what it changed.

Reminders are web push notifications: the server encrypts each one for the phone (RFC 8291) and posts it to the phone's push service, which on an iPhone requires the app to run from the Home Screen. The rating page caches itself on the phone and keeps reports in a local queue until the server confirms them, so reports made while the computer sleeps or the phone is offline are sent later with their original time. A daily submission changes only the fields it contains, and the evening form saves only the fields the participant edits, so a value an automatic source wrote after the form was opened is not replaced by an older one. When two sources write the same field, the later write wins, which is why each field has one source (Appendix A).

### 2.8 Data Management and Quality

Every field has a plausible range enforced by the database (for example, sleep between 0 and 24 hours), and the connectors drop values outside it; implausible device values are corrected or left blank in the daily log rather than silently dropped. Reports are never edited, only deleted. The hourly job logs every failed fetch, and the monthly review checks each source's completeness. Once a GPG key is configured, the hourly job writes an encrypted snapshot of the database when about a day has passed since the last one and keeps the last 30, in a folder that can be on a cloud drive; configuring it is part of the pilot. The data belong to the participant and are kept for as long as the participant chooses. Appendix A is the data dictionary.

### 2.9 Statistical Analysis Plan

#### 2.9.1 Model

For report i, made on study day d in slot s and weekday w, with y = 1 (Sad), 2 (Meh) or 3 (Happy):

$$\Pr(y_i \le k) = \operatorname{logit}^{-1}(c_k - \eta_i), \quad k = 1, 2$$

$$\eta_i = \alpha_s + \gamma_w + \mathbf{x}_d^{\top} \boldsymbol{\beta} + u_d$$

$$u_d = \phi \, u_{d-1} + \sigma \varepsilon_d, \quad \varepsilon_d \sim \mathrm{N}(0, 1)$$

The cumulative logit likelihood respects the ordinal outcome (Bürkner & Vuorre, 2019). The latent daily mood u follows a stationary first-order autoregressive process over every calendar day from the first report to the last, started from its stationary distribution, so reports on the same day share a day effect, mood can carry over between days, and days without reports keep their place in time. φ and σ describe this latent process conditional on the factors, not the raw day-to-day variation of the reports. Time of day (α) and weekday (γ) effects are constrained to sum to zero, and the cutpoints absorb the intercept. The model uses the reports made from the study start onward.

#### 2.9.2 Priors

The cutpoints have normal priors with means -1 and 1 and standard deviation 1.5 and are constrained to be ordered; α and γ are sum-to-zero vectors whose elements have normal(0, 0.5) priors; (φ + 1)/2 ~ Beta(2, 2), which keeps φ between -1 and 1 with a prior symmetric around zero, so that the direction of carry-over is estimated rather than assumed; and σ ~ HalfNormal(1). The factors are standardized. The five factors of the confirmatory hypotheses each have a normal(0, 0.5) prior on the log-odds scale per standard deviation. The other factors share a hierarchical shrinkage prior, β_j = τ z_j with z_j ~ N(0, 1) and τ ~ HalfNormal(0.5), so that the many exploratory effects are pooled toward zero; a normal prior of this kind shrinks large effects more than the regularized horseshoe would (Piironen & Vehtari, 2017), which is the price of its simplicity. The confirmatory factors are kept out of the pool because the first design analysis (Section 2.6) showed that pooling them with about 18 factors without effect shrank their estimates by about half. The priors are weakly informative on the log-odds scale in the sense of Gelman et al. (2017).

A prior predictive check (`analysis/prior_check.R`) simulated 4,000 studies of 180 days with 23 factors from these priors, 5 of them confirmatory. The share of each category had a median near one third (Sad 0.34, Meh 0.29, Happy 0.34) with 90% intervals of about 0.04 to 0.67; 0.2% of simulated studies put more than 90% of reports in one category; the absolute effect per standard deviation had a median of 0.34 and a 95th percentile of 1.0 for a confirmatory factor, and a median of 0.19 and a 95th percentile of 1.1 for another factor. The priors therefore allow a wide range of plausible data without favoring degenerate ones.

#### 2.9.3 Factors and Missing Data

Factors follow the timing rule in Section 2.4 and are standardized over the days with reports. A factor recorded on fewer than half of the days with reports, or on fewer than 10 such days, or one that never varies on those days, is left out of the model until that changes, and the reason is shown with the results; this applies above all to the optional manual factors. Remaining gaps are imputed inside the model as N(0, 1) parameters on the standardized scale. This assumes that the values are missing at random (Rubin, 1976; Graham, 2009), treats the missing values of different factors as independent of each other, and imputes yes/no flags as continuous values; a night without the ring leaves five overnight factors missing together. Sensitivity analysis (7) uses an imputation model that respects these structures.

Unanswered prompts are not imputed: the likelihood uses the reports that were made. If prompts are skipped more often in bad moods, the selection depends on the outcome itself, which can bias both the average mood and the associations; sensitivity analysis (9) assesses how much. Adherence by slot and weekday is monitored, and missing device values (for example, a ring not worn on a bad night) are examined for dependence on mood.

#### 2.9.4 Estimands

All estimands are defined over the reports made from the study start: days with more reports weigh more. For each factor: (a) the odds ratio per natural unit, such as one hour of sleep, 1,000 steps or one hour of screen time (Appendix A lists the units); (b) the average predictive comparison: the mean change, over all reports, in the probability of a Happy report (and of a Sad report) when the factor is one unit higher and everything else is as observed; for a yes/no factor, the mean difference between each report predicted with the factor set to yes and to no; and (c) the posterior probability of the direction of the effect. For H3, other screen time and social media time enter together, so the coefficient of each is the association of one more unit of it with the other held fixed; H3b therefore concerns adding social media time, not replacing other screen time with it. Time of day and weekday effects are reported as model-adjusted probabilities of a Happy report. Point estimates are posterior medians with 95% equal-tailed credible intervals.

#### 2.9.5 Confirmatory Analysis and Decision Rule

Each hypothesis in Section 1.3 is judged by the posterior probability that its effect has the predicted direction (for H5, the probability that φ > 0): supported if that probability is at least 0.975, contradicted if it is at most 0.025, and inconclusive otherwise. The thresholds are applied to the unrounded probability. A hypothesis whose factor is left out of the model at the time of the analysis (Section 2.9.3) is reported as not testable at that analysis; the participant aims to complete the evening entries for H3 and H4 every day. If social media time is left out, screen time enters as its total, H3a is judged on it, and H3b is not testable. Other screen time is missing whenever either of its two entries is, so it can be left out while social media time stays; then H3a is not testable, and H3b is judged on social media time without other screen time held fixed. The rule is applied at 6 months (interim) and at 12 months (final), counted from the study start, and the 12-month result is the conclusion; if the study stops early, the rule is applied to the data available and the report states when and why it stopped (Section 2.11). The design analysis (Section 2.6) gives the probability of support when the hypotheses are true and when they are false, one by one and for the family of six tests. The threshold is not adjusted for the number of hypotheses, because each is a separate prediction judged on its own; when none of them is true, the design analysis found at least one of the six supported in 4% of simulated studies at 6 months and 10% at 12 months, and the final report states this rate next to the results. Results are reported with their full posterior summaries, not only the category.

A confirmatory fit must pass the convergence checks in Section 2.9.8. If it does not, it is rerun with four chains of 4,000 draws after 4,000 warmup iterations and a target acceptance rate of 0.99; if it still does not, the hypotheses are reported as not assessable at that analysis, with the diagnostics.

#### 2.9.6 Secondary Outcome: Day Satisfaction

Day satisfaction is analyzed at 6 and 12 months, not continuously, with the model in `analysis/day_satisfaction.stan` (model version day-ordinal-ar1-stan-v2): a cumulative logit model for its 11 levels with ten ordered cutpoints with normal(0, 3) priors, the same weekday effects, factors, timing rules and priors as the primary model, and a latent AR(1) day effect. Days without an evening rating are left out, not imputed. With one rating per day, the day effect is identified only through its autocorrelation, so the carry-over parameter of this model is interpreted with caution. No hypothesis is tested on this outcome; factors are described with the same posterior probability categories as the exploratory analyses. The model is implemented and checked on simulated data in the software's tests, and any change to it is a protocol amendment.

#### 2.9.7 Exploratory Analyses

Everything else is exploratory: the factors outside the hypotheses (including indoor air quality), same-day totals of the behavioral factors in place of the lagged values, lags of two days, the interaction of sleep with work days, a comparison of the estimates from the first and the last six months (for adaptation or seasonal change), and the tag associations. They are run at 6 and 12 months, except the tag associations, which update with every refit. Exploratory results are described by the same posterior probability of direction, applied to the unrounded value: strong at 0.975 or more, moderate at 0.90, weak at 0.75. Shrinkage through τ guards partly against false positives, but with about twenty factors some moderate findings will be chance (Yarkoni & Westfall, 2017); they are candidates for experiments, not conclusions.

#### 2.9.8 Computation and Diagnostics

The model is written in Stan (Carpenter et al., 2017) and fitted from R with cmdstanr (Gabry et al., 2025) using the No-U-Turn sampler: four chains of 2,000 draws after 2,000 warmup iterations, with a target acceptance rate of 0.95. The length is set by the slowest-mixing parameter, σ: with half as many draws, 52 of the 180 fits of the design analysis failed the checks, and the four failed fits refitted at this length passed, one of them only after the rerun of Section 2.9.5 (Section 2.6). Draws are summarized with the posterior package (Bürkner et al., 2026). A fit passes the convergence checks if the largest rank-normalized R-hat is below 1.01 and the smallest bulk effective sample size exceeds 400 across the cutpoints, the time of day and weekday effects, φ, σ, τ and every factor coefficient, and there are no divergent transitions (Vehtari et al., 2021). The latent day effects and imputed values are not part of the check. A fit that fails is kept on the private dashboard with a warning, but it is not published and not used for any decision. Each fit records the study start it used; a change of the study start triggers a refit, and until then the older fit is treated in the same way.

Model adequacy is checked with posterior predictive checks of the category frequencies, overall and by slot, at every fit; at 6 and 12 months also of the agreement between reports on the same day and of the lag-one autocorrelation of the daily mean rating. Predictive accuracy is estimated with Pareto-smoothed importance sampling leave-one-out cross-validation and its Pareto k diagnostics (Vehtari et al., 2017); if many Pareto k values exceed 0.7, K-fold cross-validation with whole weeks as folds replaces it. Leave-one-out cross-validation predicts a held-out report from all other reports, including later ones, so it is used to compare model variants and not as a measure of forecasting accuracy. A posterior predictive check fails when the observed statistic lies outside the central 95% of the replicated ones; the dashboard marks each failed category share at every fit, and failures are reported. At 6 and 12 months, the proportional odds assumption is checked for each confirmatory factor $j$ with a diagnostic variant of the model, which is not a change to the primary model (ordinal-ar1-stan-v4). The variant keeps the primary model's likelihood, priors and imputation, except that factor $j$ has one coefficient per threshold:

$$\Pr(y_i \le k) = \operatorname{logit}^{-1}\left(c_k - \eta_i^{(-j)} - \beta_{jk} x_{ij}\right), \quad k = 1, 2$$

where $k = 1$ separates Sad from Meh or Happy and $k = 2$ separates Sad or Meh from Happy, $\eta_i^{(-j)}$ is the primary linear predictor without factor $j$, and $x_{ij}$ is the factor's observed or imputed value. $\beta_{j1}$ and $\beta_{j2}$ each have the factor's normal(0, 0.5) prior. The two cumulative probabilities are ordered only if $c_1 - \beta_{j1} x_{ij} < c_2 - \beta_{j2} x_{ij}$ for every report, so the variant gives zero posterior density to parameter values that break this for any report, with observed and imputed values alike; this truncates the prior to the region where the model is valid. The assumption fails for factor $j$ if the 95% interval of $\beta_{j1} - \beta_{j2}$ excludes zero; a factor that fails is reported with both threshold-specific effects, as odds ratios per natural unit with 95% intervals like its confirmatory result, next to that result, which is not changed. The variant's Stan file (model version ordinal-ar1-ppo-check-v1), which implements exactly this specification, is added to the published software before the 6-month analysis. Other extensions that address a failed check, such as category-specific effects for all factors, are exploratory.

The software's tests include slow tests, run on request, that fit both models to simulated data with a known effect and check that the effect is found without divergent transitions; `analysis/simulate.R` shows the same for a whole simulated study.

#### 2.9.9 Sensitivity Analyses

Planned for the 6- and 12-month analyses, reported alongside the confirmatory results, and without changing the decision rule:

1. tighter and wider priors: τ ~ HalfNormal(0.25) and HalfNormal(1) for the shared scale, and standard deviations of 0.25 and 1 for the confirmatory factors (both scales are passed to the model as data, so the model code is the same);
2. excluding reports received more than two hours after they were made;
3. complete-case analysis of each confirmatory factor: reports on days where that factor is missing are left out, and the other factors are imputed as usual;
4. adding a linear trend in study time;
5. excluding the first two weeks after the study start, when reactivity is strongest;
6. a metric model of the same data: the ratings 1, 2 and 3 as a normal outcome with the same linear predictor and AR(1) day effect, only to show how much the ordinal treatment matters;
7. multiple imputation of missing factors by chained equations (van Buuren & Groothuis-Oudshoorn, 2011) with predictive mean matching, 20 imputed data sets, the factors of adjacent days as predictors and yes/no flags kept binary, the model fitted to each data set and the draws pooled;
8. one report per slot: the first report in each slot, discarding additional ones;
9. informative nonresponse: unanswered prompts imputed from the model with their mood shifted toward Sad by 0.5 and by 1.0 on the log-odds scale, a delta adjustment (Carpenter & Kenward, 2013).

#### 2.9.10 Continuous Updating and Interim Looks

The model is refitted on all data from the study start whenever the data change, at most hourly. Each fit is a complete Bayesian update, not a sequential approximation. Estimates between the looks are descriptive and always come with the number of reports and days; the decision rule is applied only at 6 and 12 months. Because the estimates are published as they update (Section 3.2), the published page and the dashboard's summary do not label the factors of the confirmatory hypotheses as strong or moderate before the planned analyses, and every change to the model specification gets a new model version string, shown with the published results, and a dated entry in the revision history.

#### 2.9.11 Descriptive Analyses

Weekly shares of Happy and Sad reports, shares by slot and by weekday, weekly adherence, the share of reports that answer a reminder, and tag associations (the difference in the share of Happy reports with and without a tag, with Beta(1, 1) posteriors recomputed at every refit) are shown on the participant's private dashboard, together with a one-day forecast. They are unadjusted; tag associations are same-moment, so a tag can be a cause of mood or a consequence of it. The forecast is a convenience for the participant, and its accuracy is not an objective of this study.

### 2.10 Embedded N-of-1 Experiments

After the 12-month analysis, the factors under the participant's control with the strongest associations become candidates for randomized N-of-1 experiments, for example caffeine after noon, a morning walk, or an evening without social media. They are unblinded self-experiments: the participant chooses, delivers and experiences the conditions and knows the hypotheses. Each experiment gets a dated amendment to this protocol, published before it starts, that specifies at least:

1. the intervention and control conditions, and the treatment estimand (the effect of assignment on the outcome window);
2. the block design, for example pairs of days with the order randomized within each pair, the number and length of periods, and a washout if carry-over is expected;
3. the random sequence, generated by the software with a recorded seed and stored before the start, and revealed each morning, which conceals the allocation until the day it applies;
4. the outcome window: the day's mood reports, and the next day's for factors that act through sleep;
5. how adherence to the assignment is recorded, and how deviations are handled (the analysis follows the assignment);
6. the analysis: the assignment enters the model as a predictor of the reports in its outcome window, adjusted only for factors measured before assignment, with checks for period and carry-over effects;
7. stopping rules (Section 2.11) and the mapping of the experiment to the SPENT 2019 items (Porcino et al., 2020).

The assignment is recorded in the daily log (a dedicated field will be added before the first experiment). Design and reporting follow the N-of-1 guidance (Kravitz et al., 2014) and CENT 2015 (Vohra et al., 2015); micro-randomized trials are the model for momentary interventions (Klasnja et al., 2015).

### 2.11 Monitoring, Harms and Stopping

Monitoring: from the first report to the study start (the pilot), the participant checks the reminders, the automatic data flows, the backups and the evening log; no model is fitted until the study start is set, and the model starts once there are 30 reports on 14 different days after it. Afterwards, a monthly review checks weekly adherence (target: at least 80% of slots answered), the completeness of each data source, the connectors' error log and the backups; problems and their dates are recorded in the daily log's notes. If adherence falls below 50% in two consecutive completed weeks, the reminder times and the burden of the evening log are reviewed. Changes that affect the analysis go through the amendment process (Section 3.4). As a single-participant self-study with no intervention in its observational phase, it has no data monitoring committee.

Harms: the observational phase involves no intervention. Close attention to one's own mood can increase rumination, and the data may reveal a period of low mood. Safety rule: if more than half of the reports in the last 14 study days are Sad (with at least 10 reports in that period), or the evening rating is 3 or lower on at least 7 of the last 14 days, the app shows a notice on its home page and on the rating page that reminders open, and the participant will contact a family physician or a mental health professional; in a crisis, the participant will call a crisis line (988 in Canada and the United States) or emergency services. The app evaluates the rule when either page loads, after every report the page sends (including reports sent later from the phone's queue), and when an open page returns to the screen or reconnects; reports sent by a phone automation are covered the next time the app is used. The study is always secondary to health and care: care is never delayed or withheld for the study's sake. Data collection can be paused at any time; a pause is recorded as a dated note, its days are missing data, and collection resumes when the participant decides. Experiments use only everyday, low-risk changes and never medication; an experiment stops early if the intervention causes distress or harm, such as persistent caffeine withdrawal headaches, or if the safety rule is met.

Stopping: the participant can stop the study at any time. If it stops before 12 months, the confirmatory analysis is run on the data available and reported as an early stop, with its date and reason.

### 2.12 Timeline

Phase 1, infrastructure (September 2026): the software described in Sections 2.7 and 2.8, with automated tests, a prior predictive check and a design analysis.

Phase 2, pilot (19 September 2026, the day before the study start): checks of the reminders, the automatic data flows, the backups and the evening log. Pilot reports test the software and never enter a model; the software fits no model at all until the study start is set.

Phase 3, data collection (months 1 to 12 from the study start), with the interim analysis at 6 months and a monthly review.

Phase 4, final analysis at 12 months, with the secondary and sensitivity analyses, followed by experiments on the most promising factors (Section 2.10).

## 3. Ethics and Dissemination

### 3.1 Ethics

This is a private self-study: the participant designs the study, collects the data and analyzes them, and no other person's data are involved. It is conducted in Canada, outside any institution, with no funder or sponsor. Canada's Tri-Council Policy Statement (TCPS 2) governs research carried out under the auspices of institutions eligible for federal research funding; it does not reach a private individual studying themselves, so no research ethics board has jurisdiction over this study, and consent is the participant's own decision to take part. Before any results are submitted to a journal, the investigator will ask a research ethics board or the journal for its view, and the answer will be recorded in the revision history. Each experiment's amendment will restate this assessment for its intervention.

### 3.2 Privacy and Data Governance

The study data are stored in these places:

1. the participant's computer: the database, logs, posterior draws and the Amazon sign-in, in a private folder on an encrypted disk (Section 2.7);
2. the encrypted backups, in the configured backup folder, which may be on a cloud drive;
3. the phone: reports waiting to be sent, in the browser's local storage until the server confirms them, the cached rating page with recent tags, and the push subscription;
4. the services that record the raw data, under their own terms: Apple Health on the phone and its iCloud backup, Ultrahuman's cloud and Amazon's cloud. The software fetches the participant's own data from Ultrahuman and Amazon with tokens kept in the private folder and sends those services nothing else;
5. Open-Meteo receives the home location rounded to about one kilometer, to return the weather, and Apple's push service delivers the reminders, encrypted for the phone (RFC 8291): it cannot read them, but it learns when each one is sent, its size and the device it goes to, and it identifies the sending server by that server's public key and contact address, which is the address of the study's code repository (RFC 8292);
6. the public web page, which receives only a fixed set of model estimates: the effect estimates with their credible intervals and direction probabilities, the model-adjusted probabilities by time of day and weekday, the mood dynamics parameters, convergence diagnostics, the model version, and the number of reports and days. Every published field is listed by name at every level, and an automated test fails if anything else appears.

Reports, notes, tags, daily values, indoor air readings, daily model estimates and forecasts are never published. The published estimates are nonetheless health-related information about a named person: comparing successive updates can hint at the mood of recent reports, and the counts reveal when reports are made. Earlier versions of the page stay in the public history of the site and cannot be fully withdrawn. The participant accepts these costs for the sake of transparency; interim noise is the reason interim results are descriptive (Section 2.9.10).

The participant can export all data as CSV or JSON, or delete them, at any time from the application. Deletion in the application removes the reports, daily logs, indoor air readings and analyses from the database; it does not remove the encrypted backups (the 30 most recent are kept, so a backup is removed once 30 newer ones exist, about a month of daily backups; they can also be deleted by hand), the copies held by Apple, Ultrahuman and Amazon, or the public history. Backups are encrypted with a key that only the participant holds. A lost phone is handled by revoking its device token, which could not read stored data, and by changing the password; reports still waiting on a lost phone are lost with it. The Amazon connector's token can act on the participant's Amazon account, so it is stored with the same protection as the database and can be revoked from the account's device list (Nebeker et al., 2019).

### 3.3 Dissemination and Open Science

The results page publishes the estimates listed in Section 3.2 as they update. This protocol, its revision history, the record of its review and the SHA-256 hash of each version are published on the same site, which serves as the study's registration (see Administrative Information). After the 12-month analysis, a report of the confirmatory, secondary and sensitivity analyses, with the adherence and completeness of the data, will be posted there and may be submitted as a preprint or article. Individual data are not shared, for privacy; the data dictionary is Appendix A. The study software, including the Stan models, the R analysis code, the design analysis and the review scripts, is published under the GNU General Public License 3.0 at https://github.com/choxos/AStudyOnMyself; every published estimate carries its model version.

### 3.4 Protocol Amendments and Review

Any change to the outcomes, factors, data sources, model, hypotheses or decision rules gets a new protocol version, with its date, the change and the reason in the revision history, published before the change takes effect in the analysis; model changes also get a new model version string. Version 3.0 was reviewed by two AI models, GPT-6-Astra (OpenAI, through the Codex command line tool) and Grok 4.6 (xAI, through the Grok command line tool), in four rounds. Grok 4.6 accepted it from the second round on. GPT-6-Astra's fourth report asked for one more change, to the order in which the rating page applies the server's answers about the safety rule (Section 2.11); the change was made and tested, and the participant then finalized the protocol without a fifth round. Their reports, the responses and each reviewed version are published with the protocol. After the fourth round, the protocol text changed only in the administrative information, the revision history, the pilot dates in Section 2.12, the tense of Sections 3.3 and 3.4, and one clarification that the last Grok 4.6 report asked for: the scale on which the proportional odds check is reported (Section 2.9.8). Version 3.1, a correction of one data field made before the study start (Revision History), was not sent for review. Review by AI models is not peer review by human experts.

## 4. Discussion

### 4.1 Strengths

Outcomes, factors, timing rules, the model, the hypotheses and the decision rules are fixed before the confirmatory data are collected, and every change is versioned and public. The ordinal likelihood, the latent autoregressive day effect and the lagged behavioral factors address three common problems of self-tracking analyses: metric treatment of ordinal ratings, autocorrelation, and reverse causation from same-day behavior. Automatic collection keeps the daily burden to three taps and an optional evening entry for a year. Embedded experiments turn associations into causal tests where the participant can change the factor. Only estimates are published, and the software is open.

### 4.2 Limitations

The findings describe one person and say nothing about anyone else; generalizing them would need replication across people (Kazdin, 2011). The primary outcome is a single, unvalidated three-level item: it gives coarse resolution, and a participant who rarely uses the extreme levels leaves little information about what moves mood within the middle category. Wearable metrics come from proprietary algorithms that change with software updates, and the Ultrahuman Ring has no independent validation.

The associations are observational. Unmeasured factors can confound them, and behavior measured on the same day as mood is often a consequence of mood rather than a cause, which is why it enters with a one-day lag. The lag reduces but does not remove reverse causation, because yesterday's behavior may reflect a mood that persists into today, a path the autoregressive latent mood only partly absorbs. Same-day weather is a summary of the whole day and the context flags are recorded in the evening, so they adjust the model rather than predict it.

Missing values are assumed to be missing at random and imputed independently of each other. That is doubtful for prompts skipped on bad days, for optional entries made on some days and not others, for the overnight block when the ring is not worn, and for indoor air readings, which are missing while the computer sleeps or when Amazon's unofficial interface fails; the sensitivity analyses address these assumptions. Indoor air means cover mostly waking hours.

The participant is not blind: they know the hypotheses and can see the estimates as they update, so expectations can shape the ratings, and the experiments cannot be blinded. Self-monitoring can itself change mood and behavior (reactivity), most strongly in the first weeks. Fixed reminder times can tie mood reports to habitual moments. With about twenty factors, some exploratory associations will be chance findings despite the shrinkage prior. Publishing estimates as they update exposes interim noise, invites premature conclusions and discloses some information about recent mood; the decision rule is therefore applied only at 6 and 12 months. Finally, the protocol was reviewed by AI models rather than by human experts.

## Appendix A: Data Dictionary

Each factor has one source for the whole study; the alternative in brackets applies only if the primary source is not available at the study start. Apple Health values use the samples of one source only, selected by source in the phone automation: the Ultrahuman app for sleep, heart rate variability, resting heart rate and steps, and the Apple Watch for exercise minutes and time in daylight, so that samples another device records for the same period are never added to them. The pilot checks that the Ultrahuman app's asleep samples do not overlap one another. The indoor air monitor stays where it is at the study start, a place recorded in the pilot notes, for the whole study; a move is recorded as a dated note. Dates are local calendar dates in the participant's time zone; the unit in the last column is the one for which odds ratios are reported.

| Field | Definition, source and window | Model | Unit of effect |
|---|---|---|---|
| sleep_hours | Total sleep of the night that ended on the morning of the date: Ultrahuman total sleep (Apple Health: sum of asleep samples from 6 PM to noon) | same day | 1 hour |
| sleep_efficiency | Share of time in bed asleep, same night: Ultrahuman sleep efficiency (Apple Health: asleep time over time in bed) | same day | 10 points |
| hrv_ms | Heart rate variability of the same night: the average during sleep that the Partner API returns (`avg_sleep_hrv`; its `hrv` metric averages the whole calendar day and is not used); Ultrahuman states that its ring uses RMSSD in its sleep and recovery scores (Ultrahuman, 2026) but does not publish how this value is computed, so the factor is the device's value, never combined with another device's (Apple Health: mean of the night's heart rate variability samples written by the Ultrahuman app, which Apple Health stores under its SDNN type whatever statistic the device computes) | same day | 10 ms |
| resting_hr | Resting heart rate of the same night: Ultrahuman night resting heart rate (Apple Health: resting heart rate of the date) | same day | 5 beats/min |
| skin_temp_dev_c | Skin temperature deviation from the personal baseline, same night: Ultrahuman (else evening log) | same day | 0.5 °C |
| steps | Steps on the date: Ultrahuman daily steps (Apple Health: sum of step samples) | previous day | 1,000 steps |
| exercise_min | Apple exercise minutes on the date (Apple Watch) | previous day | 30 min |
| outdoor_min | Apple time in daylight on the date (Apple Watch; else evening log) | previous day | 30 min |
| social_min | Time spent in person with friends or family on the date, excluding work meetings; evening log | previous day | 1 hour |
| screen_time_min | iPhone Screen Time total for the date; evening log. Modeled as screen time other than social media when social media time is modeled | previous day | 1 hour |
| social_media_min | iPhone Screen Time for the Social category on the date; evening log | previous day | 30 min |
| caffeine_mg | Caffeine on the date; evening log or Apple Health; about 95 mg for a cup of brewed coffee, 63 mg for an espresso, 47 mg for a cup of black tea | previous day | 100 mg |
| alcohol_units | Canadian standard drinks on the date (13.45 g of alcohol: 341 mL of 5% beer, 142 mL of 12% wine, 43 mL of 40% spirits); evening log or Apple Health | previous day | 1 drink |
| work_day | A day with scheduled work; evening log | same day, adjustment | yes against no |
| travel | Slept away from home in the night that ended on the morning of the date; evening log | same day, adjustment | yes against no |
| sick | Unwell enough to change plans on the date; evening log | same day, adjustment | yes against no |
| temp_mean_c, precipitation_mm, sunshine_hours, daylight_hours | Open-Meteo daily values for the home location, rounded to about 1 km: reanalysis for older days, forecast models for the last five | same day, adjustment | 5 °C; 5 mm; 1 hour; 1 hour |
| pm25 | Open-Meteo (CAMS) mean of hourly PM2.5 over the date, home location | same day, adjustment | 10 µg/m³ |
| indoor_pm25, indoor_voc | Amazon Smart Air Quality Monitor: mean of hourly means over the date, recorded only with at least 12 sampled hours; VOC is the monitor's unitless index | previous day | 10 µg/m³; 100 index points |
| day_satisfaction | "All things considered, how satisfied were you with today?", 0 to 10, each evening | secondary outcome | |
| rating | Momentary mood, 1 Sad, 2 Meh, 3 Happy, with report time, receipt time, time zone, study date, slot, note and tags | primary outcome | |

Ultrahuman connector: the software requests `daily_metrics` for each of the last three dates from the Ultrahuman Partner API with the participant's token, files the returned values under the requested date only when the answer contains that date (sleep under the date the night ended) and otherwise stores nothing for it, stores steps only for finished days, and drops values outside the plausible ranges. Amazon connector: the participant registers the software once as an Alexa app by signing in on Amazon's own page; the software keeps only the resulting refresh token, and each hour exchanges it for web cookies, finds the air quality monitor in the account's device list and reads its current values: PM2.5 in µg/m³, volatile organic compounds as an index, carbon monoxide in parts per million, humidity in percent, temperature in °C and Amazon's air quality score. Only PM2.5 and volatile organic compounds enter the model; the others are stored for description.

## Appendix B: Reporting Checklist

SPIRIT 2025 items (Chan et al., 2025) and where this protocol addresses them. Items for randomized comparisons apply to the experiments, whose amendments will address them together with the N-of-1 items of SPENT 2019 (Porcino et al., 2020): the number and length of periods, the sequence of periods, washout, carry-over and period effects, and the within-person analysis (Section 2.10).

| Item | Topic | Where addressed |
|---|---|---|
| 1a | Title | Title |
| 1b | Structured summary | Abstract; Administrative Information |
| 2 | Protocol version | Administrative Information; Revision History |
| 3a | Contributors, affiliations, roles | Administrative Information |
| 3b, 3c | Sponsor and funders, and their role | Administrative Information: none |
| 3d | Committees and oversight | Administrative Information; Section 2.11: none |
| 4 | Registration | Administrative Information; Section 3.3: no registry, public dated record |
| 5 | Access to protocol and analysis plan | Section 3.3 |
| 6 | Data, code and materials | Section 3.3; Appendix A |
| 7a, 7b | Funding; conflicts of interest | Administrative Information |
| 8 | Dissemination | Section 3.3 |
| 9a | Background and rationale | Section 1.1 |
| 9b | Choice of comparator | Not applicable to the observational phase; experiments, Section 2.10 |
| 10 | Objectives, including harms | Sections 1.2 and 1.3 |
| 11 | Patient and public involvement | Section 2.2 |
| 12 | Design | Section 2.1 |
| 13 | Setting | Section 2.2 |
| 14a, 14b | Eligibility; sites and deliverers | Section 2.2; not applicable |
| 15a to 15d | Interventions, discontinuation, adherence, concomitant care | Not applicable to the observational phase; experiments, Sections 2.10 and 2.11; care is never withheld |
| 16 | Outcomes | Section 2.3; Appendix A |
| 17 | Harms | Section 2.11 |
| 18 | Participant timeline | Section 2.5 |
| 19 | Sample size | Section 2.6 |
| 20 | Recruitment | Not applicable (one participant); adherence, Section 2.11 |
| 21a to 23 | Sequence generation, concealment, implementation | Experiments, Section 2.10 |
| 24a to 24c | Blinding | Not possible; Sections 2.10 and 4.2 |
| 25a | Data collection | Sections 2.3, 2.4 and 2.7; Appendix A |
| 25b | Retention and follow-up | Section 2.11 |
| 26 | Data management | Sections 2.7 and 2.8; Appendix A |
| 27a | Statistical methods | Sections 2.9.1 to 2.9.8 |
| 27b | Analysis population | Sections 2.9.1 and 2.9.4: reports from the study start |
| 27c | Missing data | Section 2.9.3 |
| 27d | Additional and sensitivity analyses | Sections 2.9.7 and 2.9.9 |
| 28a | Data monitoring committee | Section 2.11: not needed |
| 28b | Interim analyses and stopping | Sections 2.9.10 and 2.11 |
| 29 | Monitoring | Section 2.11 |
| 30 | Ethics approval | Section 3.1 |
| 31 | Amendments | Section 3.4 |
| 32a, 32b | Consent | Section 3.1: self-study; no ancillary studies |
| 33 | Confidentiality | Section 3.2 |
| 34 | Ancillary and post-trial care | Section 2.11: care is never withheld; no compensation applies |

## References

Bürkner, P.-C., & Vuorre, M. (2019). Ordinal regression models in psychology: A tutorial. *Advances in Methods and Practices in Psychological Science*, 2(1), 77-101.

Bürkner, P.-C., Gabry, J., Kay, M., & Vehtari, A. (2026). *posterior: Tools for working with posterior distributions* (R package version 1.7.1). https://mc-stan.org/posterior/

Carpenter, B., Gelman, A., Hoffman, M. D., Lee, D., Goodrich, B., Betancourt, M., Brubaker, M., Guo, J., Li, P., & Riddell, A. (2017). Stan: A probabilistic programming language. *Journal of Statistical Software*, 76(1), 1-32.

Carpenter, J. R., & Kenward, M. G. (2013). *Multiple imputation and its application*. Wiley.

Chan, A.-W., Boutron, I., Hopewell, S., Moher, D., Schulz, K. F., Collins, G. S., et al. (2025). SPIRIT 2025 statement: Updated guideline for protocols of randomised trials. *BMJ*, 389, e081477. https://doi.org/10.1136/bmj-2024-081477

Cheung, F., & Lucas, R. E. (2014). Assessing the validity of single-item life satisfaction measures: Results from three large samples. *Quality of Life Research*, 23(10), 2809-2818.

Chinoy, E. D., Cuellar, J. A., Huwa, K. E., Jameson, J. T., Watson, C. H., Bessman, S. C., Hirsch, D. A., Cooper, A. D., Drummond, S. P. A., & Markwald, R. R. (2021). Performance of seven consumer sleep-tracking devices compared with polysomnography. *Sleep*, 44(5), zsaa291.

de Zambotti, M., Cellini, N., Goldstone, A., Colrain, I. M., & Baker, F. C. (2019). Wearable sleep technology in clinical and research settings. *Medicine and Science in Sports and Exercise*, 51(7), 1538-1557.

Diener, E., Heintzelman, S. J., Kushlev, K., Tay, L., Wirtz, D., Lutes, L. D., & Oishi, S. (2017). Findings all psychologists should know from the new science on subjective well-being. *Canadian Psychology*, 58(2), 87-104.

Evenson, K. R., Goto, M. M., & Furberg, R. D. (2015). Systematic review of the validity and reliability of consumer-wearable activity trackers. *International Journal of Behavioral Nutrition and Physical Activity*, 12, 159.

Gabry, J., Češnovar, R., Johnson, A., & Bronder, S. (2025). *cmdstanr: R interface to CmdStan* (R package version 0.9.0). https://mc-stan.org/cmdstanr/

Gelman, A., Carlin, J. B., Stern, H. S., Dunson, D. B., Vehtari, A., & Rubin, D. B. (2013). *Bayesian data analysis* (3rd ed.). CRC Press.

Gelman, A., Simpson, D., & Betancourt, M. (2017). The prior can often only be understood in the context of the likelihood. *Entropy*, 19(10), 555.

Golder, S. A., & Macy, M. W. (2011). Diurnal and seasonal mood vary with work, sleep, and daylength across diverse cultures. *Science*, 333(6051), 1878-1881.

Graham, J. W. (2009). Missing data analysis: Making it work in the real world. *Annual Review of Psychology*, 60, 549-576.

Hamaker, E. L. (2012). Why researchers should think "within-person": A paradigmatic rationale. In M. R. Mehl & T. S. Conner (Eds.), *Handbook of research methods for studying daily life* (pp. 43-61). Guilford Press.

Holt-Lunstad, J., Smith, T. B., & Layton, J. B. (2010). Social relationships and mortality risk: A meta-analytic review. *PLoS Medicine*, 7(7), e1000316.

Hunt, M. G., Marx, R., Lipson, C., & Young, J. (2018). No more FOMO: Limiting social media decreases loneliness and depression. *Journal of Social and Clinical Psychology*, 37(10), 751-768.

Kahneman, D., & Deaton, A. (2010). High income improves evaluation of life but not emotional well-being. *Proceedings of the National Academy of Sciences*, 107(38), 16489-16493.

Kazdin, A. E. (2011). *Single-case research designs: Methods for clinical and applied settings* (2nd ed.). Oxford University Press.

Killingsworth, M. A., & Gilbert, D. T. (2010). A wandering mind is an unhappy mind. *Science*, 330(6006), 932.

Klasnja, P., Hekler, E. B., Shiffman, S., Boruvka, A., Almirall, D., Tewari, A., & Murphy, S. A. (2015). Microrandomized trials: An experimental design for developing just-in-time adaptive interventions. *Health Psychology*, 34(Suppl), 1220-1228.

Kravitz, R. L., Duan, N., & the DEcIDE Methods Center N-of-1 Guidance Panel (Eds.). (2014). *Design and implementation of N-of-1 trials: A user's guide* (AHRQ Publication No. 13(14)-EHC122-EF). Agency for Healthcare Research and Quality.

Kuppens, P., Allen, N. B., & Sheeber, L. B. (2010). Emotional inertia and psychological maladjustment. *Psychological Science*, 21(7), 984-991.

Li, I., Dey, A., & Forlizzi, J. (2010). A stage-based model of personal informatics systems. *Proceedings of the SIGCHI Conference on Human Factors in Computing Systems*, 557-566.

Liddell, T. M., & Kruschke, J. K. (2018). Analyzing ordinal data with metric models: What could possibly go wrong? *Journal of Experimental Social Psychology*, 79, 328-348.

Lucas, R. E., & Donnellan, M. B. (2012). Estimating the reliability of single-item life satisfaction measures: Results from four national panel studies. *Social Indicators Research*, 105(3), 323-331.

Molenaar, P. C. (2004). A manifesto on psychology as idiographic science: Bringing the person back into scientific psychology, this time forever. *Measurement*, 2(4), 201-218.

Myin-Germeys, I., Kasanova, Z., Vaessen, T., Vachon, H., Kirtley, O., Viechtbauer, W., & Reininghaus, U. (2018). Experience sampling methodology in mental health research: New insights and technical developments. *World Psychiatry*, 17(2), 123-132.

Nebeker, C., Torous, J., & Bartlett Ellis, R. J. (2019). Building the case for actionable ethics in digital health research supported by artificial intelligence. *BMC Medicine*, 17, 137.

Piironen, J., & Vehtari, A. (2017). Sparsity information and regularization in the horseshoe and other shrinkage priors. *Electronic Journal of Statistics*, 11(2), 5018-5051.

Porcino, A. J., Shamseer, L., Chan, A.-W., Kravitz, R. L., Orkin, A., Punja, S., Ravaud, P., Schmid, C. H., Vohra, S., & the SPENT group. (2020). SPIRIT extension and elaboration for n-of-1 trials: SPENT 2019 checklist. *BMJ*, 368, m122. https://doi.org/10.1136/bmj.m122

Power, M. C., Kioumourtzoglou, M. A., Hart, J. E., Okereke, O. I., Laden, F., & Weisskopf, M. G. (2015). The relation between past exposure to fine particulate air pollution and prevalent anxiety: Observational cohort study. *BMJ*, 350, h1111.

Primack, B. A., Shensa, A., Sidani, J. E., Whaite, E. O., Lin, L. Y., Rosen, D., Colditz, J. B., Radovic, A., & Miller, E. (2017). Social media use and perceived social isolation among young adults in the U.S. *American Journal of Preventive Medicine*, 53(1), 1-8.

Rosenthal, N. E., Sack, D. A., Gillin, J. C., Lewy, A. J., Goodwin, F. K., Davenport, Y., Mueller, P. S., Newsome, D. A., & Wehr, T. A. (1984). Seasonal affective disorder: A description of the syndrome and preliminary findings with light therapy. *Archives of General Psychiatry*, 41(1), 72-80.

Rubin, D. B. (1976). Inference and missing data. *Biometrika*, 63(3), 581-592.

Shiffman, S., Stone, A. A., & Hufford, M. R. (2008). Ecological momentary assessment. *Annual Review of Clinical Psychology*, 4, 1-32.

Stone, A. A., Shiffman, S., Schwartz, J. E., Broderick, J. E., & Hufford, M. R. (2002). Patient non-compliance with paper diaries. *BMJ*, 324(7347), 1193-1194.

Swan, M. (2013). The quantified self: Fundamental disruption in big data science and biological discovery. *Big Data*, 1(2), 85-99.

Thayer, J. F., & Lane, R. D. (2009). Claude Bernard and the heart-brain connection: Further elaboration of a model of neurovisceral integration. *Neuroscience & Biobehavioral Reviews*, 33(2), 81-88.

Ultrahuman. (2026, September 10). *RMSSD vs SDNN: The two HRV metrics explained*. Ultrahuman Blog. https://www.ultrahuman.com/blog/rmssd-vs-sdnn-hrv-metrics-explained/

van Buuren, S., & Groothuis-Oudshoorn, K. (2011). mice: Multivariate imputation by chained equations in R. *Journal of Statistical Software*, 45(3), 1-67.

Vehtari, A., Gelman, A., & Gabry, J. (2017). Practical Bayesian model evaluation using leave-one-out cross-validation and WAIC. *Statistics and Computing*, 27(5), 1413-1432.

Vehtari, A., Gelman, A., Simpson, D., Carpenter, B., & Bürkner, P.-C. (2021). Rank-normalization, folding, and localization: An improved R-hat for assessing convergence of MCMC. *Bayesian Analysis*, 16(2), 667-718.

Vohra, S., Shamseer, L., Sampson, M., Bukutu, C., Schmid, C. H., Tate, R., Nikles, J., Zucker, D. R., Kravitz, R., Guyatt, G., Altman, D. G., & Moher, D. (2015). CONSORT extension for reporting N-of-1 trials (CENT) 2015 statement. *BMJ*, 350, h1738.

Yarkoni, T., & Westfall, J. (2017). Choosing prediction over explanation in psychology: Lessons from machine learning. *Perspectives on Psychological Science*, 12(6), 1100-1122.
