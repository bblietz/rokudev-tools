---
name: roku-manifest-validator
description: |
  Validate a Roku channel `manifest` file against the Roku spec. Checks required keys, channel-poster resolutions (HD/FHD/UHD), splash sizes, build-version sanity, and missing or unknown keys. TRIGGER when the user asks to validate, lint, or check a Roku manifest, or when sideload fails with a manifest-related error. DO NOT TRIGGER for non-Roku projects or for general image validation.
---

# Roku Manifest Validator

Pure local skill. Reads a channel `manifest` and validates against the Roku channel-publishing spec. Uses only `Read` and `Grep`. No MCP calls.

## What it checks

### Required keys

- `title`
- `subtitle`
- `major_version`, `minor_version`, `build_version`
- `mm_icon_focus_hd`, `mm_icon_focus_fhd` (channel posters)
- `splash_screen_hd`, `splash_screen_fhd`
- `ui_resolutions` (recommended `hd,fhd`; `fhd` requires UHD assets)

### Optional but flagged keys

- `mm_icon_side_hd`, `mm_icon_side_fhd` (deprecated; warn but allow)
- `screensaver_title`, `screensaver_subtitle` (only meaningful for screensavers)
- `splash_color` (must be `#RRGGBB`)
- `splash_min_time` (integer ms, sane range 0..6000)

### Asset resolution requirements

For each declared `ui_resolution`, the referenced asset file must exist and match these dimensions when possible:

| Asset | HD | FHD | UHD |
|---|---|---|---|
| Channel poster (focus) | 290x218 | 540x405 | 800x600 |
| Channel poster (side) | 246x140 | 460x260 | 660x375 |
| Splash | 720x480 | 1280x720 | 1920x1080 |

If `sips` (macOS) or `identify` (ImageMagick) is available, verify dimensions. Otherwise warn that dimension check was skipped.

## Procedure

1. Resolve project root (current dir, or argument).
2. Read `<root>/manifest`.
3. Parse as `key=value` lines. Tolerate blank lines and `#` comments.
4. Build a structured dict.
5. For each required key, emit ERROR if absent.
6. For each numeric key, emit ERROR if non-integer.
7. For each asset key, resolve relative path; emit ERROR if file missing.
8. If `sips` or `identify` exists, check declared assets against the table above; emit WARN on mismatch.
9. For unknown keys, emit INFO.
10. Print a summary table and exit with non-zero count if any ERROR.

## Output

```
Manifest: <path>
PASS / FAIL: <verdict>

ERRORS (<count>)
  - <line> <message>
WARNINGS (<count>)
  - <line> <message>
INFO (<count>)
  - <line> <message>
```

## Worked example

```
Manifest: ./manifest
FAIL

ERRORS (2)
  - mm_icon_focus_fhd missing
  - splash_screen_hd points to images/splash_hd.jpg which does not exist

WARNINGS (1)
  - splash_color "red" must be #RRGGBB

INFO (1)
  - unknown key "experiment_flag"
```

## Notes

- `manifest` is plain text, not JSON. Roku is whitespace-sensitive around `=`. The validator preserves original line numbers in messages.
- If the project uses BrighterScript, the build step may write a different `manifest` to a `dist/` dir. Validate the artifact, not the source.
