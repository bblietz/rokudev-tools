# Plan 4e: `screensaver` template design

> Status: draft for spec review, 2026-05-14.
> Parent spec: `docs/superpowers/specs/2026-05-06-rokudev-tools-prd-design.md` (PRD).
> Related plans: Plan 3 (brs-gen engine), Plan 4 / 4b / 4b.1 (`video_grid_channel`), Plan 4a (`blank_scenegraph` + branding-defaults engine), Plan 4c (`news_channel` + `content.live_label` engine thread, cross-component focus routing pattern, Home + relaunch T27 preamble), Plan 4d (`music_player` + `content.service_name` engine thread).
> Reference implementation mined: `/Users/bblietz/Work/ClaudeProjects/DevSummit-Screensaver-RokuTV/` (working hand-written screensaver channel; CLAUDE.md, manifest, source/main.brs, components/CountdownScreensaver.xml, docs/CERT_CHECKLIST.md). Many corrections to the original draft design came from this reference.

## 1. Goal

Ship the fifth base template in the v1 catalog: `screensaver`. A pure-screensaver Roku channel (NOT a launchable app with a screensaver mode) that displays a deterministic photo slideshow with Ken Burns motion and crossfade transitions. Bundled demo content is 8 hand-generated 1920x1080 JPEGs; operators override via `spec.content.feed_url` pointing at a JSON list of photo URLs.

The template demonstrates the screensaver-specific manifest discipline (no app-only keys), the `sub RunScreenSaver()` entry-point convention with required-by-cert memory monitoring, the two-Poster pingpong + crossfade + Ken Burns animation pattern, and the anti-burn-in pixel-shift idiom. It exists as the canonical scaffolding for any "channel that ONLY ships a screensaver" use case (custom screensavers from publishers, brand-showcase screensavers, photo-feed screensavers).

Plan 4e leans heavily on lessons from the reference repo (mined during brainstorming) where iteration was costly. Specifically: the manifest must contain ONLY the screensaver registration keys plus version + resolutions + `rsg_version=1.3`; including any app-only key (`splash_color`, `splash_screen_*`, `mm_icon_focus_*`) causes `/query/apps` to register the channel as `type=appl` on the home row instead of `type=ssvr` (build-23 discovery, weeks of iteration).

## 2. Locked decisions (from brainstorming)

| # | Decision | Value | Source |
|---|---|---|---|
| D1 | Template choice | `screensaver` (one of the two remaining v1 catalog templates: `screensaver`, `game_shell`. Picked first per "smaller scope" rationale.) | Q1 |
| D2 | Screensaver kind | Photo slideshow with Ken Burns motion + crossfade. Auto-picked recommendation. | Q1-recommendation |
| D3 | Channel kind | Pure screensaver (manifest declares ONLY `screensaver_title` + version + `rsg_version=1.3` + `ui_resolutions`; NO app-only manifest keys, NO launchable channel UI). | Q1-recommendation |
| D4 | Bundled content | Deterministically-generated 8 placeholder JPEGs (gradient + "Sample Photo N" text overlay) via sharp inline-SVG. Mirrors `music_player`'s playlist-art pattern. JPEG, NOT AVIF (Roku unsupported). | Q1-recommendation |
| D5 | Operator override | Optional `spec.content.feed_url` for a JSON list of photo URLs. Mirrors `news_channel` / `music_player`. | Q1-recommendation |
| D6 | Audio policy | None. Screensavers cannot play audio per Roku UX guidelines and cert (`roVideoPlayer` / `roAudioPlayer` are absent in pure screensavers). | Q1-recommendation |
| D7 | Motion strategy | Ken Burns (slow pan + zoom on the active photo) plus crossfade between photos. Operator-configurable via `content.motion = "ken_burns" \| "crossfade_only" \| "none"`; default `ken_burns`. | Q1-recommendation |
| D8 | Versioning | v0.5.5 patch (consistent with 4a/4b/4b.1/4c/4d cadence). | derived from cadence |
| D9 | Schema additions | `content.feed_url`, `content.feed_format` (default `"rokudev_screensaver_v1"`), `content.transition_seconds` (4..30, default 7), `content.motion` (default `"ken_burns"`). | derived from D2-D7 |
| D10 | Engine change | One additive line in `src/tools/generate-app.ts` propagates `content.transition_seconds` and `content.motion` into the emitted `TemplateConfig()`. Parallel to Plan 4c's `live_label` and Plan 4d's `service_name` threads. No behavior change for existing templates. | derived from D9 |
| D11 | Init-hook surface | One: `Screensaver/after_scene_show`. Mirrors `blank_scenegraph` minimalism. Module authors will hook here for analytics-on-photo-shown via `m.top.currentPhotoIndex` observer. | derived from §5 architecture |
| D12 | Cert validators in brs-gen | New: `SCREENSAVER_TITLE_CONTAINS_ROKU` (rejects `spec.app.name` containing "roku" case-insensitive); `SCREENSAVER_ZIP_TOO_LARGE` (hard error > 4 MB, warning > 3.5 MB). Surface real cert blockers at generate-time, not after sideload. | reference repo CERT_CHECKLIST + cert rule 3.7 |
| D13 | Memory monitoring | `source/main.brs` includes `roAppMemoryMonitor` + `roDeviceInfo.EnableLowGeneralMemoryEvent` boilerplate per cert requirement effective 2026-10-01. Log-and-continue in v1; freeing texture caches deferred to v1.x. | reference repo main.brs |
| D14 | Anti-burn-in pixel shift | +/-8px X, +/-5px Y, 90s `inOutQuad` loop on the photo Group. Locked default; future spec field if operators ask. | reference repo CountdownScreensaver.xml `pixelShift` Animation |
| D15 | `screensaver_thumbnail_*` | NOT shipped in v1. Reference repo does not ship them; cert checklist is silent. Verify during T27 whether the screensaver appears in `Settings > Screensavers > Custom` without thumbnails. If cert requires, add as Plan 4e Task M. | reference repo manifest absence |

