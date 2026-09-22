/**
 * Call night leaderboard — the page. The numbers come from /api/callers, which
 * reads the shared Google Sheet. The access key lives in the URL fragment
 * (#k=...) and is remembered in the browser; it never reaches the server as
 * part of the URL, only as a header.
 *
 * Nothing to edit here: titles, teams, prize, goal and call nights all come
 * from the API, which reads them from Vercel's environment variables.
 */
'use strict';
const KEY = (() => {
  const h = new URLSearchParams(location.hash.slice(1)).get('k');
  try { if (h) localStorage.setItem('k', h); return h || localStorage.getItem('k'); } catch { return h; }
})();
const REFRESH_MS = 300000;
const METRIQUES = [
  { k:'conv',   label:() => t('mConv'),   unite:() => t('uConv') },
  { k:'appels', label:() => t('mAppels'), unite:() => t('uAppels') },
  { k:'min',    label:() => t('mMin'),    unite:() => t('uMin') },
  { k:'taux',   label:() => t('mTaux'),   unite:() => t('uTaux') },
];
/* Le taux ne veut rien dire sous un certain volume : une conversion sur un
   seul appel ferait 100 %. En dessous du seuil, la personne n'est pas classee
   sur cette metrique — mais elle reste dans la liste avec ses autres chiffres. */
const SEUIL_TAUX = 15;
/* Le classement s'arrete a dix : au-dela, personne ne lit, et une liste qui
   descend jusqu'au dernier transforme un classement en rapport. */
const CAP = 10;
const PERIODES = [
  { k:'maintenant', label:() => t('maintenant') },
  { k:'jour',       label:() => t('jour') },
  { k:'semaine',    label:() => t('semaine') },
];
/* « Présentement » = la journée en cours, celle qui bouge pendant la call
   night. « Dernière journée » = la dernière journée terminée, donc hier. */
let TZ = 'America/Toronto';
/* Minutes ecoulees depuis minuit, chez l'equipe. On lit l'heure formatee
   plutot que de fabriquer une Date dans un autre fuseau : c'est la seule
   facon fiable de le faire sans bibliotheque. */
function minutesLocales() {
  const [h, m, sec] = new Date()
    .toLocaleTimeString('en-GB', { timeZone:TZ, hour12:false }).split(':').map(Number);
  return h * 60 + m + (sec || 0) / 60;
}
const aujourdhui = () => new Date().toLocaleDateString('en-CA', { timeZone:TZ });
/* Mode caller : deux vues qui alternent aux 20 secondes, comme demandé —
   celui qui n'a pas encore de conversion se voit passer dans les appels. */
const VUES = [{ metrique:'conv' }, { metrique:'appels' }, { metrique:'taux' }];
const TV_MS = 20000;

let gens = [], majAt = null, metrique = 'conv', periode = 'maintenant', erreur = null, choixFait = false;
let objectif = null, prix = null, prixLabel = null, admin = false, dernierFetch = 0;
let soiree = null;          // theme, heure de debut, prochaine soiree
let equipes = [], devise = 'CAD', kickerApi = null, sousApi = null;
let tvOn = false, tvTimer = null, tvIndex = 0;

/* ---------- deux langues : l'equipe est mixte QC / Ontario ---------- */
const T = {
  fr: {
    kicker:'Soirée d’appels', titre:'Course aux<br>conversions', details:'Détails',
    chargement:'Chargement…', direct:'En direct', reprise:'Reprise en cours…',
    refuse:'Lien refusé', invalide:'Lien invalide : la clé est absente.',
    illisible:'Impossible de lire la feuille pour le moment.',
    maintenant:'Présentement', jour:'Dernière journée', semaine:'7 derniers jours', tout:'Depuis le début',
    mConv:'Conversions', mAppels:'Appels', mMin:'Minutes',
    rapTitre:'Rapport d’appels', rapQui:'Caller', rapJours:'Jours', rapAppels:'Appels', rapMin:'Minutes', rapMoy:'Min / appel', rapConv:'Conv.', rapTaux:'Taux conv.', rapNoshow:'No-show', rapTauxNs:'Taux no-show', rapTemps:'Temps', rapTotal:'Total', rapJournal:'Journal complet, jour par jour', rapExport:'Exporter (CSV)', rapVide:'Aucun appel dans cette période.', rapDate:'Date',
    uConv:'conversions', uAppels:'appels', uMin:'minutes au téléphone',
    objectif:'Objectif de la semaine', surX:(n) => `/ ${n} conversions`,
    reste:(n, a, b) => `${n} de plus d'ici la fin de la semaine · ${a} au ${b}`,
    atteint:'🎯 Objectif atteint — le gage tombe sur le coach.',
    actifs:(c, a, n) => `conversions · ${a} appels · ${n} actif${n > 1 ? 's' : ''}`,
    stats:(c, a, m) => `${c} conv · ${a} appels · ${m} min`,
    sansNom:' · nom non renseigné dans la feuille',
    record:'★ record', modeTv:'📺 Mode caller', ensuite:'ensuite : ',
    prix:'Prix de la semaine', prixRegle:'seul le 1er repart avec', prixCarte:'carte-cadeau',
    eDebut:'Début dans', eEnCours:'En cours depuis', eCeSoir:'Ce soir', ePrix:'Prix',
    eHier:'Dernière soirée', eRien:'—', eEquipe:'équipe',
    revTitre:'Nouveaux résultats',
    revSomme:(n) => `+${n} conversion${n > 1 ? 's' : ''} depuis la dernière lecture`,
    prixAvance:(n, q) => `${n} d’avance sur ${q}`,
    prixSeul:'Seul en tête cette semaine',
    prixEgalite:(qui, n) => `Égalité à ${n} conversions : ${qui}`,
    prixPersonne:'Aucune conversion cette semaine — tout est encore à jouer.',
    pasCommence:"La soirée n'a pas encore commencé.<br>Les chiffres apparaîtront ici à mesure que la gang appelle.",
    aucune:'Aucune activité pour cette période.',
    autres:(n) => `+ ${n} autre${n > 1 ? 's' : ''} hors du top ${CAP}`,
    pied:(h) => `Lu à ${h} · la feuille source remonte aux ~30 min.`,
    aujourdhuiLe:(d) => `aujourd'hui, ${d}`, au:'au', langue:'EN',
    mTaux:'Taux', uTaux:'conversions par 100 appels', duel:'Duel des pipelines',
    rMeilleure:'Meilleure journée', rSerie:'Plus longue série', rJours:'jours d’affilée',
    rTotal:'Plus de conversions', records:'Records à battre',
    cPrendLaTete:(n) => `🔥 ${n} prend la tête !`,
    cAvance:(n, c) => `${n} monte à ${c} conversions`,
    cObjectif:'🎯 Objectif de la semaine atteint !',
  },
  en: {
    kicker:'Call night', titre:'Race to the<br>conversions', details:'Details',
    chargement:'Loading…', direct:'Live', reprise:'Reconnecting…',
    refuse:'Link refused', invalide:'Invalid link: the key is missing.',
    illisible:'Cannot read the sheet right now.',
    maintenant:'Right now', jour:'Last full day', semaine:'Last 7 days', tout:'All time',
    mConv:'Conversions', mAppels:'Calls', mMin:'Minutes',
    rapTitre:'Calling report', rapQui:'Caller', rapJours:'Days', rapAppels:'Calls', rapMin:'Minutes', rapMoy:'Min / call', rapConv:'Conv.', rapTaux:'Conv. rate', rapNoshow:'No-show', rapTauxNs:'No-show rate', rapTemps:'Time', rapTotal:'Total', rapJournal:'Full log, day by day', rapExport:'Export (CSV)', rapVide:'No calls in this period.', rapDate:'Date',
    uConv:'conversions', uAppels:'calls', uMin:'minutes on the phone',
    objectif:'Goal for the week', surX:(n) => `/ ${n} conversions`,
    reste:(n, a, b) => `${n} to go before the week ends · ${a} to ${b}`,
    atteint:'🎯 Goal reached — the coach pays up.',
    actifs:(c, a, n) => `conversions · ${a} calls · ${n} active`,
    stats:(c, a, m) => `${c} conv · ${a} calls · ${m} min`,
    sansNom:' · name not filled in the sheet',
    record:'★ best', modeTv:'📺 Caller mode', ensuite:'next: ',
    prix:'Prize of the week', prixRegle:'winner takes all', prixCarte:'gift card',
    eDebut:'Starts in', eEnCours:'Running for', eCeSoir:'Tonight', ePrix:'Prize',
    eHier:'Last night', eRien:'—', eEquipe:'team',
    revTitre:'Scores are in',
    revSomme:(n) => `+${n} conversion${n > 1 ? 's' : ''} since the last read`,
    prixAvance:(n, q) => `${n} ahead of ${q}`,
    prixSeul:'Alone at the top this week',
    prixEgalite:(qui, n) => `Tied at ${n} conversions: ${qui}`,
    prixPersonne:'No conversions yet this week — all still to play for.',
    pasCommence:'The night has not started yet.<br>Numbers will show up here as the team calls.',
    aucune:'No activity for this period.',
    autres:(n) => `+ ${n} more outside the top ${CAP}`,
    pied:(h) => `Read at ${h} · the source sheet refreshes every ~30 min.`,
    aujourdhuiLe:(d) => `today, ${d}`, au:'to', langue:'FR',
    mTaux:'Rate', uTaux:'conversions per 100 calls', duel:'Pipeline duel',
    rMeilleure:'Best single day', rSerie:'Longest streak', rJours:'days in a row',
    rTotal:'Most conversions', records:'Records to beat',
    cPrendLaTete:(n) => `🔥 ${n} takes the lead!`,
    cAvance:(n, c) => `${n} moves up to ${c} conversions`,
    cObjectif:'🎯 Weekly goal reached!',
  },
};
let lang = (() => { try { return localStorage.getItem('lang') === 'en' ? 'en' : 'fr'; } catch { return 'fr'; } })();
const t = (k) => T[lang][k];
const loc = () => (lang === 'en' ? 'en-CA' : 'fr-CA');

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const fmt = (v, d = 0) => new Intl.NumberFormat(loc(), { maximumFractionDigits:d }).format(v || 0);
const init = (n) => n.split(/\s+/).filter(Boolean).slice(0, 2).map((x) => x[0]).join('').toUpperCase();
/* Un disque de couleur propre a la personne, toujours la meme.
   Bien plus lisible qu'un cercle gris, et ca tient sur un ecran projete. */
