# Design analysis for the protocol (Section 2.6): how often the decision rule
# supports each confirmatory hypothesis, by study length, when the hypotheses are
# true (scenario "effects") and when all of them are false ("null"). Simulated
# data only; nothing here touches the real database.
#
#   Rscript analysis/design.R --scenario effects|null --days 180 [--reps 50] [--iter 1000] [--out FILE]
#   Rscript analysis/design.R --summarize FILE [FILE ...]
#   Rscript analysis/design.R --scenario null --days 365 --check REP [--iter 2000] [--adapt-delta 0.95]
#
# Each simulated study has every factor of the real one, with correlations,
# day-to-day autocorrelation, seasonal weather, missing overnight blocks (ring not
# worn) and skipped evening logs, so that the shrinkage prior works among as many
# factors, and as much missingness, as the real study will have. True effects are
# set per natural unit and converted to the fitted scale (per standard deviation
# of the observed, lagged values) for every replicate. Results are appended one
# replicate at a time, so an interrupted run resumes where it stopped.

here <- dirname(normalizePath(sub("^--file=", "", grep("^--file=", commandArgs(FALSE), value = TRUE))))
source(file.path(here, "mood.R"))
source(file.path(here, "simulate.R"))

# Confirmatory factors, the direction each hypothesis predicts, and the effect per
# natural unit in the "effects" scenario (about 0.2 to 0.4 on the log-odds scale
# per standard deviation). Every other factor has no effect in both scenarios.
CONFIRMATORY <- data.frame(
  hypothesis = c("H1", "H2", "H3a", "H3b", "H4"),
  field = c("sleep_hours", "steps", "screen_time_min", "social_media_min", "social_min"),
  sign = c(1, 1, -1, -1, 1),
  per_unit = c(0.4, 0.3 / 2500, -0.2 / 60, -0.2 / 30, 0.3 / 60)
)
PHI <- c(effects = 0.5, null = 0)

ar1 <- function(n, rho, sd) {
  e <- stats::rnorm(n)
  x <- numeric(n)
  x[1] <- e[1]
  for (t in 2:n) x[t] <- rho * x[t - 1] + sqrt(1 - rho^2) * e[t]
  x * sd
}

