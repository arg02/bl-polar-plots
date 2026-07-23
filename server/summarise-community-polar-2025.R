# Quantify 2025 polar-plot patterns for Bloomberg community sensors.
# Uses the same BL pollution + MY1 wind merge as generate-community-polar-2025.R.
# Writes community-polar-2025-summaries.json for the HTML review page.
library(openair)
library(httr)
library(jsonlite)
library(dplyr)

BL_API_BASE <- "https://api.breathelondon-communities.org/api"
BL_API_KEY <- "e2635276-e87a-11eb-9a03-0242ac130003"
YEAR <- 2025
CSV_PATH <- "community-sensors-bloomberg-active.csv"
OUT_JSON <- "community-polar-2025-summaries.json"
MIN_HOURS <- 100
FETCH_TIMEOUT_SEC <- 120
EXTRA_SITECODES <- c("CLDP0517", "CLDP0451", "CLDP0308")
ONLY_SITE <- Sys.getenv("ONLY_SITE", unset = "")

dir_label <- function(wd_deg) {
  # Meteorological wind direction: where the wind comes FROM
  labs <- c("north", "north-east", "east", "south-east",
            "south", "south-west", "west", "north-west")
  idx <- floor(((wd_deg %% 360) + 22.5) / 45) %% 8 + 1
  labs[idx]
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

analyse_pollutant <- function(sitecode, species, pollutant_label, wind) {
  bl <- fetch_bl(sitecode, species)
  if (nrow(bl) == 0) {
    return(list(ok = FALSE, reason = "no BL records"))
  }
  combined <- merge(
    bl[, c("date_hour", "ScaledValue")],
    wind,
    by = "date_hour",
    all.x = TRUE
  )
  d <- combined %>%
    transmute(
      ws = as.numeric(ws),
      wd = as.numeric(wd),
      value = as.numeric(ScaledValue)
    ) %>%
    filter(!is.na(value), !is.na(ws), !is.na(wd), is.finite(value), is.finite(ws), is.finite(wd), value > 0)

  n <- nrow(d)
  if (n < MIN_HOURS) {
    return(list(ok = FALSE, reason = sprintf("insufficient hours (%d)", n), hours = n))
  }

  overall <- mean(d$value)
  calm <- d %>% filter(ws < 2)
  breezy <- d %>% filter(ws >= 2 & ws < 4)
  windy <- d %>% filter(ws >= 4)

  calm_mean <- if (nrow(calm) >= 20) mean(calm$value) else NA_real_
  breezy_mean <- if (nrow(breezy) >= 20) mean(breezy$value) else NA_real_
  windy_mean <- if (nrow(windy) >= 20) mean(windy$value) else NA_real_

  # Sector means at higher winds (transport signal)
  sector_windy <- NULL
  if (nrow(windy) >= 40) {
    tmp <- windy %>%
      mutate(sector = dir_label(wd)) %>%
      group_by(sector) %>%
      summarise(mean_val = mean(value), n = n(), .groups = "drop") %>%
      filter(n >= 10)
    if (nrow(tmp) > 0) {
      best <- tmp[which.max(tmp$mean_val), ]
      worst <- tmp[which.min(tmp$mean_val), ]
      sector_windy <- list(
        peak_dir = best$sector,
        peak_mean = round(best$mean_val, 2),
        peak_n = best$n,
        low_dir = worst$sector,
        low_mean = round(worst$mean_val, 2),
        contrast = round(best$mean_val / max(worst$mean_val, 1e-6), 2)
      )
    }
  }

  # Sector means when calm (local)
  sector_calm <- NULL
  if (nrow(calm) >= 40) {
    tmp <- calm %>%
      mutate(sector = dir_label(wd)) %>%
      group_by(sector) %>%
      summarise(mean_val = mean(value), n = n(), .groups = "drop") %>%
      filter(n >= 8)
    if (nrow(tmp) > 0) {
      best <- tmp[which.max(tmp$mean_val), ]
      sector_calm <- list(
        peak_dir = best$sector,
        peak_mean = round(best$mean_val, 2),
        peak_n = best$n
      )
    }
  }

  calm_ratio <- if (!is.na(calm_mean) && !is.na(windy_mean) && windy_mean > 0) {
    round(calm_mean / windy_mean, 2)
  } else {
    NA_real_
  }

  # Pattern classification
  pattern <- "mixed"
  if (!is.na(calm_ratio) && calm_ratio >= 1.15) {
    pattern <- "local_calm"
  } else if (!is.na(calm_ratio) && calm_ratio <= 0.9 && !is.null(sector_windy) && sector_windy$contrast >= 1.15) {
    pattern <- "distant_directional"
  } else if (!is.null(sector_windy) && sector_windy$contrast >= 1.2) {
    pattern <- "directional"
  } else if (!is.na(calm_ratio) && calm_ratio >= 1.05) {
    pattern <- "local_leaning"
  } else {
    pattern <- "diffuse"
  }

  list(
    ok = TRUE,
    hours = n,
    overall_mean = round(overall, 2),
    calm_mean = if (is.na(calm_mean)) NULL else round(calm_mean, 2),
    breezy_mean = if (is.na(breezy_mean)) NULL else round(breezy_mean, 2),
    windy_mean = if (is.na(windy_mean)) NULL else round(windy_mean, 2),
    calm_n = nrow(calm),
    windy_n = nrow(windy),
    calm_to_windy_ratio = calm_ratio,
    sector_windy = sector_windy,
    sector_calm = sector_calm,
    pattern = pattern
  )
}

cat("Loading sensors + MY1 wind...\n")
sensors <- utils::read.csv(CSV_PATH, stringsAsFactors = FALSE, quote = "\"", fill = TRUE)
sitecodes <- unique(sensors$SiteCode)
sitecodes <- sitecodes[!is.na(sitecodes) & nzchar(sitecodes) & grepl("^CLDP", sitecodes)]
sitecodes <- unique(c(sitecodes, EXTRA_SITECODES))
if (nzchar(ONLY_SITE)) {
  wanted <- toupper(trimws(unlist(strsplit(ONLY_SITE, "[,\\s]+"))))
  sitecodes <- wanted[nzchar(wanted)]
}

wind <- importAURN(site = "MY1", year = YEAR)
wind$date_hour <- as.POSIXct(format(wind$date, "%Y-%m-%d %H:00:00"), tz = "UTC")
wind <- wind[, c("date_hour", "date", "ws", "wd")]
cat("MY1 rows:", nrow(wind), " sensors:", length(sitecodes), "\n")

jobs <- list(
  list(key = "no2", species = "INO2", label = "no2"),
  list(key = "pm25", species = "IPM25", label = "pm25")
)

out <- list()
i <- 0L
for (sc in sitecodes) {
  i <- i + 1L
  cat(sprintf("[%d/%d] %s\n", i, length(sitecodes), sc))
  entry <- list(sitecode = sc, no2 = NULL, pm25 = NULL)
  for (job in jobs) {
    res <- tryCatch(
      analyse_pollutant(sc, job$species, job$label, wind),
      error = function(e) list(ok = FALSE, reason = conditionMessage(e))
    )
    entry[[job$key]] <- res
  }
  out[[length(out) + 1]] <- entry
}

write_json(out, OUT_JSON, pretty = TRUE, auto_unbox = TRUE, null = "null")
cat("Wrote ", OUT_JSON, "\n", sep = "")