function teinte(nom) {
  let h = 0;
  for (const c of String(nom)) h = (h * 31 + c.charCodeAt(0)) % 360;
  return h;
}
const visage = (g) => `<span class="mono" style="--h:${teinte(g.nom)}">${esc(init(g.nom))}</span>`;
const val = (g) => (metrique === 'taux'
  ? (g.appels >= SEUIL_TAUX ? g.conv / g.appels * 100 : 0)
  : g[metrique] || 0);
const jourFr = (iso) => new Date(iso + 'T12:00:00Z').toLocaleDateString(loc(), { day:'numeric', month:'long' });
const classePipe = (p) => 't' + ((Math.max(0, equipes.indexOf(p)) % 3) + 1);

const toutesLesJournees = () =>
  [...new Set(gens.flatMap((g) => Object.keys(g.jours || {})))].sort();

function fenetre(decalee) {
  const tri = toutesLesJournees();
  if (!tri.length) return { set:null, label:'aucune donnée' };
  const dernier = tri[tri.length - 1];
  const auj = aujourdhui();
  if (periode === 'maintenant') {
    if (!decalee) return { set:new Set([auj]), label:t('aujourdhuiLe')(jourFr(auj)), vide:!tri.includes(auj) };
    const avant = tri.filter((t) => t < auj);
    return avant.length ? { set:new Set([avant[avant.length - 1]]) } : null;
  }
  if (periode === 'jour') {
    // la dernière journée TERMINÉE : on saute celle d'aujourd'hui
    const finies = tri.filter((t) => t < auj);
    const cible = finies.length ? finies[finies.length - 1] : dernier;
    if (!decalee) return { set:new Set([cible]), label:jourFr(cible) };
    const avant = tri.filter((t) => t < cible);
    return avant.length ? { set:new Set([avant[avant.length - 1]]) } : null;
  }
  if (periode === 'semaine') {
    const j = (n) => new Date(new Date(dernier + 'T12:00:00Z').getTime() - n * 864e5).toISOString().slice(0, 10);
    if (!decalee) {
      const debut = j(6);
      return { set:new Set(tri.filter((x) => x >= debut)), label:`${jourFr(debut)} ${t('au')} ${jourFr(dernier)}` };
    }
    const a = j(13), b = j(7);
    const dans = tri.filter((t) => t >= a && t <= b);
    return dans.length ? { set:new Set(dans) } : null;
  }
  return decalee ? null : { set:null, label:`${jourFr(tri[0])} ${t('au')} ${jourFr(dernier)}` };
}

function cumul(setJours) {
  return gens.map((g) => {
    const out = { nom:g.nom, pipeline:g.pipeline, anonyme:g.anonyme, appels:0, conv:0, min:0 };
    for (const [t, v] of Object.entries(g.jours || {})) {
      if (setJours && !setJours.has(t)) continue;
      out.appels += v.appels; out.conv += v.conv; out.min += v.min;
    }
    return out;
  });
}

function recordPasse(g, avant) {
  let best = 0;
  for (const [t, v] of Object.entries(g.jours || {})) if (t < avant) best = Math.max(best, v[metrique] || 0);
  return best;
}

