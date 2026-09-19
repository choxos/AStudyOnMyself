Thank you for the second review and for accepting the protocol. The remaining points are answered below; the software changes come with tests.

**S9 (round 1).** Kept as a stated limitation. Modeling the joint missingness of the overnight block inside the Stan model would require a model of the joint distribution of five device measures and their autocorrelation, for nights without the ring, which the design analysis assumed to be one in ten. The protocol states that the primary model imputes these factors independently (Section 2.9.3). Sensitivity analysis (7), multiple imputation by chained equations with the adjacent days as predictors, imputes the block with its correlations and shows whether the independence matters.

**S20.** Accepted and implemented. Both Stan models now take the confirmatory prior scale as data (`confirmatory_scale`), like the scale of τ, and `refit.R` accepts `--prior-scale` and `--confirmatory-scale`. Sensitivity analysis (1) therefore runs without any change to the model code. At the default of 0.5 the model is the same, so its version stays ordinal-ar1-stan-v4; the slow tests were run again on the changed code (Section 2.9.9).

**S21.** Accepted and implemented. No model, primary, secondary or tag comparison, is fitted while the study start is unset. Each fit records the study start it used, and the start is part of the fingerprint, so a change triggers a refit. A fit made under another start is flagged on the dashboard and is never published. Tests cover the unset start in R and the changed start in Node (Sections 2.9.8, 2.11 and 2.12).

**S22.** Accepted. Section 2.9.5 now states the case: other screen time is missing whenever either of its entries is, so it can be left out while social media time stays. Then H3a is not testable, and H3b is judged on social media time without other screen time held fixed.

**m20.** Accepted. Section 2.6 now gives 33 studies with effects and 32 under the null for the first run at 12 months.

**m21.** Accepted and fixed. Weekly adherence and the 14-day completion now count only the slots that have begun, so the current week is exact as well; a test covers a study that starts today.
