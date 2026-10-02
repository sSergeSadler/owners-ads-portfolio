// Lit le dossier Google Drive du portfolio et renvoie les vidéos classées par mois.
// Le dossier principal (partagé « Tous les utilisateurs disposant du lien ») contient un sous-dossier par mois,
// nommé par ex. « OCTOBRE 2026 » ou « 2026-10 ». Sans année (« OCTOBRE »), c'est le dernier mois de ce nom
// avant le mois en cours qui n'a pas déjà son dossier avec année.
const FOLDER_ID = process.env.DRIVE_FOLDER_ID || "1XS05P316iiLqf-p8AUSeBWmV9JV5ty48";

const MONTHS = ["janv", "fev", "mars", "avr", "mai", "juin", "juil", "aout", "sept", "oct", "nov", "dec"];
const ALIASES = { jan: 0, janvier: 0, fevrier: 1, feb: 1, mar: 2, avril: 3, apr: 3, may: 4, june: 5, juillet: 6, july: 6, aug: 7, august: 7, sep: 8, septembre: 8, october: 9, octobre: 9, novembre: 10, november: 10, decembre: 11, december: 11 };
const VIDEO = /\.(mp4|mov|m4v|webm|avi|mkv)$/i;

const decode = s => s.replace(/&amp;/g, "&").replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">")
  .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n));
const plain = s => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

async function list(id) {
  const r = await fetch("https://drive.google.com/embeddedfolderview?id=" + id, { headers: { "accept-language": "fr" } });
  if (!r.ok) throw new Error("Drive " + r.status);
  const html = await r.text(), out = [];
  const re = /id="entry-([\w-]+)"[\s\S]*?href="([^"]+)"[\s\S]*?class="flip-entry-title">([^<]*)</g;
  let m;
  while ((m = re.exec(html))) out.push({ id: m[1], folder: /\/folders\//.test(m[2]), name: decode(m[3]).trim() });
  return out;
}

function monthOf(name) {
  const n = plain(name);
  let m = n.match(/(20\d\d)\D{0,3}(\d{1,2})(?!\d)/);
  if (m && +m[2] >= 1 && +m[2] <= 12) return { y: +m[1], m: +m[2] };
  m = n.match(/(\d{1,2})\D{1,3}(20\d\d)/);
  if (m && +m[1] >= 1 && +m[1] <= 12) return { y: +m[2], m: +m[1] };
  const y = n.match(/20\d\d/);
  for (const w of n.split(/[^a-z]+/)) {
    if (!w) continue;
    let i = w in ALIASES ? ALIASES[w] : MONTHS.indexOf(w);
    if (i < 0 && w.length >= 3 && !w.startsWith("ju")) i = MONTHS.findIndex(p => p.startsWith(w) || w.startsWith(p));
    if (i >= 0) return { y: y ? +y[0] : null, m: i + 1 };
  }
  return null;
}

module.exports = async (req, res) => {
  res.setHeader("content-type", "application/json; charset=utf-8");
  if (!FOLDER_ID) { res.status(200).end(JSON.stringify({ months: [], configured: false })); return; }
  try {
    const subs = (await list(FOLDER_ID)).filter(e => e.folder).map(f => ({ ...f, when: monthOf(f.name) })).filter(f => f.when);
    const dated = new Set(subs.filter(f => f.when.y).map(f => f.when.y * 12 + f.when.m));
    const now = new Date(), cur = now.getFullYear() * 12 + now.getMonth() + 1;
    for (const f of subs) if (!f.when.y) {
      let y = now.getFullYear();
      while (y * 12 + f.when.m >= cur || dated.has(y * 12 + f.when.m)) y--;
      f.when.y = y;
    }
    const months = [];
    await Promise.all(subs.map(async f => {
      const when = f.when;
      const v = (await list(f.id)).filter(e => !e.folder && VIDEO.test(e.name))
        .map(e => [e.name.replace(VIDEO, ""), e.id])
        .sort((a, b) => a[0].localeCompare(b[0], "fr"));
      if (v.length) months.push({ ...when, v });
    }));
    // Mis en cache 15 secondes par Vercel : le Drive est relu au plus 4 fois par minute, quel que soit le nombre de visiteurs.
    res.setHeader("cache-control", "public, max-age=0, s-maxage=15, stale-while-revalidate=15");
    res.status(200).end(JSON.stringify({ months, configured: true }));
  } catch (e) {
    res.status(502).end(JSON.stringify({ error: String(e.message || e) }));
  }
};