function agreger() {
  const f = fenetre(false);
  const liste = cumul(f.set);
  const avant = fenetre(true);
  if (avant) {
    const rangsAvant = new Map(cumul(avant.set).sort((a, b) => val(b) - val(a)).map((g, i) => [g.nom, i + 1]));
    const rangs = new Map([...liste].sort((a, b) => val(b) - val(a)).map((g, i) => [g.nom, i + 1]));
    for (const g of liste) {
      const a = rangsAvant.get(g.nom), b = rangs.get(g.nom);
      g.mv = (a && b) ? a - b : null;
    }
  }
  if (periode === 'jour' || periode === 'maintenant') {
    const jour = [...(f.set || [])][0];
    for (const g of liste) {
      const src = gens.find((x) => x.nom === g.nom);
      g.pb = val(g) > 0 && val(g) > recordPasse(src, jour);
    }
  }
  return { liste, label:f.label, vide:f.vide };
}

const badge = (g) => (g.mv > 0 ? ` <span class="mv up">▲${g.mv}</span>` : g.mv < 0 ? ` <span class="mv down">▼${-g.mv}</span>` : '')
  + (g.pb ? ` <span class="mv pb">${t('record')}</span>` : '');
/* Le pipeline ne s'ecrit plus sur chaque ligne : le meme nom neuf fois de
   suite, c'etait la repetition la plus bruyante de la page. Il devient un
   filet de couleur sur le flanc, avec le nom au survol. */

/* ---------- le classement glisse au lieu de sauter ----------
   On note ou chaque ligne se trouve, on repeint, puis on remet chaque ligne
   a son ancienne place et on la laisse rejoindre la nouvelle. Sans ca le
   tableau se reecrit d'un bloc et le depassement — le seul moment qui compte
   dans une course — passe inapercu. */
const animationsOk = () => typeof matchMedia !== 'function'
  || !matchMedia('(prefers-reduced-motion:reduce)').matches;

function mesurer(el) {
  const m = new Map();
  if (!el || typeof el.querySelectorAll !== 'function') return m;
  for (const n of el.querySelectorAll('[data-nom]')) {
    if (typeof n.getBoundingClientRect !== 'function') continue;
    m.set(n.getAttribute('data-nom'), n.getBoundingClientRect());
  }
  return m;
}

function glisser(el, avant) {
  if (!avant || !avant.size || !animationsOk()) return;
  if (typeof requestAnimationFrame !== 'function') return;
  const bouges = [];
  for (const n of el.querySelectorAll('[data-nom]')) {
    // On coupe l'entree en fondu : elle deplace l'element (donc fausse la
    // mesure) et rejouer la cascade a chaque rafraichissement fatigue l'oeil.
    n.style.animation = 'none';
    const a = avant.get(n.getAttribute('data-nom'));
    if (!a) { n.style.animation = ''; continue; }        // un nouveau venu entre normalement
    const r = n.getBoundingClientRect();
    const dx = a.left - r.left, dy = a.top - r.top;
    if (Math.abs(dx) < 2 && Math.abs(dy) < 2) continue;
    n.style.transform = `translate(${dx}px,${dy}px)`;
    bouges.push([n, dy]);
  }
  if (!bouges.length) return;
  // Deux images d'attente : la premiere pose la position d'avant, la seconde
  // lance le glissement. Une seule et le navigateur fusionne les deux etats.
  requestAnimationFrame(() => requestAnimationFrame(() => {
    for (const [n, dy] of bouges) {
      n.style.transition = 'transform .6s cubic-bezier(.22,.9,.28,1)';
      n.style.transform = '';
      if (dy > 3) n.classList.add('gagne');             // il est monte
      setTimeout(() => { n.classList.remove('gagne'); n.style.transition = ''; }, 1150);
    }
  }));
}

function rendre() {
  if (erreur) {
    $('rangs').innerHTML = '';
    $('podium').innerHTML = '';
    $('equipes').innerHTML = '';
    $('note').innerHTML = `<div class="err">${esc(erreur)}</div>`;
    return;
  }
  $('periodes').innerHTML = PERIODES.map((x) =>
    `<button class="chip" type="button" data-p="${x.k}" aria-pressed="${x.k === periode}">${esc(x.label())}</button>`).join('');
  $('metriqueSel').innerHTML = METRIQUES.map((x) =>
    `<option value="${x.k}" ${x.k === metrique ? 'selected' : ''}>${esc(x.label())}</option>`).join('');

  const { liste, label, vide } = agreger();
  const tri = [...liste].sort((a, b) => val(b) - val(a) || b.conv - a.conv || b.appels - a.appels);
  const unite = METRIQUES.find((x) => x.k === metrique).unite();
  const top = tri.slice(0, 3), reste = tri.slice(3, CAP);
  const caches = Math.max(0, tri.filter((g) => val(g) > 0).length - CAP);
  const max = Math.max(1, ...tri.map(val));

  $('tvquoi').textContent = METRIQUES.find((x) => x.k === metrique).label();
  $('tvquand').textContent = label;

  // Duel des pipelines : une seule barre ou ils se poussent.
  const parPipe = {};
  for (const g of liste) {
    const p2 = (parPipe[g.pipeline] ||= { conv:0, appels:0 });
    p2.conv += g.conv; p2.appels += g.appels;
  }
  const duel = Object.entries(parPipe).filter(([, v]) => v.conv || v.appels)
    .sort((a, b) => b.conv - a.conv);
  const totalDuel = duel.reduce((s2, [, v]) => s2 + v.conv, 0);
  $('equipes').innerHTML = (duel.length && totalDuel) ? `<div class="duel">
    <div class="titre">${esc(t('duel'))}</div>
    <div class="corde">${duel.map(([p2, v]) =>
      `<span class="seg ${classePipe(p2)}" style="width:${(v.conv / totalDuel * 100).toFixed(1)}%"><b>${fmt(v.conv)}</b></span>`).join('')}</div>
    <div class="leg">${duel.map(([p2, v]) =>
      `<span class="lg"><i class="${classePipe(p2)}"></i>${esc(p2)} · <b>${fmt(v.conv)}</b>`
      + ` <span class="pct">${(v.conv / totalDuel * 100).toFixed(0)} %</span></span>`).join('')}</div>
  </div>` : '';

  // La hauteur de la marche suit le score : le premier a toujours la plus haute.
  const BASE = 58, AMPLI = 92;
  const carte = (g, i) => g ? `
    <div class="pod r${i + 1}" data-nom="${esc(g.nom)}" style="animation-delay:${[120, 0, 240][i] || 0}ms">
      <div class="rang-pastille">${i + 1}</div>
      <div class="face">${visage(g)}</div>
      <div class="nm">${esc(g.nom)}</div>
      <div class="sub">${esc(g.pipeline || '')}${badge(g)}</div>
      <div class="marche" style="height:${Math.round(BASE + (val(g) / max) * AMPLI * (i === 0 ? 1.25 : 1))}px">${fmt(val(g))}</div>
      <div class="unite">${esc(unite)}</div>
    </div>` : '<div class="pod"></div>';
  const rienAujourdhui = vide && !tri.some((g) => val(g));
  const avantPodium = mesurer($('podium'));
  $('podium').innerHTML = (top.length && !rienAujourdhui)
    ? [carte(top[1], 1), carte(top[0], 0), carte(top[2], 2)].join('') : '';
  glisser($('podium'), avantPodium);

  const avantRangs = mesurer($('rangs'));
  $('rangs').innerHTML = tri.length ? reste.map((g, i) => `
    <div class="rang tuyau ${classePipe(g.pipeline)} ${val(g) ? '' : 'zero'}" data-nom="${esc(g.nom)}"
         title="${esc(g.pipeline || '')}" style="animation-delay:${Math.min(i * 35, 420)}ms">
      <span class="n">${i + 4}</span>
      <span>
        <span class="nm">${esc(g.nom)}${badge(g)}</span>
        <span class="sub">${esc(t('stats')(fmt(g.conv), fmt(g.appels), fmt(g.min)))}${g.anonyme ? esc(t('sansNom')) : ''}</span>
      </span>
      <span class="v">${metrique === 'taux' ? fmt(val(g), 1) + '%' : fmt(val(g))}</span>
    </div>`).join('') + (caches ? `<div class="autres">${esc(t('autres')(caches))}</div>` : '')
    : `<div class="vide">${esc(t('aucune'))}</div>`;
  if (rienAujourdhui) {
    $('rangs').innerHTML = `<div class="vide">${t('pasCommence')}</div>`;
  }
  glisser($('rangs'), avantRangs);

  rendreEcran();
  rendrePrix();
  rendreObjectif();
  rendreRecords();
  rendreRapport();
  if (tvOn) rendreTicker();

  $('pied').textContent = majAt
    ? t('pied')(new Date(majAt).toLocaleTimeString(loc(), { hour:'2-digit', minute:'2-digit' })) : '';
}

