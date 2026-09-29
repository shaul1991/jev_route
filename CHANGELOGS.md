# Changelog

All notable changes to this project are documented in this file.

## Unreleased — 2026-09-29

### Added

- **`product_design` ALM role.** Covers user flows, information architecture, screens and their states, interaction, visual direction, responsive behavior, and UI accessibility. Added to `shared/jev-routing.mjs` (`ALM_ROLE_CRITERIA`) and routed in `config/omp.json` (`@design` preferred, falling back to `@plan`/`@default`/`@slow`).
- **`specialty` classification.** A new Jev question answered in the same request as `alm_role`/`work_type`/`task_mode`: `web_frontend`, `mobile_app`, `backend_api`, `data_database`, `infrastructure_platform`, or `none`. Below 0.6 confidence it resolves to `none`. `shared/jev-routing.mjs` exports `SPECIALTY_CRITERIA`, `readSpecialty`, and `specialtyAdvice`.
  - When a specialty is confidently chosen, every adapter (OMP, Claude, Codex, Cursor, Hermes) appends a short checklist reminder to its advisory context — for example `data_database` reminds the agent to check migration reversibility, data integrity, query performance, backup/restore, and retention rules.
  - This is advisory only: it never changes the selected OMP model role, thinking level, or subagent, and is not a security or approval boundary.
- `tests/jev-routing.test.mjs`: confidence-threshold behavior for `specialty`, checklist text for every non-`none` specialty, and that `config/omp.json` routes cover exactly the ALM roles Jev can return (the OMP extension refuses to load otherwise).

### Changed

- `operations_delivery` role criteria now explicitly include production maintenance, incidents, and retiring/decommissioning a system (previously build/CI/deploy/runtime only).
- `product_planning` and `architecture` role criteria now explicitly exclude detailed screen/interaction design, so responsibility doesn't overlap with the new `product_design` role.
- Decision labels and logs (`/jev log`, `/jev roles routes`, status line, JSONL records) now show the specialty suffix when one was classified, e.g. `product_design/design/NORMAL +web_frontend`.
- README: documented the four classification axes (`alm_role`, `work_type`, `task_mode`, `specialty`), the full ALM role table, and an explicit "classification is not authority" note — no role or specialty grants approval, scope, or tool-execution permission.

### Compatibility

- `shared/jev-routing.d.mts` gained `SPECIALTY_CRITERIA`, `readSpecialty`, `specialtyAdvice`, and `specialtyConfidence` on `ROUTING_THRESHOLDS`. `ALM_ROLE_CRITERIA` gained the `product_design` key.
- `config/omp.json` gained a `product_design` entry under `routes`. Installed configs are merged via `scripts/configure-omp.mjs`, which fills in missing keys without touching existing ones — re-run `./scripts/install.sh [profile]` (or `make install-omp`) to pick up the new route.
- No breaking changes to existing role/work-type values, hook output shape (only appended advisory text), or the `.jev.config.json` schema.
