#!/usr/bin/env python3
"""One-shot audit trail cleanup for Hardness CFR kiosk.

1) Backup audit_log.db
2) Re-label false "Factory settings changed" rows that immediately follow a
   Calibration/Validation report save (due-date modal side-effect).
3) Remove near-duplicate pairs (same user+action+details within 2s),
   keeping the earliest row — covers preview spam, dual PDF, dual session
   reset, and dual logout.
"""

from __future__ import annotations

import argparse
import pathlib
import shutil
import sqlite3
import sys
import time
from datetime import datetime
from typing import List, Optional, Set, Tuple


DEFAULT_DB = pathlib.Path("/media/usb_internal/db/audit_log.db")
WINDOW_FALSE_FACTORY_MS = 15000
WINDOW_DEDUPE_MS = 2000

FALSE_FACTORY_PRIOR_ACTIONS = (
    "Report saved",
    "Report created",
)
FALSE_FACTORY_PRIOR_NEEDLES = (
    "calibration",
    "validation",
    "distance calibration",
    "load validation",
    "weight calibration",
    "distance validation",
)

DEDUPE_ACTIONS = {
    "Report preview viewed",
    "Report PDF generated",
    "Power interruption logout",
    "Logout",
    "Logout (inactivity timeout)",
}


def _connect(db_path: pathlib.Path) -> sqlite3.Connection:
    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row
    return conn


def backup_db(db_path: pathlib.Path) -> pathlib.Path:
    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    bak = db_path.with_name("{}.bak_cleanup_{}".format(db_path.name, stamp))
    shutil.copy2(db_path, bak)
    return bak


def _is_calib_val_report_details(details: str) -> bool:
    d = (details or "").lower()
    return any(n in d for n in FALSE_FACTORY_PRIOR_NEEDLES)


def find_false_factory_ids(conn: sqlite3.Connection) -> List[str]:
    rows = conn.execute(
        """
        SELECT id, user, timestamp, details
        FROM audit_entries
        WHERE action = 'Factory settings changed'
        ORDER BY timestamp ASC, id ASC
        """
    ).fetchall()
    out: List[str] = []
    for row in rows:
        user = (row["user"] or "").strip()
        if not user or user == "--":
            continue
        ts = int(row["timestamp"] or 0)
        prior = conn.execute(
            """
            SELECT action, details
            FROM audit_entries
            WHERE user = ?
              AND timestamp >= ?
              AND timestamp <= ?
              AND id != ?
            ORDER BY timestamp DESC, id DESC
            LIMIT 8
            """,
            (user, ts - WINDOW_FALSE_FACTORY_MS, ts, row["id"]),
        ).fetchall()
        for p in prior:
            act = (p["action"] or "").strip()
            if act in FALSE_FACTORY_PRIOR_ACTIONS and _is_calib_val_report_details(p["details"] or ""):
                out.append(row["id"])
                break
    return out


def relabel_false_factory(conn: sqlite3.Connection, ids: List[str]) -> int:
    if not ids:
        return 0
    with conn:
        for eid in ids:
            conn.execute(
                """
                UPDATE audit_entries
                SET action = ?,
                    details = ?
                WHERE id = ?
                """,
                (
                    "Validation due dates updated",
                    "Historical cleanup: was false Factory settings changed after calibration/validation due-date save",
                    eid,
                ),
            )
    return len(ids)


def find_dedupe_ids(conn: sqlite3.Connection) -> List[str]:
    """Keep earliest of near-identical rows; return later ids to delete."""
    rows = conn.execute(
        """
        SELECT id, user, role, action, details, timestamp
        FROM audit_entries
        ORDER BY timestamp ASC, id ASC
        """
    ).fetchall()
    delete: List[str] = []
    last_kept: dict = {}
    for row in rows:
        action = (row["action"] or "").strip()
        if action not in DEDUPE_ACTIONS:
            continue
        key = (
            (row["user"] or "").strip(),
            (row["role"] or "").strip(),
            action,
            (row["details"] or "").strip(),
        )
        ts = int(row["timestamp"] or 0)
        prev = last_kept.get(key)
        if prev is not None and (ts - prev[0]) <= WINDOW_DEDUPE_MS:
            delete.append(row["id"])
            continue
        last_kept[key] = (ts, row["id"])
    return delete


def delete_ids(conn: sqlite3.Connection, ids: List[str]) -> int:
    if not ids:
        return 0
    with conn:
        for eid in ids:
            conn.execute("DELETE FROM audit_entries WHERE id = ?", (eid,))
    return len(ids)


def main(argv: Optional[List[str]] = None) -> int:
    parser = argparse.ArgumentParser(description="Clean false/duplicate Hardness audit rows")
    parser.add_argument("--db", type=pathlib.Path, default=DEFAULT_DB)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args(argv)

    db_path = args.db
    if not db_path.exists():
        print("ERROR: audit DB not found:", db_path)
        return 1

    bak = None
    if not args.dry_run:
        bak = backup_db(db_path)
        print("Backup:", bak)

    conn = _connect(db_path)
    try:
        false_ids = find_false_factory_ids(conn)
        dedupe_ids = find_dedupe_ids(conn)
        # Do not delete rows we are about to relabel
        false_set: Set[str] = set(false_ids)
        dedupe_ids = [i for i in dedupe_ids if i not in false_set]

        print("False Factory settings rows to relabel:", len(false_ids))
        for i in false_ids[:20]:
            print("  relabel", i)
        print("Near-duplicate rows to delete:", len(dedupe_ids))
        for i in dedupe_ids[:30]:
            print("  delete", i)
        if len(dedupe_ids) > 30:
            print("  ... and", len(dedupe_ids) - 30, "more")

        if args.dry_run:
            print("Dry-run only; no changes written.")
            return 0

        n1 = relabel_false_factory(conn, false_ids)
        n2 = delete_ids(conn, dedupe_ids)
        print("Relabeled:", n1, "| Deleted:", n2)
        remaining = conn.execute("SELECT COUNT(*) FROM audit_entries").fetchone()[0]
        print("Remaining entries:", remaining)
        return 0
    finally:
        conn.close()


if __name__ == "__main__":
    sys.exit(main())