/* La semaine de reference : les 7 derniers jours presents dans la feuille.
   L'objectif ET le prix s'appuient dessus — s'ils calculaient chacun la leur,
   la barre annoncerait une semaine et la bande du prix une autre. */
/* La semaine de la course commence le SAMEDI — le premier des quatre soirs
   d'appel (samedi, dimanche, lundi, mardi) — et finit le vendredi. Les quatre
   soirees tombent donc dans la meme semaine, et tout repart a zero le samedi
   matin sans que personne ait a remettre un compteur a la main.

   Ce n'est plus « les 7 derniers jours presents dans la feuille » : cette
   fenetre-la restait accrochee au dernier soir saisi, donc la barre et le prix
   affichaient encore la semaine passee tant qu'aucun chiffre neuf n'arrivait.
   Le samedi matin, le classement annoncait toujours le gagnant de mardi. */
let DEBUT_SEMAINE = 6;        // 0 = dimanche ... 6 = samedi — vient de l'API

function semaine() {
  // Toujours d'apres la date de l'equipe, jamais celle du visiteur.
  const d = new Date(aujourdhui() + 'T12:00:00Z');
  const recul = (d.getUTCDay() - DEBUT_SEMAINE + 7) % 7;
  const jour = (n) => new Date(d.getTime() + n * 864e5).toISOString().slice(0, 10);
  return { debut: jour(-recul), fin: jour(6 - recul) };
}

/* L'objectif est hebdomadaire : il se calcule toujours sur les 7 derniers
   jours, peu importe la section affichee. */
function rendreObjectif() {
  const el = $('objectif');
  if (!objectif) { el.innerHTML = ''; el.style.display = 'none'; return; }
  el.style.display = '';
  const sem = semaine();
  if (!sem) { el.innerHTML = ''; return; }
  const { debut, fin } = sem;
  let total = 0;
  for (const g of gens) for (const [t, v] of Object.entries(g.jours || {})) {
    if (t >= debut && t <= fin) total += v.conv;
  }
  const pct = Math.min(100, total / objectif * 100);
  const reste = Math.max(0, objectif - total);
  el.innerHTML = `
    <div class="hd">
      <span class="t">${esc(t('objectif'))}</span>
      <span class="v">${fmt(total)}<small>${esc(t('surX')(fmt(objectif)))}</small></span>
    </div>
    <div class="track"><div class="fill ${pct >= 100 ? 'plein' : ''}" style="width:${pct.toFixed(1)}%"></div></div>
    <div class="s">${pct >= 100 ? esc(t('atteint')) : esc(t('reste')(fmt(reste), jourFr(debut), jourFr(fin)))}</div>`;
}

/* ---------- le prix de la semaine ----------
   Un seul gagnant : le premier aux CONVERSIONS sur les 7 derniers jours. Le
   classement affiche peut etre trie sur les appels ou les minutes ; le prix,
   lui, ne change pas de metrique, sinon il changerait de main a chaque clic
   dans le menu. Aucun montant fixe = la bande n'existe pas : mieux vaut rien
   qu'un prix a 0 $. */
function rendrePrix() {
  const el = $('prix');
  const sem = semaine();
  if (!prix || !sem) { el.innerHTML = ''; el.style.display = 'none'; return; }
  el.style.display = '';
  const dans = new Set(toutesLesJournees().filter((j) => j >= sem.debut && j <= sem.fin));
  const classe = cumul(dans).filter((g) => g.conv > 0).sort((a2, b2) => b2.conv - a2.conv);
  const montant = new Intl.NumberFormat(loc(),
    { style:'currency', currency:devise, maximumFractionDigits:0 }).format(prix);
  const periode = `${jourFr(sem.debut)} ${t('au')} ${jourFr(sem.fin)}`;

  let face = '', qui = '', sous = esc(periode);
  if (!classe.length) {
    qui = esc(t('prixPersonne'));
  } else {
    const chef = classe[0];
    const exaequo = classe.filter((g) => g.conv === chef.conv);
    if (exaequo.length > 1) {
      // Personne ne « tient » le prix tant qu'il y a egalite : le dire, plutot
      // que de designer un gagnant par hasard d'ordre de tri.
      qui = esc(t('prixEgalite')(exaequo.slice(0, 3).map((g) => g.nom).join(', '), fmt(chef.conv)));
    } else {
      face = `<span class="face">${visage(chef)}</span>`;
      qui = `${esc(chef.nom)} · ${fmt(chef.conv)} ${esc(t('uConv'))}`;
      sous = esc((classe[1] ? t('prixAvance')(fmt(chef.conv - classe[1].conv), classe[1].nom) : t('prixSeul'))
        + ' · ' + periode);
    }
  }
  // « giftcard » est le seul mot-cle : il se traduit avec la page. N'importe
  // quel autre texte (« Carte-cadeau Amazon ») s'affiche tel qu'ecrit.
  const nature = prixLabel ? (prixLabel === 'giftcard' ? t('prixCarte') : prixLabel) : '';
  el.innerHTML = `${face}<div class="txt">
      <div class="t">${esc(t('prix'))}${nature ? ' · ' + esc(nature) : ''}</div>
      <div class="qui">${qui}</div>
      <div class="s">${sous}</div>
    </div>
    <div class="montant">${esc(montant)}<small>${esc(t('prixRegle'))}</small></div>`;
}