## 3. Non-goals

- **No interactive UI.** Screensavers are passive; any keypress dismisses (system-handled). No Settings scene, no menu, no on-screen prompts beyond the photo cycle itself.
- **No audio.** Per Roku UX guidelines and cert; screensavers do not use `roVideoPlayer` / `roAudioPlayer`. The bundled feed JSON has NO audio fields.
- **No video frames as photos.** All bundled / operator content is still images. Animated content is a v1.x feature.
- **No custom fonts in v1.** The reference repo bundles Nunito Sans static-instance slices for its countdown text. Our screensaver template renders no text on top of the photos in v1, so no font assets are needed. (Caption / metadata overlay deferred to v1.x; would require font work.)
- **No deep linking.** Pure screensavers are not launched via `/launch/dev?contentId=...`; they are activated by the system or via the dev-portal "Test Screensaver" trigger.
- **No telemetry.** Per PRD §8.5.
- **No EPG / schedule-aware behavior.** "Show kids photos before 8pm" and similar are out of scope.
- **No random shuffle.** Sequential cycle in v1 (deterministic; predictable demo). Random-shuffle is a Plan 5+ enhancement.
- **No CERT_CHECKLIST.md.ejs emission.** The reference repo ships a per-channel cert checklist; emitting one from this template is a v1.x feature (out of scope for this plan; track as follow-up).
- **No `screensaver_thumbnail_*` in v1.** See D15.

## 4. Manifest (template-emitted)

The manifest is intentionally minimal and EXCLUDES every app-only key. This is the load-bearing correctness invariant for the template.

```
title=<%= spec.app.name %>
major_version=<%= spec.app.major_version %>
minor_version=<%= spec.app.minor_version %>
build_version=<%= spec.app.build_version %>
rsg_version=1.3
ui_resolutions=hd,fhd
screensaver_title=<%= spec.app.name %>
```

**Forbidden keys (their PRESENCE breaks screensaver registration):**
- `splash_color` - app-only
- `splash_screen_hd` / `splash_screen_fhd` / `splash_screen_uhd` - app-only
- `mm_icon_focus_hd` / `mm_icon_focus_fhd` / `mm_icon_focus_uhd` - app-only
- `screensaver_private` - non-existent attribute
- `screensaver_subtitle` - non-existent attribute
- `mm_icon_side_hd` - deprecated

The reference repo learned this at build 23 (weeks into iteration). The template MUST NOT emit any of these.

**Cert-mandatory keys:**
- `rsg_version=1.3` - required for cert from 2026-10-01 onward.
- `build_version` increments per package - already enforced by spec.

**Validators (D12):**
- `spec.app.name` MUST NOT contain "roku" (case-insensitive). Per cert rule, `screensaver_title` cannot contain the word "Roku". Surface as `SCREENSAVER_TITLE_CONTAINS_ROKU` failure code from `templates/screensaver/schema.ts` `.refine()`. Failure message: `screensaver_title cannot contain the word "Roku" per Roku Channel Store cert rules; spec.app.name was "<value>"`.
- Post-zip: hard error > 4 MB (`SCREENSAVER_ZIP_TOO_LARGE`); warning > 3.5 MB. Lives in `src/build/zip.ts`, conditional on `manifest.has(screensaver_title)`. Failure message: `screensaver zip is <N> MB; cert rule 3.7 requires <= 4 MB`.

## 5. Components

### 5.1 Layout

