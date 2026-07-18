# Hardness Cfr

Tablet Hardness Tester — 21 CFR Part 11 compliant kiosk application.

## Platform (shared with Tap Density / Friability)

- SQLite audit trail with USB export verify + 24h purge
- Report approval / preview lock, PDF, A4 & thermal print
- Factory settings: auto-logout, password reset period, biometric master, load-cell range
- RBAC permission cards, approval-verify tokens
- Desktop Client API via `bridge.py` (`/api/desktop/v1/*`)
- Internal USB storage vs external export pendrive

## Hardness domain

- Parameters: Thickness, Diameter/Length/Width, Hardness, Weight (T1/T2 tolerances)
- ESP UART: TARE, LOAD, DZ/DS, DIM, HARD, HOME, BO, load validation
- Scale UART API: `/api/scale/status`, `/api/scale/read`
- Validation (load + distance) and calibration (load + distance zero/span)

## Run

```bash
export APP_ROOT=/home/rle/Hardness-Cfr
python3 bridge.py
# open http://127.0.0.1:5000/
```

See `HARDWARE_SETUP.md` and `ESP_COMMAND_SET.csv` for wiring and protocol.
