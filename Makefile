PLATFORM ?= omp
PROFILE ?=
CONFIGURE ?= 0

.PHONY: install install-omp install-claude install-codex install-cursor

ifeq ($(PLATFORM),omp)
install: install-omp
else ifeq ($(PLATFORM),claude)
install: install-claude
else ifeq ($(PLATFORM),codex)
install: install-codex
else ifeq ($(PLATFORM),cursor)
install: install-cursor
else
install:
	@echo "Unsupported PLATFORM '$(PLATFORM)'; choose omp, claude, codex, or cursor" >&2
	@exit 2
endif

install-omp:
	./scripts/install.sh $(if $(strip $(PROFILE)),"$(PROFILE)") $(if $(filter 1,$(CONFIGURE)),--configure)

install-claude:
	node scripts/configure-claude.mjs $(if $(filter 1,$(CONFIGURE)),--configure)
	claude plugin marketplace add "$(CURDIR)" --scope user
	claude plugin install jev-router@jev-route --scope user -y

install-codex:
	node scripts/configure-codex.mjs $(if $(filter 1,$(CONFIGURE)),--configure)
	codex plugin marketplace add "$(CURDIR)"
	codex plugin add jev-router@jev-route

install-cursor:
	node scripts/install-cursor.mjs