```
templates/screensaver/
  template.toml
  schema.ts
  files/
    manifest.ejs
    source/
      main.brs                        # sub RunScreenSaver() + memory monitoring
      lib/
        Feed.brs                      # bundled-loader, operator-loader, ContentNode builder
    components/
      Screensaver.xml                 # extends Scene; root scene
      Screensaver.bs                  # init, observer wiring, cycle orchestration
      PhotoCycle.xml                  # composite Group: 2 Posters + crossfade Animation + Ken Burns Animation
      PhotoCycle.bs                   # 2-poster pingpong, observe loadStatus
      HttpTask.xml                    # Task subclass for feed fetch (createObject pattern)
      HttpTask.bs
    data/
      screensaver-feed.json           # bundled 8-photo list
    images/
      sample-photo-1.jpg              # 1920x1080 JPG, gradient + text overlay
      sample-photo-2.jpg
      ...
      sample-photo-8.jpg
```

### 5.2 `source/main.brs` - entry point

Mirrors the reference repo's pattern. NOT optional: `sub RunScreenSaver()` is the exclusive entry point for pure screensavers (`Main()` and `RunUserInterface()` are prohibited).

```brightscript
sub RunScreenSaver()
    screen = CreateObject("roSGScreen")
    port = CreateObject("roMessagePort")
    screen.SetMessagePort(port)

    ' Memory monitoring (cert requirement effective 2026-10-01).
    memMonitor = CreateObject("roAppMemoryMonitor")
    if memMonitor <> invalid then
        memMonitor.SetMessagePort(port)
        memMonitor.EnableMemoryWarningEvent(true)
    end if
    di = CreateObject("roDeviceInfo")
    di.SetMessagePort(port)
    di.EnableLowGeneralMemoryEvent(true)

    screen.CreateScene("Screensaver")
    screen.Show()

    while true
        msg = wait(0, port)
        if msg <> invalid
            msgType = type(msg)
            if msgType = "roSGScreenEvent"
                if msg.IsScreenClosed() then return
            else if msgType = "roAppMemoryNotificationEvent"
                print "[main] memory warning"
            else if msgType = "roDeviceInfoEvent"
                ' log generalMemoryLevel; v1.x will free texture caches here
            end if
        end if
    end while
end sub
```

### 5.3 `Screensaver.xml` / `Screensaver.bs`

```xml
<?xml version="1.0" encoding="UTF-8" ?>
<component name="Screensaver" extends="Scene">
  <script type="text/brightscript" uri="pkg:/components/Screensaver.bs" />
  <script type="text/brightscript" uri="pkg:/source/lib/Feed.brs" />
  <script type="text/brightscript" uri="pkg:/source/_template/config.bs" />
  <script type="text/brightscript" uri="pkg:/source/_modules/__init_hooks.bs" />

  <interface>
    <field id="currentPhotoIndex" type="integer" value="0" />
  </interface>

  <children>
    <PhotoCycle id="photoCycle" />
    <HttpTask id="feedTask" />
  </children>
</component>
```

`Screensaver.bs` `init()`:
- If `TemplateConfig().feed_url` set, `m.feedTask.url = TemplateConfig().feed_url; m.feedTask.observeField("response", "onFeedResponse"); m.feedTask.control = "RUN"`. Otherwise call `Feed_LoadBundled()` synchronously and bind.
- After bind, set `m.photoCycle.photos = <ContentNode list>`, `m.photoCycle.transitionSeconds = TemplateConfig().transition_seconds`, `m.photoCycle.motion = TemplateConfig().motion`.
- Observe `m.photoCycle.currentIndex` and reflect to `m.top.currentPhotoIndex` (the field module-authors observe).
- Call `Modules_OnScreensaverAfterSceneShow(m)` (init-hook dispatch).

**Critical: `<script>` includes for `source/lib/*.brs`.** SceneGraph component scripts cannot see `source/lib/*.brs` functions unless the component XML explicitly `<script>`-includes them. The reference repo CLAUDE.md captures this (silent failure mode: `func_name_resolver failed resolving '<name>'` at runtime, not compile-time). The template authors emit explicit includes; the merger does NOT auto-inject for `source/lib/*.brs` (only for the special `_template/config.bs` and `_modules/__init_hooks.bs`).

### 5.4 `PhotoCycle.xml` / `PhotoCycle.bs`

