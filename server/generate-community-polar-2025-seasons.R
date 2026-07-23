# Batch 2025 seasonal polar plots for Bloomberg Philanthropies community
# sensors that already have annual 2025 PNGs (or are listed in
# community-sensors-bloomberg-active.csv). Style matches
# generate-cldp0299-polar-2025-seasons.R (purple-top palette, soft pink rings).
#
# Season windows (meteorological seasons):
#   Winter — 1 Dec 2024 – 28 Feb 2025 (contiguous DJF)
#   Spring — Mar–May 2025 (MAM)
#   Summer — Jun–Aug 2025 (JJA)
#   Autumn — Sep–Nov 2025 (SON)
#
# Env:
#   ONLY_SITE     — comma/space-separated sitecodes (optional)
#   ONLY_SEASON   — one of winter|spring|summer|autumn (optional)
#   FORCE         — set to 1 to overwrite existing season PNGs
#   SKIP_COMPLETE — default 1; set 0 when regenerating a season
#   MAX_SENSORS   — limit for smoke tests
#
# Outputs (public/):
#   {sitecode-lower}-{no2|pm25}-polar-2025-{winter|spring|summer|autumn}.png
# Also writes polar-seasonal-sites.json listing sites with a full 8-file set.
library(openair)
library(lattice)
library(httr)
library(jsonlite)
library(dplyr)
library(grid)

BL_API_BASE <- "https://api.breathelondon-communities.org/api"
BL_API_KEY <- "e2635276-e87a-11eb-9a03-0242ac130003"
YEAR <- 2025
OUT_DIR <- "../public"
CSV_PATH <- "community-sensors-bloomberg-active.csv"
LOG_PATH <- "community-polar-2025-seasons-log.txt"
MANIFEST_PATH <- file.path(OUT_DIR, "polar-seasonal-sites.json")
MIN_SEASON_HOURS <- 50L
FETCH_TIMEOUT_SEC <- 120
PINK <- "#C4789A"

COLS_DEFAULT_PURPLE_TOP <- c(
  "#5E4FA2", "#3082BE", "#59B9A8", "#98D7A5",
  "#D3EC97", "#F8FEB0", "#FFF4AF", "#FDCF78", "#FC9C56",
  "#D97BB8", "#A34DB8", "#6B1F8A"
)

SEASONS <- list(
  winter = list(
    # Contiguous meteorological winter spanning calendar years
    start = as.POSIXct("2024-12-01 00:00:00", tz = "UTC"),
    end = as.POSIXct("2025-02-28 23:59:59", tz = "UTC"),
    label = "Winter 2025",
    caption_range = "Dec 2024 - Feb 2025"
  ),
  spring = list(
    months = 3:5,
    label = "Spring 2025",
    caption_range = "Mar-May 2025"
  ),
  summer = list(
    months = 6:8,
    label = "Summer 2025",
    caption_range = "Jun-Aug 2025"
  ),
  autumn = list(
    months = 9:11,
    label = "Autumn 2025",
    caption_range = "Sep-Nov 2025"
  )
)

# BL + wind window must cover winter (from Dec prior year) through end of YEAR.
DATA_START <- as.POSIXct("2024-12-01 00:00:00", tz = "UTC")
DATA_END <- as.POSIXct(sprintf("%d-12-31 23:59:59", YEAR), tz = "UTC")

# Non-Bloomberg sitecodes that still get seasonal polar PNGs (keep in sync with
# sensor-polar-plot POLAR_PLOT_ALLOWLIST / generate-community-polar-2025.R).
EXTRA_SITECODES <- c("CLDP0517", "CLDP0451", "CLDP0308")

MAX_SENSORS <- Sys.getenv("MAX_SENSORS", unset = "")
MAX_SENSORS <- if (nzchar(MAX_SENSORS)) as.integer(MAX_SENSORS) else Inf
ONLY_SITE <- Sys.getenv("ONLY_SITE", unset = "")
ONLY_SEASON <- tolower(trimws(Sys.getenv("ONLY_SEASON", unset = "")))
FORCE <- Sys.getenv("FORCE", unset = "0") == "1"

