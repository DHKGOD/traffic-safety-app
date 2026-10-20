"""Windows 本機 API 使用的事件迴圈；不變更作業系統或其他程式的設定。"""
from __future__ import annotations

import asyncio


def windows_selector_loop() -> asyncio.AbstractEventLoop:
    """避開 Python 3.11 Proactor 在 accept 遇 WinError 64 後關閉監聽 socket。"""
    return asyncio.SelectorEventLoop()