/* ---------- l'ecran d'accueil ----------
   Les gens arrivent sur le Zoom quelques minutes avant. Plutot qu'un titre
   fige, l'ecran annonce la soiree : le compte a rebours, le theme, le prix,
   et le resultat de la derniere fois. La course commence avant le premier
   appel. */
function derniereSoiree() {
  const tri = toutesLesJournees();
  const auj = aujourdhui();
  const finies = tri.filter((j) => j < auj);
  const jour = finies.length ? finies[finies.length - 1] : null;
  if (!jour) return null;
  const liste = cumul(new Set([jour])).filter((g) => g.conv > 0)
    .sort((a2, b2) => b2.conv - a2.conv);
  if (!liste.length) return null;
  return { jour, chef: liste[0], total: liste.reduce((n, g) => n + g.conv, 0) };
}

function rendreEcran() {
  const el = $('ecranInfos');
  if (!el) return;
  const cartes = [];

  // Compte a rebours, seulement les soirs d'appel et si l'heure est connue.
  if (soiree && soiree.ce_soir && soiree.debut) {
    const [h, m] = String(soiree.debut).split(':').map(Number);
    if (Number.isFinite(h)) {
      const reste = (h * 60 + (m || 0)) - minutesLocales();
      const hhmm = (mn) => {
        const t = Math.max(0, Math.floor(mn));
        return (t >= 60 ? Math.floor(t / 60) + ' h ' : '') + String(t % 60).padStart(2, '0') + ' min';
      };
      cartes.push([reste > 0 ? t('eDebut') : t('eEnCours'), hhmm(Math.abs(reste)), reste > 0 ? 'or' : '']);
    }
  }
  if (soiree && soiree.theme) cartes.push([t('eCeSoir'), soiree.theme, '']);
  if (prix) {
    const nature = prixLabel ? (prixLabel === 'giftcard' ? t('prixCarte') : prixLabel) : '';
    const montant = new Intl.NumberFormat(loc(),
      { style:'currency', currency:devise, maximumFractionDigits:0 }).format(prix);
    cartes.push([t('ePrix'), montant + (nature ? ' · ' + nature : ''), 'or']);
  }
  const d = derniereSoiree();
  if (d) cartes.push([t('eHier'), `${d.chef.nom} · ${fmt(d.chef.conv)} — ${t('eEquipe')} ${fmt(d.total)}`, '']);

  el.innerHTML = cartes.map(([titre, valeur, cl]) =>
    `<span class="bulle ${cl}"><b>${esc(titre)}</b>${esc(valeur)}</span>`).join('');
}

/* ---------- le mur des records ---------- */
function records() {
  let meilleurJour = null, serie = null;
  for (const g of gens) {
    const jours = Object.entries(g.jours || {}).sort(([a], [b]) => a.localeCompare(b));
    for (const [j, v] of jours) {
      if (v.conv && (!meilleurJour || v.conv > meilleurJour.n)) meilleurJour = { nom:g.nom, n:v.conv, jour:j };
    }
    // serie : journees consecutives avec au moins une conversion
    let courante = 0, precedent = null, max = 0;
    for (const [j, v] of jours) {
      if (!v.conv) { courante = 0; precedent = j; continue; }
      const veille = new Date(new Date(j + 'T12:00:00Z').getTime() - 864e5).toISOString().slice(0, 10);
      courante = (precedent === veille) ? courante + 1 : 1;
      precedent = j;
      if (courante > max) max = courante;
    }
    if (max > 1 && (!serie || max > serie.n)) serie = { nom:g.nom, n:max };
  }
  const totaux = gens.map((g) => ({ nom:g.nom, n:Object.values(g.jours || {}).reduce((s2, v) => s2 + v.conv, 0) }))
    .sort((a, b) => b.n - a.n)[0];
  return { meilleurJour, serie, totaux };
}

function rendreRecords() {
  const el = $('records');
  const { meilleurJour, serie, totaux } = records();
  const cartes = [];
  if (meilleurJour) cartes.push([t('rMeilleure'), `${meilleurJour.n}`, `${meilleurJour.nom} · ${jourFr(meilleurJour.jour)}`]);
  if (serie) cartes.push([t('rSerie'), `${serie.n}`, `${serie.nom} · ${t('rJours')}`]);
  if (totaux && totaux.n) cartes.push([t('rTotal'), `${totaux.n}`, totaux.nom]);
  el.innerHTML = cartes.length
    ? cartes.map(([titre, gros, qui]) =>
        `<div class="rec"><div class="t">${esc(titre)}</div><div class="v">${esc(gros)}</div><div class="s">${esc(qui)}</div></div>`).join('')
    : '';
}

/* ---------- rapport d'appels : les 7 indicateurs + le journal ----------
   La version du « Calling Report » de Simon, sur la periode choisie en haut.
   Tout vient des memes journees que le classement ; les taux sont calcules
   ici (la feuille les a aussi, mais recalcules ils restent coherents avec les
   totaux). */
