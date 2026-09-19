Thank you for a detailed and exacting review. Every point is answered below, with the section where the text changed. The software changes are in the round 2 snapshot and are covered by tests. One correction first: the round 1 instructions said that data collection had not started. That was true when they were written but not when the round began, because the first pilot report was made the same morning. The protocol now separates that pilot from confirmatory data collection (M1).

**M1.** Accepted. The protocol now distinguishes a pilot, from 19 September 2026 to the study start, from confirmatory data collection, which starts on the day after the protocol is finalized. The study start is recorded in the software, and reports made before it never enter any model: `load_dataset` filters by `users.study_start`, with a test (Administrative Information; Sections 2.11 and 2.12).

**M2.** Accepted. The timing rule now separates predictors in the strict sense (last night's sleep and physiology, and the previous day's behavior and indoor air) from same-day adjustment covariates. Weather is a summary of the whole day and the context flags are recorded in the evening; the text says why each is kept and that none is a confirmatory factor (Abstract; Sections 2.4 and 4.2).

**M3.** Accepted and fixed in the code. `syncWeather` now requests days up to yesterday in the participant's time zone. The protocol says that weather uses local calendar days and the home location, even on days away from home (Section 2.4; Appendix A).

**M4.** Accepted. The claim is removed. Section 2.9.3 now says that when skipping depends on mood, the selection depends on the outcome and can bias the associations as well as the average; sensitivity analysis (9) is a delta-adjusted imputation of unanswered prompts.

**M5.** Accepted and fixed. For work day, travel and sick, the probability comparison now predicts each report with the factor set to yes and to no, using the imputed values where the flag is missing (`summarize_fit`); a slow test checks that it agrees in direction with the odds ratio. Section 2.9.4 defines the contrast.

**M6.** Accepted. The gate is now enforced: a fit that fails the checks is not published (`scripts/cli.ts`), is flagged on the private dashboard, and is not used for any decision. A confirmatory fit that fails is rerun with longer chains and a higher target acceptance rate, and otherwise the hypotheses are reported as not assessable (Sections 2.9.5 and 2.9.8).

**M7.** Accepted and fixed. The evidence categories and the decision rule use the unrounded probability, and only the reported value is rounded, now to four decimals (`summarize_fit`; Sections 2.9.5 and 2.9.7).

**M8.** Accepted. `simulate_study` now returns the standard deviations of the generating values, and `simulate.R` computes the true odds ratios from them. The design analysis was rewritten: true effects are set per natural unit and converted in every replicate to the fitted scale, the standard deviation of the observed, lagged and recoded values (Section 2.6).

**M9.** Clarified, with a correction. The snapshot did contain `software/analysis/tests/testthat/` (`helper-setup.R`, `test-dataset.R`, `test-recovery.R`), and `test-recovery.R` asserts that a known effect is found with no divergent transitions. Your point about the description stands, because those tests are slow and run only on request; Section 2.9.8 now says exactly that. They now cover the day satisfaction model and the yes/no contrast as well.

**M10.** Accepted and fixed. The evening form now carries, for each field, the value it showed, and only the fields the participant changed are saved; a test covers an automatic value written after the form was opened. Section 2.7 states the rule, and that the later write wins when two sources write the same field, which is why each field has one source (Appendix A).

**M11.** Accepted and fixed; thank you for finding it. A request made with a device token now gets only an acknowledgment: for daily values, the date and the names of the fields changed; for a report, its id, study date and slot. Stored values are never returned, and a test checks that an existing note and other fields do not appear. Sections 2.7 and 3.2 describe the scope: a token can add reports and set daily values but cannot read stored data.

**M12.** Accepted and fixed. `publicResults` now builds every published object field by field, nested intervals, levels and dynamics included. The test adds unexpected nested fields (a note, a series, dates, an extra key) and checks that none of them is published.

**M13.** Accepted. Section 3.2 now lists every place the data are stored: the computer, the backups, the phone's queue and cache, the services that record the raw data, Open-Meteo, and the public page. It also says what deletion in the application does and does not remove (backups, copies held by Apple, Ultrahuman and Amazon, the public history), and how a lost phone is handled.

**M14.** Accepted and implemented. Weekly adherence, for Monday to Sunday weeks with the eligible slots counted from the study start, is on the private Trends page, and the 14-day figure on the home page now counts only slots since the start. Sections 2.3.3 and 2.11 define both and apply the 50% rule to completed weeks. Adherence is not on the public page; the 6- and 12-month reports will give it for every week.

