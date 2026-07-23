# Batch 2025 transparent polar plots for Bloomberg Philanthropies community
# sensors with no EndDate (see community-sensors-bloomberg-active.csv).
# Colour: openair default ramp with red top → purple; soft pink rings;
# black wind-speed + N/E/S/W labels (readable on map overlays).
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
LOG_PATH <- "community-polar-2025-log.txt"
MIN_HOURS <- 100
FETCH_TIMEOUT_SEC <- 120

RING_COL <- "#C4789A" # soft pink rings / crosshairs (map overlay)
LABEL_COL <- "black"  # wind-speed numbers + N/E/S/W

# openair "default" anchors, red top swapped for purple
COLS_PURPLE_TOP <- c(
  "#5E4FA2", "#3082BE", "#59B9A8", "#98D7A5",
  "#D3EC97", "#F8FEB0", "#FFF4AF", "#FDCF78", "#FC9C56",
  "#D97BB8", "#A34DB8", "#6B1F8A"
)

# Non-Bloomberg sitecodes that still get annual polar PNGs (keep in sync with
# sensor-polar-plot POLAR_PLOT_ALLOWLIST). EndDate-null is enforced at runtime.
EXTRA_SITECODES <- c("CLDP0517", "CLDP0451", "CLDP0308")

MAX_SENSORS <- Sys.getenv("MAX_SENSORS", unset = "")
MAX_SENSORS <- if (nzchar(MAX_SENSORS)) as.integer(MAX_SENSORS) else Inf
ONLY_SITE <- Sys.getenv("ONLY_SITE", unset = "")

log_msg <- function(...) {
  line <- paste0(format(Sys.time(), "%Y-%m-%d %H:%M:%S"), " ", paste0(..., collapse = ""))
  cat(line, "\n", sep = "")
  cat(line, "\n", file = LOG_PATH, append = TRUE, sep = "")
  flush.console()
}

fetch_bl <- function(sitecode, species) {
  start_str <- URLencode(sprintf("Wed, 01 Jan %d 00:00:00 GMT", YEAR), reserved = TRUE)
  end_str <- URLencode(sprintf("Wed, 31 Dec %d 23:59:59 GMT", YEAR), reserved = TRUE)
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

month_label <- function(d) format(d, "%b")

caption_for <- function(sitecode, species_title, dates) {
  dmin <- min(dates, na.rm = TRUE)
  dmax <- max(dates, na.rm = TRUE)
  full_year <- format(dmin, "%m-%d") <= "01-07" && format(dmax, "%m-%d") >= "12-25"
  if (full_year) {
    range_txt <- "Jan-Dec"
  } else if (month_label(dmin) == month_label(dmax)) {
    range_txt <- month_label(dmin)
  } else {
    range_txt <- sprintf("%s-%s", month_label(dmin), month_label(dmax))
  }
  sprintf("%s - %s - %d (%s)", sitecode, species_title, YEAR, range_txt)
}

draw_polar_png <- function(plot_data, pollutant_label, path, lim, caption) {
  out <- polarPlot(
    plot_data,
    pollutant = pollutant_label,
    x = "ws",
    main = "",
    key.header = "µg/m³",
    key.footer = "",
    auto.text = FALSE,
    limits = c(0, lim),
    cols = COLS_PURPLE_TOP,
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
  col <- colorRampPalette(COLS_PURPLE_TOP)(length(breaks) - 1)

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
          col = RING_COL, lty = 5, lwd = 1.5
        )
      }
      # Wind-speed labels — black
      ltext(
        1.07 * intervals * sin(pi * angle.scale / 180),
        1.07 * intervals * cos(pi * angle.scale / 180),
        unit_labels,
        cex = 0.75,
        pos = 4,
        col = LABEL_COL,
        font = 2
      )
      lsegments(-upper, 0, upper, 0, col = RING_COL, lwd = 1.2)
      lsegments(0, -upper, 0, upper, col = RING_COL, lwd = 1.2)
      # Cardinal labels — black
      ltext(upper * -1 * 0.95, 0.07 * upper, "W", cex = 0.85, col = LABEL_COL, font = 2)
      ltext(0.07 * upper, upper * -1 * 0.95, "S", cex = 0.85, col = LABEL_COL, font = 2)
      ltext(0.07 * upper, upper * 0.95, "N", cex = 0.85, col = LABEL_COL, font = 2)
      ltext(upper * 0.95, 0.07 * upper, "E", cex = 0.85, col = LABEL_COL, font = 2)
    }
  )

  png(path, width = 800, height = 840, res = 150, bg = "transparent")
  print(plt)
  grid.text(
    caption,
    x = 0.5,
    y = unit(6, "mm"),
    gp = gpar(col = "grey45", fontsize = 8)
  )
  dev.off()
}

