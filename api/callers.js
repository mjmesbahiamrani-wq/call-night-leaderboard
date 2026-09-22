/**
 * Call night leaderboard — the API.
 *
 * Reads one Google Sheet (shared "anyone with the link, viewer") through its
 * CSV export, parses the daily caller report, and returns the numbers to the
 * page. No database, no Google API, no service account: every setting is an
 * environment variable, so the whole thing deploys with one click on Vercel.
 *
 * Nothing to edit in this file. Settings live in the Vercel dashboard
 * (Settings → Environment Variables) — see README.md for the list.
 */
import { createHash, timingSafeEqual } from 'node:crypto';

export const config = { maxDuration: 30 };

/* ---------- settings (all from environment variables) ---------- */
const env = (k, d = '') => {
  const v = process.env[k];
  return v === undefined || v === null || String(v).trim() === '' ? d : String(v).trim();
};
const num = (k, d) => {
  const v = Number(env(k));
  return env(k) !== '' && Number.isFinite(v) ? v : d;
};

/** Turns whatever was pasted (full link, edit link, bare ID) into a CSV export URL. */
export function csvUrl(raw) {
  const s = String(raw || '').trim();
  if (!s) return '';
  if (/\/export\?/.test(s) || /output=csv/.test(s)) return s;     // already an export link
  const id = (s.match(/\/d\/([a-zA-Z0-9_-]{20,})/) || [])[1]
    || (/^[a-zA-Z0-9_-]{20,}$/.test(s) ? s : null);
  if (!id) return '';
  const gid = (s.match(/[#&?]gid=(\d+)/) || [])[1];
  return `https://docs.google.com/spreadsheets/d/${id}/export?format=csv${gid ? '&gid=' + gid : ''}`;
}

const SHEET_URL = csvUrl(env('SHEET_URL'));
const SHEET_FAST_URL = csvUrl(env('SHEET_FAST_URL'));        // optional (see README, "faster refresh")
const MAX_STALE_MIN = num('SHEET_FAST_MAX_STALE_MIN', 15);
const TEAM_KEY = env('TEAM_KEY');
const TEAMS = env('TEAMS', 'Team 1,Team 2,Team 3').split(',').map((x) => x.trim()).filter(Boolean);
const TZ = env('TIMEZONE', 'America/Toronto');
const CURRENCY = env('CURRENCY', 'CAD');
const KICKER = env('KICKER');
const SUBTITLE = env('SUBTITLE');
const NIGHT_START = env('NIGHT_START');                        // "18:00", optional
const GOAL_WEEK = num('GOAL_WEEK', 0);
const PRIZE_AMOUNT = num('PRIZE_AMOUNT', 0);
const PRIZE_LABEL = env('PRIZE_LABEL');

// Sheet layout. Defaults match the standard daily caller report: team blocks
// 100 columns wide, one column of dates, then 12 people × 8 columns each.
const BLOCK_WIDTH = num('BLOCK_WIDTH', 100);
const COLS_PER_PERSON = num('COLS_PER_PERSON', 8);
const PEOPLE_PER_BLOCK = num('PEOPLE_PER_BLOCK', 12);
const HEADER_DATE = env('HEADER_DATE', 'Date');
const HEADER_CALLS = new RegExp(env('HEADER_CALLS', '# of Calls').replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
const COLS = {
  appels: num('COL_CALLS', 0), min: num('COL_MINUTES', 1), conv: num('COL_CONVERSIONS', 3),
  noshow: num('COL_NOSHOWS', 5), temps: num('COL_TIME', 7),
};

// Call nights, as weekday names. The race week starts on the first night of
// the run (Sat–Tue → the week starts Saturday and resets Saturday morning).
const JOURS = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6,
  dim: 0, lun: 1, mar: 2, mer: 3, jeu: 4, ven: 5, sam: 6 };
const CALL_NIGHTS = [...new Set(env('CALL_NIGHTS', 'sat,sun,mon,tue').toLowerCase()
  .split(/[,\s]+/).map((x) => JOURS[x.slice(0, 3)]).filter((x) => x !== undefined))];
export function debutDeSemaine(nuits = CALL_NIGHTS) {
  if (!nuits.length || nuits.length === 7) return 1;
  for (const d of nuits) if (!nuits.includes((d + 6) % 7)) return d;
  return nuits[0];
}

// Only real header artifacts are dropped. "Caller 3" placeholders STAY: on a
// sheet where nobody typed the names, dropping them makes a whole team vanish.
const FAUX = /^(caller name|date|office testing|)$/i;

/* ---------- access ---------- */
const sha = (s) => createHash('sha256').update(String(s)).digest('hex');
const safeEq = (a, b) => {
  const A = Buffer.from(a), B = Buffer.from(b);
  return A.length === B.length && timingSafeEqual(A, B);
};
function accesOk(key) {
  if (typeof key !== 'string' || key.length < 8) return false;
  if (!TEAM_KEY || TEAM_KEY.length < 8) return false;
  return safeEq(sha(key), sha(TEAM_KEY));
}

/* ---------- CSV ---------- */
function parseCsv(txt) {
  const lignes = [];
  let ligne = [], champ = '', dansGuillemets = false;
  for (let i = 0; i < txt.length; i++) {
    const c = txt[i];
    if (dansGuillemets) {
      if (c === '"') {
        if (txt[i + 1] === '"') { champ += '"'; i++; } else dansGuillemets = false;
      } else champ += c;
    } else if (c === '"') dansGuillemets = true;
    else if (c === ',') { ligne.push(champ); champ = ''; }
    else if (c === '\n') { ligne.push(champ); lignes.push(ligne); ligne = []; champ = ''; }
    else if (c !== '\r') champ += c;
  }
  if (champ || ligne.length) { ligne.push(champ); lignes.push(ligne); }
  return lignes;
}

// Dates usually arrive as Google serial numbers (46278 = 13 Sept 2026). Typed
// dates are accepted too: a reformatted tab must not silently empty the board.
export const serieVersJour = (n) => {
  const brut = String(n ?? '').trim();
  if (!brut) return null;
  const v = Number(brut);
  if (Number.isFinite(v)) {
    if (v < 40000 || v > 60000) return null;
    return new Date(Math.round((v - 25569) * 86400000)).toISOString().slice(0, 10);
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(brut)) return brut;
  const barres = brut.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/);
  if (barres) {
    let [, a1, b1, an] = barres;
    let mois = Number(a1), jr = Number(b1);
    if (mois > 12) { const t = mois; mois = jr; jr = t; }      // DD/MM/YYYY
    if (mois < 1 || mois > 12 || jr < 1 || jr > 31) return null;
    const d = `${an}-${String(mois).padStart(2, '0')}-${String(jr).padStart(2, '0')}`;
    return d >= '2020-01-01' && d <= '2040-12-31' ? d : null;
  }
  return null;
};
const nombre = (s) => {
  const v = parseFloat(String(s ?? '').replace(/[, %]/g, ''));
  return Number.isFinite(v) ? v : 0;
};

export function analyser(csv, teams = TEAMS) {
  const lignes = parseCsv(csv);
  const gens = new Map();
  for (let b = 0; b < teams.length; b++) {
    const o = b * BLOCK_WIDTH;
    // The header row is found by landmark, never by a fixed row number.
    let ligneEntetes = -1;
    for (let i = 0; i < lignes.length && ligneEntetes < 0; i++) {
      if ((lignes[i][o] || '').trim() === HEADER_DATE && HEADER_CALLS.test(lignes[i][o + 1] || '')) ligneEntetes = i;
    }
    if (ligneEntetes < 1) continue;
    const noms = [];
    for (let k = 0; k < PEOPLE_PER_BLOCK; k++) {
      noms.push((lignes[ligneEntetes - 1][o + 1 + k * COLS_PER_PERSON] || '').trim());
    }
    for (let i = ligneEntetes + 1; i < lignes.length; i++) {
      const jour = serieVersJour(lignes[i][o]);
      if (!jour) continue;
      noms.forEach((nom, k) => {
        if (!nom || FAUX.test(nom)) return;
        const base = o + 1 + k * COLS_PER_PERSON;
        const d = {
          appels: nombre(lignes[i][base + COLS.appels]),
          min: nombre(lignes[i][base + COLS.min]),
          conv: nombre(lignes[i][base + COLS.conv]),
          noshow: nombre(lignes[i][base + COLS.noshow]),
          temps: nombre(lignes[i][base + COLS.temps]),
        };
        if (!d.appels && !d.conv && !d.min) return;
        if (!gens.has(nom)) {
          gens.set(nom, { nom, pipeline: teams[b], anonyme: /^caller\s*\d+$/i.test(nom), jours: {} });
        }
        gens.get(nom).jours[jour] = d;
      });
    }
  }
  return [...gens.values()];
}

/** Age in minutes of a "fast" copy, from the SYNC:<iso> stamp the optional script leaves. */
export function ageDeLaCopie(csv, maintenant = Date.now()) {
  const m = csv.slice(0, 20000).match(/SYNC:(\d{4}-\d{2}-\d{2}T[\d:.]+Z)/);
  if (!m) return null;
  const t = Date.parse(m[1]);
  return Number.isFinite(t) ? (maintenant - t) / 60000 : null;
}

async function tirer(url) {
  const r = await fetch(url, { redirect: 'follow' });
  if (!r.ok) throw new Error(`The sheet answered ${r.status}.`);
  const txt = await r.text();
  // A de-shared sheet answers with a login page and status 200.
  if (/<html/i.test(txt.slice(0, 200))) throw new Error('The sheet is no longer shared by link.');
  return txt;
}

async function lireFeuille() {
  if (!SHEET_URL) throw new Error('SHEET_URL is not set.');
  if (!SHEET_FAST_URL || SHEET_FAST_URL === SHEET_URL) {
    return { csv: await tirer(SHEET_URL), source: 'origine', age: null };
  }
  let premiere = null;
  try {
    const csv = await tirer(SHEET_FAST_URL);
    const age = ageDeLaCopie(csv);
    if (age !== null && age <= MAX_STALE_MIN) return { csv, source: 'rapide', age };
    premiere = csv;
  } catch (err) {
    console.warn('Fast tab unreadable:', err.message);
  }
  try {
    return { csv: await tirer(SHEET_URL), source: 'secours', age: null };
  } catch (err) {
    if (premiere) return { csv: premiere, source: 'rapide-perime', age: null };
    throw err;
  }
}

/* ---------- tonight ---------- */
const jourLocal = (d = new Date()) => d.toLocaleDateString('en-CA', { timeZone: TZ });
function laSoiree() {
  const auj = jourLocal();
  const estSoiree = (iso) => CALL_NIGHTS.includes(new Date(iso + 'T12:00:00Z').getUTCDay());
  let prochaine = null;
  for (let i = 1; i <= 14 && !prochaine; i++) {
    const iso = new Date(Date.parse(auj + 'T12:00:00Z') + i * 864e5).toISOString().slice(0, 10);
    if (estSoiree(iso)) prochaine = { jour: iso, theme: null };
  }
  return { ce_soir: estSoiree(auj), theme: null, debut: NIGHT_START || null, prochaine };
}

/* ---------- handler ---------- */
export default async function handler(req, res) {
  try {
    if (!accesOk(req.headers['x-board-key'])) {
      // 404, not 403: a wrong key learns nothing.
      return res.status(404).json({ error: 'Lien invalide ou expiré.' });
    }
    if (req.method !== 'GET') return res.status(405).json({ error: 'GET only.' });

    let csv, source, age;
    try {
      ({ csv, source, age } = await lireFeuille());
    } catch (err) {
      return res.status(502).json({ error: String(err.message || err) });
    }
    const gens = analyser(csv);

    // Never a shared cache: the response depends on the key.
    res.setHeader('Cache-Control', 'no-store, private');
    return res.status(200).json({
      generated_at: new Date().toISOString(),
      source,
      age_min: age === null ? null : Math.round(age * 10) / 10,
      pipelines: TEAMS,
      tz: TZ,
      currency: CURRENCY,
      kicker: KICKER || null,
      subtitle: SUBTITLE || null,
      weekStart: debutDeSemaine(),
      callNights: CALL_NIGHTS,
      admin: false,
      objectif: GOAL_WEEK || null,
      prix: PRIZE_AMOUNT || null,
      prixLabel: PRIZE_LABEL || null,
      soiree: laSoiree(),
      gens,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Something went wrong on the server.' });
  }
}
