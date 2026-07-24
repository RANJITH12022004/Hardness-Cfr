#!/usr/bin/env python3
"""Smoke: no browser-native dialogs in Hardness CFR UI sources + runtime overrides."""
from __future__ import annotations

import pathlib
import re
import sys
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parents[1]
UI_FILES = [
    "script.js",
    "validation.js",
    "approval_biometric.js",
    "profile_compliance.js",
    "keyboard.js",
    "input-focus.js",
    "rbac.js",
    "index.html",
]

CALL_RE = re.compile(r"(?<![\w.])(alert|confirm|prompt)\s*\(")
ALLOWED_LINE_SNIPPETS = (
    "function kioskAlert",
    "function kioskConfirm",
    "function showAppModal",
    "function showConfirmModal",
    "window.alert =",
    "window.confirm =",
    "window.prompt =",
    "installKioskNativeDialogOverrides",
    "never uses window.",
    "App-native",
    "window.prompt is disabled",
    "Native confirm is sync",
    "[kiosk-alert]",
    "[kioskAlert]",
    "[kioskConfirm]",
    "kioskAlert(",
    "kioskConfirm(",
    "showAppModal(",
    "showConfirmModal(",
)


def scan_file(path: pathlib.Path) -> list[tuple[int, str]]:
    bad = []
    text = path.read_text(encoding="utf-8", errors="replace")
    for i, line in enumerate(text.splitlines(), 1):
        if not CALL_RE.search(line):
            continue
        if any(s in line for s in ALLOWED_LINE_SNIPPETS):
            continue
        # HTML onclick without alert — skip data attributes etc.
        stripped = line.strip()
        if stripped.startswith("//") or stripped.startswith("*") or stripped.startswith("<!--"):
            # still flag if it contains a real call (unlikely in comments we care about)
            if "alert(" not in stripped and "confirm(" not in stripped and "prompt(" not in stripped:
                continue
            if stripped.startswith("//") and ("alert(" in stripped or "confirm(" in stripped):
                # comment mentioning alert( — ignore
                continue
        bad.append((i, stripped[:160]))
    return bad


def main() -> int:
    print("=== scan UI sources for native dialogs ===")
    total_bad = 0
    for name in UI_FILES:
        path = ROOT / name
        if not path.exists():
            print(f"SKIP missing {name}")
            continue
        bad = scan_file(path)
        if bad:
            total_bad += len(bad)
            print(f"FAIL {name}: {len(bad)} native dialog call(s)")
            for ln, text in bad[:20]:
                print(f"  L{ln}: {text}")
        else:
            print(f"OK   {name}")

    # Required helpers present
    ab = (ROOT / "approval_biometric.js").read_text(encoding="utf-8", errors="replace")
    required = [
        "function showAppModal",
        "function showConfirmModal",
        "function kioskAlert",
        "function kioskConfirm",
        "installKioskNativeDialogOverrides",
        "window.alert = function",
        "window.confirm = function",
        "window.prompt = function",
    ]
    print("=== required dialog helpers ===")
    for req in required:
        ok = req in ab
        print(("OK  " if ok else "FAIL") + f" {req}")
        if not ok:
            total_bad += 1

    # Runtime: API up + index loads dialog scripts before UI
    print("=== runtime ===")
    try:
        with urllib.request.urlopen("http://127.0.0.1:5000/api/health", timeout=5) as r:
            body = r.read().decode("utf-8", errors="replace")
            print(f"OK   /api/health -> {r.status} {body[:120]}")
            if r.status not in (200, 503):
                total_bad += 1
    except Exception as e:
        print(f"FAIL /api/health: {e}")
        total_bad += 1

    try:
        with urllib.request.urlopen("http://127.0.0.1:5000/index.html", timeout=5) as r:
            html = r.read().decode("utf-8", errors="replace")
        # approval_biometric (dialogs) must load before script.js / profile_compliance
        i_ab = html.find("approval_biometric.js")
        i_val = html.find("validation.js")
        i_sc = html.find("script.js")
        i_pc = html.find("profile_compliance.js")
        if i_ab < 0 or i_sc < 0 or i_val < 0:
            print("FAIL index.html missing dialog/script tags")
            total_bad += 1
        elif not (i_ab < i_val < i_sc):
            print("FAIL expected order: approval_biometric.js → validation.js → script.js")
            total_bad += 1
        else:
            print("OK   script order: approval_biometric.js → validation.js → script.js")
        if "app-modal-overlay" not in html:
            print("FAIL app-modal-overlay missing from index.html")
            total_bad += 1
        else:
            print("OK   app-modal-overlay present")
        if "generic-modal-overlay" not in html:
            print("FAIL generic-modal-overlay missing from index.html")
            total_bad += 1
        else:
            print("OK   generic-modal-overlay present")
    except Exception as e:
        print(f"FAIL index.html: {e}")
        total_bad += 1

    # Counts: prefer kioskAlert over alert
    script = (ROOT / "script.js").read_text(encoding="utf-8", errors="replace")
    val = (ROOT / "validation.js").read_text(encoding="utf-8", errors="replace")
    raw_alert = len(re.findall(r"(?<![\w.])alert\s*\(", script + "\n" + val))
    kiosk_alert = (script + val).count("kioskAlert(")
    print(f"=== call counts: raw alert()={raw_alert} kioskAlert()={kiosk_alert} ===")
    if raw_alert > 0:
        print("FAIL raw alert() still present in script/validation")
        total_bad += 1
    else:
        print("OK   no raw alert() in script.js / validation.js")

    if total_bad:
        print(f"\nSMOKE FAIL ({total_bad} issue(s))")
        return 1
    print("\nSMOKE PASS — no browser-native dialog call sites; app modals wired")
    return 0


if __name__ == "__main__":
    sys.exit(main())
