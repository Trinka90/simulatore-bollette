// Streaming e pay per view: il modo più economico di avere i servizi che vuoi (abbonamenti singoli o pacchetti).
// Costi su 12 mesi: mensile × 12, annuale, mensile con vincolo di 12 mesi, pacchetti con promo e poi prezzo pieno.

// quali piani "contengono" altri piani (per DAZN e NOW i piani hanno contenuti diversi, non solo qualità)
const COPRE = {
  dazn: { family: ["family", "full", "goal", "sports"], full: ["full", "goal", "sports"], goal: ["goal"], myclub: ["myclub"], sports: ["sports"] },
  now: { completa: ["completa", "sport", "cinema", "ent"], sport: ["sport"], cinema: ["cinema", "ent"], ent: ["ent"] },
};
const QUALITA = ["ads", "base", "play", "standard", "noads", "premium"];

/** Il piano offerto (dal pacchetto) va bene per quello che vuoi? */
export function pianoCopre(servizio, offerto, voluto, pubblicitaOk) {
  if (COPRE[servizio]) return (COPRE[servizio][offerto] || [offerto]).includes(voluto);
  if (offerto === "ads" && !pubblicitaOk) return false;
  if (voluto === "premium") return offerto === "premium";
  return true;
}

/** Costo di 12 mesi di un piano singolo, con il modo di pagamento più conveniente consentito. */
export function costoPiano(p, impegnoOk = true) {
  const modi = [{ modo: "mensile, disdici quando vuoi", totale: p.mensile * 12 }];
  if (impegnoOk && p.annuo != null) modi.push({ modo: "annuale in un'unica soluzione", totale: p.annuo });
  if (impegnoOk && p.vincolo12 != null) modi.push({ modo: "mensile con vincolo di 12 mesi", totale: p.vincolo12 * 12 });
  return modi.sort((a, b) => a.totale - b.totale)[0];
}

/** Piano singolo più economico che soddisfa la preferenza (pubblicità sì/no, piano scelto per DAZN/NOW). */
export function pianoMigliore(servizio, voluto, pref) {
  const acc = servizio.piani.filter((p) => (COPRE[servizio.id] ? p.id === voluto : voluto === "premium" ? p.id === "premium" : pref.pubblicita || !p.pubblicita));
  return acc.map((p) => ({ piano: p, ...costoPiano(p, pref.impegno) })).sort((a, b) => a.totale - b.totale)[0] || null;
}

export function costoPacchetto(k, mesi = 12) {
  const pm = k.promoMesi ? Math.min(k.promoMesi, mesi) : 0;
  return (k.promo ?? k.mensile) * pm + k.mensile * (mesi - pm) + (k.unaTantum || 0);
}

export function pacchettoValido(k, pref, oggiIso = "") {
  if (k.scade && oggiIso && k.scade < oggiIso) return false;
  if (k.richiede === "tim" && !pref.hoTim) return false;
  if (k.annuale && !pref.impegno) return false;
  return true;
}

/**
 * catalogo: {servizi, pacchetti}; voluti: {idServizio: piano} (piano: "ads"/"standard"/"premium" o il piano DAZN/NOW).
 * pref: {pubblicita, impegno, hoTim}. Ritorna {migliore, singoli, alternative}.
 */
export function combinazioneMigliore(catalogo, voluti, pref, oggiIso = "") {
  const servizi = Object.fromEntries(catalogo.servizi.map((s) => [s.id, s]));
  const ids = Object.keys(voluti).filter((k) => servizi[k]);
  const singolo = Object.fromEntries(ids.map((id) => [id, pianoMigliore(servizi[id], voluti[id], pref)]));
  const totSingoli = ids.reduce((a, id) => a + (singolo[id]?.totale ?? 0), 0);
  const copreK = (k) => ids.filter((id) => k.include.some(([s, p]) => s === id && pianoCopre(id, p, voluti[id], pref.pubblicita)));
  const validi = catalogo.pacchetti.filter((k) => pacchettoValido(k, pref, oggiIso)).map((k) => ({ k, copre: copreK(k), costo: costoPacchetto(k) })).filter((x) => x.copre.length);
  const soluzioni = [];
  const valuta = (scelti) => {
    const coperti = new Set(scelti.flatMap((x) => x.copre));
    const resto = ids.filter((id) => !coperti.has(id));
    const totale = scelti.reduce((a, x) => a + x.costo, 0) + resto.reduce((a, id) => a + (singolo[id]?.totale ?? 0), 0);
    soluzioni.push({ pacchetti: scelti, singoli: resto.map((id) => ({ servizio: servizi[id], ...singolo[id] })), totale,
      extra: [...new Set(scelti.flatMap((x) => x.k.include.map(([s]) => s)).filter((s) => !ids.includes(s)))].map((s) => servizi[s]?.nome || s) });
  };
  valuta([]);
  for (let i = 0; i < validi.length; i++) {
    valuta([validi[i]]);
    for (let j = i + 1; j < validi.length; j++) {
      valuta([validi[i], validi[j]]);
      for (let l = j + 1; l < validi.length; l++) valuta([validi[i], validi[j], validi[l]]);
    }
  }
  // togli le soluzioni con pacchetti inutili (un pacchetto che non copre nulla di non già coperto)
  const utili = soluzioni.filter((s) => s.pacchetti.every((x, i) => x.copre.some((id) => !s.pacchetti.some((y, j) => j !== i && y.copre.includes(id)))));
  utili.sort((a, b) => a.totale - b.totale || a.pacchetti.length - b.pacchetti.length);
  const viste = new Set(), alternative = [];
  for (const s of utili) { const key = s.pacchetti.map((x) => x.k.id).sort().join("+"); if (viste.has(key)) continue; viste.add(key); alternative.push(s); if (alternative.length >= 6) break; }
  return { migliore: alternative[0], singoli: { totale: totSingoli, voci: ids.map((id) => ({ servizio: servizi[id], ...singolo[id] })) }, alternative: alternative.slice(1), ids };
}
