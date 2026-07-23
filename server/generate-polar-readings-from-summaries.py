#!/usr/bin/env python3
"""
Generate annual plain-English paragraphs for polar-readings-2025.json
from community-polar-2025-summaries.json (output of summarise-community-polar-2025.R).

RECOVERED / RECONSTRUCTED (July 2026)
-------------------------------------
The original one-off Python that wrote public/polar-readings-2025.json was never
committed as a standalone file (it lived as ad-hoc shell snippets in the agent
session that produced the 2025 readings). This script reconstructs that final
wording from the shipped JSON + session history so future regenerations have a
repeatable path.

Templates (final production copy):
  para1 — calm / local peak near plot centre
  para2 — if sector_windy.contrast >= 1.7: clear peak direction
          else: weaker directional contrast (peak vs low sector)

Seasonal blurbs are NOT produced here. Use
  summarise-community-polar-2025-seasons.R → draft_season_text()
which merges into polar-readings-2025.json seasons keys only.

Usage (from repo root or server/):
  python3 server/generate-polar-readings-from-summaries.py
  python3 server/generate-polar-readings-from-summaries.py \\
    --summaries server/community-polar-2025-summaries.json \\
    --out public/polar-readings-2025.json

By default, existing seasons keys in --out are preserved when rewriting paragraphs.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_SUMMARIES = ROOT / "server" / "community-polar-2025-summaries.json"
DEFAULT_OUT = ROOT / "public" / "polar-readings-2025.json"

POL_LABEL = {"no2": "NO₂", "pm25": "PM₂.₅"}
CONTRAST_STRONG = 1.7


def paragraphs_for(pol_key: str, metrics: dict | None) -> list[str] | None:
    """Build annual paragraphs from one pollutant metrics block."""
    if not metrics or not metrics.get("ok"):
        return None

    pol_label = POL_LABEL[pol_key]
    sw = metrics.get("sector_windy") or {}
    peak = sw.get("peak_dir")
    low = sw.get("low_dir")
    contrast = sw.get("contrast")

    p1 = (
        f"The plot shows the highest concentrations near the centre. "
        f"That means this node records its highest {pol_label} when the air is still — "
        f"pointing to pollution sources near the sensor that build up when there is "
        f"little wind to disperse them."
    )

    if peak and contrast is not None:
        if contrast >= CONTRAST_STRONG:
            p2 = (
                f"When winds are stronger, levels are highest when the wind is from the {peak}. "
                f"This points to a contribution from that direction."
            )
        else:
            p2 = (
                f"When winds are stronger, any directional pattern is weaker: levels are only "
                f"a little higher with winds from the {peak} than from the {low}. "
                f"This points to a contribution from the {peak}."
            )
        return [p1, p2]

    return [p1]


def load_summaries(path: Path) -> dict[str, dict]:
    raw = json.loads(path.read_text(encoding="utf-8"))
    if isinstance(raw, list):
        return {d["sitecode"]: d for d in raw if isinstance(d, dict) and "sitecode" in d}
    if isinstance(raw, dict):
        # Already keyed by sitecode, or wrapped
        if all(isinstance(v, dict) and ("no2" in v or "pm25" in v or "sitecode" in v) for v in raw.values()):
            out = {}
            for k, v in raw.items():
                sc = v.get("sitecode", k) if isinstance(v, dict) else k
                out[str(sc).upper()] = v
            return out
    raise SystemExit(f"Unrecognised summaries shape in {path}")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--summaries", type=Path, default=DEFAULT_SUMMARIES)
    ap.add_argument("--out", type=Path, default=DEFAULT_OUT)
    ap.add_argument(
        "--replace-all",
        action="store_true",
        help="Overwrite the whole readings file (drops seasons for sites not in summaries).",
    )
    args = ap.parse_args()

    if not args.summaries.exists():
        raise SystemExit(
            f"Missing summaries JSON: {args.summaries}\n"
            "Run summarise-community-polar-2025.R first (full Bloomberg+allowlist batch)."
        )

    metrics_by_site = load_summaries(args.summaries)
    existing: dict = {}
    if args.out.exists() and not args.replace_all:
        existing = json.loads(args.out.read_text(encoding="utf-8"))

    readings = {} if args.replace_all else dict(existing)

    n_sites = 0
    for sc, block in sorted(metrics_by_site.items()):
        sc = str(sc).upper()
        entry = readings.get(sc, {})
        for pol in ("no2", "pm25"):
            paras = paragraphs_for(pol, block.get(pol))
            if not paras:
                continue
            pol_entry = entry.get(pol) or {}
            seasons = pol_entry.get("seasons")
            pol_entry = {"paragraphs": paras}
            if seasons and not args.replace_all:
                pol_entry["seasons"] = seasons
            elif seasons and args.replace_all:
                # keep seasons only if caller used replace-all but seasons existed on this site
                pol_entry["seasons"] = seasons
            entry[pol] = pol_entry
        if entry:
            readings[sc] = entry
            n_sites += 1

    ordered = {k: readings[k] for k in sorted(readings)}
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(
        json.dumps(ordered, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    print(f"Wrote {args.out} ({len(ordered)} sites; updated paragraphs for {n_sites} from summaries)")


if __name__ == "__main__":
    main()
