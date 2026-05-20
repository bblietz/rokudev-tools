.PHONY: help test-python build-corpus test-all

help:
	@echo "Available targets:"
	@echo "  build-corpus  - Generate packages/brs-docs/src/brs_docs/data/corpus.sqlite"
	@echo "  test-python   - Run brs-docs pytest suite"
	@echo "  test-all      - test-python + pnpm turbo run test"

test-python:
	cd packages/brs-docs && uv run pytest

build-corpus:
	cd packages/brs-docs && uv run python -m brs_docs.corpus.build \
		--lock corpus.lock \
		--out src/brs_docs/data/corpus.sqlite \
		--monorepo-root $(CURDIR)

test-all: test-python
	pnpm turbo run test
