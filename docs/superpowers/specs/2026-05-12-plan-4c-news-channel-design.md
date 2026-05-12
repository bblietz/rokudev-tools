# Plan 4c: `news_channel` template design

> Status: draft for spec review, 2026-05-12.
> Parent spec: `docs/superpowers/specs/2026-05-06-rokudev-tools-prd-design.md` (PRD).
> Related plans: Plan 3 (brs-gen engine), Plan 4 (`video_grid_channel` template), Plan 4a (`blank_scenegraph` template + branding-defaults engine), Plan 4b/4b.1 (`video_grid_channel` polish + T27 honesty).

## 1. Goal

Ship the third base template in the v1 catalog: `news_channel`. A hybrid live+VOD news experience: a single live HLS stream presented in a left-hand hero, a vertical category rail on the right, and a 3-column poster grid sub-screen per category. Selecting a clip plays it directly; the live tile launches the live stream with Roku's default LIVE chrome.

The bundled content is a small, hand-authored synthetic JSON feed shipped with the template (`pkg:/data/news-feed.json`). Operators can override the feed URL via `spec.content.feed_url` (already an existing AppSpec field).

Plan 4c builds on, but does not regress, the load-bearing patterns from `video_grid_channel` post-v0.5.2: focusable hero composite with `iconUri`-bitmap Buttons, `vector2dArray` for any per-row RowList attribute, cached `createChild` references for removable overlays, foreground-checked `screenshotNoError` in the T27 driver, and deterministic re-sideload preambles.

## 2. Locked decisions (from brainstorming)

| # | Decision | Value | Source |
|---|---|---|---|
| D1 | Template flavor | Hybrid: live hero + on-demand category rows (NOT pure live, not pure VOD) | Q1 |
| D2 | Feed source | Bundled synthetic JSON inside the template (`pkg:/data/news-feed.json`) | Q2 |
| D3 | Feed shape | Custom-named fields (`live`, `categories`, `items`); NOT RDP-style | Q3 |
| D4 | MainScene layout | Two-column: live preview ~60% left, vertical category rail ~40% right (option B from mockup) | Q4 |
| D5 | CategoryGridScene layout | 3-column PosterGrid (option A from mockup); Select goes straight to PlayerScene; no DetailsScene intermediate | Q5 |
| D6 | Live source URL | NASA TV public HLS: `https://ntv1.akamaized.net/hls/live/2014075/NASA-NTV1-HLS/master.m3u8` | Q6 |
| D7 | Number of bundled categories | 5: Politics / Tech / Business / World / Sports | Q7 |
| D8 | Versioning | v0.5.3 patch (consistent with 4a/4b/4b.1 cadence) | Q8 |
| D9 | LIVE chrome strategy | Roku `Video` node default chrome via `content.live = true`. No custom scrubber suppression. | derived from D1+D6 |
| D10 | Schema additions | `content.live_label` (optional string, default `"LIVE"`) for badge text. No other new fields. | derived from D1 |
| D11 | Init-hook surface | `Main/before_scene_show`, `MainScene/after_scene_show`, **NEW** `CategoryGridScene/after_scene_show`, `PlayerScene/before_play` | derived from §4 architecture |

## 3. Non-goals

- No `DetailsScene`. News clips are short-form; one Select goes to PlayerScene. (Consistent with category-grid mockup A.)
- No DVR / scrubbing / live-edge UI for the live stream. Roku's default `Video` chrome handles whatever the HLS manifest exposes; we do not customize it.
- No custom feed-fetch path beyond `ReadAsciiFile()` for the bundled feed and `roUrlTransfer` (via existing HttpTask pattern) when `spec.content.feed_url` is an `http(s)://` URL. No incremental loading, no pagination, no cache layer.
- No per-category branding. Single `primary_color` across all categories.
- No search / filtering / sorting controls.
- No subscriptions / paywall / authentication.
- No live-stream switching (only one live source per channel).
- No conditional/dynamic feed merging.
- No reuse of `video_grid_channel`'s HeroUnit composite. `LiveHero` is a sibling, structurally similar but tailored to live-stream metadata + LIVE badge. Sharing components across templates is a Plan 5+ concern (component-extraction once two templates demonstrably need the same code path).

## 4. Architecture

The channel is five SceneGraph components. The MainScene is the entry point and owns layout; LiveHero, CategoryRail, and CategoryGridScene are children/sub-scenes; PlayerScene is the playback surface.

```
Scene
└── MainScene  (root; two-column layout, owns rotation/loading state)
    ├── LiveHero       (left ~60%; Group composite with poster + LIVE badge + title + summary + Watch Live Button)
    ├── CategoryRail   (right ~40%; vertical LabelList of category names)
    └── (sub-scene, pushed on category-Select)
        CategoryGridScene  (full-screen overlay; PosterGrid of items in selected category)
            └── (sub-scene, pushed on tile-Select)
                PlayerScene     (full-screen overlay; Roku Video node)

(Live-Watch from LiveHero also pushes PlayerScene directly, with content.live = true.)
```

Data flow:

