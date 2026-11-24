# Research: Miro complaints and Samsung Galaxy Z Fold 8 web facts

Researched 2026-11-24. "Unverified" marks anything not confirmed in a source read that day. Ranking is qualitative: G2's own theme summary [1][2], Capterra highlights [3], Trustpilot themes [4], 60 Google Play 1–2★ reviews (30 each, "most relevant", first ~330 characters of each) [5], and community.miro.com thread volume. Not sampled: App Store, TrustRadius, individual Reddit threads (scraper blocked; search snippets only). Hacker News search returned nothing relevant.

## Part A — Miro complaints, ranked by recurrence

| # | Complaint | What goes wrong (paraphrase / quote) | Verdict | Fix for White Canvas |
|---|---|---|---|---|
| 1 | Lag on large boards | G2 summary: "large boards can become cluttered, slow, and harder to navigate" [1]; Capterra: "hundreds of shapes and cards, the app can lag heavily" [3] | Confirmed, most frequent | Viewport culling, level-of-detail when zoomed out, image downsampling/tiling, lazy-load by frame, visible object-count budget |
| 2 | Weak mobile/tablet app | Play: "read-only experience at best"; freezes on flagship Galaxy Tab S7+; no connectors, grouping or duplicate on mobile [5]. Miro's own help: cannot edit in a mobile browser, cannot export from mobile, iPad app is a WebView capped at 25% RAM [6] | Confirmed | One responsive web codebase with full editing on touch; feature parity as a release gate |
| 3 | Billing surprises (auto-added seats) | Trustpilot: charges added "without notifying you or obtaining your consent" [4]; community "Unauthorized charge" thread [7]; reviewer notes no refund after billing date [8]; Play: charged after cancelling [5] | Confirmed | Never bill a seat without explicit admin confirmation; seat cap; free guest editors; prorated self-serve refunds |
| 4 | Free-plan limits and paywalls | Free: 3 editable boards, no board history, no private boards, no voting/timer, low-res watermarked export [9][10] | Confirmed (facts from Miro's pricing/help pages) | Free tier with version history, private boards, full-quality export; limit on team size or storage instead |
| 5 | Clutter, getting lost, learning curve | G2 cons list: "Board Management", "Learning Curve" [2]; "overwhelming… takes a while to organize" [1] | Confirmed | Minimap, outline of frames, "back to content" button, auto-tidy, progressive tool disclosure |
| 6 | UI churn and AI upsell | r/miro: "Continuous changes to UI and workflows are not helping anyone", "Tired of closing the Miro Spaces sidebar" [11]; Play: "Closing >30 AI pop-ups every single time" [5] | Confirmed | Stable layout, AI opt-in, zero modal promos, remembered panel state |
| 7 | Sticky/text sizing | "I spend the majority of my time in Miro fighting font sizes on sticky notes" [12]; ideas to lock text size [13] | Confirmed | Fixed font size by default; note grows or scrolls; auto-fit as opt-in; "match sizes" action |
| 8 | No offline mode | "Miro doesn't have an offline mode" [14]; long-running idea thread (7+ pages) [15]; Play: "you have access to nothing without a connection" [5] | Confirmed | Local-first storage (IndexedDB + CRDT), offline edits, sync on reconnect |
| 9 | Mouse vs trackpad navigation | "randomly going from Zooming to Scrolling with my mouse wheel" [16]; setting buried in a right-click menu [17] | Confirmed | Per-event device detection, visible toggle, one consistent gesture map |
| 10 | Accidental moves; locking | Facilitators cannot let people add stickies without moving the template [18][19]; bulk lock/unlock is clumsy [20] | Confirmed | Background layer locked by default, role-based locks, "participants edit only their own items", per-user undo |
| 11 | Connectors/diagramming | No line jump-overs [21]; behaviour changed unexpectedly [22]; mobile: "Connections attach to random shapes" [5] | Confirmed | Orthogonal routing with jumps, sticky anchors, hold-key to suppress snapping |
| 12 | Export quality | Embedded PDFs export low-quality [23]; "best quality" image PDF called misleading [24]; copy-as-image resolution regression [25] | Confirmed | True vector PDF/SVG, DPI picker, frame-per-page |
| 13 | Stylus/pen | "Does not distinguish between a stylus and a finger"; no Android handwriting recognition [5]; palm rejection documented only for Apple Pencil and S Pen [26]; Apple Pencil smoothing regression [27] | Confirmed | Pointer Events pen path, pen-draws/finger-pans, pressure, coalesced events |
| 14 | Tables | Thread titled "Table widget: Miro is doing terrible reputational damage to us!" [28]; Play: "The tables don't work… deleting as I type" [5] | Confirmed (specifics unverified) | Real grid: merge, sort, paste from Sheets, stable cell editing |
| 15 | Permissions/sharing | Collaborators lost edit rights after upgrade [29]; guests only on Business+; no board-level sharing permissions on Free [9] | Partly confirmed | Three roles, one share dialog showing who can do what and what it costs |
| 16 | Search/findability | "Where has the search bar gone?" [30]; Play: "Navigation between projects and teams pure nightmare" [5] | Weak evidence | Global full-text search with jump-to-object |
| 17 | AI gating | Free: "limited trial"; 25/50 credits per member on Starter/Business [9] | Fact confirmed; few complaints (pushiness dominates, see 6) | Transparent quota, no nagging |
| 18 | Embeds blank | One developer thread only [31] | Not confirmed (unverified) | Fallback link card when iframe is refused |

Also seen on mobile: magic-link login failures and slow cold start [5].

### Common user mistakes that better defaults could prevent
- One mega-board without frames: suggest frames, show an outline, warn at an object budget.
- Inviting clients as paid team members instead of guests [8]: make guest the default role.
- Unlocked template/background that participants drag: auto-lock facilitator content.
- Mixed sticky sizes and auto-shrunk text: uniform default, "tidy" button.
- Pasting huge images/PDFs: compress on upload, show weight.
- Wrong navigation mode; leaving collaborators lost: auto-detect, "bring everyone to me", start view.
- Exporting the whole board rather than frames; no backups on Free: frame export default, automatic history.

## Part B — Galaxy Z Fold 8

Released 7 Aug 2026 (unveiled 22 Jul) in two variants; Android 17 / One UI 9 [32][33].

| | Z Fold8 (wide) | Z Fold8 Ultra |
|---|---|---|
| Cover | 5.5", 1248×1972, 10:16, 428 ppi | 6.5", 1080×2520, 21:9, 422 ppi |
| Main | 7.6", 2448×1848, 4:3, ~403 ppi | 8.0", 2256×2504, ~10:9, ~422 ppi |
| Refresh | 1–120 Hz adaptive LTPO, both screens | same |
| S Pen | Not supported | Not supported |

Sources: [32][33][34][35]. S Pen was dropped with the Fold 7 and is still absent [36][37]; passive capacitive styluses act as touch (unverified).

### CSS viewport (dp = CSS px)
No measured Fold 8 values were found. Estimates use DPR 2.625, the ratio implied by DeviceAtlas's measured Fold 7 figures (412×960 folded, 750×832 unfolded from 1080×2520 and 1968×2184 panels) [38]. All Fold 8 numbers are **unverified**.

| Screen | Portrait | Landscape |
|---|---|---|
| Fold8 cover | 475×751 | 751×475 |
| Fold8 main | 704×933 | 933×704 (natural unfolded orientation) |
| Fold8 Ultra cover | 411×960 | 960×411 |
| Fold8 Ultra main | 859×954 | 954×859 |

Third-party sites disagree (e.g. 924×1224 for Fold8 main assuming DPR 2 [39]; 860–1130 wide for Ultra main [40]); the DPR-2 estimate for Fold 7 contradicts the measured value. Chrome and Samsung Internet share the system density, so the screen size is the same; browser toolbars and system bars reduce visible height. Display Zoom changes DPR [41]. Design for cover widths 410–480 with heights as low as ~620, and main widths 700–960, all below a 1024 breakpoint.

### Foldable web APIs
- Device Posture (`navigator.devicePosture.type`, `@media (device-posture: folded|continuous)`): Chrome Android 132, Samsung Internet 16.2, WebView 132; no Firefox/Safari [42][43].
- Viewport Segments (`horizontal-viewport-segments`, `vertical-viewport-segments`, `env(viewport-segment-width|height|top|left|right|bottom x y)`, `window.viewport.segments`): Chrome Android 138, WebView 138, Samsung Internet 30 [44][45].
- Flex Mode reaches pages as posture `folded` plus two segments: side by side (horizontal = 2) with the hinge vertical, stacked (vertical = 2) when rotated. Whether segments are also reported when flat is unverified. Fold angle is not exposed [46]. Use as progressive enhancement.
- PWA: Samsung Internet shows an install icon in the URL bar and installs to the Apps screen [47]; WebAPKs are minted by Samsung's server, Chrome uses Google's [48]. Use `display: standalone` and do not lock `orientation`.
- Insets: Chrome 135+ draws under the gesture bar; anchor toolbars with `env(safe-area-inset-bottom)` and `safe-area-max-inset-bottom` [49]. Whether `viewport-fit=cover` is needed, and Samsung Internet's behaviour, are unverified.
- Pointer events: `pointerType` `pen` with `pressure`, `tiltX/Y`, `getCoalescedEvents()` on Chromium (general platform knowledge, unverified on Fold 8, which has no digitizer). Touch reports constant pressure, so do not assume a pen.

### Pitfalls for canvas apps
- Fold/unfold switches displays mid-session: width jumps (~475 to ~933), `resize` fires, posture changes. Preserve the camera centre and never reload. Re-read `devicePixelRatio` and resize the backing store with `ResizeObserver`.
- Set `touch-action: none` on the canvas, otherwise the browser pans/zooms and sends `pointercancel`.
- Set `overscroll-behavior: none` on `html, body` to stop pull-to-refresh and overscroll glow.
- Use `100dvh` (or `position: fixed; inset: 0`), not `100vh`, which is the large viewport and hides content under toolbars.
- The on-screen keyboard resizes only the visual viewport in Chrome 108+; track `visualViewport` (unverified today).
- System back-gesture zones on the left/right edges steal drags; keep handles off the edges (unverified width).
- Keep controls out of the hinge using segment env variables.

## Sources
1. https://www.g2.com/products/miro/reviews
2. https://www.g2.com/products/miro/reviews?qs=pros-and-cons
3. https://www.capterra.com/p/128955/Miro/reviews/
4. https://www.trustpilot.com/review/www.miro.com?page=4
5. https://play.google.com/store/apps/details?id=com.realtimeboard
6. https://help.miro.com/hc/en-us/articles/360021113559-Troubleshooting-mobile-and-tablet-device-issues
7. https://community.miro.com/ask-the-community-45/unauthorized-charge-by-miro-need-advice-17295
8. https://hackceleration.com/labs/review/miro
9. https://miro.com/pricing/
10. https://help.miro.com/hc/en-us/articles/360017572754-How-to-export-your-board
11. https://www.reddit.com/r/miro/comments/1xsqubk/please_revise_the_web_interface_design/ and https://www.reddit.com/r/miro/
12. https://community.miro.com/ask-the-community-45/why-are-font-sizes-inconsistent-in-sticky-notes-781
13. https://community.miro.com/ideas/lock-text-size-on-sticky-note-2463
14. https://community.miro.com/ask-the-community-45/how-to-use-miro-offline-as-a-personal-tool-8194
15. https://community.miro.com/ideas/offline-mode-925/index7.html
16. https://community.miro.com/ask-the-community-45/i-m-randomly-going-from-zooming-to-scrolling-with-my-mouse-wheel-what-s-going-on-19067
17. https://community.miro.com/ask-the-community-45/how-do-i-reinstate-zooming-using-my-mouse-wheel-6545
18. https://community.miro.com/inspiration-and-connection-67/participants-moving-objects-4599
19. https://community.miro.com/ask-the-community-45/how-do-i-lock-my-board-to-allow-users-to-place-stickies-but-not-move-other-pieces-around-692
20. https://community.miro.com/ask-the-community-45/locking-and-unlocking-many-objects-3341
21. https://community.miro.com/ideas/connection-lines-add-a-jump-for-lines-that-cross-8223
22. https://community.miro.com/ask-the-community-45/has-something-changed-with-the-way-connection-lines-work-13586
23. https://community.miro.com/ask-the-community-45/pdf-embedded-in-board-is-low-quality-when-exported-from-frame-4724
24. https://community.miro.com/ask-the-community-45/how-to-save-better-quality-pdf-in-free-version-8259
25. https://community.miro.com/ask-the-community-45/copy-as-image-resolution-issues-18996
26. https://help.miro.com/hc/en-us/articles/360017731633-Tablet-app
27. https://www.reddit.com/r/miro/comments/1p5q136/miro_is_suddenly_making_me_sad/
28. https://community.miro.com/ask-the-community-45/table-widget-miro-is-doing-terrible-reputational-damage-to-us-26982
29. https://community.miro.com/ask-the-community-45/upgraded-to-a-paid-plan-and-now-all-my-collaborators-cannot-edit-the-boards-11840
30. https://community.miro.com/ask-the-community-45/where-has-the-search-bar-gone-19189
31. https://community.miro.com/developer-platform-and-apis-57/embed-link-is-not-working-on-my-github-page-24829
32. https://en.wikipedia.org/wiki/Samsung_Galaxy_Z_Fold_8
33. https://www.gsmarena.com/samsung_galaxy_z_fold_wide_5g-14673.php
34. https://www.gsmarena.com/samsung_galaxy_z_fold8_ultra_5g-14802.php
35. https://www.samsung.com/us/smartphones/galaxy-z-fold8/
36. https://us.community.samsung.com/t5/Galaxy-Z-Series/The-Z-Fold8-doesn-t-support-S-Pen/td-p/3659948
37. https://www.youtube.com/watch?v=H5NkSA0srVI
38. https://deviceatlas.com/blog/viewport-resolution-diagonal-screen-size-and-dpi-most-popular-smartphones
39. https://mobilepreview.lirobi.com/devices/samsung-galaxy-z-fold8-unfolded
40. https://www.screensize.io/blog/latest.html
41. https://www.reddit.com/r/GalaxyFold/comments/1vgh542/fold_8_wide_dont_sleep_on_changing_the_dpi/
42. https://developer.mozilla.org/en-US/docs/Web/API/Device_Posture_API
43. https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/@media/device-posture
44. https://developer.mozilla.org/en-US/docs/Web/API/Viewport_segments_API
45. https://developer.chrome.com/blog/viewport-segments-api-shipped
46. https://azukiazusa.dev/en/blog/device-posture-viewport-segments/
47. https://developer.samsung.com/automation/progressive-web-app.html
48. https://web.dev/learn/pwa/installation
49. https://developer.chrome.com/docs/css-ui/edge-to-edge
