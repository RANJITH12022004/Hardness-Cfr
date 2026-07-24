# Smoke Test Gap Report — Tablet Hardness Tester

**Date:** 2026-07-20  
**Environment:** kiosk-bridge on `127.0.0.1:5000`, reports stored under `/media/usb_internal/reports/`  
**Automated script:** `scripts/smoke_hardness_flows.py` (32 checks passed, 0 failed)

---

## Smoke test matrix results

| # | Flow | Result | Notes |
|---|------|--------|-------|
| 1 | **Quick test** | **Pass (API)** | Test report created via factory session (operator `Rahul` lacks `quick-test` permission). `reportApprovalStatus=pending`, preview A4 text OK, print/PDF blocked until approve. |
| 2 | **Load recipe** | **Not run (UI)** | Same save path as test (`type:test`); blocked for current operator without `recipe-test`. Recommend smoke on a user with `perm_test_access`. |
| 3 | **Load validation** | **Pass (API)** | Report id created, 80-col A4 preview, pending → approve → PDF. |
| 4 | **Distance validation** | **Pass (API)** | Gauge/measured/difference in A4 text; approve + PDF OK. |
| 5 | **Load calibration** | **Pass (API)** | No server pending; print allowed immediately (HTTP 200). |
| 6 | **Distance-zero calibration** | **Pass (API)** | A4 preview OK; no approval gate on server. |

### Sidebar / approval lock (UI vs API)

| Check | Result |
|-------|--------|
| Test/validation pending → operator print/export blocked | **Pass** (HTTP 403) |
| After factory approve → PDF generation | **Pass** |
| After approve → operator print allowed | **Pass** (HTTP 200) |
| Calibration server pending | **N/A** — server never sets `pending` |
| UI calibration approval lock | **No lock** when `reportApprovalStatus` is absent (only locks when `pending`) |

**UI manual checklist** (1024×600 device: backoff modal blank, sample persistence 10/13/15, sidebar unlock after approve) was not re-run on the physical kiosk in this session; prior fixes remain in `script.js` / `approval_biometric.js`. Re-verify on device before release sign-off.

---

## Statistics alignment (Phase 3)

Implemented in `print_service.py` (`_format_stat_number`, `_format_stat_count`, `_format_stat_rsd`) and HTML fallback in `script.js` (`formatStatCell`, `formatStatRsd`) + CSS tabular nums.

**Sample output (report 12 preview):**

```
Thickness  |   3 |   9.45 |   9.50 |   9.40 |   0.10 |   0.05 |  0.53%
Hardness   |   3 |  33.45 |  33.50 |  33.40 |   0.10 |   0.05 |  0.15%
```

- Empty values unified to `--` (no `N/A` in statistics block).
- Separator lines are 80 columns.
- Same formatter drives preview (`a4Text`), dot-matrix print, and server PDF export.

---

## Gaps and recommended actions

| Gap | Current behavior | Priority | Recommended action |
|-----|------------------|----------|-------------------|
| **Calibration approval mismatch** | UI defines `calibration-report-approve` and treats calibration as approval-capable; server `_report_requires_approval()` only includes `test` + `validation`. Calibration reports have no `reportApprovalStatus`. | **High (CFR)** | **Option A (recommended):** Set `reportApprovalStatus=pending` for calibration in `create_report`, mirror test/validation approve flow. **Option B:** Remove calibration from UI approval lock / permission checks. |
| **Operator test permissions on device** | Only `Rahul` in `members.json`; lacks `perm_test_access` (`quick-test` / `recipe-test`). Smoke uses factory for test report create. | **Medium** | Add/assign test operator with `perm_test_access` for true E2E operator smoke. |
| **Legacy TapDensity smoke script** | `scripts/run_test1_live.py` still targets tap/adapter routes. | **Low** | Use `scripts/smoke_hardness_flows.py`; deprecate or rename `run_test1_live.py`. |
| **verify_audit_trail credentials** | Defaults still `Test@123` / `Test@1234` (not present on this device). | **Low** | Set `AUDIT_TEST_USER` / `AUDIT_TEST_PASS` env vars, or update defaults to match deployed members. |
| **Dead HTML PDF path in JS** | `buildPdfHtmlByIdMap` still called from export handlers; server `/api/reports/export` **ignores** `pdf_html_by_id` and regenerates from A4 text. | **Low** | Remove client HTML PDF build from export to reduce confusion and export latency. |
| **TapDensity preview enrichment** | `report_service.py` still references `usp`, `tapsMin`, `validationRuns` in some enrichment paths. | **Low** | Cleanup after flows stable. |
| **Reports list stats columns** | Not aligned with fixed-width A4 stats. | **Out of scope** | Address only if requested. |

---

## Export path status

- **USB / batch export:** Server-side only — `POST /api/reports/export` regenerates PDFs from A4 plain text (`app.py` docstring confirms legacy `html` / `pdf_html_by_id` ignored).
- **Single report export:** `handleExportReport()` still builds `pdf_html_by_id` client-side but server does not use it.
- **PDF storage:** `/media/usb_internal/reports/report_{id}.pdf` (not `/opt/kiosk/reports/`).

---

## Script updates

| File | Change |
|------|--------|
| `scripts/smoke_hardness_flows.py` | **New** — synthetic create/preview/approve/print/PDF checks for all report types. |
| `scripts/verify_audit_trail.py` | Replaced TapDensity `adapter/check` + USP modes with hardness `validation/load/start|stop`. |

---

## Success criteria checklist

- [x] Test + validation: pending → approve → print/export work (API)
- [x] Calibration: immediate print (no approval gate on server)
- [x] A4 preview 80 columns with aligned statistics (`9.45`, `33.45`, `--`)
- [x] Automated smoke script passes locally
- [x] Gap items documented with priority
- [ ] Full 6-flow manual UI pass on 1024×600 kiosk (operator with test permissions)
