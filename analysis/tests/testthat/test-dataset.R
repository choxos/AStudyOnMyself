test_that("predictors are lagged, standardized and dropped when sparse", {
  con <- new_study_db(SCHEMA)
  on.exit(DBI::dbDisconnect(con))
  simulate_study(con, days = 20, seed = 3)
  ds <- load_dataset(con, 1L)
  fields <- ds$predictors$field
  expect_true("sleep_hours" %in% fields)
  expect_false("caffeine_mg" %in% fields) # recorded on about 30% of days
  expect_true("caffeine_mg" %in% vapply(ds$dropped, function(d) d$field, ""))

  # Steps enter as yesterday's value: the first rated day has none.
  j <- match("steps", fields)
  expect_true(is.na(ds$X[1, j]))
  day1 <- DBI::dbGetQuery(con, "SELECT steps FROM daily_logs WHERE date = '2026-01-05'")$steps
  expect_equal(ds$X[2, j] * ds$sds[j] + ds$means[j], day1)
  expect_equal(mean(ds$X[, match("sleep_hours", fields)], na.rm = TRUE), 0, tolerance = 1e-9)

  expect_true(all(ds$y %in% 1:3))
  expect_true(all(ds$weekday %in% 1:7))
  expect_equal(ds$weekday[1], 1L) # 2026-01-05 is a Monday
})

test_that("the model waits for enough data", {
  con <- new_study_db(SCHEMA)
  on.exit(DBI::dbDisconnect(con))
  simulate_study(con, days = 5)
  expect_error(load_dataset(con, 1L), class = "not_enough_data")
})

test_that("tag associations compare Happy shares with and without a tag", {
  con <- new_study_db(SCHEMA)
  on.exit(DBI::dbDisconnect(con))
  simulate_study(con, days = 10)
  DBI::dbExecute(con, "UPDATE ratings SET tags = '[\"friends\"]' WHERE rating = 3")
  tags <- tag_associations(con, 1L)
  expect_equal(tags[[1]]$tag, "friends")
  expect_gt(tags[[1]]$lo, 0) # every Happy report is tagged, so the difference is clearly positive
})

test_that("no model is fitted before the study start is set", {
  con <- new_study_db(SCHEMA, study_start = NA)
  on.exit(DBI::dbDisconnect(con))
  simulate_study(con, days = 30, seed = 4)
  expect_error(load_dataset(con, 1L), class = "not_enough_data")
  expect_error(load_day_dataset(con, 1L), class = "not_enough_data")
  expect_error(tag_associations(con, 1L), class = "not_enough_data")
  DBI::dbExecute(con, "UPDATE users SET study_start = '2026-01-05' WHERE id = 1")
  expect_equal(load_dataset(con, 1L)$study_start, "2026-01-05")
})

test_that("reports before the study start are pilot data and stay out", {
  con <- new_study_db(SCHEMA)
  on.exit(DBI::dbDisconnect(con))
  simulate_study(con, days = 40, seed = 4)
  all_days <- load_dataset(con, 1L)
  DBI::dbExecute(con, "UPDATE users SET study_start = '2026-01-15' WHERE id = 1")
  later <- load_dataset(con, 1L)
  expect_equal(min(later$rated_dates), as.Date("2026-01-15"))
  expect_lt(length(later$y), length(all_days$y))
})

test_that("with social media time modeled, screen time means the rest of screen time", {
  con <- new_study_db(SCHEMA)
  on.exit(DBI::dbDisconnect(con))
  simulate_study(con, days = 30, seed = 6)
  DBI::dbExecute(con, "UPDATE daily_logs SET social_media_min = 40 + (id % 7) * 10")
  ds <- load_dataset(con, 1L)
  j <- match("screen_time_min", ds$predictors$field)
  expect_equal(ds$predictors$label[j], "Other screen time yesterday")
  day1 <- DBI::dbGetQuery(con, "SELECT screen_time_min - social_media_min AS other FROM daily_logs WHERE date = '2026-01-05'")$other
  expect_equal(ds$X[2, j] * ds$sds[j] + ds$means[j], day1)
  # Without social media time, screen time stays the total.
  DBI::dbExecute(con, "UPDATE daily_logs SET social_media_min = NULL")
  expect_equal(load_dataset(con, 1L)$predictors$label[j], "Screen time yesterday")
})

test_that("yes/no contrasts set the flag to 1 and to 0 in every report", {
  # Two draws; three reports on three days, with the flag observed as yes, as no, and missing.
  m <- 0.5
  s <- 0.5
  ds <- list(
    X = matrix(c((1 - m) / s, (0 - m) / s, NA), ncol = 1), rated_day = 1:3, means = m, sds = s,
    predictors = data.frame(field = "work_day", unit = 1)
  )
  d <- list(
    beta = matrix(c(0.8, -0.4), ncol = 1), phi = c(0.1, 0.2),
    missing = matrix(c(3, 1), ncol = 2), x_missing = matrix(c(0.3, -1.2), ncol = 1)
  )
  rest <- matrix(c(0.2, -0.1, 0.4, 0.3, 0, -0.5), nrow = 2) # the linear predictor without the flag
  flag <- rbind(c(ds$X[1:2, 1], 0.3), c(ds$X[1:2, 1], -1.2)) # observed values, then the imputed ones
  k <- contrast(ds, d, 1, rest + d$beta[, 1] * flag)
  expect_equal(k$on, rest + d$beta[, 1] * (1 - m) / s)
  expect_equal(k$off, rest + d$beta[, 1] * (0 - m) / s)
  # A continuous factor moves one unit up from each report's own value.
  ds$predictors$field <- "steps"
  ds$predictors$unit <- 1000
  eta <- rest + d$beta[, 1] * flag
  expect_equal(contrast(ds, d, 1, eta)$on - eta, matrix(d$beta[, 1] * 1000 / s, 2, 3))
})

test_that("the day satisfaction data have one row per rated evening", {
  con <- new_study_db(SCHEMA)
  on.exit(DBI::dbDisconnect(con))
  simulate_study(con, days = 30, seed = 8)
  ds <- load_day_dataset(con, 1L)
  expect_true(all(ds$y %in% 1:11))
  expect_equal(length(ds$y), nrow(ds$X))
  expect_equal(ds$day[1], 1L)
})
