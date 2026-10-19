# Flyleaf: check a family's tree and build its book.
#
#   make -C /path/to/flyleaf book FLYLEAF_FAMILY=/path/to/family [PYTHON=/path/to/python3]
#
# Run make in Flyleaf's folder (or with -C, as the flyleaf command does), so
# paths with spaces work: make cannot split a path from MAKEFILE_LIST safely.
#
# Commands run in the family folder (flyleaf.json, data/, book/, images/,
# build/) with the engine's scripts. Without FLYLEAF_FAMILY the scripts find
# the family the usual way (see scripts/flyleaf_settings.py).

.PHONY: enrich validate book book-pdf book-preview book-archival book-coverage \
        book-scaffold book-sources book-figures book-claims book-claims-check \
        questionnaire test

ENGINE := $(CURDIR)
PYTHON ?= python3
export FLYLEAF_FAMILY
FAMILY := $(shell cd "$(ENGINE)" && "$(PYTHON)" -c 'import sys; sys.path.insert(0, "scripts"); import flyleaf_settings as f; print(f.family_root())')
RUN := cd "$(FAMILY)" && "$(PYTHON)" "$(ENGINE)/scripts

enrich:
	@$(RUN)/enrich-gedcom.py"

validate: enrich
	@$(RUN)/validate-gedcom.py"

book-figures: enrich
	@$(RUN)/book-figures.py"

book-coverage: enrich
ifdef MARK
	@$(RUN)/book-coverage.py" --mark-current $(MARK)
else
	@$(RUN)/book-coverage.py"
endif

book-scaffold: validate
	@$(RUN)/book-scaffold.py"

book-sources:
	@test -n "$(REFN)" || (echo "usage: make book-sources REFN=<slug>" && exit 1)
	@$(RUN)/book-assemble.py" --sources $(REFN)

book-claims:
	@$(RUN)/extract-claims.py"

book-claims-check:
	@$(RUN)/extract-claims.py" --check

book:
	@$(RUN)/build-book.py"

book-pdf: book

# Archival edition: PDF/A-2b for library deposit. Same content, stricter PDF,
# set in the same fonts as the book.
book-archival: book
	@$(RUN)/build-book.py" --archival

book-preview: book
	@$(RUN)/build-book.py" --preview

questionnaire:
	@test -n "$(REFN)" || (echo "usage: make questionnaire REFN=<slug>" && exit 1)
	@$(RUN)/book-questionnaire.py" $(REFN)

# Every tests/test-*.py file, in name order; the first failure stops the run.
# A shell glob, not make's wildcard, so a folder name with spaces works.
test:
	@set -e; for test in "$(ENGINE)"/tests/test-*.py; do cd "$(FAMILY)" && "$(PYTHON)" "$$test"; done