log_msg <- function(...) {
  line <- paste0(format(Sys.time(), "%Y-%m-%d %H:%M:%S"), " ", paste0(..., collapse = ""))
  cat(line, "\n", sep = "")
  cat(line, "\n", file = LOG_PATH, append = TRUE, sep = "")
  flush.console()
}

fetch_bl <- function(sitecode, species) {
  # Include Dec of prior year so contiguous winter (DJF) is available.
  start_str <- URLencode(format(DATA_START, "%a, %d %b %Y %H:%M:%S GMT"), reserved = TRUE)
  end_str <- URLencode(format(DATA_END, "%a, %d %b %Y %H:%M:%S GMT"), reserved = TRUE)
  url <- paste0(
    BL_API_BASE, "/getClarityData/", sitecode, "/", species, "/",
    start_str, "/", end_str, "/Hourly?key=", BL_API_KEY
  )
  resp <- GET(url, timeout(FETCH_TIMEOUT_SEC))
  stop_for_status(resp)
  data <- content(resp, as = "parsed")
  if (is.null(data) || (is.list(data) && length(data) == 0)) {
    return(data.frame())
  }
  if (is.list(data) && !is.data.frame(data)) {
    data <- as.data.frame(do.call(rbind, data), stringsAsFactors = FALSE)
  }
  if (nrow(data) == 0 || !("DateTime" %in% names(data))) {
    return(data.frame())
  }
  dt <- vapply(data$DateTime, function(x) as.character(x[[1]]), character(1))
  data$DateTime <- as.POSIXct(
    sub("\\.\\d{3}Z?$", "", dt),
    format = "%Y-%m-%dT%H:%M:%S",
    tz = "UTC"
  )
  data$date_hour <- as.POSIXct(format(data$DateTime, "%Y-%m-%d %H:00:00"), tz = "UTC")
  data$ScaledValue <- vapply(data$ScaledValue, function(x) {
    if (is.null(x) || length(x) == 0) return(NA_real_)
    as.numeric(x[[1]])
  }, numeric(1))
  data
}

draw_plot <- function(plot_data, pollutant_label, outfile, lim, caption) {
  out <- polarPlot(
    plot_data,
    pollutant = pollutant_label,
    x = "ws",
    main = "",
    key.header = "µg/m³",
    key.footer = "",
    auto.text = FALSE,
    limits = c(0, lim),
    cols = COLS_DEFAULT_PURPLE_TOP,
    plot = FALSE
  )

  res <- as.data.frame(out$data)
  radial <- attr(out$data, "radial_scale")
  upper <- max(abs(c(res$u, res$v, radial)), na.rm = TRUE)

  z <- res$z
  z[z > lim] <- lim
  z[z < 0] <- 0
  res$z <- z

  nlev <- 200
  breaks <- seq(0, lim, length.out = nlev)
  labs <- pretty(c(0, lim), 7)
  labs <- labs[labs >= 0 & labs <= lim]
  at <- labs

  col <- colorRampPalette(COLS_DEFAULT_PURPLE_TOP)(length(breaks) - 1)
  angle.scale <- 315
  intervals <- pretty(c(0, upper))
  intervals <- intervals[intervals > 0]
  labels <- intervals
  unit_labels <- sapply(seq_along(labels), function(i) {
    if (i == 3) paste(labels[i], "ws") else as.character(labels[i])
  })

  legend <- list(
    col = col,
    at = breaks,
    labels = list(labels = labs, at = at),
    space = "right",
    auto.text = FALSE,
    footer = "",
    header = "µg/m³",
    height = 1,
    width = 1.5,
    fit = "all"
  )
  legend <- openair:::makeOpenKeyLegend(TRUE, legend, "polarPlot")

  plt <- levelplot(
    z ~ u * v,
    data = res,
    axes = FALSE,
    aspect = 1,
    xlab = "",
    ylab = "",
    main = "",
    col.regions = col,
    at = breaks,
    region = TRUE,
    scales = list(draw = FALSE),
    xlim = c(-upper * 1.025, upper * 1.025),
    ylim = c(-upper * 1.025, upper * 1.025),
    colorkey = FALSE,
    legend = legend,
    par.settings = list(
      background = list(col = "transparent"),
      panel.background = list(col = "transparent"),
      axis.line = list(col = "transparent")
    ),
    panel = function(x, y, z, subscripts, ...) {
      panel.levelplot(
        x, y, z, subscripts,
        at = breaks,
        col.regions = col,
        labels = FALSE
      )
      angles <- seq(0, 2 * pi, length.out = 360)
      for (r in intervals) {
        llines(
          r * sin(angles), r * cos(angles),
          col = PINK, lty = 5, lwd = 1.5
        )
      }
      ltext(
        1.07 * intervals * sin(pi * angle.scale / 180),
        1.07 * intervals * cos(pi * angle.scale / 180),
        unit_labels,
        cex = 0.75,
        pos = 4,
        col = PINK,
        font = 2
      )
      lsegments(-upper, 0, upper, 0, col = PINK, lwd = 1.2)
      lsegments(0, -upper, 0, upper, col = PINK, lwd = 1.2)
      ltext(upper * -1 * 0.95, 0.07 * upper, "W", cex = 0.85, col = PINK, font = 2)
      ltext(0.07 * upper, upper * -1 * 0.95, "S", cex = 0.85, col = PINK, font = 2)
      ltext(0.07 * upper, upper * 0.95, "N", cex = 0.85, col = PINK, font = 2)
      ltext(upper * 0.95, 0.07 * upper, "E", cex = 0.85, col = PINK, font = 2)
    }
  )

  path <- file.path(OUT_DIR, outfile)
  # Do NOT use type="cairo" on this Mac — capabilities("cairo") is TRUE but the
  # cairo DLL fails to load, and png() then opens a null device (no file written).
  png(path, width = 800, height = 840, res = 150, bg = "transparent")
  print(plt)
  grid.text(
    caption,
    x = 0.5,
    y = unit(6, "mm"),
    gp = gpar(col = "grey45", fontsize = 8)
  )
  dev.off()
  if (!file.exists(path) || isTRUE(file.info(path)$size < 1000)) {
    stop("PNG not written or too small: ", path)
  }
  path
}