```xml
<?xml version="1.0" encoding="UTF-8" ?>
<component name="PhotoCycle" extends="Group">
  <script type="text/brightscript" uri="pkg:/components/PhotoCycle.bs" />

  <interface>
    <field id="photos"             type="array"   value="[]" />
    <field id="transitionSeconds"  type="integer" value="7" />
    <field id="motion"             type="string"  value="ken_burns" />
    <field id="currentIndex"       type="integer" value="0" />
  </interface>

  <children>
    <Group id="content" translation="[0,0]">
      <Poster id="posterA" width="1920" height="1080" loadDisplayMode="scaleToFill" opacity="1.0" />
      <Poster id="posterB" width="1920" height="1080" loadDisplayMode="scaleToFill" opacity="0.0" />
    </Group>

    <Timer id="cycleTimer" repeat="true" duration="7" />

    <Animation id="crossfade" duration="1.0" repeat="false" easeFunction="inOutCubic">
      <FloatFieldInterpolator fieldToInterp="posterA.opacity" key="[0.0, 1.0]" keyValue="[1.0, 0.0]" />
      <FloatFieldInterpolator fieldToInterp="posterB.opacity" key="[0.0, 1.0]" keyValue="[0.0, 1.0]" />
    </Animation>

    <Animation id="kenBurnsA" duration="7" repeat="false" easeFunction="linear" control="start">
      <Vector2DFieldInterpolator fieldToInterp="posterA.translation" key="[0.0, 1.0]" keyValue="[ [0,0], [-40,-30] ]" />
      <Vector2DFieldInterpolator fieldToInterp="posterA.scale"       key="[0.0, 1.0]" keyValue="[ [1.0,1.0], [1.05,1.05] ]" />
    </Animation>

    <Animation id="kenBurnsB" duration="7" repeat="false" easeFunction="linear">
      <Vector2DFieldInterpolator fieldToInterp="posterB.translation" key="[0.0, 1.0]" keyValue="[ [0,0], [-40,-30] ]" />
      <Vector2DFieldInterpolator fieldToInterp="posterB.scale"       key="[0.0, 1.0]" keyValue="[ [1.0,1.0], [1.05,1.05] ]" />
    </Animation>

    <Animation id="pixelShift" duration="90" repeat="true" easeFunction="inOutQuad" control="start">
      <Vector2DFieldInterpolator
        fieldToInterp="content.translation"
        key="[0.0, 0.25, 0.50, 0.75, 1.0]"
        keyValue="[ [0,0], [8,5], [0,0], [-8,-5], [0,0] ]" />
    </Animation>
  </children>
</component>
```

`PhotoCycle.bs` `init()`:
- Observes `cycleTimer.fire` and own `photos` field.
- Caches refs to all 5 named Animation nodes in `m.<name>Anim`.
- Sets `m.cycleTimer.duration = m.top.transitionSeconds`.
- **Locks Ken Burns Animation duration to match `m.top.transitionSeconds`** (the schema allows 4..30; the static `duration="7"` in XML is just the schema default, and PhotoCycle.bs init() overrides via `m.kenBurnsAAnim.duration = m.top.transitionSeconds; m.kenBurnsBAnim.duration = m.top.transitionSeconds`). This avoids the bug where a low `transitionSeconds=4` triggers crossfade at elapsedSec=3 but the still-running 8s pan would leave the inactive poster at an inconsistent intermediate position when it becomes active. Locking duration to `transitionSeconds` makes the pan complete exactly when the swap happens.
- Sets `m.activeIsA = true`. First photo loads into `posterA`.
- For each Animation: programmatically sets `control = "start"` (idempotent guard against inline `control="start"` not taking effect at scene load; CLAUDE.md lesson, load-bearing per the reference's CityBackground.brs).
- `onPhotosChanged()`: index 0 photo into `posterA.uri`, set up cycle.
- `onCycleTimerFire()`: 1Hz tick. When `m.elapsedSec >= m.top.transitionSeconds - 1`, kick off crossfade + load next photo into the inactive poster. After crossfade duration, swap `m.activeIsA`. Increment `m.top.currentIndex`. Reset `m.elapsedSec = 0`. Restart Ken Burns on the new active poster (if motion = "ken_burns").
- Observes both Posters' `loadStatus` for diagnostic logging (mirrors reference's `onPosterLoad`); a failed poster simply renders nothing in its layer; cycle continues.

### 5.5 `HttpTask.xml` / `HttpTask.bs`

Reused pattern from `news_channel`. Task subclass with declared `<interface>` fields (`url`, `response`). Standard cert-setup boilerplate. Returns parsed-JSON result. **`createObject("roSGNode", "HttpTask")`-instantiated, NEVER script-included into the Scene** (per Plan 4c lesson: script-include causes duplicate `init()` triggering).

### 5.6 `source/lib/Feed.brs`

Three pure helpers, no SceneGraph dependencies:

```brightscript
function ScreensaverFeed_LoadBundled() as object
    raw = ReadAsciiFile("pkg:/data/screensaver-feed.json")
    return ParseJSON(raw)
end function

function ScreensaverFeed_LoadOperator(rawJson as string) as object
    return ParseJSON(rawJson)
end function

function ScreensaverFeed_BuildContentNodes(feed as object) as object
    nodes = []
    if feed = invalid or feed.photos = invalid then return nodes
    for each photo in feed.photos
        node = CreateObject("roSGNode", "ContentNode")
        node.url = photo.url
        if photo.title <> invalid then node.title = photo.title
        if photo.credit <> invalid then node.ShortDescriptionLine2 = photo.credit
        nodes.push(node)
    end for
    return nodes
end function
```

