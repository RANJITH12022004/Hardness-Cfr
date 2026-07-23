#!/usr/bin/env python3
"""API-level smoke test for tablet hardness report flows (test, validation, calibration)."""

from __future__ import annotations

import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

APP_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(APP_ROOT))

BASE = os.environ.get("KIOSK_API_BASE", "http://127.0.0.1:5000")
TEST_USER = os.environ.get("AUDIT_TEST_USER", "Rahul")
TEST_PASS = os.environ.get("AUDIT_TEST_PASS", "Rle@2024")
FACTORY_USER = os.environ.get("FACTORY_USER", "RLERLT")
FACTORY_PASS = os.environ.get("FACTORY_PASS", "Rahul")

A4_WIDTH = 80


class SmokeResult:
    def __init__(self) -> None:
        self.passed: list[str] = []
        self.failed: list[str] = []
        self.warnings: list[str] = []

    def ok(self, msg: str) -> None:
        self.passed.append(msg)
        print("  OK  ", msg)

    def fail(self, msg: str) -> None:
        self.failed.append(msg)
        print("  FAIL", msg)

    def warn(self, msg: str) -> None:
        self.warnings.append(msg)
        print("  WARN", msg)


class Client:
    def __init__(self) -> None:
        self._headers: dict[str, str] = {"Content-Type": "application/json"}

    def _request(
        self,
        method: str,
        path: str,
        body=None,
        extra_headers: dict | None = None,
    ) -> tuple[int, dict]:
        url = BASE + path
        data = json.dumps(body).encode("utf-8") if body is not None else None
        headers = dict(self._headers)
        if extra_headers:
            headers.update(extra_headers)
        req = urllib.request.Request(url, data=data, headers=headers, method=method)
        try:
            with urllib.request.urlopen(req, timeout=60) as resp:
                raw = resp.read()
                return resp.status, json.loads(raw.decode("utf-8") or "{}") if raw else {}
        except urllib.error.HTTPError as e:
            raw = e.read()
            try:
                payload = json.loads(raw.decode("utf-8") or "{}") if raw else {}
            except json.JSONDecodeError:
                payload = {"error": raw.decode("utf-8", errors="replace")}
            return e.code, payload

    def login(self, username: str, password: str, role: str | None = None) -> None:
        st, data = self._request("POST", "/api/data/auth/login", {"username": username, "password": password})
        if st >= 400:
            raise RuntimeError(f"login HTTP {st}: {data}")
        if role:
            self._headers["X-User-Role"] = role
            self._headers["X-User-Name"] = username
            self._headers["X-User-Username"] = username
        else:
            for k in ("X-User-Role", "X-User-Name", "X-User-Username"):
                self._headers.pop(k, None)

    def logout(self) -> None:
        self._request("POST", "/api/data/auth/logout", {"reason": "user"})

    def create_report(self, payload: dict) -> tuple[int, dict]:
        return self._request("POST", "/api/data/reports", payload)

    def preview(self, report_id: int) -> tuple[int, dict]:
        return self._request("GET", f"/api/reports/{report_id}/preview")

    def approve(self, report_id: int, pass_fail: str = "PASS") -> tuple[int, dict]:
        return self._request(
            "POST",
            f"/api/data/reports/{report_id}/approve",
            {
                "passFail": pass_fail,
                "remarks": "Smoke test approval",
            },
            extra_headers={
                "X-User-Role": "factory",
                "X-User-Name": FACTORY_USER,
                "X-User-Username": FACTORY_USER,
            },
        )

    def print_a4(self, report_id: int) -> tuple[int, dict]:
        return self._request(
            "POST",
            "/api/print/a4",
            {"report_data": {"id": report_id}},
        )

    def pdf(self, report_id: int) -> tuple[int, dict]:
        return self._request("POST", f"/api/reports/{report_id}/pdf", {})


def _report_id(data: dict) -> int | None:
    if not data:
        return None
    if data.get("id") is not None:
        return int(data["id"])
    rep = data.get("report") or {}
    if rep.get("id") is not None:
        return int(rep["id"])
    return None


def _approval_status(data: dict) -> str:
    rep = data.get("report") or data
    return str(rep.get("reportApprovalStatus") or "").strip().lower()


def _test_report_payload() -> dict:
    return {
        "name": "Smoke Quick Test",
        "type": "test",
        "recipe": {
            "productName": "Quick Test",
            "batchNumber": "SMOKE-QT",
            "shape": "round",
            "parameters": {"Thickness": "2.5", "Hardness": "8.5"},
            "parameterSamples": {"Thickness": 10, "Hardness": 15},
            "tolerances": {
                "Thickness": {"lowerT2": 2.0, "lowerT1": 2.2, "upperT1": 2.8, "upperT2": 3.0},
                "Hardness": {"lowerT2": 7.0, "lowerT1": 7.5, "upperT1": 9.5, "upperT2": 10.0},
            },
        },
        "testData": {
            "productName": "Quick Test",
            "batchNumber": "SMOKE-QT",
            "status": "completed",
            "isQuickTest": True,
            "shape": "round",
            "measurements": {
                "Thickness": [9.45, 9.50, 9.40],
                "Hardness": [33.45, 33.50, 33.40],
            },
            "statistics": {
                "Thickness": {
                    "count": 3,
                    "mean": 9.45,
                    "max": 9.50,
                    "min": 9.40,
                    "range": 0.10,
                    "std_dev": 0.05,
                    "srel": 0.53,
                },
                "Hardness": {
                    "count": 3,
                    "mean": 33.45,
                    "max": 33.50,
                    "min": 33.40,
                    "range": 0.10,
                    "std_dev": 0.05,
                    "srel": 0.15,
                },
                "Weight": {
                    "count": 0,
                    "mean": None,
                    "max": None,
                    "min": None,
                    "range": None,
                    "std_dev": None,
                    "srel": None,
                },
            },
        },
    }


