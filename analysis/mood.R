# Bayesian ordinal model of momentary mood: data preparation, fitting, summaries.
# These functions only read the database; refit.R turns their output into JSON
# for the web app, which is the only writer.

MODEL_VERSION <- "ordinal-ar1-stan-v4"
SLOTS <- c("morning", "afternoon", "evening")
WEEKDAYS <- c("Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun")
MOODS <- c("Sad", "Meh", "Happy")
MIN_RATED_DAYS <- 14
MIN_RATINGS <- 30
MAX_MISSING <- 0.5 # drop a predictor missing on more than half of the rated days
MIN_OBSERVED <- 10

predictor <- function(field, label, unit, unit_label, lag = 0L) {
  data.frame(field = field, label = label, unit = unit, unit_label = unit_label, lag = lag)
}

# Only information available before the day's reports: last night's sleep and
# physiology, yesterday's behavior (lag 1), and same-day context mood cannot cause.
PREDICTORS <- rbind(
  predictor("sleep_hours", "Sleep last night", 1, "per extra hour"),
  predictor("sleep_efficiency", "Sleep efficiency", 10, "per 10 points"),
  predictor("hrv_ms", "Overnight HRV", 10, "per 10 ms"),
  predictor("resting_hr", "Resting heart rate", 5, "per 5 bpm"),
  predictor("skin_temp_dev_c", "Skin temperature deviation", 0.5, "per 0.5 °C"),
  predictor("steps", "Steps yesterday", 1000, "per 1,000 steps", 1L),
  predictor("exercise_min", "Exercise yesterday", 30, "per 30 min", 1L),
  predictor("outdoor_min", "Time outdoors yesterday", 30, "per 30 min", 1L),
  predictor("social_min", "Time with people yesterday", 60, "per hour", 1L),
  predictor("screen_time_min", "Screen time yesterday", 60, "per hour", 1L),
  predictor("social_media_min", "Social media yesterday", 30, "per 30 min", 1L),
  predictor("caffeine_mg", "Caffeine yesterday", 100, "per 100 mg", 1L),
  predictor("alcohol_units", "Alcohol yesterday", 1, "per drink", 1L),
  predictor("work_day", "Work day", 1, "work day vs. day off"),
  predictor("travel", "Traveling", 1, "away vs. home"),
  predictor("sick", "Sick", 1, "sick vs. well"),
  predictor("temp_mean_c", "Temperature", 5, "per 5 °C"),
  predictor("precipitation_mm", "Precipitation", 5, "per 5 mm"),
  predictor("sunshine_hours", "Sunshine", 1, "per hour"),
  predictor("daylight_hours", "Day length", 1, "per hour"),
  predictor("pm25", "Outdoor PM2.5", 10, "per 10 µg/m³"),
  # Indoor air partly follows what is done at home, so it is lagged like behavior.
  predictor("indoor_pm25", "Indoor PM2.5 yesterday", 10, "per 10 µg/m³", 1L),
  predictor("indoor_voc", "Indoor VOC yesterday", 100, "per 100 index points", 1L)
)

# Factors of the confirmatory hypotheses H1 to H4 (screen time is H3a whether it
# enters as a total or as screen time other than social media). They get their
# own prior instead of the shrinkage prior shared by the other factors.
CONFIRMATORY_FIELDS <- c("sleep_hours", "steps", "screen_time_min", "social_media_min", "social_min")

# Yes/no factors: effects compare yes with no rather than adding one unit.
BINARY <- c("work_day", "travel", "sick")

not_enough_data <- function(message) {
  stop(structure(class = c("not_enough_data", "error", "condition"), list(message = message, call = NULL)))
}

pop_sd <- function(x) {
  x <- x[!is.na(x)]
  sqrt(mean((x - mean(x))^2))
}

iso_weekday <- function(dates) as.integer(format(dates, "%u")) # 1 = Monday