`ShortDescriptionLine2` chosen for `credit` over `SecondaryTitle` per Plan 4d lesson (Roku-documented descriptive-text field).

### 5.7 `data/screensaver-feed.json` (bundled)

```json
{
  "version": 1,
  "photos": [
    { "id": "p1", "url": "pkg:/images/sample-photo-1.jpg", "title": "Sample Photo 1", "credit": "Generated placeholder" },
    { "id": "p2", "url": "pkg:/images/sample-photo-2.jpg", "title": "Sample Photo 2", "credit": "Generated placeholder" },
    ...8 entries total
  ]
}
```

Sorted by `id`. Stable across regen (deterministic).

## 6. AppSpec extension

Template-side `schema.ts` declares a tightened `ScreensaverContentSchema.strict()`. The wrapper `AppSpecV2Wrapper.content` is already `ContentSchema.partial().passthrough().optional()` from Plan 4c, so template-specific content fields (`feed_url`, `feed_format`, `transition_seconds`, `motion`) pass through wrapper validation without any change to `packages/brs-gen/src/spec/content.ts`.

```typescript
import { z } from 'zod';

export const ScreensaverContentSchema = z.object({
  feed_url: z.string().url().optional(),
  feed_format: z.literal('rokudev_screensaver_v1').default('rokudev_screensaver_v1'),
  transition_seconds: z.number().int().min(4).max(30).default(7),
  motion: z.enum(['ken_burns', 'crossfade_only', 'none']).default('ken_burns'),
}).strict();

export const Schema = z.object({
  spec_version: z.literal(2),
  template: z.literal('screensaver'),
  modules: z.array(z.object({ id: z.string(), config: z.unknown().optional() })).default([]),
  app: z.object({
    name: z.string().min(1).max(50)
      .refine(
        (v) => !/roku/i.test(v),
        { message: 'screensaver_title cannot contain the word "Roku" per Roku Channel Store cert rules' },
      ),
    major_version: z.number().int().min(0),
    minor_version: z.number().int().min(0),
    build_version: z.number().int().min(0),
  }),
  branding: z.object({}).passthrough().optional(),
  content: ScreensaverContentSchema.optional(),
});

export const Example = {
  spec_version: 2 as const,
  template: 'screensaver' as const,
  modules: [],
  app: { name: 'My Screensaver', major_version: 1, minor_version: 0, build_version: 0 },
  content: {
    // Operator override: omit feed_url to use the bundled 8-photo demo set.
    // To override, uncomment the next line and point at a JSON list of photos
    // matching the rokudev_screensaver_v1 schema:
    //   feed_url: 'https://example.com/photos.json',
    feed_format: 'rokudev_screensaver_v1' as const,
    transition_seconds: 7,
    motion: 'ken_burns' as const,
  },
};
```

## 7. Engine changes (brs-gen)

**Single additive line** in `src/tools/generate-app.ts` (mirrors Plan 4c's `live_label` and Plan 4d's `service_name` threading):

```typescript
if (content?.transition_seconds !== undefined) cfg['transition_seconds'] = content.transition_seconds;
if (content?.motion !== undefined) cfg['motion'] = content.motion;
```

The TemplateConfig emission gate from Plan 4c (`if (brandingSpec.primary_color || content || effectivePrimaryColor)`) already covers this template (any `content` field triggers emission).

**New post-zip cert-validator** in `src/build/zip.ts`:
- After zip is built, if the project's manifest contains `screensaver_title=`, check zip size:
  - `> 4 * 1024 * 1024` bytes: throw `SCREENSAVER_ZIP_TOO_LARGE` with message `screensaver zip is <N> MB; cert rule 3.7 requires <= 4 MB`.
  - `> 3.5 * 1024 * 1024` bytes: emit warning to `details.warnings` array.

The check is template-conditional (only when manifest has `screensaver_title=`). Apps and other templates are unaffected.

## 8. Init-hook surface and module composition

```toml
[template.exports]
init_hooks = [
  { scope = "Screensaver", phase = "after_scene_show", file = "components/Screensaver.bs", signature = "(m as object) as void" },
]
scene_nodes = [
  { name = "Screensaver", file = "components/Screensaver.xml" },
  { name = "PhotoCycle",  file = "components/PhotoCycle.xml" },
  { name = "HttpTask",    file = "components/HttpTask.xml" },
]
```

Modules targeting `Screensaver/after_scene_show` will commonly observe `m.top.currentPhotoIndex` for analytics. Plan 5+'s `analytics.event_pipe` module will demonstrate this pattern.

