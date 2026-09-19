# Prior predictive check (protocol Section 2.9.2): what the priors of mood.stan
# imply about the data before any data are seen. Simulated studies of 180 days,
# three slots, 80% of prompts answered and 23 standardized factors, as many as
# the real study has: 5 confirmatory factors with normal(0, 0.5) priors and 18
# others under the shared shrinkage prior.
#
#   Rscript analysis/prior_check.R [--draws 4000] [--seed 1]

args <- commandArgs(trailingOnly = TRUE)
opt <- function(name, default) {
  i <- match(paste0("--", name), args)
  if (is.na(i)) default else args[i + 1]
}
S <- as.integer(opt("draws", "4000"))
set.seed(as.integer(opt("seed", "1")))
days <- 180
P <- 23
P_CONFIRMATORY <- 5

shares <- matrix(NA_real_, S, 3)
max_share <- numeric(S)
abs_confirmatory <- numeric(0)
abs_other <- numeric(0)
day_sd <- numeric(S)
for (s in seq_len(S)) {
  # Ordered cutpoints: normal(-1, 1.5) and normal(1, 1.5), kept when in order.
  repeat {
    cut <- stats::rnorm(2, c(-1, 1), 1.5)
    if (cut[1] < cut[2]) break
  }
  # Sum-to-zero vectors with normal(0, 0.5) on their elements.
  tod <- stats::rnorm(3, 0, 0.5)
  tod <- tod - mean(tod)
  wd <- stats::rnorm(7, 0, 0.5)
  wd <- wd - mean(wd)
  phi <- 2 * stats::rbeta(1, 2, 2) - 1
  sigma <- abs(stats::rnorm(1, 0, 1))
  tau <- abs(stats::rnorm(1, 0, 0.5))
  beta <- c(stats::rnorm(P_CONFIRMATORY, 0, 0.5), tau * stats::rnorm(P - P_CONFIRMATORY))
  abs_confirmatory <- c(abs_confirmatory, abs(beta[seq_len(P_CONFIRMATORY)]))
  abs_other <- c(abs_other, abs(beta[-seq_len(P_CONFIRMATORY)]))
  u <- numeric(days)
  u[1] <- stats::rnorm(1, 0, sigma / sqrt(1 - phi^2))
  for (t in 2:days) u[t] <- phi * u[t - 1] + stats::rnorm(1, 0, sigma)
  xb <- as.numeric(matrix(stats::rnorm(days * P), days, P) %*% beta)
  day <- rep(seq_len(days), each = 3)
  slot <- rep(1:3, days)
  keep <- stats::runif(length(day)) < 0.8
  eta <- (xb[day] + u[day] + tod[slot] + wd[(day - 1) %% 7 + 1])[keep]
  p1 <- stats::plogis(cut[1] - eta)
  p2 <- stats::plogis(cut[2] - eta)
  v <- stats::runif(length(eta))
  y <- 1L + (v > p1) + (v > p2)
  shares[s, ] <- tabulate(y, 3) / length(y)
  max_share[s] <- max(shares[s, ])
  day_sd[s] <- stats::sd(xb + u)
}

q <- function(x, p = c(0.05, 0.5, 0.95)) round(stats::quantile(x, p, names = FALSE), 3)
cat(sprintf("Prior predictive check: %d simulated studies of %d days, %d factors\n", S, days, P))
for (k in 1:3) cat(sprintf("share of %-5s  median %.3f, 90%% interval %.3f to %.3f\n", c("Sad", "Meh", "Happy")[k], q(shares[, k])[2], q(shares[, k])[1], q(shares[, k])[3]))
cat(sprintf("studies with over 90%% of reports in one category: %.1f%%\n", 100 * mean(max_share > 0.9)))
cat(sprintf("studies with over 50%% Sad reports: %.1f%%\n", 100 * mean(shares[, 1] > 0.5)))
for (group in c("confirmatory", "other")) {
  b <- if (group == "confirmatory") abs_confirmatory else abs_other
  cat(sprintf("|beta| per SD, %s factors: median %.3f, 95th percentile %.3f, 99th percentile %.3f\n",
    group, stats::median(b), stats::quantile(b, 0.95), stats::quantile(b, 0.99)))
}
cat(sprintf("SD of the daily linear predictor (factors and day effect): median %.2f, 90%% interval %.2f to %.2f\n",
  q(day_sd)[2], q(day_sd)[1], q(day_sd)[3]))