prepare_plot_data <- function(bl, wind, pollutant_label) {
  empty <- data.frame(
    date = as.POSIXct(character()),
    date_hour = as.POSIXct(character()),
    ws = numeric(),
    wd = numeric(),
    month = integer(),
    stringsAsFactors = FALSE
  )
  empty[[pollutant_label]] <- numeric()
  if (nrow(bl) == 0) {
    return(empty)
  }
  combined <- merge(
    bl[, c("date_hour", "ScaledValue")],
    wind,
    by = "date_hour",
    all.x = TRUE
  )
  combined %>%
    mutate(
      date = date,
      ws = as.numeric(ws),
      wd = as.numeric(wd),
      !!pollutant_label := as.numeric(ScaledValue),
      month = as.integer(format(date_hour, "%m")),
      date_hour = date_hour
    ) %>%
    filter(
      !is.na(.data[[pollutant_label]]), !is.na(ws), !is.na(wd),
      is.finite(.data[[pollutant_label]]), is.finite(ws), is.finite(wd),
      .data[[pollutant_label]] > 0
    )
}

filter_season <- function(plot_data_all, season) {
  if (!is.null(season$start) && !is.null(season$end)) {
    plot_data_all %>%
      filter(date_hour >= season$start, date_hour <= season$end)
  } else {
    plot_data_all %>%
      filter(month %in% season$months)
  }
}