```
pkg:/data/news-feed.json (bundled, EJS-rendered at generate time)
   OR
spec.content.feed_url     (operator override; HTTP fetch via HttpTask)
        │
        ▼
Feed.bs : ParseFeed(jsonText) → { live: ContentNode, categories: [{ id, name, items: [ContentNode] }] }
        │
        ▼
MainScene.init() → LiveHero.content = feed.live; CategoryRail.content = list of category names; CategoryRail.observeField("itemSelected", "onCategorySelected")
        │
        ▼ (Right + Select on a category)
MainScene.onCategorySelected → createChild("CategoryGridScene"), set scene.categoryItems, cache m.gridSceneRef
        │
        ▼ (Select on a tile in CategoryGridScene)
CategoryGridScene fires "itemSelected" → MainScene.onClipSelected → createChild("PlayerScene"), set scene.content (with .live = false), cache m.playerSceneRef
        │
        ▼ (Back from PlayerScene)
MainScene removes m.playerSceneRef, restores focus to CategoryGridScene
        │
        ▼ (Back from CategoryGridScene)
MainScene removes m.gridSceneRef, restores focus to CategoryRail
```

The Live-Watch path:

```
LiveHero playButton fires "buttonSelected" → MainScene.onLiveSelected → createChild("PlayerScene"), set scene.content (with .live = true), cache m.playerSceneRef
        │
        ▼ (Back from PlayerScene)
MainScene removes m.playerSceneRef, restores focus to LiveHero playButton
```

The post-v0.4.2 lesson is enforced everywhere overlays are created: cache the returned reference (`m.playerSceneRef`, `m.gridSceneRef`); never use `findNode` for removal.

## 5. Template files

```
packages/brs-gen/templates/news_channel/
├── template.toml
├── schema.ts
└── files/
    ├── manifest.ejs                    # placeholder (per engine convention)
    ├── data/
    │   └── news-feed.json              # bundled synthetic feed (EJS-rendered to allow <%= spec.app.name %> if desired; current draft is static)
    ├── images/
    │   ├── play-icon-light.png         # 48×48 dark glyph on transparent (for unfocused Buttons; same byte-for-byte as v0.5.2 video_grid)
    │   ├── play-icon-dark.png          # 48×48 light glyph on transparent (for focused Buttons; same byte-for-byte as v0.5.2 video_grid)
    │   └── live-thumb-placeholder.png  # 1280×720 dark gradient PNG used as live tile poster fallback (so the channel renders something even with no operator-supplied live poster)
    ├── source/
    │   ├── Main.bs
    │   ├── Feed.bs                     # ReadAsciiFile + ParseJson + ContentNode build
    │   └── HttpTask.bs                 # only used when spec.content.feed_url is http(s)://; same pattern as video_grid
    └── components/
        ├── MainScene.{xml,bs}
        ├── LiveHero.{xml,bs}
        ├── CategoryRail.{xml,bs}
        ├── CategoryGridScene.{xml,bs}
        ├── PlayerScene.{xml,bs}
        └── HttpTask.xml                # gates HTTP-feed path
```

### 5.1 `template.toml`

```toml
[template]
id = "news_channel"
version = "0.1.0"
spec_compat = ">=2"
description = "Hybrid live + on-demand news template. Live HLS hero (left), vertical category rail (right), 3-column PosterGrid sub-screen per category. Bundled synthetic feed; operator can override via spec.content.feed_url."

[template.manifest_defaults]
title           = "<%= spec.app.name %>"
major_version   = "<%= spec.app.major_version %>"
minor_version   = "<%= spec.app.minor_version %>"
build_version   = "<%= spec.app.build_version %>"
splash_color    = "<%= spec.branding.primary_color %>"
ui_resolutions  = "fhd,hd"
bs_const        = "DEBUG=false"
# mm_icon_focus_* and splash_screen_* injected by asset pipeline.

[template.exports]
init_hooks = [
  { scope = "Main",              phase = "before_scene_show",  file = "source/Main.bs",                signature = "(args as dynamic) as void" },
  { scope = "MainScene",         phase = "after_scene_show",   file = "components/MainScene.bs",       signature = "(m as object) as void" },
  { scope = "CategoryGridScene", phase = "after_scene_show",   file = "components/CategoryGridScene.bs", signature = "(m as object) as void" },
  { scope = "PlayerScene",       phase = "before_play",        file = "components/PlayerScene.bs",     signature = "(m as object) as void" },
]
scene_nodes = [
  { name = "MainScene",         file = "components/MainScene.xml" },
  { name = "LiveHero",          file = "components/LiveHero.xml" },
  { name = "CategoryRail",      file = "components/CategoryRail.xml" },
  { name = "CategoryGridScene", file = "components/CategoryGridScene.xml" },
  { name = "PlayerScene",       file = "components/PlayerScene.xml" },
]

[template.branding_defaults]
# Same defaults as video_grid; news inherits the engine's existing branding policy.
primary_color = "#0c1320"
```

`MainScene/before_content_load` and `after_content_load` are NOT exported. Modules that want to mutate the feed must do so via `MainScene/after_scene_show` (after Feed.bs has populated `m.feed`) or by replacing `spec.content.feed_url` upstream. This keeps the export surface to four hooks (D11), small enough to not over-promise extension points we'll regret in v1.x.

### 5.2 `schema.ts`

