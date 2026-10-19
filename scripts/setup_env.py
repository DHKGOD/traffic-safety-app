"""若 .env 不存在，從 .env.example 產生，並填入隨機密碼。已存在則不動。"""
from __future__ import annotations

import secrets
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def main() -> int:
    env_file = ROOT / ".env"
    if env_file.exists():
        print(".env 已存在，不覆寫。")
        return 0
    text = (ROOT / ".env.example").read_text(encoding="utf-8")
    su_pw = secrets.token_urlsafe(18)
    app_pw = secrets.token_urlsafe(18)
    text = (text.replace("change-me-superuser", su_pw)
                .replace("change-me-app", app_pw))
    env_file.write_text(text, encoding="utf-8")
    print("已建立 .env（含隨機密碼，不會進 Git）。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