make_season_plot <- function(sitecode, plot_data_all, pollutant_label, season_key, limit_cap) {
  season <- SEASONS[[season_key]]
  outfile <- sprintf(
    "%s-%s-polar-2025-%s.png",
    tolower(sitecode),
    pollutant_label,
    season_key
  )
  out_path <- file.path(OUT_DIR, outfile)
  if (!FORCE && file.exists(out_path) && file.info(out_path)$size > 1000) {
    return(list(ok = TRUE, reason = paste("exists:", out_path), hours = NA_integer_, lim = NA_real_, skipped = TRUE))
  }

  plot_data <- filter_season(plot_data_all, season) %>%
    select(date, ws, wd, all_of(pollutant_label))

  n <- nrow(plot_data)
  if (n < MIN_SEASON_HOURS) {
    return(list(ok = FALSE, reason = sprintf("insufficient hours (%d)", n), hours = n))
  }

  p90 <- quantile(plot_data[[pollutant_label]], 0.90, na.rm = TRUE)
  lim <- min(as.numeric(p90), limit_cap)
  species_title <- if (pollutant_label == "pm25") "PM2.5" else "NO2"
  caption <- sprintf(
    "%s - %s - %s (%s)",
    sitecode, species_title, season$label, season$caption_range
  )

  path <- tryCatch(
    draw_plot(plot_data, pollutant_label, outfile, lim, caption),
    error = function(e) {
      log_msg("    plot error: ", conditionMessage(e))
      NULL
    }
  )
  if (is.null(path)) {
    return(list(ok = FALSE, reason = "plot render failed", hours = n))
  }
  list(ok = TRUE, reason = path, hours = n, lim = lim)
}

site_has_annual <- function(sitecode) {
  sc <- tolower(sitecode)
  no2 <- file.path(OUT_DIR, paste0(sc, "-no2-polar-2025.png"))
  pm <- file.path(OUT_DIR, paste0(sc, "-pm25-polar-2025.png"))
  file.exists(no2) && file.exists(pm)
}

site_seasonal_complete <- function(sitecode) {
  sc <- tolower(sitecode)
  needed <- unlist(lapply(c("no2", "pm25"), function(pol) {
    sprintf("%s-%s-polar-2025-%s.png", sc, pol, names(SEASONS))
  }))
  all(file.exists(file.path(OUT_DIR, needed)))
}

# --- main ---
options(warn = 1)
if (file.exists(LOG_PATH)) invisible(file.remove(LOG_PATH))
log_msg("=== community polar 2025 seasons batch start ===")

sensors <- utils::read.csv(CSV_PATH, stringsAsFactors = FALSE, quote = "\"", fill = TRUE)
sitecodes <- unique(sensors$SiteCode)
sitecodes <- sitecodes[!is.na(sitecodes) & nzchar(sitecodes)]
sitecodes <- sitecodes[grepl("^CLDP", sitecodes)]
sitecodes <- unique(c(sitecodes, EXTRA_SITECODES))

# Prefer sites that already have annual plots; still try CSV-only / allowlist sites.
with_annual <- sitecodes[vapply(sitecodes, site_has_annual, logical(1))]
without_annual <- setdiff(sitecodes, with_annual)
log_msg("CSV+extra sites: ", length(sitecodes),
        " with annual PNGs: ", length(with_annual),
        " without: ", paste(without_annual, collapse = ","))

sitecodes <- c(with_annual, without_annual)
if (nzchar(ONLY_SITE)) {
  wanted <- toupper(trimws(unlist(strsplit(ONLY_SITE, "[,\\s]+"))))
  wanted <- wanted[nzchar(wanted)]
  sitecodes <- wanted
  log_msg("ONLY_SITE=", ONLY_SITE, " -> ", length(sitecodes), " sensors")
}
if (is.finite(MAX_SENSORS)) {
  sitecodes <- head(sitecodes, MAX_SENSORS)
  log_msg("MAX_SENSORS=", MAX_SENSORS, " -> ", length(sitecodes), " sensors")
}
log_msg("Sensors to process: ", length(sitecodes))

season_keys <- names(SEASONS)
if (nzchar(ONLY_SEASON)) {
  if (!(ONLY_SEASON %in% season_keys)) {
    stop("ONLY_SEASON must be one of: ", paste(season_keys, collapse = ", "))
  }
  season_keys <- ONLY_SEASON
  log_msg("ONLY_SEASON=", ONLY_SEASON)
}
if (FORCE) log_msg("FORCE=1 (overwrite existing season PNGs)")

dir.create(OUT_DIR, showWarnings = FALSE, recursive = TRUE)