const pct = (a, b) => (b ? `${Math.round((a / b) * 100)} %` : '—');
const nb1 = (v) => (Math.round(v * 10) / 10).toLocaleString(loc());
function rapportLignes() {
  const f = fenetre(false);
  const out = [];
  for (const g of gens) {
    const r = { nom:g.nom, pipeline:g.pipeline, jours:0, appels:0, min:0, conv:0, noshow:0, temps:0, journal:[] };
    for (const [j, v] of Object.entries(g.jours || {})) {
      if (f.set && !f.set.has(j)) continue;
      r.jours++; r.appels += v.appels || 0; r.min += v.min || 0; r.conv += v.conv || 0; r.noshow += v.noshow || 0; r.temps += v.temps || 0;
      r.journal.push({ jour:j, ...v });
    }
    if (r.jours) out.push(r);
  }
  return out.sort((a, b) => b.conv - a.conv || b.appels - a.appels);
}
function rendreRapport() {
  const el = $('rapport'); if (!el) return;
  $('rapportTitre').textContent = t('rapTitre');
  const lignes = rapportLignes();
  if (!lignes.length) { el.innerHTML = `<div class="sous">${esc(t('rapVide'))}</div>`; return; }
  const tot = lignes.reduce((a, r) => ({ jours:a.jours + r.jours, appels:a.appels + r.appels, min:a.min + r.min, conv:a.conv + r.conv, noshow:a.noshow + r.noshow, temps:a.temps + r.temps }), { jours:0, appels:0, min:0, conv:0, noshow:0, temps:0 });
  const cell = (r) => `<td>${r.jours}</td><td>${r.appels}</td><td>${nb1(r.min)}</td><td>${r.appels ? nb1(r.min / r.appels) : '—'}</td><td><b>${r.conv}</b></td><td>${pct(r.conv, r.appels)}</td><td>${r.noshow}</td><td>${pct(r.noshow, r.conv)}</td><td>${nb1(r.temps)}</td>`;
  const entetes = `<th>${esc(t('rapJours'))}</th><th>${esc(t('rapAppels'))}</th><th>${esc(t('rapMin'))}</th><th>${esc(t('rapMoy'))}</th><th>${esc(t('rapConv'))}</th><th>${esc(t('rapTaux'))}</th><th>${esc(t('rapNoshow'))}</th><th>${esc(t('rapTauxNs'))}</th><th>${esc(t('rapTemps'))}</th>`;
  const journal = lignes.flatMap((r) => r.journal.map((j) => ({ ...j, nom:r.nom, pipeline:r.pipeline }))).sort((a, b) => b.jour.localeCompare(a.jour) || b.conv - a.conv);
  el.innerHTML = `<button type="button" class="exp" id="rapExport">${esc(t('rapExport'))}</button>
    <table><thead><tr><th>${esc(t('rapQui'))}</th>${entetes}</tr></thead><tbody>
      ${lignes.map((r) => `<tr><td>${esc(r.nom)} <span class="sous">${esc(r.pipeline)}</span></td>${cell(r)}</tr>`).join('')}
      <tr class="tot"><td>${esc(t('rapTotal'))} · ${lignes.length}</td>${cell(tot)}</tr>
    </tbody></table>
    <details class="jl"><summary>${esc(t('rapJournal'))} · ${journal.length}</summary>
      <table><thead><tr><th>${esc(t('rapDate'))}</th><th style="text-align:left">${esc(t('rapQui'))}</th><th>${esc(t('rapAppels'))}</th><th>${esc(t('rapMin'))}</th><th>${esc(t('rapConv'))}</th><th>${esc(t('rapTaux'))}</th><th>${esc(t('rapNoshow'))}</th><th>${esc(t('rapTemps'))}</th></tr></thead><tbody>
      ${journal.map((j) => `<tr><td style="text-align:left">${esc(jourFr(j.jour))}</td><td style="text-align:left">${esc(j.nom)}</td><td>${j.appels || 0}</td><td>${nb1(j.min || 0)}</td><td><b>${j.conv || 0}</b></td><td>${pct(j.conv || 0, j.appels || 0)}</td><td>${j.noshow || 0}</td><td>${nb1(j.temps || 0)}</td></tr>`).join('')}
      </tbody></table></details>`;
  $('rapExport').onclick = () => {
    const lig = [[t('rapDate'), t('rapQui'), 'Pipeline', t('rapAppels'), t('rapMin'), t('rapConv'), t('rapNoshow'), t('rapTemps')],
      ...journal.map((j) => [j.jour, j.nom, j.pipeline, j.appels || 0, j.min || 0, j.conv || 0, j.noshow || 0, j.temps || 0])];
    const csv = lig.map((l) => l.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type:'text/csv;charset=utf-8' }));
    a.download = `rapport-appels-${aujourdhui()}.csv`; a.click(); URL.revokeObjectURL(a.href);
  };
}

/* ---------- celebrations : uniquement quand quelque chose change ---------- */
let signature = null;
let derniersConv = null;          // { nom: conversions du jour } a la lecture precedente
const evenements = [];            // les gains detectes, du plus recent au plus ancien
function confetti(n = 120) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const c = document.createElement('canvas');
  c.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:60';
  c.width = innerWidth; c.height = innerHeight;
  document.body.appendChild(c);
  const ctx = c.getContext('2d');
  const cols = ['#ffd75e', '#ff6b7c', '#6fa8ff', '#4fd39b', '#ffffff'];
  const P = Array.from({ length:n }, () => ({
    x: c.width * (0.15 + Math.random() * 0.7), y: c.height * 0.36 + Math.random() * 50,
    vx: (Math.random() - 0.5) * 10, vy: -7 - Math.random() * 9,
    s: 5 + Math.random() * 8, r: Math.random() * Math.PI, vr: (Math.random() - 0.5) * 0.32,
    col: cols[(Math.random() * cols.length) | 0],
  }));
  const t0 = performance.now();
  (function frame(tm) {
    ctx.clearRect(0, 0, c.width, c.height);
    for (const p of P) {
      p.vy += 0.34; p.x += p.vx; p.y += p.vy; p.r += p.vr;
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.r); ctx.fillStyle = p.col;
      ctx.fillRect(-p.s / 2, -p.s / 2, p.s, p.s * 0.62); ctx.restore();
    }
    if (tm - t0 < 3200) requestAnimationFrame(frame); else c.remove();
  })(t0);
}
function toast(texte) {
  const el = document.createElement('div');
  el.className = 'toast'; el.textContent = texte;
  document.body.appendChild(el);
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 500); }, 4500);
}
function carillon() {
  try {
    const A = window.AudioContext || window.webkitAudioContext;
    if (!A) return;
    const ac = new A(), now = ac.currentTime;
    [660, 990].forEach((f, i) => {
      const o = ac.createOscillator(), g = ac.createGain();
      o.type = 'sine'; o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, now + i * 0.13);
      g.gain.exponentialRampToValueAtTime(0.2, now + i * 0.13 + 0.03);
      g.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.13 + 0.4);
      o.connect(g); g.connect(ac.destination);
      o.start(now + i * 0.13); o.stop(now + i * 0.13 + 0.45);
    });
    setTimeout(() => { try { ac.close(); } catch {} }, 1500);
  } catch {}
}

/* Detecte les gains de conversions entre deux lectures. La feuille remonte
   aux ~30 min, donc les gains arrivent parfois en paquet — on les annonce
   quand meme un par un, c'est ce qui fait vivre le bandeau. */
function detecterGains() {
  const j = aujourdhui();
  const courant = {};
  for (const g of gens) courant[g.nom] = (g.jours || {})[j]?.conv || 0;
  const neufs = [];
  if (derniersConv) {
    for (const [nom, n] of Object.entries(courant)) {
      const avant = derniersConv[nom] || 0;
      if (n > avant) {
        const e = { nom, gain:n - avant, total:n, at:Date.now() };
        evenements.unshift(e);
        neufs.push(e);
      }
    }
    evenements.splice(10);
  }
  derniersConv = courant;
  // Trie du plus gros gain au plus petit : la revelation ouvre sur le coup
  // le plus fort, pas sur le premier nom venu de l'objet.
  return neufs.sort((a2, b2) => b2.gain - a2.gain);
}

/* ---------- la révélation ----------
   La feuille arrive par paquets : tant qu'IMPORTRANGE dort, rien ne bouge,
   puis dix conversions tombent d'un coup. Les laisser glisser en silence,
   c'est gaspiller le seul moment de la soirée où le tableau a quelque chose
   à annoncer. On coupe donc la page une seconde et on montre ce qui vient
   d'entrer — puis le classement se réorganise derrière, comme d'habitude. */
