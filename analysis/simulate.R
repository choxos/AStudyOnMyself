# Simulated studies with known effects, for tests and for checking what the
# model can recover. Nothing here touches the real database.
#
#   Rscript analysis/simulate.R [--days 120] [--seed 7]    prints true vs. estimated effects

TRUE_BETA <- c(sleep_hours = 0.5, steps = 0.3, screen_time_min = -0.3, work_day = -0.2, temp_mean_c = 0)
TRUE_DYNAMICS <- c(phi = 0.5, sigma_day = 0.7)

# A fresh database with the app's schema, in a temporary file.
new_study_db <- function(schema_file, path = tempfile(fileext = ".sqlite3"), study_start = "2026-01-01") {
  con <- DBI::dbConnect(RSQLite::SQLite(), path)
  sql <- gsub("--[^\n]*", "", paste(readLines(schema_file), collapse = "\n"))
  for (s in trimws(strsplit(sql, ";")[[1]])) {
    if (nzchar(s)) DBI::dbExecute(con, s)
  }
  DBI::dbExecute(
    con, "INSERT INTO users (id, username, password_hash, time_zone, study_start) VALUES (1, 'sim', 'x', 'America/Toronto', ?)",
    params = list(study_start)
  )
  con
}

simulate_study <- function(con, days = 120, seed = 7, compliance = 0.8, beta = TRUE_BETA) {
  set.seed(seed)
  start <- as.Date("2026-01-05")
  dates <- start + 0:(days - 1)
  z <- function(x) if (stats::sd(x) > 0) (x - mean(x)) / sqrt(mean((x - mean(x))^2)) else 0 * x
  lag <- function(x) c(NA, head(x, -1))
  sleep <- stats::rnorm(days, 7, 1)
  steps <- pmax(stats::rnorm(days, 8000, 2500), 500)
  screen <- pmax(stats::rnorm(days, 300, 80), 30)
  work <- as.integer(format(dates, "%u")) <= 5 & stats::runif(days) > 0.1
  temp <- stats::rnorm(days, 5, 8)
  u <- numeric(days)
  phi <- TRUE_DYNAMICS[["phi"]]
  sigma <- TRUE_DYNAMICS[["sigma_day"]]
  u[1] <- stats::rnorm(1, 0, sigma / sqrt(1 - phi^2))
  for (t in 2:days) u[t] <- phi * u[t - 1] + stats::rnorm(1, 0, sigma)
  xb <- beta[["sleep_hours"]] * z(sleep) + beta[["work_day"]] * z(as.numeric(work))
  lagged <- beta[["steps"]] * lag(z(steps)) + beta[["screen_time_min"]] * lag(z(screen))
  xb <- xb + ifelse(is.na(lagged), 0, lagged)
  logs <- data.frame(
    user_id = 1L, date = format(dates),
    sleep_hours = ifelse(stats::runif(days) < 0.1, NA, round(sleep, 2)),
    steps = as.integer(steps), screen_time_min = as.integer(screen), work_day = as.integer(work),
    temp_mean_c = round(temp, 1),
    caffeine_mg = ifelse(stats::runif(days) < 0.3, as.integer(pmax(stats::rnorm(days, 150, 60), 0)), NA) # too sparse to model
  )
  DBI::dbAppendTable(con, "daily_logs", logs)
  tod <- c(-0.3, 0.1, 0.2)
  cutpoints <- c(-1, 1.2)
  rows <- list()
  for (d in seq_len(days)) {
    for (k in 1:3) {
      if (stats::runif(1) < compliance) {
        eta <- xb[d] + u[d] + tod[k]
        p <- stats::plogis(cutpoints - eta)
        y <- sample(1:3, 1, prob = c(p[1], p[2] - p[1], 1 - p[2]))
        rows[[length(rows) + 1]] <- data.frame(
          user_id = 1L, rating = y, recorded_at = sprintf("%sT%02d:00:00Z", format(dates[d]), c(13, 18, 23)[k]),
          time_zone = "America/Toronto", study_date = format(dates[d]), slot = c("morning", "afternoon", "evening")[k],
          client_id = sprintf("sim-%d-%d", d, k)
        )
      }
    }
  }
  DBI::dbAppendTable(con, "ratings", do.call(rbind, rows))

  # The evening rating of the day (0 to 10) from the same day effects, on 85% of days.
  cuts <- seq(-3, 3, length.out = 10)
  sat <- vapply(seq_len(days), function(d) {
    p <- stats::plogis(cuts - (xb[d] + u[d]))
    sample(0:10, 1, prob = diff(c(0, p, 1)))
  }, integer(1))
  keep <- stats::runif(days) < 0.85
  DBI::dbExecute(con, "UPDATE daily_logs SET day_satisfaction = ? WHERE date = ?", params = list(sat[keep], format(dates[keep])))

  # Standard deviations of the generating values: TRUE_BETA is per one of them.
  pop <- function(x) sqrt(mean((x - mean(x))^2))
  invisible(list(sd = c(sleep_hours = pop(sleep), steps = pop(steps), screen_time_min = pop(screen),
                        work_day = pop(as.numeric(work)), temp_mean_c = pop(temp))))
}

if (sys.nframe() == 0) {
  args <- commandArgs(trailingOnly = TRUE)
  opt <- function(name, default) {
    i <- match(paste0("--", name), args)
    if (is.na(i)) default else args[i + 1]
  }
  here <- dirname(normalizePath(sub("^--file=", "", grep("^--file=", commandArgs(FALSE), value = TRUE))))
  source(file.path(here, "mood.R"))
  con <- new_study_db(file.path(here, "..", "server", "schema.sql"))
  truth <- simulate_study(con, days = as.integer(opt("days", "120")), seed = as.integer(opt("seed", "7")))
  ds <- load_dataset(con, 1L)
  fit <- fit_model(ds, file.path(here, "mood.stan"), file.path(tempdir(), "stan"), seed = 1)
  res <- summarize_fit(ds, fit)
  units <- c(sleep_hours = 1, steps = 1000, screen_time_min = 60, work_day = 1, temp_mean_c = 5)
  cat(sprintf("%d reports on %d days\n", res$data$n_ratings, res$data$n_rated_days))
  cat(sprintf("%-16s %8s  %-24s %s\n", "factor", "true OR", "estimated OR (95% CrI)", "covered"))
  for (p in res$predictors) {
    true_or <- exp(TRUE_BETA[[p$field]] * units[[p$field]] / truth$sd[[p$field]]) # per unit of the generating scale
    o <- p$odds_ratio
    cat(sprintf("%-16s %8.2f  %.2f (%.2f to %.2f)       %s\n", p$field, true_or, o$est, o$lo, o$hi, o$lo <= true_or && true_or <= o$hi))
  }
  for (n in names(TRUE_DYNAMICS)) {
    e <- res$dynamics[[n]]
    cat(sprintf("%-16s %8.2f  %.2f (%.2f to %.2f)\n", n, TRUE_DYNAMICS[[n]], e$est, e$lo, e$hi))
  }
  cat("dropped:", paste(vapply(res$dropped, function(x) x$field, ""), collapse = ", "), "\n")
  str(res$diagnostics[c("max_rhat", "min_ess_bulk", "divergences", "converged")])
}