**M15.** The study is a private self-study, conducted in Canada by an individual, not as part of work for any institution, with no funder or sponsor. Canada's Tri-Council Policy Statement governs research under the auspices of eligible institutions and does not reach a private individual studying themselves, so no research ethics board has jurisdiction; the UBC policy you cite applies to UBC researchers. Section 3.1 now states this, commits to asking a research ethics board or the journal for its view before any results are submitted, and requires each experiment's amendment to restate the assessment.

**M16.** Accepted. Roenneberg et al. (2003) is removed. The daily and weekly rhythms are now supported by Golder and Macy (2011), who measured expressed mood by time of day and day of the week across cultures (Section 2.4).

**S1.** Accepted and changed in the model. When social media time is modeled, screen time now enters as screen time other than social media, so each coefficient holds the other fixed. Section 2.9.4 states that H3b concerns adding social media time, not replacing other screen time with it. A test covers the recoding.

**S2.** Accepted. Sensitivity analysis (7) is multiple imputation by chained equations with predictive mean matching, the factors of adjacent days as predictors and yes/no flags kept binary. Section 2.9.3 names the independence and binary limitations of the in-model imputation.

**S3.** Accepted. Sensitivity analyses (8), one report per slot, and (9), delta-adjusted informative nonresponse, are added, and the estimand is defined over reports (Section 2.9.4). Reminders are now push notifications sent by the app itself, and every reminder is recorded, so a report made within an hour after a reminder in its slot counts as answering it; the dashboard shows the share (Sections 2.3.1 and 2.9.11).

**S4.** Accepted, and it changed the model. The design analysis now has correlated and autocorrelated factors, missingness as in the real study, effects on H3b and H4, a global null with φ = 0, Monte Carlo standard errors, the family-wise rate under the null, the number of fits that failed the checks, and a prespecified precision target (Section 2.6). Its first run, with the shared shrinkage prior, showed that pooling the five confirmatory factors with about 18 factors without effect shrank their estimates to roughly half of the truth, with poor coverage. The confirmatory factors now have their own normal(0, 0.5) priors (model version ordinal-ar1-stan-v4; Section 2.9.2), the design analysis was run again on that model, and Section 2.6 reports both. It also showed that σ mixes slowly enough to miss the effective sample size threshold with 1,000 draws per chain, so production fits now use 2,000 (Section 2.9.8).

**S5.** Accepted. The prior predictive check was run and its results are in Section 2.9.2. Posterior checks of the agreement between reports on the same day and of lag-one autocorrelation, the response to a failed check, and K-fold cross-validation by whole weeks when Pareto k values are high are in Section 2.9.8.

**S6.** Accepted. Appendix A is a data dictionary with the source, time window, aggregation and unit of every factor, including the Canadian standard drink, caffeine conversions and the handling of travel. The evening form's help texts now match it.

**S7.** Accepted. Section 2.10 lists the minimum content of each experiment's amendment: the treatment estimand, adherence and deviations, periods and washout, carry-over and period effects, allocation concealment, adjustment for pretreatment factors only, publication before the start, and the mapping to SPENT 2019.

**S8.** Accepted and implemented. The app evaluates the safety rule every time its home page is opened, with a minimum of 10 reports, and Section 2.11 specifies how a pause is recorded and ended.

**S9.** Accepted. An early stop is now an explicit exception: the rule is applied to the data available, and the report states when and why the study stopped (Sections 2.9.5 and 2.11).

**S10.** Accepted. Section 3.2 now acknowledges that the estimates are health-related information about a named person, that comparing successive updates can hint at recent mood, that the counts reveal when reports are made, and that the public history cannot be fully withdrawn.

**m1.** Accepted. Appendix B maps every SPIRIT 2025 item to a section, marks the items that do not apply, and assigns the SPENT 2019 items to the experiments' amendments.

**m2.** Accepted. Sections 2.3.2 and 2.9.1 now say that φ and σ describe the latent process conditional on the factors.

**m3.** Accepted. Evenson et al. is described as a review of Fitbit and Jawbone trackers covering studies up to 2015, and the PubMed search is given exactly: the query, the field, the date, the number of records and what the two relevant records are.