# Reports before the study start (users.study_start, the day after the protocol
# was finalized) are pilot data and never enter a model; until the start is set,
# no model is fitted at all.
study_start <- function(con, user_id) {
  start <- DBI::dbGetQuery(con, "SELECT study_start FROM users WHERE id = ?", params = list(user_id))$study_start
  if (!length(start) || is.na(start) || !nzchar(start)) {
    not_enough_data("No model is fitted until the study start is set in Settings; reports before it are pilot data.")
  }
  start
}

# The factors for a set of outcome days, following the timing rules: one row per
# outcome day, standardized over those days. Factors recorded too rarely, or that
# never vary, are left out with the reason.
build_factors <- function(con, user_id, outcome_dates) {
  first <- min(outcome_dates)
  last <- max(outcome_dates)
  logs <- DBI::dbGetQuery(
    con,
    sprintf(
      "SELECT date, %s FROM daily_logs WHERE user_id = ? AND date BETWEEN ? AND ?",
      paste(PREDICTORS$field, collapse = ", ")
    ),
    params = list(user_id, format(first - 1), format(last))
  )
  # One row per calendar day from the day before the first outcome, so shifting
  # by one row is exactly a one-day lag.
  frame_dates <- seq(first - 1, last, by = "day")
  frame <- matrix(NA_real_, length(frame_dates), nrow(PREDICTORS), dimnames = list(NULL, PREDICTORS$field))
  rows <- match(as.Date(logs$date), frame_dates)
  for (f in PREDICTORS$field) frame[rows, f] <- as.numeric(logs[[f]])
  rated_rows <- match(outcome_dates, frame_dates)
  shift <- function(values, lag) if (lag == 1) c(NA, head(values, -1)) else values
  usable <- function(on_rated) {
    observed <- !is.na(on_rated)
    if (mean(observed) < 1 - MAX_MISSING || sum(observed) < MIN_OBSERVED) {
      sprintf("recorded on %.0f%% of rated days", 100 * mean(observed))
    } else if (pop_sd(on_rated) == 0) "never varies" else ""
  }

  # Social media time is part of screen time. When both are modeled, screen time
  # becomes screen time other than social media, so that each coefficient answers
  # its own hypothesis (H3a and H3b) instead of a substitution of one for the other.
  predictors <- PREDICTORS
  if (usable(shift(frame[, "social_media_min"], 1)[rated_rows]) == "") {
    frame[, "screen_time_min"] <- pmax(frame[, "screen_time_min"] - frame[, "social_media_min"], 0)
    predictors$label[predictors$field == "screen_time_min"] <- "Other screen time yesterday"
  }

  kept <- integer(0)
  columns <- list()
  next_values <- numeric(0)
  dropped <- list()
  for (j in seq_len(nrow(predictors))) {
    p <- predictors[j, ]
    values <- frame[, p$field]
    on_rated <- shift(values, p$lag)[rated_rows]
    reason <- usable(on_rated)
    if (nzchar(reason)) {
      dropped[[length(dropped) + 1]] <- list(field = p$field, label = p$label, reason = reason)
    } else {
      kept <- c(kept, j)
      columns[[length(columns) + 1]] <- on_rated
      # Tomorrow's lag-1 value is known today; same-day values are not.
      next_values <- c(next_values, if (p$lag == 1) values[length(values)] else NA_real_)
    }
  }

  raw <- if (length(columns)) do.call(cbind, columns) else matrix(numeric(0), length(outcome_dates), 0)
  means <- if (length(columns)) colMeans(raw, na.rm = TRUE) else numeric(0)
  sds <- if (length(columns)) apply(raw, 2, pop_sd) else numeric(0)
  list(
    X = sweep(sweep(raw, 2, means), 2, sds, "/"),
    predictors = predictors[kept, , drop = FALSE],
    means = unname(means),
    sds = unname(sds),
    next_x = (next_values - means) / sds,
    dropped = dropped
  )
}

