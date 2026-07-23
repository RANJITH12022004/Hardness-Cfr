#!/usr/bin/env python3
"""
Smoke: factory settings survive power-cut / restart, plus auto-logout,
password-reset cycle policy, and biometric login (mock).

Simulates:
  1) Save distinctive factory settings (incl. autoLogoutMinutes, passwordResetPeriodDays, maxQa)
  2) Clean service restart  -> settings still present, session cleared (login required)
  3) Unclean kill (no clean-stop flag) -> settings still present, session cleared
  4) Password-reset cycle computation from installationDate + period
  5) Biometric login via BIOMETRIC_MOCK after restart
"""

from __future__ import annotations

import json
import os
import signal
import subprocess
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timedelta
from pathlib import Path

APP_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(APP_ROOT))

BASE = os.environ.get("KIOSK_API_BASE", "http://127.0.0.1:5000").rstrip("/")
FACTORY_USER = os.environ.get("FACTORY_USER", "RLERLT")
FACTORY_PASS = os.environ.get("FACTORY_PASS", "Rahul")
TEST_USER = os.environ.get("AUDIT_TEST_USER", "Rahul")
TEST_PASS = os.environ.get("AUDIT_TEST_PASS", "Rle@2024")
STORAGE = Path(os.environ.get("STORAGE_DIR", "/media/usb_internal/storage"))
MIRROR = Path(os.environ.get("APP_ROOT", "/opt/kiosk")) / "storage" / "factorySettings.json"
SERVICE = os.environ.get("KIOSK_BRIDGE_SERVICE", "kiosk-bridge.service")
MOCK_DROPIN = Path("/etc/systemd/system/kiosk-bridge.service.d/biometric-mock-smoke.conf")

MARKER = {
    "companyName": "SMOKE_PWR_CO",
    "companyLocation": "SMOKE_CITY",
    "serialNo": "SMOKE-SN-77",
    "modelNo": "THT-SMOKE",
    "instrumentId": "INST-SMOKE",
    "installationDate": "2026-01-01",
    "firmware": "RD-THT v1.0.0",
    "installedBy": "smoke",
    "loadCellRange": 500,
    "maxRecipes": 150,
    "maxUsers": 11,
    "maxAdmins": 2,
    "maxSupervisors": 3,
    "maxQa": 6,
    "passwordResetPeriodDays": 30,
    "autoLogoutMinutes": 7,
    "biometricEnabled": True,
}


class Result:
    def __init__(self) -> None:
        self.passed: list[str] = []
        self.failed: list[str] = []

    def ok(self, msg: str) -> None:
        self.passed.append(msg)
        print("  OK  ", msg)

    def fail(self, msg: str) -> None:
        self.failed.append(msg)
        print("  FAIL", msg)


def _request(method: str, path: str, body=None, headers: dict | None = None, timeout: float = 30.0):
    data = json.dumps(body).encode("utf-8") if body is not None else None
    hdrs = {"Content-Type": "application/json"}
    if headers:
        hdrs.update(headers)
    req = urllib.request.Request(BASE + path, data=data, headers=hdrs, method=method)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read().decode("utf-8", errors="replace")
            try:
                parsed = json.loads(raw) if raw else {}
            except json.JSONDecodeError:
                return resp.status, {"error": "non-json", "raw": raw[:240]}
            return resp.status, parsed if isinstance(parsed, dict) else {"error": "bad-json-type"}
    except urllib.error.HTTPError as e:
        raw = e.read().decode("utf-8", errors="replace")
        try:
            parsed = json.loads(raw) if raw else {}
        except json.JSONDecodeError:
            parsed = {"error": raw[:240]}
        return e.code, parsed if isinstance(parsed, dict) else {"error": str(parsed)}
    except Exception as e:
        return 0, {"error": str(e)}


def wait_api(timeout_sec: float = 45.0) -> bool:
    deadline = time.time() + timeout_sec
    while time.time() < deadline:
        st, _ = _request("GET", "/api/data/factory-settings", timeout=5.0)
        if st == 200:
            return True
        time.sleep(0.8)
    return False


