Thank you for checking the revision so closely, code included. The four new points and the five partly resolved ones are answered below; each software change comes with a test. Separately, the prior scale of the confirmatory factors is now passed to both Stan models as data, so that sensitivity analysis (1) needs no change to the model code. At the default of 0.5 the model is the same, so its version stays ordinal-ar1-stan-v4 (Section 2.9.9).

**M13.** Accepted; both statements were wrong. Section 3.2 now says that the 30 most recent backups are kept, so a backup is removed once 30 newer ones exist, about a month of daily backups. It also says that Apple's push service cannot read the encrypted reminders but learns when each one is sent, its size and the device it goes to, and identifies the sending server by its public key and contact address, the address of the study's code repository (RFC 8292).

**M14.** Accepted and fixed. Both the 14-day completion and weekly adherence now count only slots that have begun, so a single report in the first morning slot is 1 of 1, not 1 of 3 (`begunSlots` in `stats.ts`). The test starts a study today and checks that the eligible slots equal the slots begun so far, and that both measures agree. Section 2.3.3 already defined adherence this way; the code now matches it.

**S5.** Accepted. Section 2.9.8 now specifies the check at 6 and 12 months. Each confirmatory factor gets a refit with separate coefficients for its two thresholds (Sad against Meh or Happy, and Sad or Meh against Happy). The assumption fails for that factor if the 95% interval of the difference between the two coefficients excludes zero. A factor that fails is reported with both coefficients next to its confirmatory result, and the decision rule is unchanged.

**S6.** Accepted.

- **Apple Health.** The values use the samples of one source only, selected by source in the phone automation: the Ultrahuman app for sleep, heart rate variability, resting heart rate and steps, and the Apple Watch for exercise minutes and time in daylight. Samples another device records for the same period are never added. The pilot checks that the Ultrahuman app's asleep samples do not overlap one another. The README's recipe now includes the filter.
- **Monitor placement.** The monitor stays where it is at the study start, a place recorded in the pilot notes, and a move is a dated note.
- **HRV.** The factor is the nightly average that the Partner API returns (`hrv.avg`). Ultrahuman states that its ring uses RMSSD in its sleep and recovery scores but does not publish how this value is computed. The factor is therefore the device's value and is never combined with another device's. Apple Health stores ring values under its SDNN type whatever the statistic (Appendix A).

**S8.** Accepted and implemented. The rating page that reminders open now evaluates the safety rule and shows the same notice as the home page, so the rule is checked at every report made in the app (Section 2.11; `ratePage`).

**M20.** Accepted and fixed.

- **Unset start.** `study_start()` now stops every model, primary, secondary and tag comparisons alike, while the study start is unset; the run is recorded as waiting with that reason.
- **Record of the start used.** Each fit records the study start it used (`data.study_start`), and the start is part of the fingerprint, so changing it triggers a refit.
- **Older fits.** A fit whose recorded start differs from the current one is flagged on the dashboard, and `publishable()` refuses it. The same gate applies to the hourly job and to the manual publish command.
- **Tests.** An R test covers the unset start (no dataset, day dataset or tag comparison). A Node test checks that a changed start changes the fingerprint and blocks publishing the older fit (Sections 2.9.8, 2.11 and 2.12).

**M21.** Accepted and fixed; thank you for the upgrade probe. `users.study_start` is now in the migration list, which is exported as `migrate()`. A test builds a database with the previous users table, runs the migration twice and checks the added columns and their defaults.

**M22.** Accepted and fixed. The connector files values only under the requested date and only when the answer contains that date; otherwise it stores nothing and reports the date as missing. A test stubs the service to answer today's request with yesterday's metrics and checks that nothing is stored (Appendix A).

**M23.** Accepted and fixed. The check now uses the 2.5th and 97.5th percentiles of the replicated shares and records, per category, whether the observed share lies outside them, using unrounded values. The dashboard marks each failed share, describes the interval as the central 95%, and counts the failures among the diagnostics (Section 2.9.8).

**S20.** Accepted. The yes/no comparison is now a separate function, `contrast()`, and a test without Stan checks it numerically. It uses two draws and three reports whose flag is observed as yes, observed as no and missing. The test checks that every report's linear predictor is set exactly to the flag's yes and no values, which the earlier value-plus-one comparison would fail, and that a continuous factor moves one unit up from each report's own value.
