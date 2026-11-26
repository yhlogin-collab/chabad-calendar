# Chabad of Carrollton-Lewisville – Events Calendar

Replaces Tockify (paid). Rabbi Yehuda Horowitz's events calendar for jewishcarrollton.org.

## How it works
- Source of truth: Google Calendar "Chabad Events"
  `c_98fc9fb2a617c70b49b0855b339b48fed01f593a210e6ea4efed8971d8021bc3@group.calendar.google.com`.
  Public with **"See all event details"** — the build reads the public iCal feed, no API key.
  (If it is ever set back to free/busy, every event arrives as "Busy"; the build refuses to deploy and the live site keeps the last good version.)
- `.github/workflows/deploy.yml` runs every 6 hours (cron `17 */6 * * *`), on push, and on "Run workflow".
  It runs `scripts/build.mjs` → `site/events.json` + `site/e/<slug>/` share pages, then deploys `site/` to GitHub Pages.
  The deploy step waits 15s and retries once, because GitHub's artifact lookup sometimes fails transiently.
- Live: https://events.jewishcarrollton.org/ (custom domain; CNAME events → yhlogin-collab.github.io added by ChabadOne support 2026-11-25; Pages source = GitHub Actions).
  Old yhlogin-collab.github.io/chabad-calendar/ URLs 301-redirect here – to http until "Enforce HTTPS" is on, which the https site blocks, so all embeds must use https://events.jewishcarrollton.org/.
- Embedded on https://www.jewishcarrollton.org/templates/articlecco_cdo/aid/7009553/jewish/Holidays-Events.htm
  (ChabadOne CMS). **The CMS parses article HTML as XML: never put a bare `&` (or `&&`) in embed code.**

## Files
- `config.json` – calendar ID, timezone, location for zmanim (33.08,-97.01, 18-min candles, Shabbat ends at `havdalahDeg` 8.4° – fitted to Chabad.org zip 75056: matches all 43 times checked, Nov 27 2026 – erev Pesach Apr 21 2027 incl. DST; Hebcal at 8.5° was 1 min late on Shabbat ends),
  `site` (pageUrl, calendarUrl, shareIntro, email), `images` (series → picture), `links` (series → page on the site), `series` (key → name + title prefixes, for next-event boxes), `collections`, `hide` (event slugs to leave off).
- `scripts/build.mjs` – parses iCal with ical.js (recurrences, exceptions, EXDATE, all-day), times as wall-clock in
  America/Chicago; Hebrew dates/holidays/parsha/candles/havdalah via @hebcal/core; readable slugs; share pages with OG tags.
- `site/index.html`, `site/style.css`, `site/app.js` – static page, no framework.
- `site/img/` – 1080×1080 series pictures + `og-default.jpg` (1200×630) for events without one.
- `test/sample.ics` – sample feed for local testing.

