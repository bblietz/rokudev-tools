---
name: roku-bsc-lint
description: |
  Run BrighterScript / bsc compile-check on a Roku channel project and summarize errors. TRIGGER when the user asks to lint, compile-check, or statically analyze BrightScript code, or when sideload fails with a syntax-class error. DO NOT TRIGGER for runtime debugging (use roku-triage), for non-Roku TypeScript/JavaScript lint, or for runtime profiling.
---

# Roku bsc Lint

Wraps the `bsc` (BrighterScript) command-line tool for static analysis of `.brs`, `.bs`, and SceneGraph `.xml` files.

## Tools used

- `Bash` for `bsc --lint`
- `Read` to surface offending source lines

No MCP server required.

## Prerequisites

```bash
bsc --version
```

If not installed:

```bash
npm i -g brighterscript
```

If the project has its own `bsconfig.json`, use it. Otherwise lint with sane defaults.

## Procedure

1. Detect project root by walking up from the working dir looking for `manifest`.
2. Look for `bsconfig.json`. If present, run `bsc --project <path>`. Else run `bsc --lint --rootDir <root>`.
3. Capture stdout + stderr.
4. Parse lines of the form `<file>:<line>:<col> - error <code>: <msg>` and `... - warning <code>: <msg>`.
5. Group by severity. For each error, print:
   ```
   <file>:<line>:<col>
     <code>: <msg>
     | <source line>
   ```
6. Summary: `errors: N, warnings: M`. Exit non-zero on errors.

## Output

```
Project: <root>
bsconfig: <path or default>
errors: 2
warnings: 5

ERRORS
  source/main.brs:42:7
    BSLINT1001: Variable "frobnicate" is not defined
    |     frobnicate(x)

  components/MyScene.bs:8:14
    BSLINT2003: function returns nothing but is used as a value
    |     return getThing()

WARNINGS
  ...
```

## Worked example

User: "Lint the channel before sideloading."

1. Run `bsc --version`. Found 0.69.x.
2. Run `bsc --project ./bsconfig.json`.
3. Parse 2 errors, 5 warnings. Print summary.
4. Suggest fix for the most common error code.

## Notes

- For Rooibos test files, exclude them from the lint pass via `bsconfig.json` `exclude`. See the `roku-rooibos-test` skill for running them.
- BSLINT codes start at 1000. SceneGraph XML errors come through with code 9xxx.
- If `bsc` is too noisy on legacy code, suggest `--ignoreErrorCodes` rather than disabling lint entirely.