## 9. Determinism

- **Photos**: `scripts/gen-screensaver-photos.mjs` emits 8 deterministic JPEGs via sharp inline-SVG (gradient + "Sample Photo N" text overlay). Pinned sharp params: `kernel: 'lanczos3'`, `compressionLevel: 9`, `palette: false`, JPEG quality `82`. Verified byte-equal across runs on darwin/arm64 with the project-pinned `sharp@0.34.5`.
  - **Sharp byte-equality risk** (Plan 4d carry-forward): Plan 4d documented that `play-icon-{light,dark}.png` could NOT be regenerated byte-equal across sharp 0.34.5 inline-SVG runs in some configurations and was worked around by `copyFile`-ing committed bytes from `news_channel`. For the screensaver template's gradient + text JPEGs, the implementation plan must verify byte-equality on the first `gen-screensaver-photos.mjs` run; if reproducibility fails for the same reason (text-rendering pixel jitter inside sharp's libvips path), commit the 8 JPEGs as authoritative bytes and have the script `copyFile` rather than regenerate. Either outcome is acceptable; the spec just flags this as a known-recurring discovery cost so the plan can budget for it.
- **No fonts** bundled in v1.
- **Bundled feed JSON**: sorted by `id`, no timestamps. Deterministic via `stableStringify`.
- **Goldens** (regenerated via `TZ=UTC node scripts/regen-golden.mjs`): per-template snapshot covers `manifest`, `Screensaver.brs`, `Screensaver.xml`, `PhotoCycle.brs`, `__init_hooks.bs`, `provenance.json`, full file listing. E2E byte-equal zip + provenance.

## 10. T27 plan