## Features (current)
- Month grid like Tockify (site orange #f04a26): Hebrew date per day, holiday/parsha, Friday 🕯️ candle time, ✨ Shabbat/Yom Tov ends (labelled "Shabbat ends", never "Havdalah"), event dots.
  Click a day → list filtered to that day. Month / List / Today buttons. Mobile layout.
- Event list: series picture or orange date tile (with Hebrew date), title, time, Hebrew date, 2-line description.
  Shabbos/Chanukah strips between events are OFF (`SHOW_ZMAN_ROWS = false` in app.js) — user preference; zmanim stay in the grid.
- Popup: full picture, details with links, map link only for real addresses; buttons: RSVP, + Google Calendar,
  + Apple/Outlook (.ics), Share on WhatsApp, Copy link, Share… (phones). Popup opens next to the clicked event inside the embed.
- RSVP: a description link containing RSVP/register/sign up → "RSVP" button; a Location containing "RSVP"
  → hidden location + "✉️ RSVP for location" mailto to info@JewishCarrollton.org with subject/body prefilled.
- An event whose end equals its start shows only the start time.
- "More info →" button (list + popup, opens in the whole window via target=_top) to the series' own page on
  jewishcarrollton.org, from `config.links` (title prefix → URL): Community/Chanukah Menorah, Minyan, Kid(s) Shabbat,
  First Fridays, Bagels, Lox / BLT, Torah & Tea, Torah Studies (Weekly Torah Study page), Kids in the Kitchen.
- Share links: `<calendarUrl>e/<slug>/` (e.g. `torah-studies-nov-25`) → page with OG preview (flyer, title, date) →
  redirects to the jewishcarrollton.org page `#<slug>`; the embed script forwards the parent hash into the iframe, which opens that event.
  WhatsApp text: shareIntro line, *title*, date/time, link.
- Collection pages (`config.collections`): one link for a group of events, e.g. `<calendarUrl>chanukah/` – cards with
  RSVP / + Google Calendar / More info, an "Add all N to my calendar" button (`<key>/<key>.ics`, all events in one file with a
  2-hour reminder; iPhone/Outlook add all at once, Android uses per-event Google buttons), OG preview for texting.
  Listed by event slug; the build warns if a slug disappears (title/date changed). Current: `chanukah` (Dec 4 First Fridays,
  Dec 9 Community Menorah, Dec 12 Minyan Shabbat Chanukah).
- "Next event" boxes for the series pages on jewishcarrollton.org: `site/next/index.html?s=<series key>` reads
  `../events.json` in the browser and shows the next upcoming date (rolls over by itself after an event ends),
  Hebrew date, RSVP/Google/Apple buttons, a per-date flyer if one is attached to that Google event (`e.flyer`),
  and up to 6 later dates. No dates → "New dates coming soon!". Series keys come from `config.series`
  (name + title prefixes): minyan, kid-shabbat, blt, first-fridays, torah-and-tea, torah-studies, kids-in-the-kitchen,
  community-menorah. Each event carries `series` in events.json. Auto-height via postMessage type `chabad-next-height`.
  Embed (XML-safe, identical script on every page, only `s=` changes):
  ```html
  <iframe src="https://events.jewishcarrollton.org/next/?s=minyan" style="width:100%;height:560px;border:0" scrolling="no" title="Next event"></iframe>
  <script>
  window.addEventListener('message',function(e){var d=e.data;if(d){if(d.type==='chabad-next-height'){var fs=document.getElementsByTagName('iframe');var i=fs.length;while(i--){if(fs[i].contentWindow===e.source){fs[i].style.height=(d.height+10)+'px';}}}}});
  </script>
  ```
  (No `<` or `&` in CMS scripts – hence `while(i--)`.)
- Home-page strip `site/upcoming/` ("Upcoming at Chabad"): reads `../events.json` in the browser; this week's
  Shabbat/Yom Tov line (parsha, candle lighting, "Shabbat ends") + cards for events in the next 7 days (at least 3, at most 4;
  "+ N more this week" on the button). Cards link to `pageUrl#slug` (target _top) so the Holidays & Events page opens
  that event. Same embed script as the next-event boxes (postMessage type `chabad-next-height`), src `<calendarUrl>upcoming/`.
- `site/embed.js` – loaded site-wide from ChabadOne's **footer code** (the home page has no HTML editing):
  `<script src="https://events.jewishcarrollton.org/embed.js" async="async"></script>`.
  On the home page (`body.home`) it inserts `#chabad-upcoming` (white section, iframe of `upcoming/`) right after the
  `.promo_slider` row, before the gray "About" `.hp-row`; fallbacks: before first `.hp-row`, else top of `#content`.
  On every page it handles `chabad-next-height` auto-sizing, so next-event boxes only need the `<iframe>` line.
  Change placement/behavior here – no re-pasting needed by the user.
- Hidden from site: events marked **Private** in Google (feed shows "Busy") and slugs in `config.hide`
  (currently `challah-bake-dec-17` – a private bat mitzvah).

## Series pictures (`config.images`, matched by title prefix, case-insensitive)
Bagels, Lox / BLT → blt.jpg · Torah Studies → torah-studies.jpg · Torah & Tea → torah-and-tea.jpg ·
First Fridays → first-fridays.jpg · Kid Shabbat / Kids Shabbat → kid-shabbat.jpg · Minyan → minyan-kiddush.jpg ·
Community Menorah → community-menorah.jpg. (Challah Bake image removed.)
Pictures are AI-made: 1080×1080 JPG, no dates/times, title readable at 96px, content in center 80%.
**Always inspect new pictures at full size for crosses/church-like emblems** (the generator put crosses on challah covers,
tefillin bags, cups, Torah covers). Only Jewish symbols.

## Current embed code (XML-safe)
```html
<iframe id="chabadCal" src="https://events.jewishcarrollton.org/" style="width:100%;height:2750px;border:0" scrolling="no" title="Holidays and Events" allow="clipboard-write; web-share"></iframe>
<script>
(function(){var f=document.getElementById('chabadCal');var h=window.location.hash;if(h){f.src=f.src.split('#')[0]+h;}
window.addEventListener('message',function(e){var d=e.data;if(d){if(d.type==='chabad-calendar-height'){f.style.height=(d.height+20)+'px';}}});})();
</script>
```

## Pending
- Tick "Enforce HTTPS" in Settings → Pages once GitHub allows it (certificate was issued 2026-11-25).
- Cancel Tockify once the user confirms the site looks right.

## Working rules
- Test locally: `CAL_ICS_FILE=test/sample.ics node scripts/build.mjs && python3 -m http.server -d site`
  (or fetch the real public feed). Screenshot with Playwright before pushing.
- Commit as `chabad-calendar <chabad-calendar@users.noreply.github.com>`; after pushing, check the Actions run and the live site.
- Don't commit `site/events.json`, `site/e/` or collection folders (built in CI; `.gitignore` covers `site/*/` except `site/img/`, `site/next/`, `site/upcoming/`).