def sh(cmd: list[str], check: bool = True) -> subprocess.CompletedProcess:
    return subprocess.run(cmd, check=check, text=True, capture_output=True)


def enable_biometric_mock() -> None:
    conf = "[Service]\nEnvironment=BIOMETRIC_MOCK=1\nEnvironment=BIOMETRIC_MOCK_TEMPLATE_ID=1\n"
    subprocess.run(
        ["sudo", "tee", str(MOCK_DROPIN)],
        input=conf,
        text=True,
        check=True,
        capture_output=True,
    )
    sh(["sudo", "systemctl", "daemon-reload"])


def disable_biometric_mock() -> None:
    subprocess.run(["sudo", "rm", "-f", str(MOCK_DROPIN)], check=False)
    sh(["sudo", "systemctl", "daemon-reload"], check=False)


def restart_clean() -> None:
    sh(["sudo", "systemctl", "restart", SERVICE])
    if not wait_api():
        raise RuntimeError("API did not come back after clean restart")


def restart_unclean_powercut() -> None:
    """Simulate power cut: SIGKILL bridge (no atexit clean-stop), remove clean flag, start again."""
    pid_s = sh(["systemctl", "show", "-p", "MainPID", "--value", SERVICE]).stdout.strip()
    try:
        pid = int(pid_s or "0")
    except ValueError:
        pid = 0
    # Remove any existing clean-stop marker so startup treats this as unclean.
    for flag in (
        STORAGE / "app_clean_stop.flag",
        Path("/opt/kiosk/storage/app_clean_stop.flag"),
    ):
        try:
            if flag.exists():
                flag.unlink()
        except OSError:
            pass
    if pid > 1:
        try:
            os.kill(pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
    # Give systemd a moment, then force start
    time.sleep(1.0)
    sh(["sudo", "systemctl", "reset-failed", SERVICE], check=False)
    sh(["sudo", "systemctl", "start", SERVICE])
    if not wait_api():
        raise RuntimeError("API did not come back after unclean power-cut restart")


def read_settings_file(path: Path) -> dict:
    if not path.exists():
        return {}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def assert_settings_match(res: Result, settings: dict, label: str) -> None:
    checks = [
        ("companyName", MARKER["companyName"]),
        ("companyLocation", MARKER["companyLocation"]),
        ("serialNo", MARKER["serialNo"]),
        ("autoLogoutMinutes", MARKER["autoLogoutMinutes"]),
        ("passwordResetPeriodDays", MARKER["passwordResetPeriodDays"]),
        ("maxQa", MARKER["maxQa"]),
        ("maxUsers", MARKER["maxUsers"]),
        ("biometricEnabled", True),
        ("installationDate", MARKER["installationDate"]),
    ]
    bad = []
    for key, expect in checks:
        got = settings.get(key)
        if got != expect:
            bad.append(f"{key}={got!r} expected {expect!r}")
    if bad:
        res.fail(f"{label}: " + "; ".join(bad))
    else:
        res.ok(f"{label}: factory settings intact (logout={settings.get('autoLogoutMinutes')}m, pwdDays={settings.get('passwordResetPeriodDays')}, maxQa={settings.get('maxQa')})")


def test_password_cycle(res: Result) -> None:
    import data_service as ds

    ds.init(
        {
            "STORAGE_DIR": str(STORAGE),
            "REPORTS_DIR": os.environ.get("REPORTS_DIR", "/media/usb_internal/reports"),
            "APP_ROOT": str(APP_ROOT),
        }
    )
    policy = ds.get_password_policy_for_members()
    if not policy.get("enabled"):
        res.fail("password policy not enabled after save (need installationDate + periodDays)")
        return
    if int(policy.get("periodDays") or 0) != MARKER["passwordResetPeriodDays"]:
        res.fail(f"password periodDays={policy.get('periodDays')} expected {MARKER['passwordResetPeriodDays']}")
        return
    res.ok(f"password policy enabled periodDays={policy['periodDays']} install={policy['installationDate'].date().isoformat()}")

    # Fresh password within cycle -> not expired
    member_ok = {
        "passwordLastChangedAt": datetime.now().isoformat(timespec="seconds"),
        "createdAt": datetime.now().isoformat(timespec="seconds"),
    }
    st_ok = ds.get_member_password_expiry_state(member_ok)
    if st_ok.get("expired"):
        res.fail(f"fresh password unexpectedly expired: {st_ok}")
    else:
        res.ok("password cycle: fresh password not expired")

    # Password last changed far before install+period -> expired
    old = (policy["installationDate"] - timedelta(days=5)).isoformat(timespec="seconds")
    member_old = {"passwordLastChangedAt": old, "createdAt": old}
    # Advance "now" past first boundary
    now_past = policy["installationDate"] + timedelta(days=MARKER["passwordResetPeriodDays"] + 5)
    st_old = ds.get_member_password_expiry_state(member_old, now=now_past)
    if st_old.get("expired"):
        res.ok(f"password cycle: stale password expired (expiresOn={st_old.get('expiresOn')})")
    else:
        res.fail(f"password cycle: expected expired for stale password, got {st_old}")


def main() -> int:
    res = Result()
    print("=== Factory settings / auto-logout / password cycle / biometric smoke ===")
    print(f"API={BASE} STORAGE={STORAGE}")

    if not wait_api(20):
        res.fail("API not reachable at start")
        print(f"\n{len(res.passed)} passed, {len(res.failed)} failed")
        return 1

    # Snapshot current settings so we can restore after the smoke run.
    st0, before = _request("GET", "/api/data/factory-settings")
    restore_settings = dict((before.get("settings") or {})) if st0 == 200 else {}

    # Login factory + save marker settings
    st, data = _request("POST", "/api/data/auth/login", {"username": FACTORY_USER, "password": FACTORY_PASS})
    if st != 200 or not data.get("success"):
        res.fail(f"factory login failed: HTTP {st} {data}")
    else:
        res.ok("factory login")

    hdrs = {"X-User-Role": "Factory", "X-User-Username": FACTORY_USER, "X-User-Name": "Factory"}
    st, data = _request("POST", "/api/data/factory-settings", MARKER, headers=hdrs)
    if st != 200 or not data.get("success"):
        res.fail(f"save factory settings failed: HTTP {st} {data}")
    else:
        assert_settings_match(res, data.get("settings") or {}, "POST save response")

    usb = read_settings_file(STORAGE / "factorySettings.json")
    assert_settings_match(res, usb, "USB factorySettings.json")
    mirror = read_settings_file(MIRROR)
    if mirror:
        assert_settings_match(res, mirror, "APP_ROOT mirror factorySettings.json")
    else:
        res.fail("APP_ROOT mirror factorySettings.json missing after save")

    # Session should exist now; after restart must clear
    st, cur = _request("GET", "/api/data/auth/current-user")
    if st == 200 and isinstance(cur.get("user"), dict) and cur["user"].get("username"):
        res.ok(f"session active before restart ({cur['user'].get('username')})")
    else:
        res.ok("no sticky session before restart (acceptable)")

    # --- Clean restart ---
    print("-- clean restart --")
    try:
        restart_clean()
        res.ok("clean restart completed")
    except Exception as e:
        res.fail(f"clean restart: {e}")
        print(f"\n{len(res.passed)} passed, {len(res.failed)} failed")
        return 1

    st, data = _request("GET", "/api/data/factory-settings")
    if st != 200:
        res.fail(f"GET factory-settings after clean restart HTTP {st} {data}")
    else:
        assert_settings_match(res, data.get("settings") or {}, "after clean restart (API)")

    st, cur = _request("GET", "/api/data/auth/current-user")
    if st == 200 and (cur.get("user") is None or cur.get("user") == {}):
        res.ok("after clean restart: login required (session cleared)")
    elif st == 200 and isinstance(cur.get("user"), dict) and cur["user"].get("username"):
        res.fail(f"after clean restart: session still set to {cur['user'].get('username')}")
    else:
        res.ok("after clean restart: current-user null/empty")

    # --- Unclean power-cut restart ---
    print("-- unclean power-cut restart (SIGKILL) --")
    # Re-login so pending session marker exists for power-interruption path
    _request("POST", "/api/data/auth/login", {"username": TEST_USER, "password": TEST_PASS})
    try:
        restart_unclean_powercut()
        res.ok("unclean power-cut restart completed")
    except Exception as e:
        res.fail(f"unclean restart: {e}")
        print(f"\n{len(res.passed)} passed, {len(res.failed)} failed")
        return 1

    st, data = _request("GET", "/api/data/factory-settings")
    if st != 200:
        res.fail(f"GET factory-settings after power-cut HTTP {st} {data}")
    else:
        assert_settings_match(res, data.get("settings") or {}, "after power-cut restart (API)")

    usb2 = read_settings_file(STORAGE / "factorySettings.json")
    assert_settings_match(res, usb2, "USB file after power-cut")

    st, cur = _request("GET", "/api/data/auth/current-user")
    if st == 200 and not (isinstance(cur.get("user"), dict) and cur["user"].get("username")):
        res.ok("after power-cut: login required (session cleared)")
    else:
        res.fail(f"after power-cut: unexpected current-user {cur}")

    # Password cycle
    print("-- password reset cycle --")
    try:
        test_password_cycle(res)
    except Exception as e:
        res.fail(f"password cycle test error: {e}")

    # Auto-logout value is policy stored in factory settings; watcher reads it after login.
    # Confirm API still exposes 7 minutes for UI applyFactoryAutoLogoutSetting.
    st, data = _request("GET", "/api/data/factory-settings")
    mins = (data.get("settings") or {}).get("autoLogoutMinutes")
    if mins == MARKER["autoLogoutMinutes"]:
        res.ok(f"auto-logout policy available to UI after restart ({mins} minutes)")
    else:
        res.fail(f"auto-logout minutes={mins!r} after restart")

    # Biometric mock after restart
    print("-- biometric mock login after restart --")
    try:
        enable_biometric_mock()
        restart_clean()
        res.ok("restarted with BIOMETRIC_MOCK=1")
        st, data = _request("POST", "/api/data/auth/login-biometric", {})
        if st == 200 and data.get("success") and isinstance(data.get("user"), dict):
            res.ok(f"biometric mock login ok user={data['user'].get('username')} templateId={data.get('templateId')}")
        else:
            res.fail(f"biometric mock login HTTP {st}: {data}")
        # Settings still intact with mock drop-in restart
        st, fs = _request("GET", "/api/data/factory-settings")
        assert_settings_match(res, (fs.get("settings") or {}), "factory settings after biometric mock restart")
    except Exception as e:
        res.fail(f"biometric mock path: {e}")
    finally:
        disable_biometric_mock()
        try:
            restart_clean()
            res.ok("restored bridge without BIOMETRIC_MOCK")
        except Exception as e:
            res.fail(f"restore bridge: {e}")

    # Password login still works after all restarts
    st, data = _request("POST", "/api/data/auth/login", {"username": FACTORY_USER, "password": FACTORY_PASS})
    if st == 200 and data.get("success"):
        res.ok("password login still works after power-cut smoke")
    else:
        res.fail(f"password login after smoke HTTP {st}: {data}")

    # Restore prior factory settings (keep device as operator left it)
    if restore_settings:
        hdrs = {"X-User-Role": "Factory", "X-User-Username": FACTORY_USER, "X-User-Name": "Factory"}
        st, data = _request("POST", "/api/data/factory-settings", restore_settings, headers=hdrs)
        if st == 200 and data.get("success"):
            res.ok(f"restored previous factory settings (company={restore_settings.get('companyName')!r})")
        else:
            res.fail(f"restore previous factory settings failed: HTTP {st} {data}")

    print(f"\n{len(res.passed)} passed, {len(res.failed)} failed")
    for f in res.failed:
        print("  -", f)
    return 1 if res.failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