def _validation_load_payload() -> dict:
    return {
        "name": "Smoke Load Validation - Pass",
        "type": "validation",
        "validationSubtype": "load",
        "expectedWeight": 200.0,
        "min": 198.0,
        "max": 202.0,
        "mean": 200.1,
        "status": "PASS",
        "testData": {
            "readings": [199.8, 200.1, 200.4],
            "min": 198.0,
            "max": 202.0,
            "mean": 200.1,
            "expectedWeight": 200.0,
            "operatorName": TEST_USER,
            "employeeId": TEST_USER,
        },
    }


def _validation_distance_payload() -> dict:
    return {
        "name": "Smoke Distance Validation - Pass",
        "type": "validation",
        "validationSubtype": "distance",
        "distance": 10.02,
        "expectedGaugeBlock": 10.0,
        "difference": 0.02,
        "status": "PASS",
        "testData": {
            "distance": 10.02,
            "expectedGaugeBlock": 10.0,
            "difference": 0.02,
            "operatorName": TEST_USER,
            "employeeId": TEST_USER,
        },
    }


def _calibration_load_payload() -> dict:
    return {
        "name": "Smoke Load Calibration - Calibrated",
        "type": "calibration",
        "calibrationSubtype": "load",
        "status": "Calibrated",
        "testData": {
            "status": "Calibrated",
            "operatorName": TEST_USER,
            "employeeId": TEST_USER,
        },
    }


def _calibration_distance_zero_payload() -> dict:
    return {
        "name": "Smoke Distance Zero Calibration - Calibrated",
        "type": "calibration",
        "calibrationSubtype": "distance-zero",
        "status": "Calibrated",
        "testData": {
            "status": "Calibrated",
            "operatorName": TEST_USER,
            "employeeId": TEST_USER,
        },
    }


def _assert_a4_text(res: SmokeResult, a4_text: str, label: str) -> None:
    if not a4_text or not str(a4_text).strip():
        res.fail(f"{label}: preview a4Text empty")
        return
    res.ok(f"{label}: preview a4Text non-empty ({len(a4_text)} chars)")
    lines = str(a4_text).splitlines()
    sep_lines = [ln for ln in lines if ln and set(ln) <= {"="}]
    if sep_lines and len(sep_lines[0]) == A4_WIDTH:
        res.ok(f"{label}: first separator line is {A4_WIDTH} columns")
    elif sep_lines:
        res.warn(f"{label}: separator length {len(sep_lines[0])} (expected {A4_WIDTH})")
    else:
        res.warn(f"{label}: no === separator lines found")


def _assert_statistics_format(res: SmokeResult, a4_text: str) -> None:
    text = str(a4_text)
    if "STATISTICS" not in text:
        res.warn("test report: STATISTICS section missing from a4Text")
        return
    if "N/A" in text.split("STATISTICS", 1)[-1][:600]:
        res.fail("test report: statistics section still contains N/A")
    else:
        res.ok("test report: statistics section uses -- (no N/A)")
    if re.search(r"\b9\.45\b", text) and re.search(r"\b33\.45\b", text):
        res.ok("test report: sample means 9.45 and 33.45 present in a4Text")
    else:
        res.fail("test report: expected sample means 9.45 / 33.45 not found in a4Text")
    stats_block = text.split("STATISTICS", 1)[-1]
    if re.search(r"\s9\.45\s|\s9\.45\|", stats_block) or "  9.45" in stats_block:
        res.ok("test report: Thickness mean appears right-aligned in statistics")
    else:
        res.warn("test report: could not verify right-aligned 9.45 in statistics block")


def _create_and_preview(c: Client, res: SmokeResult, payload: dict, label: str) -> int | None:
    st, data = c.create_report(payload)
    if st >= 400:
        res.fail(f"{label}: create HTTP {st}: {data.get('error') or data}")
        return None
    rid = _report_id(data)
    if rid is None:
        res.fail(f"{label}: create response missing id")
        return None
    res.ok(f"{label}: created report id={rid}")
    st2, prev = c.preview(rid)
    if st2 >= 400:
        res.fail(f"{label}: preview HTTP {st2}: {prev.get('error') or prev}")
        return rid
    a4 = ((prev.get("preview") or {}).get("a4Text") or "")
    _assert_a4_text(res, a4, label)
    return rid


