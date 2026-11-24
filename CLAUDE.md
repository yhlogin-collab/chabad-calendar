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
- Live: https://yhlogin-collab.github.io/chabad-calendar/ (Pages source = GitHub Actions).
- Embedded on https://www.jewishcarrollton.org/templates/articlecco_cdo/aid/7009553/jewish/Holidays-Events.htm
  (ChabadOne CMS). **The CMS parses article HTML as XML: never put a bare `&` (or `&&`) in embed code.**

## Files
- `config.json` – calendar ID, timezone, location for zmanim (Lewisville, 18-min candles, havdalah 8.5°),
  `site` (pageUrl, calendarUrl, shareIntro, email), `images` (series → picture), `hide` (event slugs to leave off).
- `scripts/build.mjs` – parses iCal with ical.js (recurrences, exceptions, EXDATE, all-day), times as wall-clock in
  America/Chicago; Hebrew dates/holidays/parsha/candles/havdalah via @hebcal/core; readable slugs; share pages with OG tags.
- `site/index.html`, `site/style.css`, `site/app.js` – static page, no framework.
- `site/img/` – 1080×1080 series pictures + `og-default.jpg` (1200×630) for events without one.
- `test/sample.ics` – sample feed for local testing.

## Features (current)
- Month grid like Tockify (site orange #f04a26): Hebrew date per day, holiday/parsha, Friday 🕯️ candle time, ✨ havdalah, event dots.
  Click a day → list filtered to that day. Month / List / Today buttons. Mobile layout.
- Event list: series picture or orange date tile (with Hebrew date), title, time, Hebrew date, 2-line description.
  Shabbos/Chanukah strips between events are OFF (`SHOW_ZMAN_ROWS = false` in app.js) — user preference; zmanim stay in the grid.
- Popup: full picture, details with links, map link only for real addresses; buttons: RSVP, + Google Calendar,
  + Apple/Outlook (.ics), Share on WhatsApp, Copy link, Share… (phones). Popup opens next to the clicked event inside the embed.
- RSVP: a description link containing RSVP/register/sign up → "RSVP" button; a Location containing "RSVP"
  → hidden location + "✉️ RSVP for location" mailto to info@JewishCarrollton.org with subject/body prefilled.
- An event whose end equals its start shows only the start time.
- Share links: `<calendarUrl>e/<slug>/` (e.g. `torah-studies-nov-25`) → page with OG preview (flyer, title, date) →
  redirects to the jewishcarrollton.org page `#<slug>`; the embed script forwards the parent hash into the iframe, which opens that event.
  WhatsApp text: shareIntro line, *title*, date/time, link.
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
<iframe id="chabadCal" src="https://yhlogin-collab.github.io/chabad-calendar/" style="width:100%;height:2750px;border:0" scrolling="no" title="Holidays and Events" allow="clipboard-write; web-share"></iframe>
<script>
(function(){var f=document.getElementById('chabadCal');var h=window.location.hash;if(h){f.src=f.src.split('#')[0]+h;}
window.addEventListener('message',function(e){var d=e.data;if(d){if(d.type==='chabad-calendar-height'){f.style.height=(d.height+20)+'px';}}});})();
</script>
```

## Pending
- New Torah Studies picture from the user (swap `site/img/torah-studies.jpg`).
- Custom domain `events.jewishcarrollton.org`: user emailed/will email ChabadOne support (they manage DNS) for
  `CNAME events → yhlogin-collab.github.io`. When live: set the Pages custom domain, change `site.calendarUrl`
  to `https://events.jewishcarrollton.org/`, give the user the embed line with the new src, verify HTTPS.
- Cancel Tockify once the user confirms the site looks right.

## Working rules
- Test locally: `CAL_ICS_FILE=test/sample.ics node scripts/build.mjs && python3 -m http.server -d site`
  (or fetch the real public feed). Screenshot with Playwright before pushing.
- Commit as `chabad-calendar <chabad-calendar@users.noreply.github.com>`; after pushing, check the Actions run and the live site.
- Don't commit `site/events.json` or `site/e/` (built in CI).
