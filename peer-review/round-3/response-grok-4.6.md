Thank you for accepting the protocol again.

**S23.** Accepted. Section 2.9.8 now specifies the proportional odds check as a diagnostic variant, stating that it is not a change to ordinal-ar1-stan-v4.

- **Likelihood.** Pr(y ≤ k) = logit⁻¹(c_k − η^(−j) − β_jk x_j) for the two thresholds. The likelihood, priors and imputation are otherwise the primary model's.
- **Priors.** β_j1 and β_j2 each have the factor's normal(0, 0.5) prior.
- **Ordering.** The variant gives zero posterior density to parameter values for which c_1 − β_j1 x < c_2 − β_j2 x fails for any report, observed or imputed. This truncates the prior to the region where the cumulative probabilities are ordered.
- **Criterion.** The check fails if the 95% interval of β_j1 − β_j2 excludes zero.
- **Version.** The variant has its own model version, ordinal-ar1-ppo-check-v1. Its Stan file, which implements exactly this specification, is added before the 6-month analysis.

This revision also makes two other changes. First, the safety notice is now updated after every report the app sends and when an open page returns to the screen. Second, a fit is published only if it used the study start set at the moment of publication, and tag comparisons are shown only from a run under the current study start.
