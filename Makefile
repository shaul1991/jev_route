PLATFORM ?= omp
PROFILE ?=
CONFIGURE ?= 0

.PHONY: install install-omp install-claude

ifeq ($(PLATFORM),omp)
install: install-omp
else ifeq ($(PLATFORM),claude)
install: install-claude
else
install:
	@echo "Unsupported PLATFORM '$(PLATFORM)'; choose omp or claude" >&2
	@exit 2
endif

install-omp:
	./scripts/install.sh $(if $(strip $(PROFILE)),"$(PROFILE)") $(if $(filter 1,$(CONFIGURE)),--configure)

install-claude:
	claude plugin marketplace add "$(CURDIR)" --scope user
	claude plugin install jev-router@jev-route --scope user -y
