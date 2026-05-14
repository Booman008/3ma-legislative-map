# Right Sidebar Scroll Layout + Remove FIPS/Sources Plan

## Summary

Fix the long county legislator list layout by making the app viewport-locked on desktop: the map stays fixed at full viewport height, while the right detail sidebar gets its own independent vertical scroll. This prevents the page from scrolling past the map and leaving a large blank area.

Also remove:
- County FIPS display from the selected county subtitle.
- Sources section at the bottom of the detail sidebar.

## Current Problem

Current desktop layout:

```css
.app-shell {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 390px;
  min-height: 100vh;
}

.map-stage {
  min-height: 100vh;
}

#map {
  height: 100vh;
}

.detail-panel {
  min-height: 100vh;
  overflow-y: auto;
}
```

Because `.app-shell` grows taller than the viewport when the right sidebar has many elected officials, the browser page itself scrolls. The map is only `100vh`, so after scrolling down the page, the left side becomes blank below the map.

## Desired Behavior

Desktop/tablet wide layout:

- Browser page itself should not scroll.
- Map remains fixed in the left area at full viewport height.
- Left control/search panel remains fixed and usable.
- Right detail panel scrolls internally.
- Long elected-official lists scroll only inside the right sidebar.
- Map should not move or expose blank page space while the user scrolls the official list.

Mobile/narrow layout:

- Keep normal document scrolling.
- Map remains at `68vh`.
- Detail panel stacks below the map.
- Avoid trapping mobile users inside nested scroll regions.

## Files To Change

- `index.html`
- `app.js`
- `styles.css`

## Implementation Details

### 1. Remove Sources Section From `index.html`

Delete this block entirely:

```html
<section class="info-section sources">
  <h3>Sources</h3>
  <ul>
    ...
  </ul>
</section>
```

Do not replace it with another section.

### 2. Remove County FIPS From County Selection

Current county render logic in `app.js`:

```js
els.selectionSubtitle.textContent = "County FIPS " + p.GEOID + ".";
```

Replace with:

```js
setSelectionSubtitle("");
```

Add a small helper so empty subtitles are hidden cleanly:

```js
function setSelectionSubtitle(text) {
  els.selectionSubtitle.textContent = text;
  els.selectionSubtitle.hidden = !text;
}
```

Use this helper anywhere `els.selectionSubtitle.textContent = ...` currently appears.

Recommended replacements:

Initial HTML remains:

```html
<p id="selection-subtitle">Select a county or district to view legislative and MMCP details.</p>
```

County selection:

```js
setSelectionSubtitle("");
```

District selection:

```js
setSelectionSubtitle("Select Counties boundary mode to view county-level MMCP tallies.");
```

Address fallback selection:

```js
setSelectionSubtitle(result.label);
```

This keeps useful context where needed, but removes FIPS from counties.

### 3. Lock Desktop App To Viewport

Add or change CSS:

```css
html,
body {
  height: 100%;
}

body {
  overflow: hidden;
}

.app-shell {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 390px;
  height: 100vh;
  min-height: 0;
  overflow: hidden;
}

.map-stage {
  position: relative;
  height: 100vh;
  min-height: 0;
  overflow: hidden;
}

#map {
  width: 100%;
  height: 100%;
}

.detail-panel {
  position: relative;
  z-index: 800;
  height: 100vh;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: 26px 24px 30px;
}
```

Remove or override desktop `min-height: 100vh` where it causes page growth.

### 4. Keep Mobile/Narrow Layout Scrollable

Inside the existing `@media (max-width: 980px)` block, restore normal page scrolling:

```css
@media (max-width: 980px) {
  body {
    overflow: auto;
  }

  .app-shell {
    grid-template-columns: 1fr;
    height: auto;
    min-height: 100vh;
    overflow: visible;
  }

  .map-stage {
    height: 68vh;
    min-height: 68vh;
  }

  #map {
    height: 68vh;
  }

  .detail-panel {
    height: auto;
    min-height: auto;
    overflow: visible;
    border-left: 0;
    border-top: 1px solid var(--line);
  }
}
```

This avoids creating a difficult nested-scroll experience on mobile.

### 5. Optional Detail Panel Scrollbar Polish

Add:

```css
.detail-panel {
  scrollbar-gutter: stable;
}

.detail-panel::-webkit-scrollbar {
  width: 10px;
}

.detail-panel::-webkit-scrollbar-thumb {
  background: rgba(7, 31, 64, 0.22);
  border-radius: 999px;
  border: 3px solid rgba(255, 255, 255, 0.96);
}

.detail-panel::-webkit-scrollbar-track {
  background: transparent;
}
```

This is optional but recommended because the right panel will now be the main scrolling surface.

## Edge Cases

### Long County Official Lists

Expected:
- Right panel scrolls.
- Map stays visible and filled.
- No blank left-side area appears.

### Search Dropdown With Right Panel Scroll

Search panel is on the left and fixed; it should remain unaffected.

### Address Search Marker

No behavioral change. Marker cleanup behavior remains as previously implemented.

### District View

District views usually have shorter official lists, but should still use the same right-panel scroll if content exceeds the viewport.

### Sources Removal

Sources are removed only from the public detail sidebar. Data source notes remain in:
- `README.md`
- `mississippi_interactive_map_plan.html`

## Testing Plan

### Manual Browser Tests

1. Select a county with many officials, such as Harrison County.
   - Scroll using mouse wheel over the right detail panel.
   - Confirm only the right panel scrolls.
   - Confirm the map remains visible and full-height.
   - Confirm no blank map area appears.

2. Scroll while mouse is over the map.
   - Confirm map zoom behavior still works normally.
   - Confirm page itself does not scroll.

3. Select a county.
   - Confirm no `County FIPS` text appears.

4. Inspect the bottom of the right panel.
   - Confirm the `Sources` section is gone.

5. Select `MS House District 80`.
   - Confirm district subtitle still appears where useful.
   - Confirm right panel scroll behavior still works.

6. Test at mobile/narrow viewport.
   - Confirm page scrolls normally.
   - Confirm map stacks above detail panel.
   - Confirm no trapped nested scroll issue.

### Playwright Smoke Tests

Use viewport `1440x900`:

- Search/select `Harrison`.
- Capture:
  - `document.scrollingElement.scrollHeight === window.innerHeight` or body page scroll does not grow materially.
  - `.detail-panel.scrollHeight > .detail-panel.clientHeight`.
  - `#map` height equals viewport height.
  - no `Sources` heading exists.
  - `#selection-subtitle` is hidden or empty for county selection.

Use viewport `390x844`:

- Confirm body/page scroll is enabled.
- Confirm `.detail-panel` is not fixed-height.
- Confirm `#map` height is around `68vh`.

## Acceptance Criteria

- No County FIPS appears in the selected county panel.
- No Sources section appears in the right sidebar.
- On desktop, the page does not scroll into blank map space.
- On desktop, the right detail panel has its own scroll.
- On mobile, the page remains naturally scrollable.
- Existing map interactions, search, address markers, and boundary controls continue working.
- No browser console errors.

## Assumptions

- Source attribution can remain in documentation instead of the in-app detail panel.
- Desktop users benefit from a fixed map plus independently scrollable right panel.
- Mobile users should keep normal page scrolling rather than a fixed split-pane app shell.