```ts
import { z } from 'zod';
import { AppSpecBase } from '../../src/spec/app-spec.js';
import { BrandingSchema } from '../../src/spec/branding.js';
import { ContentSchema } from '../../src/spec/content.js';

// news_channel-specific content extension.
const NewsContentSchema = ContentSchema.extend({
  live_label: z.string().min(1).max(12).optional(), // default applied at template-runtime (LiveHero.bs)
}).strict();

export const Schema = AppSpecBase.extend({
  template: z.literal('news_channel'),
  branding: BrandingSchema.partial().optional(),
  content: NewsContentSchema.optional(),
}).strict();

export const Example = {
  spec_version: 2,
  template: 'news_channel',
  modules: [],
  app: { name: 'News Channel Demo', major_version: 0, minor_version: 1, build_version: 0 },
  // No content block: bundled pkg:/data/news-feed.json is used.
  // No branding block: template_branding_defaults primary_color (#0c1320) drives synthesized icon + splash.
};
```

The `live_label` length cap (12) is enforced at schema-validate time — the badge is small (~6 chars at design size); long strings overflow the layout. Default is `"LIVE"` if absent.

### 5.3 Bundled feed: `files/data/news-feed.json`

Custom-named, hand-authored JSON. Static (not EJS-templated) in v1 to keep the feed identical across operator branding overrides. Schema:

```json
{
  "live": {
    "title": "NASA TV Live",
    "summary": "Continuous coverage from Kennedy Space Center, mission control, and crewed spaceflight operations.",
    "url": "https://ntv1.akamaized.net/hls/live/2014075/NASA-NTV1-HLS/master.m3u8",
    "stream_format": "hls",
    "thumbnail_url": "pkg:/images/live-thumb-placeholder.png"
  },
  "categories": [
    { "id": "politics", "name": "Politics", "item_ids": ["clip-pol-1", "clip-pol-2", "clip-pol-3", "clip-pol-4", "clip-pol-5", "clip-pol-6"] },
    { "id": "tech",     "name": "Technology", "item_ids": ["clip-tec-1", "clip-tec-2", "clip-tec-3", "clip-tec-4", "clip-tec-5"] },
    { "id": "business", "name": "Business",   "item_ids": ["clip-bus-1", "clip-bus-2", "clip-bus-3"] },
    { "id": "world",    "name": "World",      "item_ids": ["clip-wor-1", "clip-wor-2", "clip-wor-3", "clip-wor-4"] },
    { "id": "sports",   "name": "Sports",     "item_ids": ["clip-spo-1", "clip-spo-2", "clip-spo-3"] }
  ],
  "items": [
    {
      "id": "clip-pol-1",
      "title": "Election update — Q4 polling cycle",
      "summary": "Latest data from key swing states ahead of the next primary.",
      "url": "https://demo.avideo.com/videos/2024/05/12/12345/sample.mp4",
      "stream_format": "mp4",
      "duration_s": 154,
      "thumbnail_url": "pkg:/images/live-thumb-placeholder.png"
    }
    /* ... 20 more items, one per item_id across all categories ... */
  ]
}
```

Notes on the shape:

- `live.url` is the NASA TV public HLS endpoint (D6). Same fix-forward policy as `video_grid_channel`'s AVideo demo URL: if the stream URL rotates or 404s, we patch the bundled feed in a follow-up release. Channels using `spec.content.feed_url` to override are unaffected.
- `items[].url` for VOD clips uses the AVideo demo platform (already the demo source for `video_grid_channel`, already accepted as fix-forward). All 21 items reuse a small set of distinct sample MP4 URLs from that platform (probably 3-5 distinct URLs cycled with different titles); the goal is not unique content, it's exercising the click-through-to-play flow on-device.
- `items[].thumbnail_url` for v1 is `pkg:/images/live-thumb-placeholder.png` for every item. Real thumbnail bundling is out of scope (would add ~20 PNGs to the template; not worth it for a synthetic demo). The placeholder is reused as the live thumb (D6 has no published poster) and as every clip thumb.
- `categories[].item_ids` is an array of string ids that index into the flat top-level `items[]` array. This is denormalized vs RDP's nested-objects style but trivial to traverse in BrightScript and keeps each item's payload in exactly one place.
- Total file size target: < 8 KB. Easily fits in the channel package without bloating sideload size.

### 5.4 `source/Feed.bs`

Two public functions:

```brs
' Reads the bundled feed from pkg:/data/news-feed.json and returns a parsed
' { live: AssociativeArray, categories: [AssociativeArray], items: [AssociativeArray] }.
' Returns invalid on parse failure (caller logs + uses empty feed).
function NewsFeed_LoadBundled() as object
  txt = ReadAsciiFile("pkg:/data/news-feed.json")
  if txt = invalid or Len(txt) = 0 then return invalid
  parsed = ParseJson(txt)
  if parsed = invalid then return invalid
  return parsed
end function

' Builds a ContentNode for the live tile. Sets .live = true and .url = HLS URL.
' For VOD items, builds nodes with .url = mp4 URL, .live = false, .streamFormat = "mp4" or "hls".
function NewsFeed_BuildContentNode(item as object, isLive as boolean) as object
  c = createObject("roSGNode", "ContentNode")
  c.title = item.title
  if item.summary <> invalid then c.shortDescriptionLine1 = item.summary
  if item.thumbnail_url <> invalid then c.HDPosterUrl = item.thumbnail_url
  c.url = item.url
  if item.stream_format <> invalid then c.streamFormat = item.stream_format
  c.live = isLive
  return c
end function

' Convenience: returns ContentNode array of items for one category id.
function NewsFeed_ItemsForCategory(feed as object, categoryId as string) as object
  out = []
  for each cat in feed.categories
    if cat.id = categoryId
      for each itemId in cat.item_ids
        for each item in feed.items
          if item.id = itemId
            out.Push(NewsFeed_BuildContentNode(item, false))
            exit for
          end if
        end for
      end for
      exit for
    end if
  end for
  return out
end function
```

