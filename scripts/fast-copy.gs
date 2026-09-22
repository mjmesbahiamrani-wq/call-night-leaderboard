/**
 * FAST COPY (optional) — replaces the IMPORTRANGE wait with a direct copy.
 * =====================================================================
 *
 * THE PROBLEM
 * If your sheet is fed by IMPORTRANGE, Google refreshes it every ~30 minutes
 * and that delay cannot be changed. The board rereads the sheet every 5
 * minutes, but the numbers it finds are up to half an hour old.
 *
 * WHAT THIS SCRIPT DOES
 * It reads the SAME source sheets, but directly, with your account (the one
 * that authorised the IMPORTRANGE formulas). A copy takes about a second, and
 * a trigger can rerun it EVERY MINUTE. It never touches your formulas: it
 * writes into a separate, hidden tab called "RAPIDE". If the script ever
 * stops, the board notices (the copy carries a timestamp) and falls back to
 * the original tab on its own.
 *
 * HOW TO INSTALL
 *   1. Go to https://script.google.com signed in as the account that OWNS
 *      the sheet. New project. Delete what is there, paste THIS WHOLE FILE.
 *   2. Replace PASTE_YOUR_SHEET_ID_HERE below with your sheet's ID (the long
 *      code in the sheet's address, between /d/ and /edit). Save.
 *   3. At the top, pick the function "verifier" and click Run. It writes
 *      nothing: it only says whether the sources are readable. Google asks
 *      for permission: Review permissions → your account → Advanced →
 *      Go to ... → Allow. That is normal: the script reads your own sheets.
 *   4. Then run "syncRapide". The log prints the URL to give the board.
 *   5. Triggers (the clock icon on the left) → Add trigger:
 *        function: syncRapide · event source: time-driven ·
 *        type: minutes timer · every minute. Save.
 *   6. In Vercel → Settings → Environment Variables, add SHEET_FAST_URL with
 *      the URL from step 4, then Deployments → Redeploy.
 */

/** Nom de l'onglet rapide. Il est cree tout seul au premier passage. */
var ONGLET_RAPIDE = 'RAPIDE';

/**
 * Identifiant de la feuille (the one the board reads).
 * Sert uniquement quand le script tourne depuis script.google.com, ou il
 * n'est attache a aucune feuille. Colle dans Extensions > Apps Script, il
 * n'est meme pas lu.
 */
var ID_CLASSEUR = 'PASTE_YOUR_SHEET_ID_HERE';   // <-- your sheet ID

/**
 * Le classeur sur lequel travailler.
 *
 * Attache a la feuille, getActiveSpreadsheet() repond. En projet autonome il
 * rend null — on ouvre alors par identifiant. Le meme fichier marche donc
 * des deux cotes, sans rien changer.
 */
function classeur_() {
  var actif = SpreadsheetApp.getActiveSpreadsheet();
  return actif || SpreadsheetApp.openById(ID_CLASSEUR);
}

/**
 * Copie chaque bloc IMPORTRANGE vers l'onglet rapide.
 *
 * Le script DECOUVRE les sources tout seul en lisant les formules de l'onglet
 * d'origine : rien a coder en dur, et le jour ou tu ajoutes un pipeline, la
 * copie le suit sans qu'on retouche au script.
 */
