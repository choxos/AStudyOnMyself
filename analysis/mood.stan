// Ordinal model of momentary mood (1 Sad, 2 Meh, 3 Happy).
//
//   P(y_i <= k) = logistic(c_k - eta_i),  k = 1, 2
//   eta_i = time_of_day[s] + weekday[w] + x_d' beta + u_d
//   u_d = phi * u_(d-1) + sigma * e_d          latent daily mood, stationary AR(1)
//
// phi lies in (-1, 1) with (phi + 1) / 2 ~ Beta(2, 2), a prior symmetric around
// zero, so the direction of day-to-day carry-over is estimated, not assumed.
//
// Predictors are standardized; missing cells are imputed as N(0, 1) parameters
// (missing at random). Confirmatory factors have normal(0, 0.5) priors, the scale
// passed as data so that sensitivity analyses can vary it; the others share a
// hierarchical shrinkage prior, beta = tau * beta_z.
data {
  int<lower=1> N;                                 // reports
  int<lower=1> D;                                 // calendar days from first to last report
  int<lower=1> R;                                 // days with reports (rows of X)
  int<lower=0> P;                                 // predictors
  array[N] int<lower=1, upper=3> y;
  array[N] int<lower=1, upper=3> slot;            // morning, afternoon, evening
  array[N] int<lower=1, upper=7> weekday;         // 1 = Monday
  array[N] int<lower=1, upper=D> day;
  array[N] int<lower=1, upper=R> rated_day;       // row of X for each report
  matrix[R, P] X;                                 // missing cells hold 0
  int<lower=0> M;
  array[M] int<lower=1, upper=R> miss_row;
  array[M] int<lower=1, upper=P> miss_col;
  real<lower=0> prior_scale;                      // scale of the half-normal prior on tau
  real<lower=0> confirmatory_scale;               // prior SD of the confirmatory factors (0.5)
  array[P] int<lower=0, upper=1> pooled;          // 0: confirmatory factor, 1: shares tau
}
parameters {
  ordered[2] cutpoints;
  sum_to_zero_vector[3] time_of_day;
  sum_to_zero_vector[7] weekday_effect;
  real<lower=-1, upper=1> phi;
  real<lower=0> sigma_day;
  vector[D] z_day;
  real<lower=0> tau;
  vector[P] beta_z;
  vector[M] x_missing;
}
transformed parameters {
  // Factors of the confirmatory hypotheses have their own normal(0, confirmatory_scale) prior;
  // the others share the scale tau, a hierarchical shrinkage prior. Pooling the
  // confirmatory factors with many null ones would shrink them by about half.
  vector[P] beta;
  for (j in 1:P) {
    beta[j] = (pooled[j] ? tau : confirmatory_scale) * beta_z[j];
  }
  // Non-centered AR(1), started from its stationary distribution.
  vector[D] mood_day;
  mood_day[1] = sigma_day * z_day[1] / sqrt(1 - square(phi));
  for (d in 2:D) {
    mood_day[d] = phi * mood_day[d - 1] + sigma_day * z_day[d];
  }
}
model {
  vector[N] eta = time_of_day[slot] + weekday_effect[weekday] + mood_day[day];
  if (P > 0) {
    matrix[R, P] X_full = X;
    for (m in 1:M) {
      X_full[miss_row[m], miss_col[m]] = x_missing[m];
    }
    eta += (X_full * beta)[rated_day];
  }
  cutpoints ~ normal([-1, 1]', 1.5);
  // On a sum-to-zero vector this matches PyMC's ZeroSumNormal(0.5).
  time_of_day ~ normal(0, 0.5);
  weekday_effect ~ normal(0, 0.5);
  target += beta_lpdf((phi + 1) / 2 | 2, 2);
  sigma_day ~ normal(0, 1);
  z_day ~ std_normal();
  tau ~ normal(0, prior_scale);
  beta_z ~ std_normal();
  x_missing ~ std_normal();
  y ~ ordered_logistic(eta, cutpoints);
}