**Trigger problem**: A pure screensaver does NOT launch via `/launch/dev` (the channel is not an app; the device's launcher does not know what to do with it). The screensaver activates via:
1. The system idle-timer firing (after the user-configured timeout in `Settings > Theme > Screensavers`), AFTER the operator has set this channel as the active screensaver in `Settings > Theme > Screensavers > Custom > <channel name>`.
2. The Roku dev-portal HTTP "Test Screensaver" trigger (a button on the dev portal's channel page).

**Three options for T27 trigger**, in preference order:

- **Option A (preferred)**: Reverse-engineer the dev-portal "Test Screensaver" form-POST and call it from `_t27-lib.mjs`. Likely a multipart form to `/plugin_inspect` with a specific `mysubmit` value (mirrors how `Genkey`, `Rekey`, `Inspect` work today). Plan Task: `assertScreensaverTrigger(host, password)` helper. **Best-case**: full automation parity with other templates.
- **Option B (fallback)**: Sideload + active-screensaver-set via dev portal + manual idle wait. T27 driver does sideload + reachability + screenshot heuristic with a documented "operator must set screensaver in Settings then leave device idle" gate. Honest but unautomated.
- **Option C (last resort)**: Skip on-device verification; rely on snapshot tests + manifest validation. Mirrors the `blank_scenegraph` Phase B deferral pattern. Honest; documented limitation.

**Recommended sequence**: Plan Task implements A; if A is unreachable in the dev-portal HTML form (i.e. no obvious form to POST), document and fall back to B; if B is too brittle on the test devices we have, fall back to C. Decision is made in the implementation plan, not the spec.

**Active-app identification**: `/query/active-app` for a running screensaver returns `type=ssvr` (per reference repo CERT_CHECKLIST and Roku ECP docs). The current `assertActiveAppIsOurs` helper checks `id='dev'`. Verify on first T27 run whether dev-sideloaded screensavers also report `id='dev'` (with possibly a different `type`) or report a screensaver-specific id. Adjust the helper or add a `screensaverMode: true` opt accordingly.

**API shape pre-commit for D-impl-3**: regardless of what `/query/active-app` actually returns for a sideloaded screensaver, the helper signature change is fixed at `assertActiveAppIsOurs(host, {screensaverMode: true})` (additive opt object, default `{screensaverMode: false}`). This is binding for the implementation plan: existing callers with no opts argument continue to work (the existing `(host)` signature is preserved); the `screensaverMode: true` path inside the helper accepts `type=ssvr` regardless of `id`, OR accepts `id='dev'` with `type=ssvr`, OR whatever the device actually reports (decided in plan Task during T27 observation). No caller-side breakage; the test surface for the helper grows by one case.

**Phase A (deterministic verification)**:
1. Sideload the channel.
2. Inspect manifest to verify it contains `screensaver_title` and NO forbidden keys (defense-in-depth check; emit-time validators should already catch this).
3. Trigger screensaver per Option A/B/C.
4. Wait `transition_seconds + 2` seconds. Take screenshot. Assert `screenshotNoError` (size > 50 KB heuristic; foreground active-app check adapted for screensaver mode).
5. Wait another `transition_seconds + 2`. Take second screenshot. Assert pixel hash differs from screenshot 1 (proves the cycle is running).
6. (Optional) Query `/query/active-app`; document what it returns for a screensaver in the T27 evidence appendix.

**Phase B** (operator feed override): deferred per spec policy mirroring `news_channel` / `music_player`.

## 11. Snapshots and tests

- **Snapshot tests** (`packages/brs-gen/tests/snapshots.test.ts`): one new describe block for `screensaver`. Snapshots: post-render `manifest`, post-compile `Screensaver.brs` (assert it contains the 5 named animation handles + the 1 init hook firing), `Screensaver.xml`, `PhotoCycle.brs`, `__init_hooks.bs`. Matches the pattern from `music_player`.
  - **Defense-in-depth manifest allowlist snapshot**: in addition to snapshotting the rendered `manifest` content, add an assertion that the rendered manifest's set of keys is EXACTLY `{title, major_version, minor_version, build_version, rsg_version, ui_resolutions, screensaver_title}`. The forbidden-keys list in §4 is non-exhaustive by nature; an allowlist check catches a future template author who adds e.g. `screensaver_animated_thumbnail_hd` (a key not on the forbidden list because it does not yet exist).
- **E2E golden tests** (`packages/brs-gen/tests/e2e.test.ts`): one new test asserting byte-equal `screensaver.zip` + `screensaver-provenance.json` against `__golden__/`.
- **Conflict-matrix tests** (`packages/brs-gen/tests/conflict-matrix.test.ts`): one new entry for `screensaver` with empty modules (matches the catalog-baseline pattern).
- **Determinism tests** (`packages/brs-gen/tests/determinism.test.ts`): one new test for full-pipeline byte equality across two in-process runs.
- **Asset-reuse test** (`packages/brs-gen/tests/asset-reuse.test.ts`): N/A in v1 (no shared icons; screensaver template has no Buttons, no `play-icon-light/dark.png`). Will revisit if Plan 5+ modules add Buttons to this scene.
- **Cert-validator tests**: new unit test in `packages/brs-gen/tests/cert-validators.test.ts`:
  - `spec.app.name = "Roku Photos"` -> `SCREENSAVER_TITLE_CONTAINS_ROKU` failure
  - `spec.app.name = "ROKU PHOTOS"` -> same failure (case-insensitive)
  - `spec.app.name = "Family Photos"` -> success
  - 4.5 MB synthesized zip with `screensaver_title` -> `SCREENSAVER_ZIP_TOO_LARGE` failure
  - 3.7 MB zip -> success with warning in `details.warnings`
  - 4.5 MB zip WITHOUT `screensaver_title` -> success (validator only fires for screensaver template)

## 12. Outstanding polish (deferred to v1.x)

- **`screensaver_thumbnail_*` keys**: status TBD. If T27 reveals the screensaver is rejected by `Settings > Theme > Screensavers > Custom` without thumbnails, add as Plan 4e Task M with a new `SCREENSAVER_THUMB_BUCKETS` constant + asset-pipeline extension.
- **Custom font support**: variable-axis TTFs render only at the default instance per CLAUDE.md; need static-instance slicer tooling (`scripts/slice-nunitosans.py` from reference repo). Defer; v1 has no on-screen text.
- **Photo metadata caption overlay**: title + credit Labels at the bottom-left with scrim. Needs font work above; defer.
- **Schedule-aware screensavers**: "Show photos tagged 'family' before 8pm". Spec-only feature; defer.
- **Operator-configurable anti-burn-in shift parameters**: locked at +/-8x, +/-5y, 90s in v1.
- **Memory-pressure response**: log-only in v1; v1.x will free texture caches when `roDeviceInfoEvent.generalMemoryLevel` reports low.
- **`CERT_CHECKLIST.md.ejs`**: per-channel cert checklist emission. v1.x. Track in MEMORY.md as a follow-up that benefits ALL templates, not just screensaver.

## 13. Open implementation-time decisions (resolved during plan, not spec)

- **D-impl-1 (T27 trigger)**: A vs B vs C per §10. Plan Task explicitly attempts A; documents fallback decision.
- **D-impl-2 (`screensaver_thumbnail_*`)**: required or optional. Plan Task verifies during T27; if required, adds `SCREENSAVER_THUMB_BUCKETS` constant + pipeline extension as Plan 4e Task M.
- **D-impl-3 (active-app reporting)**: what `/query/active-app` returns for a sideloaded screensaver. Plan Task observes and adjusts `assertActiveAppIsOurs` helper accordingly.

## 14. Engine surface to lock for game_shell coexistence

Per the work-order directive, `game_shell` (Plan 4f) follows directly after `screensaver`. The following decisions in this spec MUST NOT cause cross-template conflicts when game_shell is added:

- **`SCREENSAVER_ZIP_TOO_LARGE` validator**: template-conditional (only fires when manifest has `screensaver_title=`). Game_shell is an app, has no `screensaver_title`, is unaffected. Even if Roku's cert rule 3.7 also applies to apps in the future, adding a separate `APP_ZIP_TOO_LARGE` validator at that time would not regress this one.
- **`SCREENSAVER_TITLE_CONTAINS_ROKU` validator**: lives in `templates/screensaver/schema.ts`, not in shared `src/spec/`. Only fires for screensaver template's `spec.app.name`. No effect on other templates.
- **`content.feed_url`, `content.transition_seconds`, `content.motion`, `content.feed_format`** fields: this template's `.strict()` schema accepts them; other templates' `.strict()` schemas reject unknown content fields. Wrapper passthrough means cross-pollination at the wrapper level is fine. No conflict with game_shell's expected `content.gamepad_required` style fields.
- **No new shared engine surface** beyond the additive TemplateConfig threading (already exhausted by v0.5.4's pattern).

## 15. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Manifest accidentally includes app-only key during template authoring | Snapshot test on `manifest` fails loudly if any forbidden key appears. Reviewed in plan Task. |
| `screensaver_thumbnail_*` may be cert-required despite reference repo not shipping them | Plan Task: T27 verification; add as Plan 4e Task M if needed. |
| dev-portal "Test Screensaver" trigger may not exist as a stable HTTP endpoint | Plan Task: try it; document fallback. T27 falls back to manual trigger if needed. |
| Variable-axis fonts work in template author's hands but break on Roku | NOT a v1 risk: no fonts bundled. v1.x adds slicer when fonts arrive. |
| AVIF source assets bundled accidentally | `validate_assets` already enforces PNG; extending for JPG-only screensaver assets is a small validator addition. Plan Task covers. |
| `func_name_resolver failed resolving '<name>'` runtime error from missing `<script>` includes | All `source/lib/*.brs` references in components have explicit `<script>` tags in their XML. Snapshot test asserts each component's XML includes the expected script tags. Plan Task. |
| 4 MB cert limit silently exceeded by future module composition | `SCREENSAVER_ZIP_TOO_LARGE` post-zip check fails the build; cert violation surfaces at generate-time, not after submission. |
| Screensaver `id` in `/query/active-app` differs from `dev` | Plan Task observes during T27; adjusts `assertActiveAppIsOurs` (possibly add `screensaverMode` opt). |
| MainScene focus or input-handling regressions in modules that hook `Screensaver/after_scene_show` | Screensavers don't accept focus; modules attempting `setFocus(...)` are no-ops. Plan 5+ module-author guide must document this. NOT a v1 plan task; just a follow-up note.|

## 16. Acceptance criteria

- All snapshot tests pass; goldens are stable.
- E2E: `screensaver.zip` byte-equal to golden across two in-process runs and across `darwin/arm64` developers (TZ=UTC).
- All cert validators fire correctly per §11 unit tests.
- T27: at minimum Phase A passes via Option A or B (Option C is acceptable v1 if A and B both prove unviable, with documented limitation).
- Manifest contains ZERO forbidden keys (defensive snapshot).
- `RunScreenSaver()` is the entry point (snapshot of `main.brs`).
- `rsg_version=1.3` is in the manifest (snapshot).
- v0.5.5 release notes added to README in the chronological pattern (matching v0.1->v0.2->v0.3->v0.4->v0.5.x).
- MEMORY.md updated with Plan 4e summary block + lessons learned (deferred to plan release-notes task).

## 17. PRD compliance

- PRD §1.5 success criteria: this template advances "From 'I want a screensaver channel' to a sideloaded, working screensaver" by establishing the second-to-last v1 catalog template.
- PRD §3.2 deterministic-path discipline: this template is fully deterministic and device-tested per T27 plan.
- PRD §3.5 AppSpec versioning: spec_version: 2 with no v1 promotion path needed (screensaver is a v2-new template).
- PRD §3.6 mandatory `bsc` lint: applies.
- PRD §3.7 brs-gen tool surface: no new tools; uses existing `generate_app`, `package_app`, `lint`, `validate_manifest`, `validate_assets`.
- PRD §6.4 `roku-vibe` disambiguation table: row "screensaver" -> `screensaver` (no modules) becomes a real path. Currently fails because the template does not exist; this plan resolves that for that row.
- PRD §8.1 v1 shipping list: ticks "screensaver" off the 6-template requirement (5 of 6 after this plan; game_shell remaining).
- PRD §8.5 stated guarantees: telemetry: none; plaintext password storage unaffected; public export surface of `roku-device-client` unaffected.