let revTimer = null;
function revelation(gains) {
  const el = $('reveal');
  if (!el || !gains.length) return;
  const total = gains.reduce((n, g) => n + g.gain, 0);
  el.innerHTML = `<div class="carte">
      <div class="t">${esc(t('revTitre'))}</div>
      <div class="n">+${fmt(total)}</div>
      <div class="s">${esc(t('revSomme')(total))}</div>
      <div class="qui">${gains.slice(0, 6).map((g) => `<div class="l">
        <span class="nm">${esc(g.nom)}</span>
        <span class="g">+${fmt(g.gain)}</span>
        <span class="tt">${fmt(g.total)}</span>
      </div>`).join('')}</div>
    </div>`;
  el.hidden = false;
  // Deux images d'attente, sinon le navigateur fusionne l'affichage et
  // l'animation, et la carte apparait deja en place.
  requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('va')));
  clearTimeout(revTimer);
  revTimer = setTimeout(fermerRevelation, tvOn ? 6000 : 4500);
}
function fermerRevelation() {
  const el = $('reveal');
  if (!el || el.hidden) return;
  clearTimeout(revTimer);
  el.classList.remove('va');
  // On attend la fin du fondu avant de le retirer du flux.
  setTimeout(() => { el.hidden = true; el.innerHTML = ''; }, 320);
}

function rendreTicker() {
  const piste = $('piste'), barre = $('ticker');
  const j = aujourdhui();
  const dujour = gens
    .map((g) => ({ nom:g.nom, conv:(g.jours || {})[j]?.conv || 0, appels:(g.jours || {})[j]?.appels || 0 }))
    .filter((x) => x.conv || x.appels)
    .sort((a, b) => b.conv - a.conv);
  if (!dujour.length) { barre.classList.add('vide'); piste.innerHTML = ''; return; }
  barre.classList.remove('vide');

  const items = [
    ...evenements.map((e) => `<span class="tk neuf"><span class="d">▲ +${e.gain}</span>`
      + `<b>${esc(e.nom.toUpperCase())}</b><span class="n">${fmt(e.total)}</span></span>`),
    ...dujour.map((x, i) => `<span class="tk ${i === 0 ? 'tete' : ''}">`
      + `<b>${esc(x.nom.toUpperCase())}</b><span class="n">${fmt(x.conv)}</span>`
      + `<span>${esc(t('uConv'))} · ${fmt(x.appels)} ${esc(t('uAppels'))}</span></span>`),
  ];
  const bloc = items.join('');
  piste.innerHTML = bloc + bloc;                     // doublé : la boucle est invisible
  piste.style.setProperty('--duree', Math.max(28, items.length * 7) + 's');
}

/* On compare deux lectures : nouveau meneur, record battu, objectif atteint. */
function verifierCelebrations() {
  const j = aujourdhui();
  const dujour = gens.map((g) => ({ nom:g.nom, conv:(g.jours || {})[j]?.conv || 0 }))
    .filter((x) => x.conv).sort((a, b) => b.conv - a.conv);
  const meneur = dujour[0] || null;
  const semTotal = (() => {
    const sem = semaine();
    let s2 = 0;
    for (const g of gens) for (const [d2, v] of Object.entries(g.jours || {})) {
      if (d2 >= sem.debut && d2 <= sem.fin) s2 += v.conv;
    }
    return s2;
  })();
  const sig = { meneur:meneur?.nom || null, conv:meneur?.conv || 0, semaine:semTotal };
  if (signature) {
    if (sig.meneur && sig.meneur !== signature.meneur) {
      toast(t('cPrendLaTete')(sig.meneur)); confetti(); if (tvOn) carillon();
    } else if (sig.meneur && sig.conv > signature.conv) {
      toast(t('cAvance')(sig.meneur, sig.conv));
    }
    if (objectif && signature.semaine < objectif && sig.semaine >= objectif) {
      toast(t('cObjectif')); confetti(180); if (tvOn) carillon();
    }
  }
  signature = sig;
}

/* ---------- l'ecran titre ----------
   Il couvre la page, qui est deja rendue dessous : rien ne se charge pendant
   ce temps-la. On clique n'importe ou, une onde doree part du point touche,
   l'ecran s'efface en grandissant d'un cheveu, et le classement est la. */
let introFaite = false, compteFait = false;

/* ============ Le titre, a modifier ici ============
   `blanc` reste en blanc, `or` recoit le metal et le balayage de lumiere. */
const ECRAN = {
  fr: { kick:() => kickerApi || 'Soirée d’appels', blanc:'Course aux', or:'Conversions',
        sous:() => (sousApi || equipes.join(' · ')) + ' — classement en direct',
        invite:'Clique pour entrer' },
  en: { kick:() => kickerApi || 'Call night', blanc:'Race to the', or:'Conversions',
        sous:() => (sousApi || equipes.join(' · ')) + ' — live standings',
        invite:'Click to enter' },
};
/* ================================================== */

/* The API brings the kicker, the subtitle and the team names: refresh the
   title screen's words without replaying its animation. */
function majEcranTextes() {
  const c = ECRAN[lang] || ECRAN.fr;
  if ($('ecranKick')) $('ecranKick').textContent = c.kick();
  if ($('ecranSous')) $('ecranSous').textContent = c.sous();
}

function lancerIntro() {
  const el = $('ecran');
  if (!el) return;
  const c = ECRAN[lang] || ECRAN.fr;
  $('ecranKick').textContent = c.kick();
  $('ecranBlanc').textContent = c.blanc;
  $('ecranSous').textContent = c.sous();
  $('ecranInvite').innerHTML = `${esc(c.invite)} <b></b>`;
  $('ecranDate').textContent = new Date().toLocaleDateString(loc(),
    { weekday:'long', day:'numeric', month:'long' });
  const or = $('ecranOr');
  or.textContent = c.or;
  if (or.setAttribute) or.setAttribute('data-text', c.or);
  // Deja entre : on vient seulement de changer de langue, l'ecran ne revient pas.
  if (introFaite) return;
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
    el.classList.add('parti'); introFaite = true; return;
  }
  // Le balayage repart du debut a chaque affichage, une fois et une seule.
  or.classList.remove('brille');
  void or.offsetWidth;
  or.classList.add('brille');
  el.addEventListener('click', entrer);
  // N'importe quelle touche ouvre aussi : l'ecran couvre tout, il n'y a rien
  // d'autre a faire a ce moment-la.
  document.addEventListener('keydown', entrer);
}