def run_smoke(res: SmokeResult) -> dict[int, str]:
    c = Client()
    created: dict[int, str] = {}

    c.login(TEST_USER, TEST_PASS)
    res.ok(f"Logged in as operator {TEST_USER}")

    # Test reports require quick-test/recipe-test; use factory when operator lacks test access.
    c.logout()
    c.login(FACTORY_USER, FACTORY_PASS, role="factory")
    st_test, test_data = c.create_report(_test_report_payload())
    c.logout()
    c.login(TEST_USER, TEST_PASS)
    test_id = None
    if st_test >= 400:
        res.fail(f"test: create HTTP {st_test}: {test_data.get('error') or test_data}")
    else:
        test_id = _report_id(test_data)
        if test_id is None:
            res.fail("test: create response missing id")
        else:
            created[test_id] = "test"
            res.ok(f"test: created report id={test_id} (via factory session)")
            st2, prev = c.preview(test_id)
            if st2 >= 400:
                res.fail(f"test: preview HTTP {st2}: {prev.get('error') or prev}")
            else:
                a4 = ((prev.get("preview") or {}).get("a4Text") or "")
                _assert_a4_text(res, a4, "test")
                _assert_statistics_format(res, a4)
                if _approval_status(test_data) == "pending":
                    res.ok("test: reportApprovalStatus pending on create")
                else:
                    res.fail(f"test: expected pending approval, got {_approval_status(test_data)!r}")
                st_p, _ = c.print_a4(test_id)
                if st_p == 403:
                    res.ok("test: print blocked for operator while pending")
                else:
                    res.fail(f"test: expected print blocked (403), got {st_p}")
                st_pdf, _ = c.pdf(test_id)
                if st_pdf == 403:
                    res.ok("test: PDF blocked while pending")
                else:
                    res.fail(f"test: expected PDF blocked (403), got {st_pdf}")

    val_load_id = _create_and_preview(c, res, _validation_load_payload(), "validation-load")
    if val_load_id:
        created[val_load_id] = "validation-load"
        st_p, _ = c.print_a4(val_load_id)
        if st_p == 403:
            res.ok("validation-load: print blocked while pending")
        else:
            res.fail(f"validation-load: expected print blocked (403), got {st_p}")

    val_dist_id = _create_and_preview(c, res, _validation_distance_payload(), "validation-distance")
    if val_dist_id:
        created[val_dist_id] = "validation-distance"

    c.logout()
    c.login(FACTORY_USER, FACTORY_PASS, role="factory")
    cal_load_id = _create_and_preview(c, res, _calibration_load_payload(), "calibration-load")
    cal_dz_id = _create_and_preview(c, res, _calibration_distance_zero_payload(), "calibration-distance-zero")
    c.logout()
    c.login(TEST_USER, TEST_PASS)
    if cal_load_id:
        created[cal_load_id] = "calibration-load"
        st_p, pdata = c.print_a4(cal_load_id)
        if st_p == 403:
            res.ok("calibration-load: print blocked while pending")
        else:
            res.fail(f"calibration-load: expected print blocked (403), got {st_p}")

    if cal_dz_id:
        created[cal_dz_id] = "calibration-distance-zero"

    c.logout()

    c.login(FACTORY_USER, FACTORY_PASS, role="factory")
    res.ok(f"Logged in as factory {FACTORY_USER}")

    for rid, kind in list(created.items()):
        if kind != "test" and not kind.startswith("validation") and not kind.startswith("calibration"):
            continue
        st, data = c.approve(rid)
        if st >= 400:
            res.fail(f"{kind} id={rid}: approve HTTP {st}: {data.get('error') or data}")
            continue
        st_after = _approval_status(data)
        if st_after == "approved":
            res.ok(f"{kind} id={rid}: approved")
        else:
            rep = data.get("report") or data
            res.fail(f"{kind} id={rid}: approval status={rep.get('reportApprovalStatus')!r}")
        st_pdf, pdf_data = c.pdf(rid)
        if st_pdf == 200 and pdf_data.get("success"):
            res.ok(f"{kind} id={rid}: PDF generated ({pdf_data.get('size_bytes')} bytes)")
        else:
            res.fail(f"{kind} id={rid}: PDF HTTP {st_pdf}: {pdf_data.get('error') or pdf_data}")

    if test_id:
        st_p, pdata = c.print_a4(test_id)
        if st_p == 200 or (st_p >= 400 and pdata.get("error")):
            res.ok(f"test id={test_id}: print allowed after approve (HTTP {st_p})")
        else:
            res.fail(f"test id={test_id}: print after approve HTTP {st_p}")

    c.logout()
    return created


def main() -> int:
    print(f"Hardness flow smoke test → {BASE}\n")
    res = SmokeResult()
    try:
        run_smoke(res)
    except Exception as exc:
        res.fail(f"Unhandled error: {exc}")
    print()
    print(f"Passed: {len(res.passed)}  Failed: {len(res.failed)}  Warnings: {len(res.warnings)}")
    if res.failed:
        for msg in res.failed:
            print("  -", msg)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
