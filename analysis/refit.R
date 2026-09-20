#!/usr/bin/env Rscript
# Fit the mood model for one user and write the results as JSON.
#
#   Rscript analysis/refit.R --db PATH --user ID --out FILE --draws FILE --stan-dir DIR
#                            [--seed N] [--chains 4] [--iter 2000] [--adapt-delta 0.95]
#                            [--prior-scale 0.5] [--confirmatory-scale 0.5]
#
# --iter sets both the warmup and the draws per chain. A confirmatory fit that
# fails the convergence checks is rerun with --iter 4000 --adapt-delta 0.99
# (protocol Section 2.9.5). The two prior scales are varied only by sensitivity
# analysis (1) in Section 2.9.9.
#
# Reads the database only. Prints nothing on success; errors go to stderr with
# a non-zero exit so the web app can record the failure.

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

user <- as.integer(opt("user"))
con <- dbConnect(SQLite(), opt("db"), flags = SQLITE_RO)
invisible(dbExecute(con, "PRAGMA busy_timeout = 10000"))
on.exit(dbDisconnect(con))

started <- Sys.time()
# The study start is read once, so the tag comparisons and the model use the same
# one, and every result records it.
start <- NULL
tags <- list()
output <- tryCatch(
  {
    start <- study_start(con, user)
    tags <- tag_associations(con, user, start)
    ds <- load_dataset(con, user, start)
    sampling <- list(
      iter = as.integer(opt("iter", "2000")), adapt_delta = as.numeric(opt("adapt-delta", "0.95")),
      prior_scale = as.numeric(opt("prior-scale", "0.5")), confirmatory_scale = as.numeric(opt("confirmatory-scale", "0.5"))
    )
    fit <- fit_model(
      ds, file.path(here, "mood.stan"), opt("stan-dir"),
      seed = as.integer(opt("seed", "1")), chains = as.integer(opt("chains", "4")), iter = sampling$iter,
      adapt_delta = sampling$adapt_delta, prior_scale = sampling$prior_scale, confirmatory_scale = sampling$confirmatory_scale
    )
    results <- summarize_fit(ds, fit, as.numeric(difftime(Sys.time(), started, units = "secs")))
    # Kept with the fit, so a rerun or a sensitivity analysis can be told from a standard fit.
    results$model$sampling <- sampling
    jsonlite::write_json(whatif_draws(ds, fit), opt("draws"), auto_unbox = TRUE, digits = 6)
    results$tags <- tags
    list(status = "done", message = "", results = results)
  },
  not_enough_data = function(e) {
    list(status = "waiting", message = conditionMessage(e), results = list(tags = tags, data = list(study_start = start)))
  }
)
jsonlite::write_json(output, opt("out"), auto_unbox = TRUE, digits = NA, na = "null", null = "null")
