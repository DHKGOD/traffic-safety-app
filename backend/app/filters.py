"""晴天／雨天、時段模式的共用篩選條件。"""
from __future__ import annotations

from enum import Enum


class Weather(str, Enum):
    all = "all"
    clear = "clear"   # 晴、陰
    rain = "rain"     # 雨


class Period(str, Enum):
    all = "all"
    morning = "morning"   # 06–09 上學上班
    day = "day"           # 10–15
    evening = "evening"   # 16–19 放學下班
    night = "night"       # 20–05


PERIOD_HOURS = {
    Period.morning: (6, 9),
    Period.day: (10, 15),
    Period.evening: (16, 19),
}

PERIOD_LABEL = {Period.all: "全天", Period.morning: "早上 6–9 點", Period.day: "白天 10–15 點",
                Period.evening: "傍晚 16–19 點", Period.night: "夜間 20–5 點"}
WEATHER_LABEL = {Weather.all: "全部天候", Weather.clear: "晴／陰天", Weather.rain: "雨天"}


def accident_filter_sql(weather: Weather, period: Period, alias: str = "a") -> str:
    """回傳附加在 WHERE 後面的條件（以 AND 開頭；無條件時回傳空字串）。只用常數，沒有使用者輸入。"""
    parts: list[str] = []
    if weather == Weather.clear:
        parts.append(f"{alias}.weather IN ('晴', '陰')")
    elif weather == Weather.rain:
        parts.append(f"{alias}.weather = '雨'")
    if period == Period.night:
        parts.append(f"({alias}.hour >= 20 OR {alias}.hour < 6)")
    elif period in PERIOD_HOURS:
        lo, hi = PERIOD_HOURS[period]
        parts.append(f"{alias}.hour BETWEEN {lo} AND {hi}")
    return "".join(f" AND {p}" for p in parts)