load_dataset <- function(con, user_id, start = study_start(con, user_id)) {
  ratings <- DBI::dbGetQuery(
    con, "SELECT rating, slot, study_date FROM ratings WHERE user_id = ? AND study_date >= ? ORDER BY recorded_at",
    params = list(user_id, start)
  )
  if (nrow(ratings) == 0) not_enough_data("No ratings yet.")
  ratings$study_date <- as.Date(ratings$study_date)
  rated_dates <- sort(unique(ratings$study_date))
  if (length(rated_dates) < MIN_RATED_DAYS || nrow(ratings) < MIN_RATINGS) {
    not_enough_data(sprintf(
      "The model starts after %d ratings on %d different days (so far: %d ratings on %d days).",
      MIN_RATINGS, MIN_RATED_DAYS, nrow(ratings), length(rated_dates)
    ))
  }
  first <- min(rated_dates)
  f <- build_factors(con, user_id, rated_dates)
  c(
    list(
      y = as.integer(ratings$rating),
      slot = match(ratings$slot, SLOTS),
      weekday = iso_weekday(ratings$study_date),
      day = as.integer(ratings$study_date - first) + 1L,
      rated_day = match(ratings$study_date, rated_dates),
      dates = seq(first, max(rated_dates), by = "day"),
      rated_dates = rated_dates,
      study_start = start
    ),
    f
  )
}

stan_data <- function(ds, prior_scale = 0.5, confirmatory_scale = 0.5) {
  missing <- which(is.na(ds$X), arr.ind = TRUE)
  X0 <- ds$X
  X0[is.na(X0)] <- 0
  list(
    N = length(ds$y), D = length(ds$dates), R = length(ds$rated_dates), P = ncol(ds$X),
    y = ds$y, slot = ds$slot, weekday = ds$weekday, day = ds$day, rated_day = ds$rated_day,
    X = X0, M = nrow(missing), miss_row = as.array(as.integer(missing[, 1])),
    miss_col = as.array(as.integer(missing[, 2])), prior_scale = prior_scale, confirmatory_scale = confirmatory_scale,
    pooled = as.array(as.integer(!(ds$predictors$field %in% CONFIRMATORY_FIELDS)))
  )
}

fit_model <- function(ds, stan_file, stan_dir, seed = 1, chains = 4, iter = 2000, prior_scale = 0.5, adapt_delta = 0.95,
                      confirmatory_scale = 0.5) {
  dir.create(stan_dir, showWarnings = FALSE, recursive = TRUE)
  # The compiled program lives in the data folder and is rebuilt only when mood.stan changes.
  model <- cmdstanr::cmdstan_model(stan_file, dir = stan_dir, quiet = TRUE)
  model$sample(
    data = stan_data(ds, prior_scale, confirmatory_scale), seed = seed, chains = chains, parallel_chains = chains,
    iter_warmup = iter, iter_sampling = iter, adapt_delta = adapt_delta, refresh = 0,
    show_messages = FALSE, show_exceptions = FALSE
  )
}

# Draws of a vector or matrix parameter as a draws x elements matrix.
block <- function(draws, name) {
  cols <- grep(paste0("^", name, "\\["), colnames(draws))
  unclass(draws[, cols, drop = FALSE])
}

interval <- function(x) {
  q <- stats::quantile(x, c(0.025, 0.5, 0.975), names = FALSE)
  list(est = round(q[2], 4), lo = round(q[1], 4), hi = round(q[3], 4))
}

evidence <- function(p_positive) {
  p <- max(p_positive, 1 - p_positive)
  if (p >= 0.975) "strong" else if (p >= 0.9) "moderate" else if (p >= 0.75) "weak" else "unclear"
}

# Standardized values of factor j on each rated day, per draw (imputed cells vary).
factor_draws <- function(ds, d, j) {
  z <- matrix(ds$X[, j], length(d$phi), nrow(ds$X), byrow = TRUE)
  cells <- which(d$missing[, 2] == j)
  for (m in cells) z[, d$missing[m, 1]] <- d$x_missing[, m]
  z
}

