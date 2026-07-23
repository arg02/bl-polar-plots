# Derive seasonal polar-plot pattern stats from openair polarPlot surfaces
# (plot=FALSE z-grid), then draft season blurbs into polar-readings-2025.json.
#
# Does NOT look at PNGs. Uses Clarity + MY1 hourly merge → polarPlot surface.
#
# Season windows (match generate-community-polar-2025-seasons.R):
#   Winter — 1 Dec 2024 – 28 Feb 2025
#   Spring — Mar–May 2025
#   Summer — Jun–Aug 2025
#   Autumn — Sep–Nov 2025
#
# Env:
#   ONLY_SITE — comma/space-separated sitecodes (optional)
#
# Outputs (server/):
#   community-polar-2025-season-stats.json
# Updates:
#   ../public/polar-readings-2025.json  (seasons keys only; paragraphs untouched)
#   ../docs/node-info/polar-readings-2025.json (same, if present)
library(openair)
library(httr)
library(jsonlite)
library(dplyr)

BL_API_BASE <- "https://api.breathelondon-communities.org/api"
BL_API_KEY <- "e2635276-e87a-11eb-9a03-0242ac130003"
YEAR <- 2025
CSV_PATH <- "community-sensors-bloomberg-active.csv"
MANIFEST_PATH <- "../public/polar-seasonal-sites.json"
STATS_OUT <- "community-polar-2025-season-stats.json"
READINGS_PATHS <- c(
  "../public/polar-readings-2025.json",
  "../docs/node-info/polar-readings-2025.json"
)
MIN_SEASON_HOURS <- 50L
FETCH_TIMEOUT_SEC <- 120
EXTRA_SITECODES <- c("CLDP0517", "CLDP0451", "CLDP0308")
ONLY_SITE <- Sys.getenv("ONLY_SITE", unset = "")

DATA_START <- as.POSIXct("2024-12-01 00:00:00", tz = "UTC")
DATA_END <- as.POSIXct(sprintf("%d-12-31 23:59:59", YEAR), tz = "UTC")

SEASONS <- list(
  winter = list(
    start = as.POSIXct("2024-12-01 00:00:00", tz = "UTC"),
    end = as.POSIXct("2025-02-28 23:59:59", tz = "UTC")
  ),
  spring = list(months = 3:5),
  summer = list(months = 6:8),
  autumn = list(months = 9:11)
)

DIR_CODES <- c("N", "NE", "E", "SE", "S", "SW", "W", "NW")
DIR_NAMES <- c(
  N = "north", NE = "north-east", E = "east", SE = "south-east",
  S = "south", SW = "south-west", W = "west", NW = "north-west"
)

dir_code <- function(wd_deg) {
  idx <- floor(((wd_deg %% 360) + 22.5) / 45) %% 8 + 1
  DIR_CODES[idx]
}

format_dirs <- function(codes) {
  codes <- unique(codes)
  codes <- codes[codes %in% DIR_CODES]
  if (length(codes) == 0) return(NULL)
  # Keep compass order starting from first code
  ord <- match(codes, DIR_CODES)
  codes <- codes[order(ord)]
  names <- unname(DIR_NAMES[codes])
  if (length(names) == 1) return(names)
  if (length(names) == 2) {
    i1 <- match(codes[1], DIR_CODES)
    i2 <- match(codes[2], DIR_CODES)
    adjacent <- abs(i1 - i2) %% 8 == 1 || abs(i1 - i2) %% 8 == 7
    if (adjacent) return(paste0(names[1], "–", names[2]))
    return(paste(names, collapse = " and "))
  }
  paste(paste(names[-length(names)], collapse = ", "), names[length(names)], sep = " and ")
}

pollutant_display <- function(key) {
  if (key == "pm25") "PM₂.₅" else "NO₂"
}