simulate_design <- function(con, days, seed, scenario) {
  set.seed(seed)
  start <- as.Date("2026-10-01")
  dates <- start + 0:(days - 1)
  weekday <- as.integer(format(dates, "%u"))
  weekend <- weekday >= 6
  season <- cos(2 * pi * (as.numeric(dates - as.Date("2026-07-01"))) / 365)

  sleep <- 7 + 0.4 * weekend + ar1(days, 0.3, 0.9)
  steps <- pmax(8000 + ar1(days, 0.3, 2400), 300)
  screen <- pmax(300 + 40 * weekend + ar1(days, 0.4, 70), 30)
  social_media <- pmin(pmax(60 + 0.25 * (screen - 300) + ar1(days, 0.4, 25), 0), screen)
  social <- pmax(80 + 60 * weekend - 0.1 * (screen - 300) + ar1(days, 0.2, 55), 0)
  x <- data.frame(
    sleep_hours = round(sleep, 2),
    sleep_efficiency = round(pmin(pmax(88 + 2 * (sleep - 7) + ar1(days, 0.3, 4), 50), 100), 1),
    hrv_ms = round(pmax(45 + ar1(days, 0.5, 11), 5), 1),
    resting_hr = round(58 + ar1(days, 0.5, 4), 1),
    skin_temp_dev_c = round(ar1(days, 0.4, 0.3), 2),
    steps = as.integer(steps),
    exercise_min = as.integer(pmax(30 + 0.008 * (steps - 8000) + ar1(days, 0.2, 18), 0)),
    outdoor_min = as.integer(pmax(60 + 0.01 * (steps - 8000) - 25 * season + ar1(days, 0.3, 30), 0)),
    social_min = as.integer(social),
    screen_time_min = as.integer(screen),
    social_media_min = as.integer(social_media),
    caffeine_mg = as.integer(pmax(150 + ar1(days, 0.3, 60), 0)),
    alcohol_units = stats::rpois(days, 0.3 + 0.8 * weekend),
    work_day = as.integer(!weekend & stats::runif(days) > 0.08),
    travel = as.integer(stats::filter(stats::runif(days) < 0.03, rep(1, 3), sides = 1, circular = TRUE) > 0),
    sick = as.integer(stats::runif(days) < 0.03),
    temp_mean_c = round(8 - 12 * season + ar1(days, 0.7, 4), 1),
    precipitation_mm = round(stats::rexp(days, 0.4) * (stats::runif(days) < 0.35), 1),
    sunshine_hours = round(pmin(pmax(5 - 2 * season + ar1(days, 0.3, 2.5), 0), 15), 1),
    daylight_hours = round(12.2 - 3.2 * season, 2),
    pm25 = round(pmax(7 + ar1(days, 0.6, 4), 0.5), 1),
    indoor_pm25 = round(pmax(6 + ar1(days, 0.5, 3), 0.5), 1),
    indoor_voc = round(pmax(100 + ar1(days, 0.5, 30), 1), 0)
  )

  # Linear predictor from the confirmatory factors, as the model sees them:
  # sleep the same day, behavior the day before, screen time other than social media.
  lag <- function(v) c(NA, head(v, -1))
  centered <- function(v) v - mean(v, na.rm = TRUE)
  used <- list(
    sleep_hours = x$sleep_hours, steps = lag(x$steps), screen_time_min = lag(x$screen_time_min - x$social_media_min),
    social_media_min = lag(x$social_media_min), social_min = lag(x$social_min)
  )
  xb <- numeric(days)
  if (scenario == "effects") {
    for (i in seq_len(nrow(CONFIRMATORY))) {
      v <- centered(used[[CONFIRMATORY$field[i]]])
      xb <- xb + CONFIRMATORY$per_unit[i] * ifelse(is.na(v), 0, v)
    }
  }

  # Missing values: nights without the ring, days without the evening log.
  no_ring <- stats::runif(days) < 0.10
  x[no_ring, c("sleep_hours", "sleep_efficiency", "hrv_ms", "resting_hr", "skin_temp_dev_c")] <- NA
  no_log <- stats::runif(days) < 0.30
  x[no_log, c("social_min", "screen_time_min", "social_media_min", "caffeine_mg", "alcohol_units", "work_day", "travel", "sick")] <- NA
  x[stats::runif(days) < 0.05, c("steps", "exercise_min", "outdoor_min")] <- NA
  x[stats::runif(days) < 0.25, c("indoor_pm25", "indoor_voc")] <- NA
  DBI::dbAppendTable(con, "daily_logs", cbind(data.frame(user_id = 1L, date = format(dates)), x))

  phi <- PHI[[scenario]]
  sigma <- 0.7
  u <- numeric(days)
  u[1] <- stats::rnorm(1, 0, sigma / sqrt(1 - phi^2))
  for (t in 2:days) u[t] <- phi * u[t - 1] + stats::rnorm(1, 0, sigma)
  tod <- c(-0.3, 0.1, 0.2)
  wd <- c(-0.15, -0.1, -0.05, 0, 0.05, 0.15, 0.1)
  cutpoints <- c(-1.2, 1.2)
  rows <- list()
  for (d in seq_len(days)) {
    for (k in 1:3) {
      if (stats::runif(1) < 0.8) {
        p <- stats::plogis(cutpoints - (xb[d] + u[d] + tod[k] + wd[weekday[d]]))
        rows[[length(rows) + 1]] <- data.frame(
          user_id = 1L, rating = sample(1:3, 1, prob = c(p[1], p[2] - p[1], 1 - p[2])),
          recorded_at = sprintf("%sT%02d:00:00Z", format(dates[d]), c(13, 18, 23)[k]), time_zone = "America/Toronto",
          study_date = format(dates[d]), slot = SLOTS[k], client_id = sprintf("sim-%d-%d", d, k)
        )
      }
    }
  }
  DBI::dbAppendTable(con, "ratings", do.call(rbind, rows))
}

