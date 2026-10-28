# OM Studio

Confidential. Parametric design and configuration platform for OM immersive venues.

See **[OM_MASTER_PLAN.md](OM_MASTER_PLAN.md)** for objectives, architecture, rounds, risks and open
questions, and **[docs/research/ROUND_00_RESEARCH.md](docs/research/ROUND_00_RESEARCH.md)** for the
product research behind the component library.

## Run

```bash
npm install
npm run dev          # http://localhost:5173
npm test             # geometry, seating, validation and export tests
npm run build        # type-check + production build
```

## Rhino export

In the app: **EXPORT RHINO** (top right) downloads a `.3dm` of the current configuration. In the TRANSFORM
workspace, with the timeline at its standing end, it exports the standing state instead.

From the command line, and with an independent check using McNeel's Python `rhino3dm`:

```bash
npm run export:sample                              # writes exports/om-300-flagship_round04.3dm (+ _standing)
python3 -m venv .venv-validate && .venv-validate/bin/pip install rhino3dm
.venv-validate/bin/python scripts/validate_3dm.py exports/om-300-flagship_round04.3dm
```

`npm run export:sample -- path/to/saved.omstudio.json` exports any configuration saved from the app.

## Layout

```
src/engine/     parametric engine (no Three.js): coordinates, validation, media, seating, stage, envelope, sections
src/library/    seating and LED products with per-value verification status and sources
src/export/     rhino3dm .3dm writer
src/app/        React UI and React Three Fiber viewport
scripts/        sample export + Python validator
tests/          vitest suites
```

Coordinates: right-handed, Z up, metres; origin = reference sphere centre = reference eye point; +Y forward.