fetch_bl <- function(sitecode, species) {
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

filter_season <- function(plot_data_all, season) {
  if (!is.null(season$start) && !is.null(season$end)) {
    plot_data_all %>%
      filter(date_hour >= season$start, date_hour <= season$end)
  } else {
    plot_data_all %>%
      filter(month %in% season$months)
  }
}

analyse_surface <- function(plot_data, pollutant_label) {
  n <- nrow(plot_data)
  if (n < MIN_SEASON_HOURS) {
    return(list(ok = FALSE, reason = sprintf("insufficient hours (%d)", n), hours = n))
  }

  out <- tryCatch(
    polarPlot(
      plot_data,
      pollutant = pollutant_label,
      x = "ws",
      plot = FALSE,
      key = FALSE
    ),
    error = function(e) NULL
  )
  if (is.null(out) || is.null(out$data)) {
    return(list(ok = FALSE, reason = "polarPlot failed", hours = n))
  }

  res <- as.data.frame(out$data) %>%
    filter(is.finite(z), is.finite(u), is.finite(v))
  if (nrow(res) < 100) {
    return(list(ok = FALSE, reason = "sparse surface", hours = n))
  }

  res$r <- sqrt(res$u^2 + res$v^2)
  # openair: u = ws*sin(wd), v = ws*cos(wd) → meteorological "from" direction
  res$wd <- (atan2(res$u, res$v) * 180 / pi) %% 360
  res$sector <- dir_code(res$wd)

  radial <- attr(out$data, "radial_scale")
  r_max <- if (!is.null(radial) && length(radial) >= 2) {
    as.numeric(radial[2])
  } else {
    max(res$r, na.rm = TRUE)
  }
  # Calm = near centre; directional ring = moderate–high ws on the plot surface
  calm_cut <- max(1.2, 0.18 * r_max)
  dir_cut <- max(2.0, 0.28 * r_max)

  calm <- res %>% filter(r < calm_cut)
  directional <- res %>% filter(r >= dir_cut)
  if (nrow(calm) < 20 || nrow(directional) < 50) {
    return(list(ok = FALSE, reason = "too few surface cells", hours = n))
  }

  calm_mean <- mean(calm$z)
  calm_max <- max(calm$z)
  dir_mean_all <- mean(directional$z)
  dir_max_all <- max(directional$z)

  sec <- directional %>%
    group_by(sector) %>%
    summarise(
      mean_z = mean(z),
      max_z = max(z),
      p90 = as.numeric(quantile(z, 0.9)),
      n = n(),
      .groups = "drop"
    ) %>%
    arrange(desc(mean_z))

  if (nrow(sec) < 3) {
    return(list(ok = FALSE, reason = "too few sectors", hours = n))
  }

  best_mean <- sec$mean_z[1]
  low_mean <- min(sec$mean_z)
  contrast <- best_mean / max(low_mean, 1e-6)

  # Primary dirs: near the peak mean, and well above the sector median
  med_mean <- median(sec$mean_z)
  primary <- sec %>%
    filter(mean_z >= best_mean * 0.92, mean_z >= med_mean * 1.12) %>%
    pull(sector)
  if (length(primary) == 0) {
    primary <- sec$sector[1]
  }
  # Cap at 2 for cautious wording
  if (length(primary) > 2) {
    primary <- sec$sector[seq_len(2)]
  }

  # High-cell confirmation (upper quartile of whole surface, directional ring)
  hi_thr <- as.numeric(quantile(res$z, 0.75, na.rm = TRUE))
  hi_sec <- directional %>%
    filter(z >= hi_thr) %>%
    count(sector, sort = TRUE)
  # Prefer dirs that also dominate high cells
  if (nrow(hi_sec) > 0) {
    top_hi <- hi_sec$sector[hi_sec$n >= max(hi_sec$n[1] * 0.55, 1)]
    top_hi <- top_hi[seq_len(min(2, length(top_hi)))]
    # Intersect with mean-based primary when possible; else use high-cell dirs
    inter <- intersect(primary, top_hi)
    if (length(inter) > 0) {
      primary <- inter
    } else if (sec$mean_z[sec$sector == top_hi[1]][1] >= med_mean * 1.05) {
      primary <- top_hi
    }
  }

  dir_vs_calm <- best_mean / max(calm_mean, 1e-6)
  calm_vs_dir <- calm_mean / max(best_mean, 1e-6)
  peak_exceeds_calm <- dir_max_all >= calm_max * 1.02

  pattern <- "mixed"
  if (dir_vs_calm >= 1.05 && contrast >= 1.15 && (peak_exceeds_calm || dir_vs_calm >= 1.1)) {
    # Strong directional peak on the plot surface
    if (calm_vs_dir >= 0.85 && calm_mean >= mean(res$z) * 0.95) {
      pattern <- "mixed"
    } else {
      pattern <- "directional"
    }
  } else if (calm_vs_dir >= 1.12 && !peak_exceeds_calm) {
    pattern <- "calm-local"
  } else if (calm_vs_dir >= 1.05 && contrast < 1.2) {
    pattern <- "calm-local"
  } else if (contrast >= 1.2 && dir_vs_calm >= 0.95) {
    pattern <- "mixed"
  } else if (calm_mean >= dir_mean_all * 1.08) {
    pattern <- "calm-local"
  } else {
    pattern <- "mixed"
  }

  # Cleaner opposite dirs (for calm-local winter-style notes)
  clean_dirs <- sec %>%
    filter(mean_z <= med_mean * 0.9) %>%
    arrange(mean_z) %>%
    pull(sector)
  clean_dirs <- clean_dirs[seq_len(min(2, length(clean_dirs)))]

  notes <- sprintf(
    "calm_mean=%.2f calm_max=%.2f best=%s best_mean=%.2f dir_vs_calm=%.2f contrast=%.2f peak_gt_calm=%s",
    calm_mean, calm_max, paste(primary, collapse = "+"), best_mean,
    dir_vs_calm, contrast, peak_exceeds_calm
  )

  list(
    ok = TRUE,
    hours = n,
    pattern = pattern,
    calmLevel = round(calm_mean, 2),
    calmMax = round(calm_max, 2),
    directionalLevel = round(best_mean, 2),
    directionalMax = round(dir_max_all, 2),
    dirVsCalm = round(dir_vs_calm, 2),
    contrast = round(contrast, 2),
    primaryDirs = as.list(unname(primary)),
    cleanDirs = as.list(unname(clean_dirs)),
    notes = notes
  )
}

draft_season_text <- function(stats, pollutant_key, season_key) {
  if (is.null(stats) || !isTRUE(stats$ok)) return(NULL)

  pol <- pollutant_display(pollutant_key)
  dirs <- unlist(stats$primaryDirs)
  dir_phrase <- format_dirs(dirs)
  clean <- unlist(stats$cleanDirs)
  clean_phrase <- format_dirs(clean)
  pattern <- stats$pattern

  has_dir <- !is.null(dir_phrase) && nzchar(dir_phrase)
  strong_dir <- isTRUE(stats$dirVsCalm >= 1.08) || isTRUE(stats$directionalMax > stats$calmMax)

  if (pattern == "directional" && has_dir) {
    if (season_key == "summer") {
      base <- sprintf(
        "In summer, %s is highest with moderate-to-stronger winds from the %s, suggesting a contribution from that direction.",
        pol, dir_phrase
      )
      if (isTRUE(stats$calmLevel >= stats$directionalLevel * 0.8)) {
        return(paste(base, "Levels also stay elevated in calm air."))
      }
      return(base)
    }
    if (season_key == "winter") {
      return(sprintf(
        "Highest %s with winds from the %s at moderate-to-higher speeds, pointing to a contribution from that direction. Calm periods are less dominant than this directional signal.",
        pol, dir_phrase
      ))
    }
    return(sprintf(
      "Levels are highest with moderate-to-stronger winds from the %s, suggesting a contribution from that direction rather than build-up in still air alone.",
      dir_phrase
    ))
  }

  if (pattern == "mixed" && has_dir) {
    if (season_key == "summer") {
      if (strong_dir) {
        return(sprintf(
          "In summer the peak is less centred on calm air: levels are highest with moderate winds from the %s, suggesting a contribution arriving from that direction as well as local build-up in still conditions.",
          dir_phrase
        ))
      }
      return(sprintf(
        "In summer, %s stays elevated in calm air, with a clearer lift when winds are from the %s.",
        pol, dir_phrase
      ))
    }
    if (season_key == "winter") {
      return(sprintf(
        "Highest %s when the air is still — local sources building up in calm winter weather. Stronger winds from the %s also show elevated levels.",
        pol, dir_phrase
      ))
    }
    if (season_key == "spring") {
      return(sprintf(
        "Highest when the air is still, pointing to nearby sources. There is also a secondary signal from the %s at moderate wind speeds.",
        dir_phrase
      ))
    }
    # autumn
    return(sprintf(
      "Highest when the air is still, pointing to local sources. Stronger winds show a contribution from the %s.",
      dir_phrase
    ))
  }

  # calm-local
  if (season_key == "winter") {
    if (has_dir && isTRUE(stats$contrast >= 1.15)) {
      return(sprintf(
        "Highest %s when the air is still — local sources building up in calm winter weather. Light-to-moderate winds from the %s also show elevated levels.",
        pol, dir_phrase
      ))
    }
    if (!is.null(clean_phrase) && nzchar(clean_phrase)) {
      return(sprintf(
        "Highest %s when the air is still — local sources building up in calm winter weather. Stronger winds, especially from the %s, bring cleaner air.",
        pol, clean_phrase
      ))
    }
    return(sprintf(
      "Highest %s when the air is still — local sources building up in calm winter weather. Levels fall as wind speeds increase.",
      pol
    ))
  }
  if (season_key == "summer") {
    if (has_dir && isTRUE(stats$contrast >= 1.15)) {
      return(sprintf(
        "In summer, %s stays highest in calm air. Moderate winds show a clearer lift from the %s than from other directions.",
        pol, dir_phrase
      ))
    }
    return(sprintf(
      "In summer, %s stays highest in calm air. Directional differences are weaker once winds strengthen.",
      pol
    ))
  }
  if (season_key == "spring") {
    if (has_dir) {
      return(sprintf(
        "Highest when the air is still, pointing to nearby sources. A signal from the %s appears at stronger winds.",
        dir_phrase
      ))
    }
    return("Highest when the air is still, pointing to nearby sources. Levels fall as wind speeds increase.")
  }
  # autumn
  if (has_dir) {
    return(sprintf(
      "Highest when the air is still, pointing to local sources. Stronger winds show a contribution from the %s.",
      dir_phrase
    ))
  }
  return("Highest when the air is still, pointing to local sources building up in calm weather. Levels fall quickly as wind speeds increase.")
}

# --- main ---
options(warn = 1)
cat("=== seasonal surface-stats + blurb draft ===\n")

sitecodes <- character(0)
if (file.exists(MANIFEST_PATH)) {
  sitecodes <- toupper(unlist(fromJSON(MANIFEST_PATH)))
}
if (length(sitecodes) == 0 && file.exists(CSV_PATH)) {
  sensors <- utils::read.csv(CSV_PATH, stringsAsFactors = FALSE, quote = "\"", fill = TRUE)
  sitecodes <- unique(sensors$SiteCode)
  sitecodes <- sitecodes[!is.na(sitecodes) & nzchar(sitecodes) & grepl("^CLDP", sitecodes)]
  sitecodes <- unique(c(sitecodes, EXTRA_SITECODES))
}
if (nzchar(ONLY_SITE)) {
  wanted <- toupper(trimws(unlist(strsplit(ONLY_SITE, "[,\\s]+"))))
  sitecodes <- wanted[nzchar(wanted)]
}
sitecodes <- unique(sitecodes)
cat("Sites:", length(sitecodes), "\n")

cat("Loading MY1 wind 2024+2025...\n")
wind <- rbind(
  importAURN(site = "MY1", year = 2024),
  importAURN(site = "MY1", year = 2025)
)
wind$date_hour <- as.POSIXct(format(wind$date, "%Y-%m-%d %H:00:00"), tz = "UTC")
wind <- wind[, c("date_hour", "ws", "wd")]
cat("MY1 rows:", nrow(wind), "\n")

jobs <- list(
  list(key = "no2", species = "INO2", label = "no2"),
  list(key = "pm25", species = "IPM25", label = "pm25")
)

stats_root <- list()
blurbs_root <- list()
n_ok <- 0L
n_fail <- 0L

for (i in seq_along(sitecodes)) {
  sc <- sitecodes[i]
  cat(sprintf("[%d/%d] %s\n", i, length(sitecodes), sc))
  stats_root[[sc]] <- list()
  blurbs_root[[sc]] <- list()

  for (job in jobs) {
    bl <- tryCatch(fetch_bl(sc, job$species), error = function(e) data.frame())
    if (nrow(bl) == 0) {
      cat("  ", job$key, " no BL data\n", sep = "")
      next
    }
    combined <- merge(
      bl[, c("date_hour", "ScaledValue")],
      wind,
      by = "date_hour",
      all.x = TRUE
    )
    plot_data_all <- combined %>%
      transmute(
        date_hour = date_hour,
        date = date_hour,
        ws = as.numeric(ws),
        wd = as.numeric(wd),
        !!job$label := as.numeric(ScaledValue),
        month = as.integer(format(date_hour, "%m"))
      ) %>%
      filter(
        !is.na(.data[[job$label]]), !is.na(ws), !is.na(wd),
        is.finite(.data[[job$label]]), is.finite(ws), is.finite(wd),
        .data[[job$label]] > 0
      )

    stats_root[[sc]][[job$key]] <- list()
    blurbs_root[[sc]][[job$key]] <- list()

    for (season_key in names(SEASONS)) {
      season <- SEASONS[[season_key]]
      plot_data <- filter_season(plot_data_all, season) %>%
        select(date, ws, wd, all_of(job$label))
      res <- tryCatch(
        analyse_surface(plot_data, job$label),
        error = function(e) list(ok = FALSE, reason = conditionMessage(e))
      )
      stats_root[[sc]][[job$key]][[season_key]] <- res
      text <- draft_season_text(res, job$key, season_key)
      if (!is.null(text)) {
        blurbs_root[[sc]][[job$key]][[season_key]] <- text
        n_ok <- n_ok + 1L
        cat(sprintf(
          "  OK %s/%s pattern=%s dirs=%s\n",
          season_key, job$key,
          if (isTRUE(res$ok)) res$pattern else "?",
          paste(unlist(res$primaryDirs), collapse = ",")
        ))
      } else {
        n_fail <- n_fail + 1L
        cat(sprintf(
          "  FAIL %s/%s %s\n",
          season_key, job$key,
          if (!is.null(res$reason)) res$reason else "no text"
        ))
      }
    }
  }
}

write_json(
  stats_root,
  STATS_OUT,
  pretty = TRUE,
  auto_unbox = TRUE,
  null = "null"
)
cat("Wrote", STATS_OUT, " ok_blurbs=", n_ok, " fail=", n_fail, "\n", sep = "")

# Sanity check print
if (!is.null(blurbs_root[["CLDP0517"]][["pm25"]][["summer"]])) {
  cat(
    "SANITY CLDP0517 summer PM2.5:\n  ",
    blurbs_root[["CLDP0517"]][["pm25"]][["summer"]],
    "\n",
    sep = ""
  )
  s <- stats_root[["CLDP0517"]][["pm25"]][["summer"]]
  if (isTRUE(s$ok)) {
    cat(
      "  pattern=", s$pattern,
      " dirs=", paste(unlist(s$primaryDirs), collapse = ","),
      " calm=", s$calmLevel,
      " dirLevel=", s$directionalLevel,
      "\n",
      sep = ""
    )
  }
}

# Merge seasons into polar-readings JSON files (preserve paragraphs)
for (path in READINGS_PATHS) {
  if (!file.exists(path)) {
    cat("Skip missing readings:", path, "\n")
    next
  }
  readings <- fromJSON(path, simplifyVector = FALSE)
  updated <- 0L
  for (sc in names(blurbs_root)) {
    if (is.null(readings[[sc]])) next
    for (pol in names(blurbs_root[[sc]])) {
      if (is.null(readings[[sc]][[pol]])) next
      seasons_new <- blurbs_root[[sc]][[pol]]
      if (length(seasons_new) == 0) next
      readings[[sc]][[pol]]$seasons <- seasons_new
      updated <- updated + length(seasons_new)
    }
  }
  write_json(
    readings,
    path,
    pretty = TRUE,
    auto_unbox = TRUE,
    null = "null"
  )
  cat("Updated", path, " season entries written:", updated, "\n")
}

cat("=== done ===\n")