# One simulated study and its fit; the seeds make every replicate reproducible.
fit_replicate <- function(scenario, days, r, iter, adapt_delta = 0.95) {
  con <- new_study_db(file.path(here, "..", "server", "schema.sql"))
  on.exit(DBI::dbDisconnect(con))
  simulate_design(con, days, seed = 100000L * (scenario == "null") + 1000L * days + r, scenario = scenario)
  ds <- load_dataset(con, 1L)
  fit <- fit_model(ds, file.path(here, "mood.stan"), file.path(tempdir(), "stan"), seed = r, iter = iter, adapt_delta = adapt_delta)
  list(ds = ds, fit = fit)
}

# The convergence checks of protocol Section 2.9.8.
check_fit <- function(fit) {
  diag <- posterior::summarise_draws(fit$draws(c("cutpoints", "time_of_day", "weekday_effect", "phi", "sigma_day", "tau", "beta")), "rhat", "ess_bulk")
  g <- list(
    max_rhat = max(diag$rhat, na.rm = TRUE), min_ess_bulk = min(diag$ess_bulk, na.rm = TRUE),
    slowest = diag$variable[which.min(diag$ess_bulk)], divergences = sum(fit$diagnostic_summary(quiet = TRUE)$num_divergent)
  )
  g$converged <- g$max_rhat < 1.01 && g$min_ess_bulk > 400 && g$divergences == 0
  g
}

replicate_rows <- function(scenario, days, r, iter) {
  f <- fit_replicate(scenario, days, r, iter)
  ds <- f$ds
  dr <- posterior::as_draws_matrix(f$fit$draws(c("beta", "phi")))
  common <- data.frame(
    scenario = scenario, days = days, rep = r, iter = iter, n_reports = length(ds$y), n_factors = ncol(ds$X),
    converged = check_fit(f$fit)$converged
  )
  row <- function(hypothesis, sign, truth, draws) {
    cbind(common, data.frame(
      hypothesis = hypothesis, sign = sign, truth = round(truth, 4), est = round(stats::median(draws), 4),
      lo = round(unname(stats::quantile(draws, 0.025)), 4), hi = round(unname(stats::quantile(draws, 0.975)), 4),
      p_positive = mean(draws > 0)
    ))
  }
  out <- lapply(seq_len(nrow(CONFIRMATORY)), function(i) {
    h <- CONFIRMATORY[i, ]
    j <- match(h$field, ds$predictors$field)
    # Truth on the fitted scale: the per-unit effect times the fitted standard deviation.
    truth <- if (scenario == "effects") h$per_unit * ds$sds[j] else 0
    row(h$hypothesis, h$sign, truth, as.numeric(dr[, sprintf("beta[%d]", j)]))
  })
  nulls <- setdiff(seq_len(ncol(ds$X)), match(CONFIRMATORY$field, ds$predictors$field))
  out <- c(out, lapply(nulls, function(j) row(paste0("null:", ds$predictors$field[j]), 1, 0, as.numeric(dr[, sprintf("beta[%d]", j)]))))
  out[[length(out) + 1]] <- row("H5", 1, PHI[[scenario]], as.numeric(dr[, "phi"]))
  do.call(rbind, out)
}

