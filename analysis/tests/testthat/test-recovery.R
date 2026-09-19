test_that("the model recovers a sleep effect from simulated data", {
  skip_if(Sys.getenv("ASOM_SLOW_TESTS") == "", "set ASOM_SLOW_TESTS=1 to fit the model")
  con <- new_study_db(SCHEMA)
  on.exit(DBI::dbDisconnect(con))
  beta <- replace(TRUE_BETA, "sleep_hours", 1) # a clear effect: 1 SD on the log-odds scale
  simulate_study(con, days = 60, seed = 11, beta = beta)
  ds <- load_dataset(con, 1L)
  fit <- fit_model(ds, STAN, file.path(tempdir(), "stan"), seed = 1, iter = 500)
  res <- summarize_fit(ds, fit)
  sleep <- Filter(function(p) p$field == "sleep_hours", res$predictors)[[1]]
  expect_gt(sleep$p_positive, 0.99)
  expect_equal(res$diagnostics$divergences, 0)
  expect_equal(sum(res$forecast$slots$morning), 1, tolerance = 0.01)
})

test_that("the day satisfaction model recovers a sleep effect", {
  skip_if(Sys.getenv("ASOM_SLOW_TESTS") == "", "set ASOM_SLOW_TESTS=1 to fit the model")
  con <- new_study_db(SCHEMA)
  on.exit(DBI::dbDisconnect(con))
  simulate_study(con, days = 120, seed = 12, beta = replace(TRUE_BETA, "sleep_hours", 1))
  ds <- load_day_dataset(con, 1L)
  res <- summarize_day_fit(ds, fit_day_model(ds, DAY_STAN, file.path(tempdir(), "stan"), seed = 1, iter = 500))
  sleep <- Filter(function(p) p$field == "sleep_hours", res$factors)[[1]]
  expect_gt(sleep$p_positive, 0.99)
  expect_equal(res$diagnostics$divergences, 0)
})

test_that("yes/no factors compare yes with no", {
  skip_if(Sys.getenv("ASOM_SLOW_TESTS") == "", "set ASOM_SLOW_TESTS=1 to fit the model")
  con <- new_study_db(SCHEMA)
  on.exit(DBI::dbDisconnect(con))
  simulate_study(con, days = 60, seed = 13)
  ds <- load_dataset(con, 1L)
  res <- summarize_fit(ds, fit_model(ds, STAN, file.path(tempdir(), "stan"), seed = 1, iter = 500))
  work <- Filter(function(p) p$field == "work_day", res$predictors)[[1]]
  # The probability change and the odds ratio agree in direction, and the evidence
  # label follows the unrounded probability.
  expect_equal(sign(work$d_happy_pp$est), sign(log(work$odds_ratio$est)))
  expect_equal(work$evidence, evidence(work$p_positive))
})
