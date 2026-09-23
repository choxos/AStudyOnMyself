#!/usr/bin/env Rscript
# Secondary outcome (protocol Section 2.9.6): the evening rating of the day, run
# at the 6- and 12-month analyses rather than continuously.
#
#   Rscript analysis/secondary.R --db PATH --user ID --out FILE [--stan-dir DIR] [--seed N]
#
# Reads the database only and writes a JSON summary: odds ratios per natural
# unit, the posterior probability of each direction, weekday effects, the
# day-to-day carry-over, and convergence diagnostics.

MODEL_VERSION_DAY <- "day-ordinal-ar1-stan-v2"

# One row per day with an evening rating (from the study start), with the same
# factors and timing rules as the model of momentary mood.
load_day_dataset <- function(con, user_id, start = study_start(con, user_id)) {
  days <- DBI::dbGetQuery(
    con,
    "SELECT date, day_satisfaction FROM daily_logs WHERE user_id = ? AND date >= ? AND day_satisfaction IS NOT NULL ORDER BY date",
    params = list(user_id, start)
  )
  if (nrow(days) < MIN_RATED_DAYS) {
    not_enough_data(sprintf("The day satisfaction model needs %d rated days (so far: %d).", MIN_RATED_DAYS, nrow(days)))
  }
  dates <- as.Date(days$date)
  c(
    list(
      y = as.integer(days$day_satisfaction) + 1L,
      weekday = iso_weekday(dates),
      day = as.integer(dates - min(dates)) + 1L,
      dates = seq(min(dates), max(dates), by = "day"),
      rated_dates = dates,
      study_start = start
    ),
    build_factors(con, user_id, dates)
  )
}

fit_day_model <- function(ds, stan_file, stan_dir, seed = 1, chains = 4, iter = 2000, prior_scale = 0.5, confirmatory_scale = 0.5) {
  dir.create(stan_dir, showWarnings = FALSE, recursive = TRUE)
  model <- cmdstanr::cmdstan_model(stan_file, dir = stan_dir, quiet = TRUE)
  missing <- which(is.na(ds$X), arr.ind = TRUE)
  X0 <- ds$X
  X0[is.na(X0)] <- 0
  model$sample(
    data = list(
      N = length(ds$y), D = length(ds$dates), P = ncol(ds$X), y = ds$y, weekday = ds$weekday, day = ds$day,
      X = X0, M = nrow(missing), miss_row = as.array(as.integer(missing[, 1])),
      miss_col = as.array(as.integer(missing[, 2])), prior_scale = prior_scale, confirmatory_scale = confirmatory_scale,
      pooled = as.array(as.integer(!(ds$predictors$field %in% CONFIRMATORY_FIELDS)))
    ),
    seed = seed, chains = chains, parallel_chains = chains, iter_warmup = iter, iter_sampling = iter,
    adapt_delta = 0.95, refresh = 0, show_messages = FALSE, show_exceptions = FALSE
  )
}

summarize_day_fit <- function(ds, fit) {
  vars <- c("cutpoints", "weekday_effect", "phi", "sigma_day", "tau")
  if (ncol(ds$X)) vars <- c(vars, "beta")
  dr <- posterior::as_draws_matrix(fit$draws(vars))
  diag <- posterior::summarise_draws(fit$draws(vars), "rhat", "ess_bulk", "ess_tail")
  factors <- lapply(seq_len(ncol(ds$X)), function(j) {
    p <- ds$predictors[j, ]
    shift <- as.numeric(dr[, sprintf("beta[%d]", j)]) * p$unit / ds$sds[j]
    p_positive <- mean(shift > 0)
    list(
      field = p$field, label = p$label, unit_label = p$unit_label, lag = p$lag,
      odds_ratio = interval(exp(shift)), p_positive = round(p_positive, 4), evidence = evidence(p_positive)
    )
  })
  list(
    model = list(version = MODEL_VERSION_DAY, draws = nrow(dr), chains = fit$num_chains()),
    data = list(n_days = length(ds$y), study_start = ds$study_start, first_date = format(min(ds$dates)), last_date = format(max(ds$dates))),
    factors = factors,
    dropped = ds$dropped,
    weekday = lapply(1:7, function(k) list(level = WEEKDAYS[k], effect = interval(as.numeric(dr[, sprintf("weekday_effect[%d]", k)])))),
    dynamics = list(
      phi = c(interval(as.numeric(dr[, "phi"])), p_positive = round(mean(dr[, "phi"] > 0), 4)),
      sigma_day = interval(as.numeric(dr[, "sigma_day"]))
    ),
    diagnostics = within(list(
      max_rhat = max(diag$rhat, na.rm = TRUE), min_ess_bulk = min(diag$ess_bulk, na.rm = TRUE),
      min_ess_tail = min(diag$ess_tail, na.rm = TRUE), divergences = sum(fit$diagnostic_summary(quiet = TRUE)$num_divergent)
    ), converged <- max_rhat < 1.01 && min_ess_bulk > 400 && divergences == 0) # the checks of protocol Section 2.9.8
  )
}

if (sys.nframe() == 0) {
  args <- commandArgs(trailingOnly = TRUE)
  opt <- function(name, default = NULL) {
    i <- match(paste0("--", name), args)
    if (is.na(i)) {
      if (is.null(default)) stop("missing --", name, call. = FALSE)
      return(default)
    }
    args[i + 1]
  }
  here <- dirname(normalizePath(sub("^--file=", "", grep("^--file=", commandArgs(FALSE), value = TRUE))))
  suppressPackageStartupMessages({
    library(DBI)
    library(RSQLite)
  })
  source(file.path(here, "mood.R"))
  con <- dbConnect(SQLite(), opt("db"), flags = SQLITE_RO)
  on.exit(dbDisconnect(con))
  ds <- load_day_dataset(con, as.integer(opt("user")))
  fit <- fit_day_model(ds, file.path(here, "day_satisfaction.stan"), opt("stan-dir", file.path(tempdir(), "stan")), seed = as.integer(opt("seed", "1")))
  jsonlite::write_json(summarize_day_fit(ds, fit), opt("out"), auto_unbox = TRUE, digits = NA, na = "null")
}