make_plot <- function(sitecode, species, pollutant_label, outfile, limit_cap, wind) {
  bl <- fetch_bl(sitecode, species)
  if (nrow(bl) == 0) {
    return(list(ok = FALSE, reason = "no BL records", hours = 0L))
  }
  combined <- merge(
    bl[, c("date_hour", "ScaledValue")],
    wind,
    by = "date_hour",
    all.x = TRUE
  )
  plot_data <- combined %>%
    mutate(
      date = date,
      ws = as.numeric(ws),
      wd = as.numeric(wd),
      !!pollutant_label := as.numeric(ScaledValue)
    ) %>%
    filter(
      !is.na(.data[[pollutant_label]]), !is.na(ws), !is.na(wd),
      is.finite(.data[[pollutant_label]]), is.finite(ws), is.finite(wd),
      .data[[pollutant_label]] > 0
    ) %>%
    select(date, ws, wd, all_of(pollutant_label))

  n <- nrow(plot_data)
  if (n < MIN_HOURS) {
    return(list(ok = FALSE, reason = sprintf("insufficient matched hours (%d)", n), hours = n))
  }

  p90 <- quantile(plot_data[[pollutant_label]], 0.90, na.rm = TRUE)
  lim <- min(as.numeric(p90), limit_cap)
  species_title <- if (pollutant_label == "pm25") "PM2.5" else "NO2"
  caption <- caption_for(sitecode, species_title, plot_data$date)
  path <- file.path(OUT_DIR, outfile)

  plot_ok <- FALSE
  tryCatch({
    draw_polar_png(plot_data, pollutant_label, path, lim, caption)
    plot_ok <- TRUE
  }, error = function(e) {
    log_msg("  plot error: ", conditionMessage(e))
  })
  if (!plot_ok) {
    return(list(ok = FALSE, reason = "plot render failed", hours = n))
  }
  list(ok = TRUE, reason = path, hours = n, caption = caption, lim = lim)
}

# --- main ---
options(warn = 1)
if (file.exists(LOG_PATH)) invisible(file.remove(LOG_PATH))
log_msg("=== community polar 2025 batch start (purple-top + black labels) ===")

sensors <- utils::read.csv(CSV_PATH, stringsAsFactors = FALSE, quote = "\"", fill = TRUE)
sitecodes <- unique(sensors$SiteCode)
sitecodes <- sitecodes[!is.na(sitecodes) & nzchar(sitecodes)]
sitecodes <- sitecodes[grepl("^CLDP", sitecodes)]
sitecodes <- unique(c(sitecodes, EXTRA_SITECODES))
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

dir.create(OUT_DIR, showWarnings = FALSE, recursive = TRUE)

log_msg("Loading MY1 wind for ", YEAR, " ...")
wind <- tryCatch(
  {
    w <- importAURN(site = "MY1", year = YEAR)
    w$date_hour <- as.POSIXct(format(w$date, "%Y-%m-%d %H:00:00"), tz = "UTC")
    w[, c("date_hour", "date", "ws", "wd")]
  },
  error = function(e) {
    log_msg("FATAL: MY1 wind load failed: ", conditionMessage(e))
    NULL
  }
)
if (is.null(wind)) quit(status = 1)
log_msg("MY1 wind rows: ", nrow(wind))

stats <- list(ok_no2 = 0L, ok_pm25 = 0L, fail_no2 = 0L, fail_pm25 = 0L, sensors = 0L)

jobs <- list(
  list(species = "INO2", label = "no2", suffix = "no2-polar-2025.png", cap = 55),
  list(species = "IPM25", label = "pm25", suffix = "pm25-polar-2025.png", cap = 30)
)

for (sc in sitecodes) {
  stats$sensors <- stats$sensors + 1L
  log_msg("--- ", sc, " (", stats$sensors, "/", length(sitecodes), ") ---")
  sc_lower <- tolower(sc)
  for (job in jobs) {
    outfile <- paste0(sc_lower, "-", job$suffix)
    result <- tryCatch(
      make_plot(sc, job$species, job$label, outfile, job$cap, wind),
      error = function(e) {
        list(ok = FALSE, reason = paste("error:", conditionMessage(e)), hours = 0L)
      }
    )
    key_ok <- if (job$label == "no2") "ok_no2" else "ok_pm25"
    key_fail <- if (job$label == "no2") "fail_no2" else "fail_pm25"
    if (isTRUE(result$ok)) {
      stats[[key_ok]] <- stats[[key_ok]] + 1L
      log_msg(
        "  OK ", job$species, " hours=", result$hours,
        " limit=", round(result$lim, 2),
        " -> ", result$reason,
        " caption=\"", result$caption, "\""
      )
    } else {
      stats[[key_fail]] <- stats[[key_fail]] + 1L
      log_msg("  SKIP ", job$species, " ", result$reason)
    }
  }
}

log_msg("=== batch complete ===")
log_msg(
  "sensors=", stats$sensors,
  " NO2 ok=", stats$ok_no2, " fail=", stats$fail_no2,
  " PM2.5 ok=", stats$ok_pm25, " fail=", stats$fail_pm25
)
cat("Done. See ", LOG_PATH, "\n", sep = "")