# The linear predictor of every report (draws x reports) with factor j changed:
# yes/no factors set to 1 and to 0, replacing each report's observed or imputed
# value; other factors one unit above their value and at it.
contrast <- function(ds, d, j, eta) {
  if (ds$predictors$field[j] %in% BINARY) {
    base <- eta - d$beta[, j] * factor_draws(ds, d, j)[, ds$rated_day, drop = FALSE]
    list(on = base + d$beta[, j] * (1 - ds$means[j]) / ds$sds[j], off = base + d$beta[, j] * (0 - ds$means[j]) / ds$sds[j])
  } else {
    list(on = eta + d$beta[, j] * ds$predictors$unit[j] / ds$sds[j], off = eta)
  }
}

# Posterior draws needed by every summary, with the linear predictor rebuilt per draw.
extract_draws <- function(ds, fit) {
  P <- ncol(ds$X)
  vars <- c("cutpoints", "time_of_day", "weekday_effect", "phi", "sigma_day", "mood_day")
  if (P) vars <- c(vars, "beta")
  missing <- which(is.na(ds$X), arr.ind = TRUE)
  if (nrow(missing)) vars <- c(vars, "x_missing")
  dr <- posterior::as_draws_matrix(fit$draws(vars))
  d <- list(
    cut = block(dr, "cutpoints"), tod = block(dr, "time_of_day"), wd = block(dr, "weekday_effect"),
    mood = block(dr, "mood_day"), phi = as.numeric(dr[, "phi"]), sigma = as.numeric(dr[, "sigma_day"]),
    chain = rep(seq_len(fit$num_chains()), each = nrow(dr) / fit$num_chains())
  )
  S <- nrow(dr)
  X0 <- ds$X
  X0[is.na(X0)] <- 0
  if (P) {
    d$beta <- block(dr, "beta")
    d$xb <- d$beta %*% t(X0)
    d$missing <- missing
    if (nrow(missing)) {
      x_missing <- block(dr, "x_missing")
      d$x_missing <- x_missing
      for (m in seq_len(nrow(missing))) {
        r <- missing[m, 1]
        d$xb[, r] <- d$xb[, r] + x_missing[, m] * d$beta[, missing[m, 2]]
      }
    }
  } else {
    d$beta <- matrix(0, S, 0)
    d$xb <- matrix(0, S, length(ds$rated_dates))
  }
  d$eta <- d$tod[, ds$slot] + d$wd[, ds$weekday] + d$mood[, ds$day] + d$xb[, ds$rated_day]
  d
}

# P(Sad), P(Meh), P(Happy) averaged over draws, for a vector of linear predictors (one per draw).
category_probs <- function(eta, cut) {
  below_meh <- stats::plogis(cut[, 1] - eta)
  below_happy <- stats::plogis(cut[, 2] - eta)
  round(c(mean(below_meh), mean(below_happy - below_meh), mean(1 - below_happy)), 3)
}

