# Python build packaging lessons

Captured 2026-05-20 from the brs-docs v0.7.0 -> v0.7.1 -> v0.7.2
post-T29 verification cycle. Two latent bugs shipped in v0.7.0 and
would have stayed hidden without the spec-mandated post-release
success-criteria checklist. Both fixed via TDD and shipped same day.

## TL;DR

| # | Lesson | Source bug |
|---|---|---|
| 1 | `Path.with_suffix(".sqlite.lock")` REPLACES, not appends | v0.7.1 companion-lock filename |
| 2 | Hatch wheel target honors `.gitignore` by default | v0.7.2 wheel missing corpus.sqlite |
| 3 | Test the shipping artifact, not just the source tree | both v0.7.1 + v0.7.2 |
| 4 | Permissive `or` in assertions hides bugs | v0.7.1 build-test |

## 1. `Path.with_suffix(".sqlite.lock")` REPLACES the existing suffix

`pathlib.Path.with_suffix()` swaps the final component's suffix; it
does NOT append. For `out = Path(".../corpus.sqlite")`:

```python
>>> out.with_suffix(".sqlite.lock")
PosixPath('.../corpus.sqlite.lock')
# Note: NOT corpus.sqlite.sqlite.lock
```

This is what v0.7.0 `build_corpus` did:

```python
# WRONG -- yields corpus.sqlite.lock
companion_lock = out_path.with_suffix(".sqlite.lock")
```

while `first_run.py` and `cli.py` both looked for `corpus.lock` as a
sibling of `corpus.sqlite`. Result: `brs-docs version` reported
"no corpus installed" on every dev install.

**Fix**: use `path.parent / "name"` or `path.with_name(...)` when you
want a sibling file with a different stem:

```python
companion_lock = out_path.parent / "corpus.lock"
```

## 2. Hatch wheel target honors `.gitignore` by default

`hatchling.build` (via `[tool.hatch.build.targets.wheel]`) excludes
gitignored files unless you opt them in explicitly. If your package
ships a generated binary artifact (a sqlite db, a compiled asset, a
pre-built lookup table), and that artifact is in `.gitignore` because
it's a build product, the wheel will silently lack it.

v0.7.0 shipped a 27 KB wheel (vs target ~18 MB) because
`src/brs_docs/data/corpus.sqlite` is in `.gitignore` and the wheel
config only force-included `corpus.lock`:

```toml
# v0.7.0 (incomplete)
[tool.hatch.build.targets.wheel.force-include]
"corpus.lock" = "brs_docs/data/corpus.lock"
```

The wheel passed all source tests because `importlib.resources` in a
dev/editable install resolves against the live `src/` tree, where the
sqlite IS present. Wheel installs (`pip install brs-docs`, `uvx ...`)
crashed first-run with `CorpusNotInitialized`.

**Fix**: explicitly opt the artifact in:

```toml
[tool.hatch.build.targets.wheel.force-include]
"corpus.lock" = "brs_docs/data/corpus.lock"
"src/brs_docs/data/corpus.sqlite" = "brs_docs/data/corpus.sqlite"
```

Alternative pattern using `artifacts`:

```toml
[tool.hatch.build]
artifacts = ["src/brs_docs/data/corpus.sqlite"]
```

## 3. Test the shipping artifact, not just the source tree

The corollary: all v0.7.0 unit + integration tests passed because
they ran against the dev tree. The failing path was the wheel install
itself.

For any package that bundles binary data, add a `tests/contract/`
integration test that:

1. subprocesses `uv build --wheel`
2. unzips the resulting `.whl`
3. asserts the expected files are present
4. asserts the wheel size is in a sane band

Pattern (see `packages/brs-docs/tests/contract/test_wheel_bundles_corpus_sqlite.py`):

```python
@pytest.mark.integration
def test_wheel_bundles_corpus_sqlite(tmp_path: Path) -> None:
    if not (PACKAGE_ROOT / "src/brs_docs/data/corpus.sqlite").exists():
        pytest.skip("run `make build-corpus` first")

    dist_dir = tmp_path / "dist"
    result = subprocess.run(
        ["uv", "build", "--wheel", "--out-dir", str(dist_dir)],
        cwd=PACKAGE_ROOT,
        capture_output=True,
        text=True,
        timeout=120,
    )
    assert result.returncode == 0, result.stderr

    wheels = list(dist_dir.glob("*.whl"))
    assert len(wheels) == 1
    wheel = wheels[0]
    assert wheel.stat().st_size > 1_000_000, (
        f"wheel is {wheel.stat().st_size} bytes; "
        f"corpus.sqlite is probably missing"
    )

    with zipfile.ZipFile(wheel) as zf:
        names = zf.namelist()
        assert "brs_docs/data/corpus.sqlite" in names, (
            "wheel must bundle brs_docs/data/corpus.sqlite for "
            "first-run on a pip/uvx install"
        )
```

This catches both bug 2 (missing file) and a future regression where
the corpus shrinks unexpectedly.

## 4. Permissive `or` clauses in assertions hide bugs

The v0.7.0 build test was:

```python
assert (
    (out.with_suffix(".sqlite.lock")).exists()
    or (out.parent / "corpus.lock").exists()
)
```

This passed against EITHER filename, so the readers' expectation
(`corpus.lock`) was never enforced. The bug only surfaced when
`first_run.py` actually tried to open `corpus.lock`.

**Pattern to avoid**: any `assert A.exists() or B.exists()` whose
clauses are not actually equivalent paths through the code.

**Fix**: one strict assertion + an explanatory message that names the
canonical filename and which downstream consumers depend on it:

```python
assert (out.parent / "corpus.lock").exists(), (
    "build_corpus must write companion lock as 'corpus.lock' beside "
    "corpus.sqlite; first_run.py and cli.py both look for that name."
)
```

The message itself becomes documentation of the contract.

## Meta-lesson: post-release verification matters

Both bugs were caught by a checklist that the v1 success-criteria
spec required (the "post-T29 Done checklist" in Plan 6). Without
that gate, v0.7.0 would have shipped to PyPI broken. Any step that
claims "wheel ships X" needs a wheel-inspection contract test;
"source tree has X" tests are not equivalent.
