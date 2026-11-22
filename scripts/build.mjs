// Builds site/events.json from the Google Calendar iCal feed plus Hebrew dates,
// holidays and candle-lighting times for Lewisville, TX.
//
// Feed source (first one set wins):
//   CAL_ICS_URL   – full URL (use the "secret address in iCal format" if the calendar is private)
//   CAL_ICS_FILE  – local .ics file (for testing)
//   otherwise the public feed of CALENDAR_ID in config.json

import ICAL from 'ical.js';
import { HDate, HebrewCalendar, Location, Locale, gematriya, flags } from '@hebcal/core';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const config = JSON.parse(await fs.readFile(path.join(root, 'config.json'), 'utf8'));
const TZ = config.timezone;

// ---------- 1. Load the feed ----------
async function loadIcs() {
  if (process.env.CAL_ICS_FILE) return fs.readFile(process.env.CAL_ICS_FILE, 'utf8');
  const url = process.env.CAL_ICS_URL ||
    `https://calendar.google.com/calendar/ical/${encodeURIComponent(config.calendarId)}/public/basic.ics`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Calendar feed returned HTTP ${res.status}`);
  return res.text();
}

// ---------- 2. Time helpers ----------
// Offset (minutes) of a time zone at a given instant.
function tzOffset(zone, date) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: zone, hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(date).reduce((a, p) => (a[p.type] = p.value, a), {});
  const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
  return (asUtc - date.getTime()) / 60000;
}
// Wall-clock time in `zone` → real instant.
function wallToDate(y, mo, d, h, mi, s, zone) {
  const guess = Date.UTC(y, mo - 1, d, h, mi, s);
  let off = tzOffset(zone, new Date(guess));
  let t = guess - off * 60000;
  const off2 = tzOffset(zone, new Date(t));
  if (off2 !== off) t = guess - off2 * 60000;
  return new Date(t);
}
const ymd = (y, m, d) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

// ICAL.Time → { allDay, date: 'YYYY-MM-DD', iso }
function convert(t) {
  if (t.isDate) return { allDay: true, date: ymd(t.year, t.month, t.day) };
  let dt;
  const zone = t.zone && t.zone.tzid;
  if (zone === 'UTC' || zone === 'Z') {
    dt = new Date(Date.UTC(t.year, t.month - 1, t.day, t.hour, t.minute, t.second));
  } else {
    // TZID or floating time: read it as wall-clock time in its own zone (default: site zone)
    const tzid = t.timezone || (zone && zone !== 'floating' ? zone : TZ);
    let z = TZ;
    try { new Intl.DateTimeFormat('en-US', { timeZone: tzid }); z = tzid; } catch { /* unknown → site zone */ }
    dt = wallToDate(t.year, t.month, t.day, t.hour, t.minute, t.second, z);
  }
  return { allDay: false, iso: dt.toISOString(), date: localDate(dt) };
}
function localDate(dt) {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(dt);
  return p; // en-CA gives YYYY-MM-DD
}

// ---------- 3. Text helpers ----------
function cleanDescription(raw = '') {
  // Google sends descriptions as light HTML. Keep links and line breaks, drop everything else.
  let s = String(raw)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li)>/gi, '\n')
    .replace(/<li[^>]*>/gi, '• ');
  const links = [];
  s = s.replace(/<a [^>]*href="([^"]+)"[^>]*>(.*?)<\/a>/gi, (_, href, text) => {
    links.push({ href, text: text.replace(/<[^>]+>/g, '') });
    return `\u0000${links.length - 1}\u0000`;
  });
  s = s.replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n').trim();
  s = s.replace(/\u0000(\d+)\u0000/g, (_, i) => `[[${links[i].text}|${links[i].href}]]`);
  return s;
}

// Google Drive attachment → displayable image URL (file must be shared "anyone with the link").
function imageFromAttach(prop) {
  const url = prop.getFirstValue();
  const fmt = prop.getParameter('fmttype') || '';
  const name = prop.getParameter('filename') || '';
  const isImage = fmt.startsWith('image/') || /\.(png|jpe?g|gif|webp)$/i.test(name) || /\.(png|jpe?g|gif|webp)(\?|$)/i.test(url);
  if (!isImage) return null;
  const m = url.match(/drive\.google\.com\/(?:open\?id=|file\/d\/|uc\?(?:[^&]*&)*id=)([\w-]+)/);
  return m ? `https://drive.google.com/thumbnail?id=${m[1]}&sz=w600` : url;
}
function attachments(comp) {
  const out = { image: null, files: [] };
  for (const p of comp.getAllProperties('attach')) {
    const img = imageFromAttach(p);
    if (img && !out.image) out.image = img;
    else out.files.push({ name: p.getParameter('filename') || 'Attachment', url: p.getFirstValue() });
  }
  return out;
}

