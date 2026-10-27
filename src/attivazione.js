// Data di attivazione stimata se firmi un'offerta in un certo giorno.
// Regole:
// - il venditore invia la richiesta di cambio dopo i 14 giorni di ripensamento (contratti online o a distanza),
//   salvo che tu chieda l'esecuzione anticipata; qui conto 2 giorni di lavorazione in più;
// - gas, e luce con richiesta fino al 10/11/2026 (delibera ARERA 487/2015): richiesta entro il giorno 10 del mese M
//   → fornitura dal 1° del mese M+1, altrimenti dal 1° del mese M+2;
// - luce domestica con richiesta dal 11/11/2026 (delibera ARERA 58/2026/R/eel, in vigore dal 1/12/2026):
//   attivazione in qualsiasi giorno, dal primo giorno lavorativo dopo la richiesta (non prima del 1/12/2026).

export const RIPENSAMENTO = 14, LAVORAZIONE = 2;
const NUOVE_REGOLE_LUCE = "2026-12-01", ULTIMA_RICHIESTA_VECCHIE = "2026-11-10";

const iso = (d) => d.toISOString().slice(0, 10);
const giorno = (s) => new Date(s + "T00:00:00Z");
const piu = (d, n) => new Date(d.getTime() + n * 86400000);

// festività nazionali (fisse + Pasquetta)
function pasqua(y) {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mese = Math.floor((h + l - 7 * m + 114) / 31), gg = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(y, mese - 1, gg));
}
export function lavorativo(d) {
  const w = d.getUTCDay();
  if (w === 0 || w === 6) return false;
  const md = iso(d).slice(5);
  if (["01-01", "01-06", "04-25", "05-01", "06-02", "08-15", "11-01", "12-08", "12-25", "12-26"].includes(md)) return false;
  return iso(piu(pasqua(d.getUTCFullYear()), 1)) !== iso(d);
}
const prossimoLavorativo = (d) => { let x = piu(d, 1); while (!lavorativo(x)) x = piu(x, 1); return x; };
const primoDelMese = (y, m) => new Date(Date.UTC(y, m, 1)); // m 0-based, gestisce lo scavalco d'anno

/**
 * firma: "AAAA-MM-GG"; forn: "LUCE" | "GAS"; anticipata: esecuzione senza attendere il ripensamento.
 * Ritorna { richiesta, attivazione, mese: "AAAA-MM", regola }.
 */
export function dataAttivazione(firma, forn, { anticipata = false, domestico = true } = {}) {
  const r = piu(giorno(firma), anticipata ? LAVORAZIONE : RIPENSAMENTO + LAVORAZIONE);
  const rIso = iso(r);
  let att, regola;
  if (forn === "LUCE" && domestico && rIso > ULTIMA_RICHIESTA_VECCHIE) {
    att = prossimoLavorativo(r);
    if (iso(att) < NUOVE_REGOLE_LUCE) att = giorno(NUOVE_REGOLE_LUCE);
    regola = "luce: cambio dal primo giorno lavorativo dopo la richiesta (regole ARERA dal 1° dicembre 2026)";
  } else {
    const y = r.getUTCFullYear(), m = r.getUTCMonth();
    att = r.getUTCDate() <= 10 ? primoDelMese(y, m + 1) : primoDelMese(y, m + 2);
    regola = r.getUTCDate() <= 10 ? "richiesta entro il 10 del mese → fornitura dal 1° del mese successivo"
      : "richiesta dopo il 10 del mese → fornitura dal 1° del secondo mese successivo";
  }
  const a = iso(att);
  return { richiesta: rIso, attivazione: a, mese: a.slice(0, 7), regola };
}

/** Mese da usare nella simulazione: se l'attivazione è dopo il 15, la prima bolletta intera è il mese dopo. */
export function meseSimulazione(attivazione) {
  const d = giorno(attivazione);
  if (d.getUTCDate() <= 15) return attivazione.slice(0, 7);
  return iso(primoDelMese(d.getUTCFullYear(), d.getUTCMonth() + 1)).slice(0, 7);
}