function syncRapide() {
  var classeur = classeur_();
  var source = classeur.getSheets()[0];              // l'onglet aux formules
  var blocs = trouverImportrange_(source);

  if (!blocs.length) {
    throw new Error(
      'Aucune formule IMPORTRANGE trouvee dans l\'onglet « ' + source.getName() + ' ». '
      + 'Verifie que c\'est bien le premier onglet du classeur.');
  }

  var rapide = classeur.getSheetByName(ONGLET_RAPIDE);
  if (!rapide) {
    rapide = classeur.insertSheet(ONGLET_RAPIDE);
    rapide.hideSheet();          // il n'est pas fait pour etre lu a l'oeil
  }

  var copiees = 0;
  for (var i = 0; i < blocs.length; i++) {
    var b = blocs[i];
    try {
      var valeurs = SpreadsheetApp.openById(b.id).getRange(b.plage).getValues();
      if (!valeurs.length || !valeurs[0].length) continue;

      // On ecrit le bloc a la MEME place que la formule d'origine : le
      // tableau de bord retrouve donc exactement la disposition qu'il connait
      // (un bloc tous les 100 colonnes, date puis 12 personnes x 8 colonnes).
      rapide.getRange(b.ligne, b.colonne, valeurs.length, valeurs[0].length)
            .setValues(valeurs);

      // Les dates doivent rester des NOMBRES. Formatees en date, elles
      // sortiraient en texte dans l'export CSV et le tableau ne les lirait
      // plus. C'est le seul piege de toute cette manoeuvre.
      rapide.getRange(b.ligne, b.colonne, valeurs.length, 1).setNumberFormat('0');
      copiees++;
    } catch (err) {
      // Une source illisible ne doit pas empecher les autres de passer.
      console.error('Bloc ' + (i + 1) + ' (' + b.plage + ') : ' + err.message);
    }
  }

  // Horodatage de fraicheur. Le tableau le lit : si cette marque vieillit —
  // declencheur arrete, quota epuise, autorisation revoquee — il repasse tout
  // seul sur l'onglet IMPORTRANGE au lieu de figer sur une copie morte.
  // C'est la seule ligne qui empeche une panne silencieuse.
  rapide.getRange(1, 298).setValue('SYNC:' + new Date().toISOString());

  var quand = Utilities.formatDate(new Date(), 'America/Toronto', 'yyyy-MM-dd HH:mm:ss');
  console.log(copiees + '/' + blocs.length + ' blocs copies a ' + quand);
  console.log('GID de l\'onglet RAPIDE : ' + rapide.getSheetId());
  console.log('URL a donner au tableau de bord :');
  console.log('https://docs.google.com/spreadsheets/d/' + classeur.getId()
              + '/export?format=csv&gid=' + rapide.getSheetId());
  return rapide.getSheetId();
}

/**
 * Lit les formules de l'onglet et en tire les IMPORTRANGE.
 *
 * On accepte aussi les formules enrobees — IFERROR(IMPORTRANGE(...)),
 * ARRAYFORMULA(IMPORTRANGE(...)) — parce que c'est frequent et que rater un
 * bloc se verrait seulement le soir venu, en plein call night.
 */
function trouverImportrange_(feuille) {
  var formules = feuille.getDataRange().getFormulas();
  var motif = /IMPORTRANGE\(\s*"([^"]+)"\s*[,;]\s*"([^"]+)"\s*\)/i;
  var blocs = [];

  for (var l = 0; l < formules.length; l++) {
    for (var c = 0; c < formules[l].length; c++) {
      var f = formules[l][c];
      if (!f || f.toUpperCase().indexOf('IMPORTRANGE') === -1) continue;
      var m = f.match(motif);
      if (!m) continue;

      // Le 1er argument est soit une URL complete, soit deja un identifiant.
      var id = m[1];
      var dansUrl = id.match(/\/d\/([-\w]{25,})/);
      if (dansUrl) id = dansUrl[1];

      blocs.push({ id: id, plage: m[2], ligne: l + 1, colonne: c + 1 });
    }
  }
  return blocs;
}

/**
 * A lancer une fois pour verifier que tout est lisible AVANT de brancher le
 * declencheur. N'ecrit rien : il se contente de dire ce qu'il voit.
 */
function verifier() {
  var source = classeur_().getSheets()[0];
  var blocs = trouverImportrange_(source);
  console.log(blocs.length + ' formule(s) IMPORTRANGE dans « ' + source.getName() + ' »');
  for (var i = 0; i < blocs.length; i++) {
    var b = blocs[i];
    var ligne = '  bloc ' + (i + 1) + ' : ligne ' + b.ligne + ', colonne ' + b.colonne
              + ' -> ' + b.plage;
    try {
      var n = SpreadsheetApp.openById(b.id).getRange(b.plage).getValues();
      console.log(ligne + '  [OK, ' + n.length + ' lignes lues]');
    } catch (err) {
      console.log(ligne + '  [ILLISIBLE : ' + err.message + ']');
    }
  }
}
