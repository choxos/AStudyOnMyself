Thank you again. The in-memory probes found two real gaps, both now closed; the changes are below, each with a test.

**M20.** Accepted and fixed.

- **Publication.** The gate now sits inside `publish()`, the one function every publication goes through. It re-reads the study start from the database when the page is written, so a fit made before the start changed is never published, whoever called `publish()` and whatever start that caller had read. `publishable()` takes only the fit and reads the current start itself. The test makes a fit under one start, changes the start in the database and checks that the same fit is refused.
- **One reading per run.** `refit.R` reads the study start once and passes it to the tag comparisons and the model, so both use the same start.
- **Tag comparisons.** Every run records its start, waiting runs included (`data.study_start`). The Trends page shows tag comparisons only from a run whose recorded start equals the current one.

**M24.** Accepted and fixed; the claim was wrong for a page that stays open.

- **The notice.** It is now always in the home and rating pages, hidden unless the rule is met.
- **After each report.** The response to every report the app sends carries the rule's current state. The page updates the notice after each report it sends, including reports sent later from the phone's queue.
- **On resume.** When an open page returns to the screen or reconnects, it sends its queue and then asks `/api/safety/`.
- **Device tokens.** Reports sent with a device token still get only an acknowledgment. Section 2.11 now states this schedule, and that reports from a phone automation are covered the next time the app is used.
- **Test.** A new user keeps one session open and sends ten Sad reports, the earlier ones backdated as queued reports are. The first nine answers carry `safety: false`, the tenth `true`, and `/api/safety/` and the rating page then agree. The device test still checks that a token's answer has only the id, date and slot.

**S21.** Accepted. Section 2.9.8 now gives the diagnostic variant in full; it is not a change to the primary model.

- **Likelihood.** Pr(y ≤ k) = logit⁻¹(c_k − η^(−j) − β_jk x_j) for the two thresholds. Everything else, the imputation included, is as in the primary model.
- **Priors.** β_j1 and β_j2 each have the factor's normal(0, 0.5) prior.
- **Ordering.** Zero posterior density is given to parameter values for which c_1 − β_j1 x < c_2 − β_j2 x fails for any report, with observed and imputed values alike. This truncates the prior to the region where the model is valid.
- **Criterion and code.** The failure criterion is the 95% interval of β_j1 − β_j2. The Stan file (ordinal-ar1-ppo-check-v1), which implements exactly this specification, is added before the 6-month analysis.

**S22.** Accepted. `completion()` and `weeklyAdherence()` now take the current time as an argument, and the test uses fixed times with a fixed report. One morning report on the first study day gives 1 of 1 at 10 AM and 1 of 2 at 2 PM, for both measures. The former three-slot denominator would give 1 of 3 at both times and fail. The clock-dependent assertions were removed.