summarize_fit <- function(ds, fit, seconds = 0) {
  d <- extract_draws(ds, fit)
  c1 <- d$cut[, 1]
  c2 <- d$cut[, 2]
  eta <- d$eta
  p_happy <- stats::plogis(eta - c2) # vectors of length S recycle down the draws
  p_sad <- stats::plogis(c1 - eta)

  predictors <- lapply(seq_len(nrow(ds$predictors)), function(j) {
    p <- ds$predictors[j, ]
    shift <- d$beta[, j] * p$unit / ds$sds[j]
    k <- contrast(ds, d, j, eta)
    on <- k$on
    off <- k$off
    # Thresholds use the unrounded probability; only the reported value is rounded.
    p_positive <- mean(shift > 0)
    list(
      field = p$field, label = p$label, unit_label = p$unit_label, lag = p$lag,
      mean = ds$means[j], sd = ds$sds[j], missing_pct = 100 * mean(is.na(ds$X[, j])),
      odds_ratio = interval(exp(shift)),
      d_happy_pp = interval(100 * rowMeans(stats::plogis(on - c2) - stats::plogis(off - c2))),
      d_sad_pp = interval(100 * rowMeans(stats::plogis(c1 - on) - stats::plogis(c1 - off))),
      p_positive = round(p_positive, 4),
      direction = if (p_positive >= 0.5) "better" else "worse",
      evidence = evidence(p_positive)
    )
  })
  predictors <- predictors[order(-abs(vapply(predictors, function(p) p$d_happy_pp$est, numeric(1))))]

  # P(Happy) if every report had been made at this level, all else as observed.
  adjusted <- function(effect, index, levels) {
    base <- eta - effect[, index]
    lapply(seq_along(levels), function(k) {
      list(level = levels[k], p_happy = interval(rowMeans(stats::plogis(base + effect[, k] - c2))))
    })
  }

  # Smoothed mood per calendar day: P(Happy) at an average time of day.
  day_eta <- d$mood + d$wd[, iso_weekday(ds$dates)]
  rated_cols <- match(ds$rated_dates, ds$dates)
  day_eta[, rated_cols] <- day_eta[, rated_cols] + d$xb
  daily <- stats::plogis(day_eta - c2)

  # Forecast for the day after the last report: one AR(1) step plus known lag-1 predictors.
  set.seed(0)
  S <- length(c1)
  next_day <- max(ds$dates) + 1
  next_x <- ifelse(is.na(ds$next_x), 0, ds$next_x)
  u_next <- d$phi * d$mood[, ncol(d$mood)] + d$sigma * stats::rnorm(S)
  base_next <- u_next + d$wd[, iso_weekday(next_day)] + as.numeric(d$beta %*% next_x)
  forecast <- stats::setNames(lapply(1:3, function(k) category_probs(base_next + d$tod[, k], d$cut)), SLOTS)

  # Posterior predictive check on category frequencies, overall and by slot.
  F1 <- stats::plogis(c1 - eta)
  F2 <- stats::plogis(c2 - eta)
  u <- matrix(stats::runif(length(eta)), nrow(eta))
  replicated <- 1L + (u > F1) + (u > F2)
  groups <- c(list(all = rep(TRUE, length(ds$y))), stats::setNames(lapply(1:3, function(k) ds$slot == k), SLOTS))
  ppc <- list()
  for (name in names(groups)) {
    mask <- groups[[name]]
    if (!any(mask)) next
    shares <- sapply(1:3, function(k) rowMeans(replicated[, mask, drop = FALSE] == k))
    observed <- tabulate(ds$y[mask], 3) / sum(mask)
    lo <- apply(shares, 2, stats::quantile, 0.025, names = FALSE)
    hi <- apply(shares, 2, stats::quantile, 0.975, names = FALSE)
    ppc[[name]] <- list(
      observed = round(observed, 3), predicted = round(colMeans(shares), 3), lo = round(lo, 3), hi = round(hi, 3),
      # Protocol Section 2.9.8: the check fails when the observed share lies outside the central 95% of the replicated ones.
      fails = observed < lo | observed > hi
    )
  }

  # Pointwise log likelihood for PSIS-LOO.
  lik <- F1
  lik[, ds$y == 2] <- (F2 - F1)[, ds$y == 2]
  lik[, ds$y == 3] <- (1 - F2)[, ds$y == 3]
  log_lik <- log(pmax(lik, 1e-300))
  loo_fit <- suppressWarnings(loo::loo(log_lik, r_eff = loo::relative_eff(exp(log_lik), chain_id = d$chain)))

  vars <- c("cutpoints", "time_of_day", "weekday_effect", "phi", "sigma_day", "tau")
  if (ncol(ds$X)) vars <- c(vars, "beta")
  diag <- posterior::summarise_draws(fit$draws(vars), "rhat", "ess_bulk", "ess_tail")
  diagnostics <- list(
    max_rhat = max(diag$rhat, na.rm = TRUE),
    min_ess_bulk = min(diag$ess_bulk, na.rm = TRUE),
    min_ess_tail = min(diag$ess_tail, na.rm = TRUE),
    divergences = sum(fit$diagnostic_summary(quiet = TRUE)$num_divergent),
    elpd_loo = loo_fit$estimates["elpd_loo", "Estimate"],
    elpd_loo_se = loo_fit$estimates["elpd_loo", "SE"],
    p_loo = loo_fit$estimates["p_loo", "Estimate"],
    high_pareto_k = sum(loo_fit$diagnostics$pareto_k > 0.7),
    ppc_failures = sum(vapply(ppc, function(p) sum(p$fails), 0))
  )
  diagnostics$converged <- diagnostics$max_rhat < 1.01 && diagnostics$min_ess_bulk > 400 && diagnostics$divergences == 0

  list(
    model = list(
      version = MODEL_VERSION, draws = S, chains = fit$num_chains(), seconds = round(seconds, 1),
      software = list(
        r = R.version.string, cmdstan = cmdstanr::cmdstan_version(),
        cmdstanr = as.character(utils::packageVersion("cmdstanr")),
        posterior = as.character(utils::packageVersion("posterior")),
        loo = as.character(utils::packageVersion("loo"))
      )
    ),
    data = list(
      n_ratings = length(ds$y), n_rated_days = length(ds$rated_dates), study_start = ds$study_start,
      first_date = format(min(ds$dates)), last_date = format(max(ds$dates)), counts = tabulate(ds$y, 3)
    ),
    predictors = predictors,
    dropped = ds$dropped,
    time_of_day = adjusted(d$tod, ds$slot, SLOTS),
    weekday = adjusted(d$wd, ds$weekday, WEEKDAYS),
    # p_positive is the posterior probability of carry-over (hypothesis 5).
    dynamics = list(phi = c(interval(d$phi), p_positive = round(mean(d$phi > 0), 4)), sigma_day = interval(d$sigma)),
    daily_mood = list(
      dates = format(ds$dates),
      mean = round(colMeans(daily), 3),
      lo = round(apply(daily, 2, stats::quantile, 0.1, names = FALSE), 3),
      hi = round(apply(daily, 2, stats::quantile, 0.9, names = FALSE), 3)
    ),
    forecast = list(date = format(next_day), slots = forecast),
    ppc = ppc,
    diagnostics = diagnostics
  )
}

