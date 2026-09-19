// Secondary outcome: the evening rating of the day, 0 to 10 (coded 1 to 11).
//
//   P(y_d <= k) = logistic(c_k - eta_d),  k = 1, ..., 10
//   eta_d = weekday[w] + x_d' beta + u_d
//   u_d = phi * u_(d-1) + sigma * e_d          latent day effect, stationary AR(1)
//
// The same factors, timing rules, weekday effects and priors as mood.stan
// (confirmatory factors unpooled, the others under shared shrinkage), with ten
// ordered cutpoints. With one rating per day, the day effect is identified
// only through its autocorrelation.
data {
  int<lower=1> N;                                 // days with a rating
  int<lower=1> D;                                 // calendar days from first to last rating
  int<lower=0> P;                                 // factors
  array[N] int<lower=1, upper=11> y;
  array[N] int<lower=1, upper=7> weekday;         // 1 = Monday
  array[N] int<lower=1, upper=D> day;
  matrix[N, P] X;                                 // missing cells hold 0
  int<lower=0> M;
  array[M] int<lower=1, upper=N> miss_row;
  array[M] int<lower=1, upper=P> miss_col;
  real<lower=0> prior_scale;                      // scale of the half-normal prior on tau
  real<lower=0> confirmatory_scale;               // prior SD of the confirmatory factors (0.5)
  array[P] int<lower=0, upper=1> pooled;          // 0: confirmatory factor, 1: shares tau
}
parameters {
  ordered[10] cutpoints;
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
  vector[D] mood_day;
  mood_day[1] = sigma_day * z_day[1] / sqrt(1 - square(phi));
  for (d in 2:D) {
    mood_day[d] = phi * mood_day[d - 1] + sigma_day * z_day[d];
  }
}
model {
  vector[N] eta = weekday_effect[weekday] + mood_day[day];
  if (P > 0) {
    matrix[N, P] X_full = X;
    for (m in 1:M) {
      X_full[miss_row[m], miss_col[m]] = x_missing[m];
    }
    eta += X_full * beta;
  }
  cutpoints ~ normal(0, 3);
  weekday_effect ~ normal(0, 0.5);
  target += beta_lpdf((phi + 1) / 2 | 2, 2);
  sigma_day ~ normal(0, 1);
  z_day ~ std_normal();
  tau ~ normal(0, prior_scale);
  beta_z ~ std_normal();
  x_missing ~ std_normal();
  y ~ ordered_logistic(eta, cutpoints);
}
