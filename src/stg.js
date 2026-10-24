// Restare nel Servizio a Tutele Graduali (STG) o passare al mercato libero?
// - confronto di ogni offerta con l'STG al variare del consumo annuo (soglie di convenienza);
// - "restare" realistico: l'STG finisce il 31/03/2027 (ARERA, comunicato del 12/10/2026); chi non sceglie passa
//   all'offerta di mercato libero più economica del proprio venditore STG disponibile a dicembre 2026.
import { riepilogoOfferta, simulaOfferta, totaleMesi } from "./bolletta.js";

export const FINE_STG = "2027-03"; // ultimo mese di STG

// Aste STG 2024 (ARERA): aree assegnate a Hera Comm e relative province.
const AREE_HERA = {
  "Nord 6": "CR GE SP LO LU MS", "Nord 7": "AL AT CN NO PV", "Nord 8": "BG SO UD", "Nord 12": "AN PD PU VE",
  "Centro 1": "AP BO FM FE MC RO", "Centro 3": "AR CE PG RI TR VT", "Sud 4": "CH FC AQ PE RA RN TE",
};
export function areaSTG(sigla) {
  for (const [area, p] of Object.entries(AREE_HERA)) if (p.split(" ").includes(sigla)) return { area, venditore: "Hera Comm", sito: "heracomm.gruppohera.it" };
  return null;
}

/** Stessa utenza con un altro consumo annuo di luce (i mesi inseriti a mano vengono riproporzionati). */
export function conConsumo(u, kwh) {
  const n = structuredClone(u);
  const mesi = n.luce.mesi && Object.values(n.luce.mesi).some((x) => x > 0) ? n.luce.mesi : null;
  if (mesi) {
    const tot = Object.values(mesi).reduce((a, b) => a + Number(b || 0), 0);
    for (const k of Object.keys(mesi)) mesi[k] = Number(mesi[k] || 0) * kwh / tot;
  }
  n.luce.annuo = kwh;
  return n;
}

export const GRIGLIA = [1000, 1500, 2000, 2500, 3000, 3500, 4000, 4500, 5000, 6000, 7000, 8000];

/** Differenza annua offerta − STG per ogni consumo della griglia (negativo = l'offerta costa meno). */
export function curva(off, stg, u, ctx, griglia = GRIGLIA, cacheStg = new Map()) {
  return griglia.map((k) => {
    const uk = conConsumo(u, k);
    if (!cacheStg.has(k)) cacheStg.set(k, riepilogoOfferta(stg, uk, ctx, false).centrale);
    const s = cacheStg.get(k);
    const o = riepilogoOfferta(off, uk, ctx, false).centrale;
    return { kwh: k, offerta: o, stg: s, diff: o - s };
  });
}

/** Intervalli di consumo in cui l'offerta costa meno dell'STG, con interpolazione lineare dei punti di pareggio. */
export function soglie(c) {
  const out = [];
  let da = null;
  for (let i = 0; i < c.length; i++) {
    const p = c[i], prev = c[i - 1];
    const x0 = (a, b) => Math.round((a.kwh + (b.kwh - a.kwh) * (a.diff / (a.diff - b.diff))) / 50) * 50;
    if (p.diff < 0 && da == null) da = i === 0 ? { kwh: p.kwh, aperto: true } : { kwh: x0(prev, p), aperto: false };
    if (p.diff >= 0 && da != null) { out.push({ da, a: { kwh: x0(prev, p), aperto: false } }); da = null; }
  }
  if (da != null) out.push({ da, a: { kwh: c.at(-1).kwh, aperto: true } });
  return out;
}

/** Frase: "conviene sempre", "conviene da 2.300 kWh in su", "conviene fino a 4.100 kWh", "non conviene mai (1.000–8.000 kWh)". */
export function fraseSoglie(s, griglia = GRIGLIA) {
  const f = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  if (!s.length) return `non conviene mai tra ${f(griglia[0])} e ${f(griglia.at(-1))} kWh`;
  return s.map(({ da, a }) => da.aperto && a.aperto ? `conviene sempre tra ${f(griglia[0])} e ${f(griglia.at(-1))} kWh`
    : da.aperto ? `conviene fino a circa ${f(a.kwh)} kWh` : a.aperto ? `conviene da circa ${f(da.kwh)} kWh in su`
    : `conviene tra circa ${f(da.kwh)} e ${f(a.kwh)} kWh`).join("; ");
}

/**
 * "Restare": STG fino a marzo 2027, poi l'offerta del venditore STG (stima: la sua più economica oggi).
 * Ritorna { totale, mesiStg, mesiDopo, dopo: offerta usata }.
 */
export function restare(stg, offertaDopo, u, ctx) {
  const ms = simulaOfferta(stg, u, ctx, "centrale");
  const ym = (m) => `${m.anno}-${String(m.mese).padStart(2, "0")}`;
  const primi = ms.filter((m) => ym(m) <= FINE_STG);
  const n = ms.length - primi.length;
  if (!n || !offertaDopo) return { totale: totaleMesi(ms), mesiStg: primi.length, mesiDopo: 0, dopo: null, mesi: ms };
  const md = simulaOfferta(offertaDopo, { ...u, ingresso: "2027-04" }, ctx, "centrale").slice(0, n);
  return { totale: totaleMesi(primi) + totaleMesi(md), mesiStg: primi.length, mesiDopo: n, dopo: offertaDopo, mesi: [...primi, ...md] };
}