// Default flyer per event series, from config.images: { "Torah Studies": "img/torah-studies.jpg" }
function seriesImage(title) {
  const t = title.toLowerCase();
  for (const [key, img] of Object.entries(config.images || {})) if (img && t.startsWith(key.toLowerCase())) return img;
  return null;
}

// RSVP / registration link: first link whose text or URL looks like signup, else none.
function findRsvp(desc) {
  const re = /\[\[([^|\]]*)\|([^\]]+)\]\]/g;
  let m;
  while ((m = re.exec(desc))) {
    if (/rsvp|register|registration|sign ?up|tickets?|reserve/i.test(m[1] + ' ' + m[2])) return m[2];
  }
  const bare = desc.match(/https?:\/\/\S*(rsvp|register|registration|signup|events?\/)\S*/i);
  return bare ? bare[0].replace(/[).,]+$/, '') : null;
}

// ---------- 4. Expand events ----------
function buildEvents(icsText, from, to) {
  const vcal = new ICAL.Component(ICAL.parse(icsText));
  for (const tz of vcal.getAllSubcomponents('vtimezone')) ICAL.TimezoneService.register(tz);

  const byUid = new Map();
  for (const ve of vcal.getAllSubcomponents('vevent')) {
    const uid = ve.getFirstPropertyValue('uid');
    if (!byUid.has(uid)) byUid.set(uid, { master: null, exceptions: [] });
    if (ve.hasProperty('recurrence-id')) byUid.get(uid).exceptions.push(ve);
    else byUid.get(uid).master = ve;
  }

  const out = [];
  const push = (comp, start, end, uid) => {
    if ((comp.getFirstPropertyValue('status') || '').toUpperCase() === 'CANCELLED') return;
    const title = (comp.getFirstPropertyValue('summary') || 'Event').trim();
    const desc = cleanDescription(comp.getFirstPropertyValue('description') || '');
    const s = convert(start), e = end ? convert(end) : null;
    const att = attachments(comp);
    out.push({
      id: `${uid}_${s.iso || s.date}`.replace(/[^\w-]/g, ''),
      title,
      allDay: s.allDay,
      date: s.date,
      start: s.iso || null,
      // all-day DTEND is exclusive in iCal; store the inclusive last day
      endDate: s.allDay && e ? prevDay(e.date) : (e ? e.date : s.date),
      end: e && e.iso ? e.iso : null,
      location: (comp.getFirstPropertyValue('location') || '').trim(),
      description: desc,
      image: att.image || seriesImage(title),
      files: att.files,
      rsvp: findRsvp(desc),
    });
  };

  for (const [uid, { master, exceptions }] of byUid) {
    if (!master) { exceptions.forEach(x => { const ev = new ICAL.Event(x); push(x, ev.startDate, ev.endDate, uid); }); continue; }
    const ev = new ICAL.Event(master);
    exceptions.forEach(x => ev.relateException(x));
    if (!ev.isRecurring()) {
      const s = convert(ev.startDate);
      if (s.date >= from && s.date <= to) push(master, ev.startDate, ev.endDate, uid);
      continue;
    }
    const it = ev.iterator();
    let next, guard = 0;
    while ((next = it.next()) && guard++ < 2000) {
      const occ = ev.getOccurrenceDetails(next);
      const s = convert(occ.startDate);
      if (s.date > to) break;
      if (s.date < from) continue;
      push(occ.item.component, occ.startDate, occ.endDate, uid);
    }
  }
  out.sort((a, b) => (a.start || a.date + 'T00').localeCompare(b.start || b.date + 'T00'));
  return out;
}
function prevDay(d) {
  const t = new Date(d + 'T12:00:00Z'); t.setUTCDate(t.getUTCDate() - 1);
  return t.toISOString().slice(0, 10);
}

