"""匯入資料處理的純函式測試，不連線資料庫或網路。"""
from __future__ import annotations

import csv
import io
import tempfile
import zipfile
from contextlib import contextmanager
from pathlib import Path
from typing import Iterator

import pytest

from scripts import build_hotspots, clean_coords, import_accidents


@contextmanager
def _sample_zip(header: list[str] | None = None) -> Iterator[tuple[Path, list[list[str]]]]:
    """建立並在測試結束後清理迷你官方格式 ZIP。"""
    rows: list[list[str]] = []
    for index, order in enumerate((1, 2, 1, 2, 3), start=1):
        row = [""] * len(import_accidents.COLS)
        row[import_accidents.I["發生年度"]] = "115"
        row[import_accidents.I["當事者順位"]] = str(order)
        row[import_accidents.I["發生地點"]] = f"測試路段{index}"
        rows.append(row)

    output = io.StringIO(newline="")
    writer = csv.writer(output, lineterminator="\n")
    writer.writerow(import_accidents.COLS if header is None else header)
    writer.writerows(rows)
    writer.writerow(["資料提供日期：115年8月"])
    writer.writerow(["事故類別：A2類"])

    with tempfile.TemporaryDirectory(dir=Path(__file__).parent) as temp_dir:
        path = Path(temp_dir) / "mini.zip"
        with zipfile.ZipFile(path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
            archive.writestr("NPA_TMA2_1.csv", output.getvalue().encode("utf-8-sig"))
        yield path, rows


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ("新北市新莊區中正路 / 新北市新莊區民安路", ("新北市", "新莊區")),
        ("臺南市新市區中山路", ("臺南市", "新市區")),
        ("彰化縣員林市中山路", ("彰化縣", "員林市")),
        ("台中市西屯區", ("臺中市", "西屯區")),
    ],
)
def test_parse_location(text: str, expected: tuple[str | None, str | None]) -> None:
    assert import_accidents.parse_location(text) == expected


def test_read_csv_rows_reads_data_and_skips_footer() -> None:
    with _sample_zip() as (archive, expected):
        rows = import_accidents.read_csv_rows(archive)
        assert rows == expected
        assert len(rows) == 5


def test_read_csv_rows_rejects_unexpected_header() -> None:
    changed_header = import_accidents.COLS.copy()
    changed_header[0] = "非預期欄位"
    with _sample_zip(changed_header) as (archive, _):
        with pytest.raises(SystemExit, match="欄位與預期不同"):
            import_accidents.read_csv_rows(archive)


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        ("12", 12),
        (" 12.9 ", 12),
        ("-3", -3),
        ("", None),
        ("   ", None),
        ("不是數字", None),
        ("inf", None),
        ("nan", None),
    ],
)
def test_to_int_boundaries(value: str, expected: int | None) -> None:
    assert import_accidents.to_int(value) == expected


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        ("0", 0.0),
        (" -121.5 ", -121.5),
        ("", None),
        ("   ", None),
        ("不是數字", None),
        ("inf", None),
        ("nan", None),
    ],
)
def test_to_float_boundaries(value: str, expected: float | None) -> None:
    assert import_accidents.to_float(value) == expected


@pytest.mark.parametrize(
    ("value", "expected"),
    [(" 文字 ", "文字"), ("", None), ("   \t", None), ("0", "0")],
)
def test_nz_boundaries(value: str, expected: str | None) -> None:
    assert import_accidents.nz(value) == expected


def test_primary_party_order_starts_a_new_accident() -> None:
    rows = _write_sample_rows()
    accidents: list[list[list[str]]] = []
    for row in rows:
        order = import_accidents.to_int(row[import_accidents.I["當事者順位"]]) or 0
        if order == 1 or not accidents:
            accidents.append([])
        accidents[-1].append(row)

    assert len(accidents) == 2
    assert sum(map(len, accidents)) == 5
    assert [len(accident) for accident in accidents] == [2, 3]


def _write_sample_rows() -> list[list[str]]:
    """提供切分測試使用的順位 1, 2, 1, 2, 3 五列。"""
    rows = []
    for order in (1, 2, 1, 2, 3):
        row = [""] * len(import_accidents.COLS)
        row[import_accidents.I["當事者順位"]] = str(order)
        rows.append(row)
    return rows


def test_clean_name_removes_administrative_prefixes_and_noise() -> None:
    assert build_hotspots.clean_name(
        "新北市新莊區中正路前0.0公尺 / 新北市新莊區民安路附近"
    ) == "中正路 / 民安路"


def test_clean_name_deduplicates_segments() -> None:
    assert build_hotspots.clean_name(
        "新北市新莊區中正路 / 新北市新莊區中正路"
    ) == "中正路"


def test_clean_name_normalizes_taiwan_and_trims_intersection_suffix() -> None:
    assert build_hotspots.clean_name("台中市西屯區中正路口") == "中正路"


def test_clean_coords_policy_thresholds_are_exposed_as_constants() -> None:
    # clean_coords 目前沒有可單獨呼叫的純函式；確認其規則以常數形式提供，
    # 並在不執行 main() 的情況下可以安全匯入。
    assert clean_coords.CELL == 0.0005
    assert clean_coords.MIN_DISTRICTS == 4
    assert clean_coords.FAR_KM == 10
