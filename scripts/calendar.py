import argparse
import json
import os
import re
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
LEVELS = ("NONE", "FIRST_QUARTILE", "SECOND_QUARTILE", "THIRD_QUARTILE", "FOURTH_QUARTILE")
QUERY = """
query Calendar($owner: String!) {
  user(login: $owner) {
    contributionsCollection {
      contributionCalendar {
        weeks { contributionDays { weekday contributionCount contributionLevel } }
      }
    }
  }
}
"""


def calendar_rows(weeks):
    weeks = weeks[-53:]
    return [
        [col, day["weekday"], day["contributionCount"], LEVELS.index(day["contributionLevel"])]
        for col, week in enumerate(weeks, start=53 - len(weeks))
        for day in week["contributionDays"]
        if day["contributionCount"] > 0
    ]


def fetch_calendar(owner, token):
    request = urllib.request.Request(
        "https://api.github.com/graphql",
        data=json.dumps({"query": QUERY, "variables": {"owner": owner}}).encode(),
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json",
                 "User-Agent": "havi-contribution-grid"},
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        result = json.load(response)
    if result.get("errors") or not (result.get("data") or {}).get("user"):
        raise SystemExit("GitHub did not return a calendar. Check the owner and token access.")
    return calendar_rows(result["data"]["user"]["contributionsCollection"]["contributionCalendar"]["weeks"])


def build(source, rows):
    if rows is None:
        return source
    updated, count = re.subn(
        r"const sourceDays = \[[\s\S]*?\];",
        lambda _: "const sourceDays = " + json.dumps(rows, separators=(",", ":")) + ";",
        source,
        count=1,
    )
    if count != 1:
        raise ValueError("The animation is missing its calendar declaration.")
    return updated


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--sample", action="store_true")
    args = parser.parse_args()
    rows = None if args.sample else fetch_calendar(os.environ["GITHUB_OWNER"], os.environ["GITHUB_TOKEN"])
    site = ROOT / "build" / "site"
    site.mkdir(parents=True, exist_ok=True)
    template = (ROOT / "grid" / "index.html").read_text(encoding="utf-8")
    (site / "index.html").write_text(build(template, rows), encoding="utf-8")


if __name__ == "__main__":
    main()