# Wind covers Dec prior year through YEAR (contiguous winter needs both).
wind_years <- sort(unique(c(as.integer(format(DATA_START, "%Y")), YEAR)))
log_msg("Loading MY1 wind for ", paste(wind_years, collapse = "+"), " ...")
wind <- tryCatch(
  {
    parts <- lapply(wind_years, function(y) {
      w <- importAURN(site = "MY1", year = y)
      w$date_hour <- as.POSIXct(format(w$date, "%Y-%m-%d %H:00:00"), tz = "UTC")
      w[, c("date_hour", "date", "ws", "wd")]
    })
    do.call(rbind, parts)
  },
  error = function(e) {
    log_msg("FATAL: MY1 wind load failed: ", conditionMessage(e))
    NULL
  }
)
if (is.null(wind)) quit(status = 1)
log_msg("MY1 wind rows: ", nrow(wind))

jobs <- list(
  list(species = "INO2", label = "no2", cap = 55),
  list(species = "IPM25", label = "pm25", cap = 30)
)

stats <- list(
  sensors = 0L,
  ok_files = 0L,
  skip_files = 0L,
  complete_sites = 0L
)

SKIP_COMPLETE <- Sys.getenv("SKIP_COMPLETE", unset = "1") != "0"
# When regenerating a single season, never skip "complete" sites.
if (nzchar(ONLY_SEASON)) SKIP_COMPLETE <- FALSE

for (sc in sitecodes) {
  stats$sensors <- stats$sensors + 1L
  log_msg("--- ", sc, " (", stats$sensors, "/", length(sitecodes), ") ---")

  if (SKIP_COMPLETE && site_seasonal_complete(sc)) {
    stats$complete_sites <- stats$complete_sites + 1L
    log_msg("  SKIP existing full seasonal set for ", sc)
    next
  }

  for (job in jobs) {
    log_msg("  Fetching ", job$species, " ...")
    bl <- tryCatch(
      fetch_bl(sc, job$species),
      error = function(e) {
        log_msg("  FETCH FAIL ", job$species, ": ", conditionMessage(e))
        data.frame()
      }
    )
    plot_data_all <- prepare_plot_data(bl, wind, job$label)
    log_msg("  usable hours (window): ", nrow(plot_data_all))

    for (season_key in season_keys) {
      result <- tryCatch(
        make_season_plot(sc, plot_data_all, job$label, season_key, job$cap),
        error = function(e) {
          list(ok = FALSE, reason = paste("error:", conditionMessage(e)), hours = 0L)
        }
      )
      if (isTRUE(result$ok)) {
        stats$ok_files <- stats$ok_files + 1L
        log_msg(
          "    OK ", season_key, "/", job$label,
          " hours=", result$hours,
          " limit=", round(result$lim, 2),
          " -> ", result$reason
        )
      } else {
        stats$skip_files <- stats$skip_files + 1L
        log_msg("    SKIP ", season_key, "/", job$label, " ", result$reason)
      }
    }
  }

  if (site_seasonal_complete(sc)) {
    stats$complete_sites <- stats$complete_sites + 1L
    log_msg("  FULL seasonal set for ", sc)
  } else {
    log_msg("  INCOMPLETE seasonal set for ", sc)
  }
  # Release plot memory between sites (long batch / macOS PNG stability).
  invisible(gc())
}

complete <- sitecodes[vapply(sitecodes, site_seasonal_complete, logical(1))]
# Keep any previously complete sites not in this run (e.g. ONLY_SITE)
existing_manifest <- character(0)
if (file.exists(MANIFEST_PATH)) {
  existing_manifest <- tryCatch(
    {
      m <- fromJSON(MANIFEST_PATH)
      if (is.character(m)) m else character(0)
    },
    error = function(e) character(0)
  )
}
all_complete <- sort(unique(c(existing_manifest, complete)))
# Drop sites that are no longer complete on disk
all_complete <- all_complete[vapply(all_complete, site_seasonal_complete, logical(1))]
write_json(all_complete, MANIFEST_PATH, pretty = TRUE, auto_unbox = TRUE)
log_msg("Wrote manifest (", length(all_complete), " sites): ", MANIFEST_PATH)

log_msg("=== seasons batch complete ===")
log_msg(
  "sensors=", stats$sensors,
  " ok_files=", stats$ok_files,
  " skip_files=", stats$skip_files,
  " complete_sites=", length(all_complete)
)
cat("Done. See ", LOG_PATH, "\n", sep = "")
