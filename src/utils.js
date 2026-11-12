'use strict';
const TZ = 'Asia/Jakarta';

class HttpError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

// Jam sistem bisa diganti saat pengujian.
let clockOffsetMs = 0;
const now = () => new Date(Date.now() + clockOffsetMs);
const setClockOffset = (ms) => { clockOffsetMs = ms; };

const iso = (d = now()) => new Date(d).toISOString();
const addMinutes = (d, m) => new Date(new Date(d).getTime() + m * 60000);

const dateFmt = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
const hmFmt = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false });

/** Tanggal WIB berformat YYYY-MM-DD. */
const wibDate = (d = now()) => dateFmt.format(new Date(d));
/** Jam WIB berformat HH:MM. */
const wibHM = (d = now()) => hmFmt.format(new Date(d)).replace(/^24/, '00');
/** Jam WIB (0-23) sebagai angka. */
const wibHour = (d = now()) => Number(wibHM(d).slice(0, 2));
/** Membentuk Date dari tanggal WIB dan jam HH:MM. */
const fromWib = (dateStr, hm) => new Date(`${dateStr}T${hm}:00+07:00`);

const isHM = (s) => typeof s === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(s);

const str = (v, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const int = (v, def = null) => {
  const n = Number(v);
  return Number.isInteger(n) ? n : def;
};

module.exports = { HttpError, now, setClockOffset, iso, addMinutes, wibDate, wibHM, wibHour, fromWib, isHM, str, int, TZ };
