# Chabad of Carrollton-Lewisville – Events Calendar

Replaces Tockify. Reads the "Chabad Events" Google Calendar every 6 hours (or on demand) and publishes
a calendar page (GitHub Pages) that is embedded on jewishcarrollton.org.

**You keep adding events in Google Calendar exactly as before.**

## What it shows
- Month grid + list, styled like the site (prev/next, Today, List view)
- Hebrew date on every day and event; Hebrew months in the header
- Holidays, parsha, Friday candle lighting and havdalah for Lewisville (18 min.) in the month grid
- Series pictures for recurring events (by title), orange date tile otherwise
- Event popup: picture, details, map link, RSVP / "RSVP for location" email, add to Google/Apple/Outlook, WhatsApp share, copy link
- Readable share links (`e/torah-studies-nov-25/`) with WhatsApp/Facebook previews that open the event on jewishcarrollton.org
- Events marked Private in Google Calendar stay off the site

## Tips for events in Google Calendar
| You want | Do this in the Google event |
|---|---|
| A flyer picture | Attach the image from Google Drive (the file must be shared "Anyone with the link") |
| An RSVP button | Put a link in the description whose text or URL contains *RSVP*, *register* or *sign up* |
| A location + map link | Fill in the Location field |
| A multi-day event | Make it an all-day event spanning the days |
| Keep an event off the website | Set the event's visibility to Private |

## Embed code
See CLAUDE.md for the current (XML-safe) embed code. ChabadOne parses article HTML as XML, so no bare `&`.

## Settings
`config.json` – calendar ID, zmanim location, series pictures (`images`), hidden events (`hide`), share text.

## Refresh now
GitHub → Actions → "Update calendar" → Run workflow. Otherwise it refreshes every 6 hours.

## Local test
```
npm ci
CAL_ICS_FILE=test/sample.ics node scripts/build.mjs
python3 -m http.server -d site
```