# Thinned draws the web app uses for what-if predictions without calling R.
whatif_draws <- function(ds, fit, keep = 1000) {
  d <- extract_draws(ds, fit)
  S <- length(d$phi)
  i <- unique(round(seq(1, S, length.out = min(S, keep))))
  list(
    cutpoints = d$cut[i, , drop = FALSE], time_of_day = d$tod[i, , drop = FALSE],
    weekday_effect = d$wd[i, , drop = FALSE], beta = d$beta[i, , drop = FALSE],
    phi = d$phi[i], sigma_day = d$sigma[i],
    fields = I(ds$predictors$field), means = I(ds$means), sds = I(ds$sds)
  )
}

# P(Happy) with vs. without each tag, from Beta(1, 1) posteriors. Same-moment
# associations: a tag can be a cause of mood or a consequence of it.
tag_associations <- function(con, user_id, start = study_start(con, user_id), min_uses = 5, draws = 4000) {
  r <- DBI::dbGetQuery(
    con, "SELECT rating, tags FROM ratings WHERE user_id = ? AND study_date >= ?",
    params = list(user_id, start)
  )
  if (!nrow(r)) return(list())
  tags <- lapply(r$tags, function(t) unique(as.character(jsonlite::fromJSON(t))))
  uses <- sort(table(unlist(tags)), decreasing = TRUE)
  happy <- r$rating == 3
  set.seed(0)
  out <- list()
  for (tag in names(uses)[uses >= min_uses]) {
    has <- vapply(tags, function(t) tag %in% t, logical(1))
    if (all(has)) next
    p_with <- stats::rbeta(draws, 1 + sum(happy[has]), 1 + sum(has) - sum(happy[has]))
    p_without <- stats::rbeta(draws, 1 + sum(happy[!has]), 1 + sum(!has) - sum(happy[!has]))
    diff <- interval(100 * (p_with - p_without))
    out[[length(out) + 1]] <- list(
      tag = tag, n = sum(has), p_with = round(stats::median(p_with), 4),
      p_without = round(stats::median(p_without), 4), est = diff$est, lo = diff$lo, hi = diff$hi,
      p_positive = round(mean(p_with > p_without), 3)
    )
  }
  out
}