The script is included into MainScene.xml + CategoryGridScene.xml + PlayerScene.xml (per the SceneGraph thread-isolation lesson from MEMORY.md: components cannot see source/*.bs functions unless explicitly included).

### 5.5 `components/MainScene.xml` and `MainScene.bs`

XML structure (annotated):

```xml
<?xml version="1.0" encoding="utf-8" ?>
<component name="MainScene" extends="Scene">
  <script type="text/brightscript" uri="MainScene.bs" />
  <script type="text/brightscript" uri="pkg:/source/Feed.bs" />
  <script type="text/brightscript" uri="pkg:/source/_template/config.bs" />
  <script type="text/brightscript" uri="pkg:/source/_modules/__init_hooks.bs" />
  <children>
    <Rectangle id="bgFill" width="1920" height="1080" color="0x0c1320FF" />
    <LiveHero       id="liveHero"     translation="[0, 0]"     width="1152" height="1080" />
    <CategoryRail   id="categoryRail" translation="[1152, 0]"  width="768"  height="1080" />
    <Label          id="loadingLabel" translation="[940, 530]" text="Loading..." color="0xFFFFFFFF" font="font:LargeBoldSystemFont" horizAlign="center" />
  </children>
</component>
```

`MainScene.bs` responsibilities (~60-80 lines):

1. `init()` — find children, set focus to `liveHero` after content binds, observe `liveHero.buttonSelected` and `categoryRail.itemSelected`, call `LoadFeed()`, fire `Modules_OnMainSceneAfterSceneShow(m)`.
2. `LoadFeed()` — `feed = NewsFeed_LoadBundled()`. If `spec.content.feed_url` (template config emits this) is set and is `http(s)://`, swap to HttpTask path (mirror video_grid). On success: bind LiveHero content, bind CategoryRail labels, hide loadingLabel, focus LiveHero playButton.
3. `onLiveSelected()` — open PlayerScene with live ContentNode (`live=true`), cache `m.playerSceneRef`, observe `m.playerSceneRef.close`.
4. `onCategorySelected()` — read selected category id, create CategoryGridScene, pass items as a content array, cache `m.gridSceneRef`, observe `m.gridSceneRef.close` and `m.gridSceneRef.itemSelected`.
5. `onGridItemSelected()` — open PlayerScene with the selected VOD ContentNode (`live=false`), cache `m.playerSceneRef`, observe close.
6. `onPlayerClose()` — `m.top.removeChild(m.playerSceneRef)`, `m.playerSceneRef = invalid`. If LiveHero originated → `m.liveHero.findNode("playButton").setFocus(true)`. If CategoryGrid originated → `m.gridSceneRef.setFocus(true)`.
7. `onGridClose()` — `m.top.removeChild(m.gridSceneRef)`, `m.gridSceneRef = invalid`, `m.categoryRail.setFocus(true)`.

The cached-reference pattern is enforced: every `createChild` is followed by `m.<x>Ref = node`; every removal goes through that ref, never `findNode("ComponentTypeName")`.

### 5.6 `components/LiveHero.xml` and `LiveHero.bs`

Composite Group, NOT focusable itself. Focus belongs on the inner `playButton` (post-v0.4.1 rule).

XML structure:

```xml
<?xml version="1.0" encoding="utf-8" ?>
<component name="LiveHero" extends="Group">
  <script type="text/brightscript" uri="LiveHero.bs" />
  <interface>
    <field id="content" type="node" onChange="onContentChange" />
  </interface>
  <children>
    <Rectangle id="bgGrad"     width="1152" height="1080" color="0x1d2a4aFF" />
    <Poster    id="livePoster" translation="[100, 100]" width="952" height="535" loadDisplayMode="scaleToFill" />
    <Rectangle id="scrim"      translation="[100, 605]" width="952" height="375" color="0x000000AA" />
    <Group     id="badgeGroup" translation="[100, 625]">
      <Rectangle id="badgeBg" width="80" height="32" color="0xe50914FF" />
      <Label     id="badgeText" translation="[10, 4]" text="LIVE" color="0xFFFFFFFF" font="font:MediumBoldSystemFont" />
    </Group>
    <Label     id="title"     translation="[100, 670]" width="952" text="" color="0xFFFFFFFF" font="font:LargeBoldSystemFont" />
    <Label     id="summary"   translation="[100, 750]" width="952" wrap="true" maxLines="3" text="" color="0xCCCCCCFF" font="font:MediumSystemFont" />
    <Button    id="playButton" translation="[100, 880]" minWidth="220" text="Watch Live" iconUri="pkg:/images/play-icon-light.png" focusedIconUri="pkg:/images/play-icon-dark.png" />
  </children>
</component>
```

`LiveHero.bs`:

```brs
sub init()
  m.poster      = m.top.findNode("livePoster")
  m.title       = m.top.findNode("title")
  m.summary     = m.top.findNode("summary")
  m.badgeText   = m.top.findNode("badgeText")
  m.playButton  = m.top.findNode("playButton")
  ' Default badge text comes from template config (which reflects spec.content.live_label or "LIVE").
  liveLabel = TemplateConfig().live_label
  if liveLabel <> invalid and Len(liveLabel) > 0 then m.badgeText.text = liveLabel
end sub

sub onContentChange()
  c = m.top.content
  if c = invalid then return
  m.title.text   = c.title
  m.summary.text = c.shortDescriptionLine1
  if c.HDPosterUrl <> invalid then m.poster.uri = c.HDPosterUrl
end sub
```

Note: LiveHero does not set up its own `playButton` `buttonSelected` handler. The Button's `buttonSelected` field is observed by MainScene directly via `m.liveHero.findNode("playButton").observeField("buttonSelected", "onLiveSelected")` — same pattern as video_grid_channel post-v0.5.1.

### 5.7 `components/CategoryRail.xml` and `CategoryRail.bs`

Vertical `LabelList` showing category names. ~5-10 lines of BrightScript.

```xml
<?xml version="1.0" encoding="utf-8" ?>
<component name="CategoryRail" extends="Group">
  <script type="text/brightscript" uri="CategoryRail.bs" />
  <interface>
    <field id="content"      type="node"    onChange="onContentChange" />
    <field id="itemSelected" type="integer" alias="list.itemSelected" />
  </interface>
  <children>
    <Rectangle id="railBg"  width="768" height="1080" color="0x0a0f1cFF" />
    <Label     id="header"  translation="[60, 80]"  text="CATEGORIES" color="0x999999FF" font="font:SmallBoldSystemFont" />
    <LabelList id="list"    translation="[60, 130]" itemSize="[640, 60]" numRows="5" drawFocusFeedback="true" />
  </children>
</component>
```

`CategoryRail.bs`:

```brs
sub init()
  m.list = m.top.findNode("list")
end sub

sub onContentChange()
  c = m.top.content
  if c = invalid then return
  m.list.content = c
  m.list.setFocus(true)
end sub
```

The `itemSelected` field on the rail is aliased to `list.itemSelected`, so MainScene can observe a single field on the rail itself rather than reaching inside.

### 5.8 `components/CategoryGridScene.xml` and `CategoryGridScene.bs`

Full-screen overlay. PosterGrid with 3 columns × N rows.

```xml
<?xml version="1.0" encoding="utf-8" ?>
<component name="CategoryGridScene" extends="Group">
  <script type="text/brightscript" uri="CategoryGridScene.bs" />
  <script type="text/brightscript" uri="pkg:/source/Feed.bs" />
  <script type="text/brightscript" uri="pkg:/source/_template/config.bs" />
  <script type="text/brightscript" uri="pkg:/source/_modules/__init_hooks.bs" />
  <interface>
    <field id="categoryName"  type="string" />
    <field id="categoryItems" type="nodeArray" onChange="onItemsChange" />
    <field id="itemSelected"  type="integer" alias="grid.itemSelected" />
    <field id="close"         type="boolean" />
  </interface>
  <children>
    <Rectangle id="bg"         width="1920" height="1080" color="0x0c1320FF" />
    <Label     id="categoryHeader" translation="[120, 60]"  text="" color="0xFFFFFFFF" font="font:LargeBoldSystemFont" />
    <Label     id="countLabel"     translation="[120, 105]" text="" color="0x888888FF" font="font:SmallSystemFont" />
    <PosterGrid id="grid"
                translation="[120, 160]"
                basePosterSize="[440, 248]"
                numColumns="3"
                numRows="3"
                itemSpacing="[24, 32]"
                drawFocusFeedback="true" />
  </children>
</component>
```

`CategoryGridScene.bs`:

```brs
sub init()
  m.grid          = m.top.findNode("grid")
  m.categoryHeader = m.top.findNode("categoryHeader")
  m.countLabel    = m.top.findNode("countLabel")
  m.top.observeField("categoryName", "onNameChange")
  Modules_OnCategoryGridSceneAfterSceneShow(m)
end sub

sub onNameChange()
  m.categoryHeader.text = m.top.categoryName
end sub

sub onItemsChange()
  items = m.top.categoryItems
  if items = invalid then return
  ' PosterGrid wants a single ContentNode with child ContentNodes.
  root = createObject("roSGNode", "ContentNode")
  for each item in items
    root.appendChild(item)
  end for
  m.grid.content = root
  m.countLabel.text = items.Count().ToStr() + " clips"
  m.grid.setFocus(true)
end sub

function onKeyEvent(key as string, press as boolean) as boolean
  if not press then return false
  if key = "back"
    m.top.close = true
    return true
  end if
  return false
end function
```

The `Modules_OnCategoryGridSceneAfterSceneShow(m)` call is the new init-hook fire site (D11). Modules can decorate the grid header, inject overlays, etc.

### 5.9 `components/PlayerScene.xml` and `PlayerScene.bs`

Same shape as `video_grid_channel`'s PlayerScene, with the live-flag respected:

```brs
sub init()
  m.video = m.top.findNode("video")
  m.top.observeField("content", "onContentChange")
  Modules_OnPlayerSceneBeforePlay(m)
end sub

sub onContentChange()
  c = m.top.content
  if c = invalid then return
  ' BrightScript ContentNode has `live` (boolean) on Roku firmware 11+; safe to set.
  ' Roku Video node uses .content.live to suppress scrubber and render LIVE chrome.
  m.video.content = c
  m.video.control = "play"
end sub

function onKeyEvent(key as string, press as boolean) as boolean
  if not press then return false
  if key = "back"
    m.video.control = "stop"
    m.top.close = true
    return true
  end if
  return false
end function
```

### 5.10 `source/Main.bs`

Standard SceneGraph bootstrap with the `Main/before_scene_show` hook fire:

```brs
sub Main(args as dynamic)
  Modules_OnMainBeforeSceneShow(args)
  screen = CreateObject("roSGScreen")
  m.port = CreateObject("roMessagePort")
  screen.setMessagePort(m.port)
  scene = screen.CreateScene("MainScene")
  screen.show()
  while true
    msg = wait(0, m.port)
    if type(msg) = "roSGScreenEvent" and msg.isScreenClosed() then return
  end while
end sub
```

## 6. Engine changes

**Effectively none.** All engine surface used by news_channel landed in Plan 4 (asset pipeline, content schema, manifest merge), Plan 4a (branding defaults), or Plan 4b (Button iconUri pattern, no engine impact). Only changes:

- `src/spec/content.ts` is unchanged. Per-template tightening of the content schema (the `live_label` field) lives in `templates/news_channel/schema.ts`, NOT in the shared `ContentSchema`. This keeps the shared schema minimal and consistent with how `video_grid_channel` uses `feed_url` / `feed_format` without coupling them into other templates.
- No new failure codes in `@rokudev/device-client`.
- No changes to `src/merger/` (template-territory fences already cover `source/_template/` and `assets/`; news_channel doesn't introduce a new fenced path).

Confirmed by the §13 verification gate: device-client tests stay at 296; rokudev-device tests stay at 184; brs-gen test count grows only by the news_channel-specific additions in §9.

## 7. Data flow — feed resolution

```
At generate time:
  spec.content?.feed_url is undefined
    → bundled pkg:/data/news-feed.json is shipped as-is
  spec.content?.feed_url is "pkg:/..."
    → operator overrides with their own bundled feed (still pkg-local; no HTTP at runtime)
  spec.content?.feed_url is "http(s)://..."
    → HttpTask path at runtime; bundled feed file still ships but is unused

At runtime (MainScene.LoadFeed):
  if config.feed_url begins with "http"
    → kick off HttpTask, observeField("data"), parse on completion
  else
    → ReadAsciiFile(config.feed_url or "pkg:/data/news-feed.json"), parse synchronously
```

Only one HttpTask `<script>`-include is needed in MainScene (HttpTask.xml component) to keep the http path live. If `spec.content.feed_url` is a `pkg:/` path, the HttpTask file still ships but is never instantiated; this is consistent with how `video_grid_channel` handles the same conditional.

## 8. Error handling

| Error code | When | Data | Surface |
|---|---|---|---|
| (existing) `ASSET_*` | Branding asset failures | as-is | brs-gen generate_app |
| (existing) `MODULE_TEMPLATE_TERRITORY_VIOLATION` | Module writes under `assets/` or `source/_template/` | as-is | brs-gen merger |

**Runtime (channel-side, surfaced via 8085 log only):**

- Bundled feed missing → `print "[news] feed file not found: " + path` then loadingLabel stays visible. (User sees "Loading..." indefinitely; we accept this as "operator misconfigured `spec.content.feed_url` to a pkg path that doesn't exist".)
- Bundled feed malformed JSON → `print "[news] feed parse failed"` then loadingLabel stays visible.
- Live URL fails to play → Roku Video node fires `state = "error"`; we leave default Roku error handling in place (same as video_grid). The on-device user sees a Roku stock error overlay, which the T27 driver's screenshotNoError check would catch as a regression if the bundled URL ever rotates.

**No new generate-time error codes.** The schema's `live_label` length validation (max 12) raises a generic Zod ValidationError surfaced through `generate_app`'s existing schema validation path.

## 9. Testing strategy

### 9.1 Unit tests (brs-gen)

- `src/spec/content.test.ts` (extend) — assert news_channel's `live_label` schema accepts `"LIVE"`, `"AO VIVO"`, etc.; rejects empty string and >12-char strings; `content` block remains optional overall.
- `src/tools/generate-app.test.ts` (extend) — generate news_channel from zero-content spec produces a project containing `data/news-feed.json` (verbatim from template), `images/play-icon-*.png` (verbatim, byte-equal to video_grid's copies), and a manifest with synthesized icon + splash entries.

### 9.2 Snapshot tests

`packages/brs-gen/tests/__snapshots__/news_channel/`:

- `manifest.snap.txt`
- `MainScene.xml.snap.txt` and `MainScene.brs.snap.txt` (post-compile)
- `LiveHero.xml.snap.txt`
- `CategoryRail.xml.snap.txt`
- `CategoryGridScene.xml.snap.txt` and `CategoryGridScene.brs.snap.txt`
- `PlayerScene.xml.snap.txt` and `PlayerScene.brs.snap.txt`
- `data/news-feed.json.snap.txt` (asserts the bundled feed shape)

Plus a regression-test pattern (per Plan 4b): assert post-compile `MainScene.brs` contains `Modules_OnMainSceneAfterSceneShow(m)` and the cached-ref var names (`m.playerSceneRef`, `m.gridSceneRef`); `CategoryGridScene.brs` contains `Modules_OnCategoryGridSceneAfterSceneShow(m)`.

### 9.3 Golden e2e test

`tests/e2e.test.ts` gains a `news_channel` describe block:

- `tests/__golden__/news.zip`
- `tests/__golden__/news.provenance.json`

Regenerated via `TZ=UTC node scripts/regen-golden.mjs` (existing workflow).

### 9.4 Conflict matrix

`tests/conflict-matrix.test.ts` adds:

- `{ template: 'news_channel', modules: [] }` — must merge, compile, zip.
- `{ template: 'news_channel', modules: ['stub_label'] }` — merges; emitted project dispatches `stub_label` from `MainScene/before_scene_show`. (Note: `stub_label` exports `Main/before_scene_show`, which news_channel does export, so this combination exercises real wiring.)

### 9.5 Determinism

`tests/determinism.test.ts` adds a news_channel full-pipeline byte-equality test under `TZ=UTC`. Runs alongside Plan 4 / Plan 4a determinism tests; all three go green or all red.

### 9.6 Asset reuse verification

Cheap unit assertion: read the bundled `play-icon-light.png` and `play-icon-dark.png` from both `templates/video_grid_channel/files/images/` and `templates/news_channel/files/images/`; assert sha256 equality. This catches the case where a future patch drifts the icons in one template but not the other. (If the user later prefers shared-asset-by-symlink-or-import, that's a Plan 5+ concern.)

## 10. T27 real-device verification

`scripts/t27-news.mjs` (operator-run on Roku at user-supplied IP):

**Phase A — bundled feed (zero operator content):**

1. `generate_app` — spec has only `app` + `template`.
2. Sideload + launch.
3. `/query/active-app` reports `dev`.
4. `screenshotNoError` (foreground-checked) — assert clean MainScene render (no Roku error overlay).
5. Press `Right` once → focus moves from LiveHero playButton to CategoryRail first item.
6. Press `Down` 2x → focus on third category.
7. Press `Select` → CategoryGridScene push; sleep 1s for grid render.
8. `screenshotNoError` — assert clean CategoryGridScene render.
9. Press `Select` on first tile → PlayerScene push.
10. Sleep 3s for video metadata; check `/query/media-player` reports `state = "playing"` (best-effort; AVideo demo may not buffer instantly).
11. `screenshotNoError {assertForeground: false}` — capture player screenshot regardless of state.
12. Press `Back` 3x → returns to MainScene with LiveHero focused.
13. `screenshotNoError` — assert MainScene render restored, focus on playButton.

**Phase B — live stream:**

14. Re-sideload and launch (deterministic preamble per Plan 4b.1 lesson).
15. Press `Select` immediately on LiveHero playButton (focus default).
16. Sleep 5s for HLS handshake.
17. `/query/media-player` reports `state = "playing"` (best-effort; NASA TV is reliable, but corp-network DRM/firewall could intervene).
18. `screenshotNoError {assertForeground: false}` — capture live screenshot.
19. Press `Back` → returns to MainScene with LiveHero focused.
20. `screenshotNoError` — final clean state.

Total: ~20 steps, ~45-60 seconds on-device.

Failure-capture screenshots (the `catch`-block sites) use `{assertForeground: false}` per the Plan 4b.1 lesson.

T27 PASS evidence (Roku IP + firmware + transcript) goes in this spec's Appendix A after the implementation runs.

## 11. Scope cut (explicit non-ships)

- No DetailsScene. (Re-stated for emphasis; this is the biggest divergence from `video_grid_channel`.)
- No EPG / schedule / "what's on next" overlay for the live stream.
- No multi-source live (one HLS stream).
- No category-level branding / per-category color theming.
- No real thumbnail bundling (placeholder reused for all clips + live tile in v1).
- No HttpTask refactor / pull-up to a shared module. Each template keeps its own copy until two templates demonstrably need byte-identical behavior.
- No reuse of `video_grid_channel`'s HeroUnit. LiveHero is purpose-built.
- No "Up from row 0" or "playButton-restore-after-Details" polish-debt items inherited from video_grid; news_channel has no Details and no row-0-vs-hero ambiguity by construction.
- No Rooibos unit tests for the new BrightScript helpers in v1.

## 12. Release plan

- Monorepo bump: `v0.5.2` → `v0.5.3` (patch — new template, no engine surface change).
- Package bumps: `brs-gen` 0.5.2 → 0.5.3; `@rokudev/device-client` unchanged (stays at 0.3.0).
- Goldens regenerated under `TZ=UTC` AFTER the version bump (per Plan 3+ regen ordering lesson).
- Tag `v0.5.3` + GitHub release with notes covering: new template, T27 evidence (Phase A + Phase B), bundled feed shape, NASA TV fix-forward policy.
- Update `MEMORY.md`'s "Implementation status" block with Plan 4c COMPLETE entry; carry forward all load-bearing lessons from this implementation (especially anything new about PosterGrid, LabelList alias fields, or Roku Video `content.live` chrome behavior on the test device firmware).
- README appends "What's in v0.5.3 (Plan 4c)" section in chronological order. (No backfill of v0.5.0/v0.5.1 release notes; project policy is GH-release-only for those.)

## 13. Verification gate (must pass before ship)

1. `pnpm -C packages/brs-gen test` — all green. Target: approximately **295-305 tests** (281 baseline from v0.5.2 + ~2 content-schema additions for live_label + ~1 generate-app test for news + ~10 snapshots + ~2 e2e + ~2 conflict matrix entries + ~1 determinism + ~1 asset-reuse sha256 equality). Final count locked during plan decomposition.
2. `pnpm -C packages/roku-device-client test` — 296 green (no change).
3. `pnpm -C packages/rokudev-device test` — 184 green (no change).
4. `pnpm build` from the workspace root — clean (no TS errors). Required because vitest doesn't typecheck.
5. `TZ=UTC node packages/brs-gen/scripts/regen-golden.mjs` followed by `pnpm -C packages/brs-gen test` — still green (determinism).
6. `t27-news.mjs` Phase A (bundled feed, zero-branding) PASS.
7. `t27-news.mjs` Phase B (live stream) PASS.
8. `t27-video-grid.mjs` still PASS (no regression).
9. `t27-blank.mjs` still PASS (no regression).
10. Secret-leak invariant: no new code path that touches dev_password / signing_password.

## 14. Open questions / to-resolve-in-plan

- **RESOLVED inline (D9):** Roku Video node's `content.live = true` is sufficient for default LIVE chrome on Roku firmware 11+; no manual scrubber suppression needed. If on-device verification surfaces a glitch (e.g. firmware-15 chrome differences), fix-forward in a v0.5.3.x patch.
- **RESOLVED inline (D10):** `live_label` length cap is 12 characters; default `"LIVE"`. Schema enforces.
- **RESOLVED inline (D11):** Init-hook export surface is locked at 4 hooks; resist adding `before_content_load` / `after_content_load` until a real module needs them. Adding hooks later is non-breaking; removing them isn't.
- **OPEN — to resolve in plan decomposition:** Do we ship 21 distinct AVideo VOD URLs, or cycle through 3-5? Plan author should pick the smallest set that exercises both happy and sad paths (e.g. one URL for happy-path play; second URL for "different metadata" testing). Default during plan: cycle through 3 URLs.
- **OPEN — to resolve in plan decomposition:** PosterGrid `basePosterSize` is drafted as `[440, 248]` (16:9 at 440 wide, gives 3-across with 24px gaps inside 1920-240=1680 work area: `(1680 - 48) / 3 = 544`, so 440 leaves headroom for left margin). Confirm against actual Roku PosterGrid documentation during plan or adjust to fit cleanly.
- **OPEN — to resolve on-device:** Whether NASA TV HLS works through the operator's network. If it fails for any operator (corp firewall, geo-restriction), the fix-forward is to swap the bundled feed's `live.url` to a different known-good HLS endpoint. Document in the GitHub release notes if this happens during 4c verification.

No blocking open questions. Plan decomposition may proceed.

---

**Appendix A:** PRD cross-references

- §3.2.1 (base template definition) — news_channel fits the shape (Scene root + a small constellation of components).
- §3.2.6.1 (template.toml format) — uses unchanged shape; no engine extensions.
- §10.5 (asset constraints) — same as Plan 4a/4b: synthesized PNGs from `template_branding_defaults.primary_color` when operator branding absent.
- §8.3 (combinatorial merger test) — adds 2 entries to the matrix (news + empty, news + stub_label).

**Appendix B:** memory-side lessons applied

- `findNode` is id-only — every overlay (`PlayerScene`, `CategoryGridScene`) cached in `m.<x>Ref` at create time.
- `createChild` returns must be cached — same as above.
- HeroUnit / plain `Group` composites are not focusable — `LiveHero` is a Group; focus belongs on its inner Button.
- `vector2dArray` for per-row RowList attributes — N/A (news_channel uses LabelList for the rail and PosterGrid for the grid; neither has the per-row attribute trap).
- bs_const must use `KEY=false/true` — `DEBUG=false` is the only entry; correct format.
- `screenshotNoError` foreground check — driver uses default-on; failure-capture sites pass `{assertForeground: false}`.
- T27 preamble must be a `sideloadAndLaunch` reset, not a Back-spam — Phase B starts with a re-sideload.
- Roku Home app id is `562859` (numeric, NOT the literal string `"Roku"`) — not directly used here, but documented for any negative-test work.
- Reference-app polish insistence — news_channel does NOT inherit from video_grid; built fresh per the rule.

**Appendix C:** Test-device caveats (to be filled in during implementation)

- T27 Phase A pass evidence + Roku model/firmware
- T27 Phase B pass evidence + observed HLS handshake latency
- Any deviations from spec-time `basePosterSize` / layout coords driven by on-device measurement
