# Chabad of Carrollton-Lewisville – Events Calendar

Replaces Tockify. Reads the "Chabad Events" Google Calendar every 6 hours (or on demand) and publishes
a calendar page (GitHub Pages) that is embedded on jewishcarrollton.org.

**You keep adding events in Google Calendar exactly as before.**

## What it shows
- Month grid + list, styled like the site (prev/next, Today, List view)
- Hebrew date on every day and event; Hebrew months in the header
- Holidays, parsha, Friday candle lighting and havdalah for Lewisville (18 min.)
- Event popup: flyer image, details, map link, RSVP, add to Google/Apple/Outlook, WhatsApp share, copy link

## Tips for events in Google Calendar
| You want | Do this in the Google event |
|---|---|
| A flyer picture | Attach the image from Google Drive (the file must be shared "Anyone with the link") |
| An RSVP button | Put a link in the description whose text or URL contains *RSVP*, *register* or *sign up* |
| A location + map link | Fill in the Location field |
| A multi-day event | Make it an all-day event spanning the days |

## Embed code (paste into the ChabadOne article, HTML mode)
Simple:
```html
<iframe src="https://yhlogin-collab.github.io/chabad-calendar/" style="width:100%;height:1600px;border:0" title="Holidays & Events"></iframe>
```
Auto-height (if the editor allows a script):
```html
<iframe id="chabadCal" src="https://yhlogin-collab.github.io/chabad-calendar/" style="width:100%;height:1600px;border:0" title="Holidays & Events"></iframe>
<script>
window.addEventListener('message',function(e){if(e.data&&e.data.type==='chabad-calendar-height'){document.getElementById('chabadCal').style.height=(e.data.height+20)+'px';}});
</script>
```

## Settings
`config.json` – calendar ID, location for zmanim, candle-lighting minutes, how far back/ahead to show.

## Refresh now
GitHub → Actions → "Update calendar" → Run workflow.

## Local test
```
npm ci
CAL_ICS_FILE=test/sample.ics node scripts/build.mjs
python3 -m http.server -d site
```