// ---------- 5. Jewish calendar: Hebrew dates, holidays, zmanim ----------
function jewishCalendar(from, to) {
  const loc = new Location(config.location.latitude, config.location.longitude, false, TZ,
    config.location.name, 'US', undefined, config.location.elevation || 0);
  const start = new Date(from + 'T12:00:00Z'), end = new Date(to + 'T12:00:00Z');
  const evs = HebrewCalendar.calendar({
    start, end, location: loc, candlelighting: true, sedrot: true, il: false,
    candleLightingMins: config.candleLightingMins, havdalahMins: config.havdalahMins || undefined,
    havdalahDeg: config.havdalahMins ? undefined : 8.5, noModern: false, locale: 'en',
  });
  const days = {};
  const day = (d) => (days[d] ||= { heb: '', holidays: [], candles: null, havdalah: null, parsha: null });

  // Hebrew date for every day in range
  for (let t = new Date(start); t <= end; t.setUTCDate(t.getUTCDate() + 1)) {
    const d = t.toISOString().slice(0, 10);
    const hd = new HDate(new Date(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate()));
    day(d).heb = `${gematriya(hd.getDate())} ${Locale.gettext(hd.getMonthName(), 'he-x-NoNikud')}`;
    day(d).hy = gematriya(hd.getFullYear() % 1000);
  }
  for (const e of evs) {
    const g = e.getDate().greg();
    const d = ymd(g.getFullYear(), g.getMonth() + 1, g.getDate());
    const f = e.getFlags();
    if (e.getDesc() === 'Havdalah') {
      day(d).havdalah = e.eventTime ? e.eventTime.toISOString() : null;
    } else if (e.getDesc() === 'Candle lighting') {
      day(d).candles = e.eventTime ? e.eventTime.toISOString() : null;
    } else if (/^Chanukah: \d+ Candles?$/.test(e.getDesc())) {
      const n = parseInt(e.getDesc().match(/\d+/)[0], 10);
      day(d).holidays.push({ en: `Chanukah – light ${n} candle${n > 1 ? 's' : ''}`, he: `חנוכה – נר ${gematriya(n)}`, major: false, chanukah: n });
    } else if (f & flags.PARSHA_HASHAVUA) {
      day(d).parsha = e.render('he-x-NoNikud').replace(/^פרשת\s*/, '');
      day(d).parshaEn = e.render('en');
    } else if (!(f & (flags.DAF_YOMI | flags.OMER_COUNT | flags.MOLAD | flags.SHABBAT_MEVARCHIM | flags.USER_EVENT))) {
      if (f & flags.MODERN_HOLIDAY) continue;
      day(d).holidays.push({ en: e.render('en'), he: e.render('he-x-NoNikud'), major: !!(f & (flags.CHAG | flags.MAJOR_FAST)) });
    }
  }
  return days;
}

// ---------- 6. Run ----------
const now = new Date();
const from = localDate(new Date(now.getTime() - config.daysBack * 864e5)).slice(0, 8) + '01';
const to = localDate(new Date(now.getTime() + config.daysAhead * 864e5));

const ics = await loadIcs();
const events = buildEvents(ics, from, to);
const busyOnly = events.length > 0 && events.every(e => e.title === 'Busy');
if (busyOnly) {
  console.error('Every event in the feed is titled "Busy". The calendar is shared as free/busy only.\n' +
    'Set it to "See all event details", or put the secret iCal address in the CAL_ICS_URL secret.');
  process.exit(1);
}
const data = { generated: now.toISOString(), timezone: TZ, from, to, site: config.site, events, days: jewishCalendar(from, to) };
await fs.mkdir(path.join(root, 'site'), { recursive: true });
await fs.writeFile(path.join(root, 'site', 'events.json'), JSON.stringify(data));
console.log(`Wrote ${events.length} events (${from} → ${to}).`);
