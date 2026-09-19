Thank you for a clear and practical review. Every point is answered below, with the section where the text changed. The software changes are in the round 2 snapshot and are covered by tests. One correction first: the round 1 instructions said that data collection had not started. That was true when they were written but not when the round began, because the first pilot report was made the same morning. Your M1 is resolved as you proposed.

**M1.** Accepted as proposed. Reports made before the protocol is finalized are pilot data: the pilot runs from 19 September 2026 to the study start, which is the day after finalization. The study start is recorded in the software, and pilot reports never enter any model, confirmatory or live (`load_dataset` filters by `users.study_start`, with a test). The 6- and 12-month analyses count from the study start (Administrative Information; Sections 2.11 and 2.12).

**M2.** Accepted and implemented as proposed. When social media time is modeled, screen time enters as screen time other than social media, so H3a and H3b are judged on those two coefficients, each with the other held fixed. When social media time is left out, screen time enters as its total, H3a is judged on it, and H3b is not testable (Sections 1.3, 2.9.4 and 2.9.5; `build_factors` in `mood.R`, with a test).

**M3.** Accepted. The timing rule now limits the pre-report claim to last night's sleep and physiology and the previous day's behavior and indoor air. Same-day weather is named as an explicit exception, including that a morning report is modeled with the afternoon's rain, and the work, travel and sick flags are described as evening-recorded same-day covariates that can follow the day's mood. Both groups are adjustment covariates, and neither is a confirmatory factor (Abstract; Sections 2.4 and 4.2).

**S1.** Accepted. The protocol now gives the country and states that the study is conducted privately, outside any institution (Administrative Information; Section 2.2). Section 2.2 has the patient and public involvement statement. The Administrative Information and Section 3.3 give the reason there is no registry: every version is published with its hash on a public site whose commit history dates it. Appendix B maps every SPIRIT 2025 item to a section and marks the items that do not apply.

**S2.** Accepted, and it changed the model. The design analysis now runs replicates for each of four conditions (180 and 365 days, with effects and under the null); 50 is the script's default, and Section 2.6 gives the number completed. It places signed effects on every confirmatory factor, H3b and H4 included, and removes the optional factors on 30% of evenings. It reports how often each hypothesis is supported and how often at least one of the six tests is supported under the global null. Its first run, with the shared shrinkage prior, showed that pooling the confirmatory factors with about 18 factors without effect shrank their estimates to roughly half of the truth. The confirmatory factors now have their own normal(0, 0.5) priors (model version ordinal-ar1-stan-v4; Section 2.9.2), and the design analysis was run again on that model; Section 2.6 reports both runs.

**S3.** Accepted. Appendix A and the connector paragraph now specify the Ultrahuman endpoint, the HRV statistic, the date convention for sleep, the Apple Health alternatives and the one-source rule. For Amazon they cover the unofficial method, what its token can do, the units (VOC as the monitor's unitless index), calendar-day means and the waking-hours bias. Switching a factor to the Partner API after the start is an amendment modeled as a break (Section 2.4).

**S4.** Accepted and implemented. The day satisfaction model is now in the software: `analysis/day_satisfaction.stan` and `analysis/secondary.R`, model version day-ordinal-ar1-stan-v2 (with the prior change described under S2), tested on simulated data. Any change to it is an amendment. Days without an evening rating are left out, not imputed (Section 2.9.6).

**S5.** Accepted. The estimand is defined over reports, so days with more reports weigh more (Sections 2.3.1 and 2.9.4), and sensitivity analysis (8) keeps only the first report in each slot.

**S6.** Partly accepted. The participant asked for automatic collection wherever possible, so these entries stay optional rather than required. The protocol states the aim to complete them every evening and notes that Screen Time allows a missed evening to be filled in within the week. It also keeps the not-testable rule, and the design analysis now simulates 30% of evenings missing, so that its estimates of power include this cost (Sections 2.4, 2.6 and 2.9.5).

**S7.** Accepted. Roenneberg et al. is replaced by Golder and Macy (2011), who measured expressed mood by time of day and day of the week. Power et al. is now presented as background linking PM2.5 with anxiety, not as evidence about momentary mood (Section 2.4).

**S8.** Accepted and implemented. The published page no longer carries an evidence label for the five confirmatory factors: it shows "judged at 6 and 12 months" and keeps the intervals and probabilities. The home page summary leaves them out (Section 2.9.10; `publicResults`, with a test).

**S9.** Accepted. Section 2.9.3 now names the overnight block that goes missing together, and sensitivity analysis (7) imputes by chained equations, in which each missing factor is predicted from the others and from adjacent days, so the block is imputed with its correlations. Checking device missingness against mood remains planned.

**S10.** Accepted. The complete-case analysis is defined per confirmatory factor: reports on days where that factor is missing are left out, and the other factors are imputed as usual. The metric model is defined as the ratings 1, 2 and 3 as a normal outcome with the same linear predictor and AR(1) day effect. Same-day behavior is removed from the sensitivity list and remains exploratory (Sections 2.9.7 and 2.9.9).

**S11.** Accepted. The repository will be public under the GNU General Public License 3.0 when the protocol is finalized. Section 3.3 gives the license and the address, and "on request" is gone.

**S12.** Accepted. Section 2.10 now states that the experiments are unblinded self-experiments, that version 3.0 fixes the observational phase and the template for experiment amendments, and that each amendment will cover the SPENT 2019 items for periods, sequence, concealment and washout.

**S13.** Accepted and fixed. Weather now uses complete days in the participant's time zone (`syncWeather`), and the protocol states that it is for the home location even on days away from home (Section 2.4; Appendix A).

**m1.** Accepted. Section 2.3.1 now says that both timestamps are stored, so the delay can be computed.

**m2.** Accepted. Section 2.8 now describes the backup rule as implemented.

**m3.** Accepted. Section 2.9.3 now names a factor that never varies as a reason for leaving it out.

**m4.** Accepted and implemented. Weekly adherence is computed and shown on the private Trends page, with the eligible slots counted from the study start (Section 2.3.3).

**m5.** Both connectors are now implemented, so the revision history lists them as part of version 3.0. Section 2.4 states that they are tested with synthetic responses shaped like the services' formats. The Amazon connector has since been checked against the live service; the Ultrahuman connector will be checked when the Partner API token is granted.

**m6.** Accepted. φ is now called day-to-day carry-over of the latent mood, analogous to but not the same as the emotional inertia of Kuppens et al. (Section 2.3.2).

**m7.** Accepted. Section 2.9.8 names the parameters that must pass the R-hat and effective sample size checks, matching `summarize_fit`.

**m8.** Accepted. Section 2.7 notes that the Tailscale certificate publishes the computer's name in public certificate transparency logs.
