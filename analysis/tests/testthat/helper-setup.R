# testthat runs from analysis/tests/testthat.
source(file.path("..", "..", "mood.R"))
source(file.path("..", "..", "simulate.R"))
SCHEMA <- file.path("..", "..", "..", "server", "schema.sql")
STAN <- file.path("..", "..", "mood.stan")
source(file.path("..", "..", "secondary.R"))
DAY_STAN <- file.path("..", "..", "day_satisfaction.stan")