function entrer(e) {
  if (introFaite) return;
  // Un raccourci du navigateur (⌘R, ⌘L…) n'est pas une envie d'entrer.
  if (e && (e.metaKey || e.ctrlKey || e.altKey)) return;
  introFaite = true;
  if (e && e.type === 'keydown' && e.preventDefault) e.preventDefault();
  const el = $('ecran');

  // L'onde part du point exact du clic ; au clavier, du centre.
  const onde = document.createElement('div');
  onde.className = 'onde';
  const x = (e && typeof e.clientX === 'number') ? e.clientX : innerWidth / 2;
  const y = (e && typeof e.clientY === 'number') ? e.clientY : innerHeight / 2;
  onde.style.left = x + 'px';
  onde.style.top = y + 'px';
  document.body.appendChild(onde);
  requestAnimationFrame(() => onde.classList.add('va'));
  setTimeout(() => onde.remove(), 1100);

  el.classList.add('parti');
  compterPodium();
}

/* Les trois chiffres du podium partent de zero et montent jusqu'a leur valeur. */
function compterPodium() {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  for (const m of document.querySelectorAll('.pod .marche')) {
    const cible = parseFloat(String(m.textContent).replace(/[^\d.,-]/g, '').replace(',', '.'));
    if (!Number.isFinite(cible) || cible <= 0) continue;
    const suffixe = /%/.test(m.textContent) ? '%' : '';
    const t0 = performance.now(), duree = 800;
    (function pas(now) {
      const k = Math.min(1, (now - t0) / duree);
      const e = 1 - Math.pow(1 - k, 3);
      m.textContent = (suffixe ? (cible * e).toFixed(1) : Math.round(cible * e)) + suffixe;
      if (k < 1) requestAnimationFrame(pas);
    })(t0);
  }
}

function etat(txt, c) { $('etat').textContent = txt; $('dot').className = 'dot' + (c ? ' ' + c : ''); }

/* Les textes qui vivent dans le HTML, pas dans le rendu. */
function traduireCoquille() {
  $('kicker').textContent = kickerApi || t('kicker');
  $('titre').innerHTML = t('titre');
  $('tv').textContent = t('modeTv');
  $('lang').textContent = t('langue');
  $('detailsTitre').textContent = t('details');
  document.documentElement.lang = lang;
}
$('lang').addEventListener('click', () => {
  lang = lang === 'fr' ? 'en' : 'fr';
  try { localStorage.setItem('lang', lang); } catch {}
  traduireCoquille();
// Repliee sur telephone, ouverte sur ordinateur : le classement reste en premier.
$('details').open = innerWidth >= 900;
lancerIntro();
  rendre();
});
traduireCoquille();
// Repliee sur telephone, ouverte sur ordinateur : le classement reste en premier.
$('details').open = innerWidth >= 900;
lancerIntro();

/* Un changement de section va rechercher les chiffres, mais pas plus d'une
   fois par 20 secondes : inutile de marteler l'API en cliquant partout. */
async function rafraichirSiVieux() {
  if (Date.now() - dernierFetch > 20000) await charger();
  else rendre();
}


async function charger() {
  if (!KEY) { erreur = t('invalide'); etat(t('refuse'), 'bad'); return rendre(); }
  try {
    const r = await fetch('/api/callers', { headers:{ 'x-board-key':KEY }, cache:'no-store' });
    if (r.status === 404) { erreur = t('invalide'); etat(t('refuse'), 'bad'); return rendre(); }
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const d = await r.json();
    gens = d.gens || []; majAt = d.generated_at; erreur = null;
    objectif = d.objectif || null; prix = d.prix || null; prixLabel = d.prixLabel || null;
    soiree = d.soiree || null; admin = !!d.admin;
    equipes = d.pipelines || []; devise = d.currency || 'CAD';
    if (d.tz) TZ = d.tz;
    if (Number.isFinite(d.weekStart)) DEBUT_SEMAINE = d.weekStart;
    kickerApi = d.kicker || null; sousApi = d.subtitle || null;
    traduireCoquille(); majEcranTextes();
    dernierFetch = Date.now();
    if (!choixFait) {
      choixFait = true;
      const auj = aujourdhui();
      /* On n'ouvre sur « Présentement » que si la soirée a vraiment commencé.
         Deux lignes a 1 conversion en fin d'apres-midi, ce n'est pas une
         soiree : c'est un classement vide qui donne l'air d'une page cassee
         a quelqu'un qui arrive par le lien. */
      const duJour = gens.reduce((n, g) => n + ((g.jours && g.jours[auj])
        ? (g.jours[auj].conv || 0) + (g.jours[auj].appels || 0) : 0), 0);
      if (duJour < 25) periode = 'jour';
    }
    etat(t('direct'), '');
    if (introFaite && !compteFait) { compteFait = true; compterPodium(); }
    const gains = detecterGains();
    verifierCelebrations();
    // Jamais a la toute premiere lecture : derniersConv est vide, donc
    // `gains` l'est aussi, et personne ne recoit une revelation en arrivant.
    if (gains.length) revelation(gains);
  } catch {
    if (!gens.length) erreur = t('illisible');
    etat(t('reprise'), 'bad');
  }
  rendre();
}

function tvTick() {
  tvIndex = (tvIndex + 1) % VUES.length;
  metrique = VUES[tvIndex].metrique;
  rendre();
  charger();   // en mode caller, chaque bascule rafraichit : l'ecran ne dort jamais
  $('tvprochain').textContent = t('ensuite') + METRIQUES.find((x) => x.k === VUES[(tvIndex + 1) % VUES.length].metrique).label.toLowerCase();
}
function setTv(on) {
  tvOn = on;
  document.body.classList.toggle('tv', on);
  clearInterval(tvTimer);
  if (on) {
    tvIndex = 0; metrique = VUES[0].metrique; rendre();
    $('tvprochain').textContent = t('ensuite') + t('mAppels').toLowerCase();
    tvTimer = setInterval(tvTick, TV_MS);
    document.documentElement.requestFullscreen?.().catch(() => {});
  } else {
    if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
    rendre();
  }
}

$('periodes').addEventListener('click', (e) => {
  const b = e.target.closest('[data-p]');
  if (!b) return;
  periode = b.dataset.p; choixFait = true;
  rendre();              // reponse immediate au clic
  rafraichirSiVieux();   // puis on va chercher du frais
});
$('metriqueSel').addEventListener('change', (e) => {
  metrique = e.target.value;
  rendre();
  rafraichirSiVieux();
});
$('reveal').addEventListener('click', fermerRevelation);
// Le compte a rebours doit descendre tout seul tant que l'ecran est la.
setInterval(() => { if (!introFaite) rendreEcran(); }, 20000);
$('tv').addEventListener('click', () => setTv(!tvOn));
document.addEventListener('fullscreenchange', () => { if (!document.fullscreenElement && tvOn) setTv(false); });
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (!$('reveal').hidden) return fermerRevelation();
  if (tvOn) setTv(false);
});
setInterval(() => { if (document.visibilityState === 'visible') charger(); }, REFRESH_MS);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') charger(); });
charger();