summarize_design <- function(files) {
  res <- do.call(rbind, lapply(files, utils::read.csv))
  res$p_dir <- ifelse(res$sign > 0, res$p_positive, 1 - res$p_positive)
  res$supported <- res$p_dir >= 0.975
  res$contradicted <- res$p_dir <= 0.025
  res$covered <- res$lo <= res$truth & res$truth <= res$hi
  res$width <- res$hi - res$lo
  mc <- function(p, n) sqrt(p * (1 - p) / n)
  confirm <- res[!startsWith(res$hypothesis, "null:"), ]
  by_h <- stats::aggregate(
    cbind(supported, contradicted, covered, width) ~ scenario + days + hypothesis, data = confirm, FUN = mean
  )
  by_h$replicates <- stats::aggregate(rep ~ scenario + days + hypothesis, data = confirm, FUN = length)$rep
  by_h$supported_se <- mc(by_h$supported, by_h$replicates)
  # Any confirmatory hypothesis supported in a replicate (the family-wise rate under the null).
  any_h <- stats::aggregate(supported ~ scenario + days + rep, data = confirm, FUN = any)
  family <- stats::aggregate(supported ~ scenario + days, data = any_h, FUN = mean)
  family$replicates <- stats::aggregate(rep ~ scenario + days, data = any_h, FUN = length)$rep
  family$se <- mc(family$supported, family$replicates)
  nulls <- res[startsWith(res$hypothesis, "null:"), ]
  null_rate <- stats::aggregate(cbind(false_direction = p_dir >= 0.975 | p_dir <= 0.025) ~ scenario + days, data = nulls, FUN = mean)
  runs <- unique(res[, c("scenario", "days", "rep", "converged")])
  list(by_hypothesis = by_h, any_supported = family, exploratory_null_factors = null_rate,
       not_converged = stats::aggregate(!converged ~ scenario + days, data = runs, FUN = sum))
}

args <- commandArgs(trailingOnly = TRUE)
opt <- function(name, default = NULL) {
  i <- match(paste0("--", name), args)
  if (is.na(i)) default else args[i + 1]
}
if (!is.null(opt("summarize"))) {
  files <- args[(match("--summarize", args) + 1):length(args)]
  s <- summarize_design(files)
  for (name in names(s)) {
    cat("\n", name, "\n", sep = "")
    print(format(s[[name]], digits = 3), row.names = FALSE)
  }
} else if (!is.null(opt("check"))) {
  # Refit one replicate, for example at the production length, and print its checks.
  scenario <- opt("scenario", "effects")
  days <- as.integer(opt("days", "365"))
  r <- as.integer(opt("check"))
  iter <- as.integer(opt("iter", "2000"))
  adapt_delta <- as.numeric(opt("adapt-delta", "0.95"))
  g <- check_fit(fit_replicate(scenario, days, r, iter, adapt_delta)$fit)
  cat(sprintf(
    "%s, %d days, replicate %d, %d warmup and %d draws per chain, adapt_delta %.2f: largest R-hat %.4f, smallest bulk ESS %.0f (%s), %d divergent transitions: %s\n",
    scenario, days, r, iter, iter, adapt_delta, g$max_rhat, g$min_ess_bulk, g$slowest, g$divergences, if (g$converged) "passes" else "fails"
  ))
} else {
  scenario <- opt("scenario", "effects")
  days <- as.integer(opt("days", "365"))
  reps <- as.integer(opt("reps", "50"))
  # Half the production length (1,000 warmup and 1,000 draws per chain) keeps 200 fits feasible.
  iter <- as.integer(opt("iter", "1000"))
  out <- opt("out", file.path(here, sprintf("design-%s-%d.csv", scenario, days)))
  done <- if (file.exists(out)) utils::read.csv(out) else NULL
  for (r in seq_len(reps)) {
    if (!is.null(done) && any(done$rep == r)) next
    started <- Sys.time()
    rows <- replicate_rows(scenario, days, r, iter)
    utils::write.table(rows, out, sep = ",", row.names = FALSE, append = file.exists(out), col.names = !file.exists(out))
    cat(sprintf("%s, %d days, replicate %d: %.0f s\n", scenario, days, r, as.numeric(Sys.time() - started, units = "secs")))
  }
}
