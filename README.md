# Simulatore Bollette (Android)

App Android che confronta **tutte le offerte luce e gas del mercato libero** (grandi e piccoli venditori)
e mostra per ognuna 12 bollette mensili complete, voce per voce, sui tuoi consumi.

## Installare l'app
1. Dal telefono apri la pagina **Releases** di questo repository.
2. Scarica l'ultimo file `SimulatoreBollette-x.y.z.apk` e aprilo.
3. La prima volta Android chiede di consentire l'installazione da questa fonte: conferma.

Gli aggiornamenti si installano sopra la versione precedente: profilo e CTE restano.

## Da dove vengono le offerte
Dal **Portale Offerte** di ARERA e Acquirente Unico, dove per legge ogni venditore deve pubblicare tutte
le sue offerte. Il Portale pubblica ogni giorno gli open data (licenza CC-BY):
- `PO_Offerte_E_MLIBERO_AAAAMMGG.xml` e `PO_Offerte_G_…`: offerte luce e gas, con prezzi, quote fisse,
  sconti e condizioni, dispacciamento, componenti regolate, zone, scadenza di sottoscrizione;
- `PO_Parametri_Mercato_Libero_E/G_AAAAMMGG.csv`: reti, oneri di sistema, dispacciamento, accisa luce, IVA.

Il Portale **rifiuta le connessioni dai server cloud** (anche da GitHub), quindi il download lo fa il
telefono: ogni giorno alla prima apertura, oppure dal pulsante *Scarica le offerte di oggi* (scheda Info).
L'app contiene un elenco iniziale (06/10/2026) che viene sostituito dal primo aggiornamento.

## Come si usa
- **Offerte**: scegli Luce o Gas. In alto c'è la più conveniente per te (con il risparmio rispetto alle Tutele Graduali o alla tua offerta),
  sotto la classifica completa. Cerchi un fornitore per nome e filtri con un tocco: prezzo fisso o variabile, fornitori conosciuti,
  senza penali, senza deposito.
- **Dettaglio**: totale annuo, «In breve» con sconti, prezzi promozionali, penali, deposito e vincoli in parole semplici,
  chi è il fornitore con i link alle recensioni (Trustpilot e Google), poi prezzi, condizioni, bolletta su misura e le 12 bollette.
- **La mia offerta**: carica la CTE della tua offerta (o di una che ti hanno proposto) per vederla nella stessa classifica.
- **Consumi**: comune, data di passaggio, consumi annui o mese per mese, bolletta online e domiciliazione (decidono quali sconti valgono).

## Fornitori e recensioni
Tutti i venditori sul Portale sono autorizzati, ma la qualità del servizio cambia. L'app indica se un fornitore è un grande
operatore nazionale, una multiutility locale o un piccolo fornitore (classificazione fatta a mano sui principali marchi,
`src/fornitori.js`) e apre le recensioni aggiornate su Trustpilot e Google. ARERA pubblica i reclami per venditore solo in forma
anonima, quindi non esiste una valutazione ufficiale per nome.

## Come calcola
Le regole sono quelle del Portale Offerte (*Regole per il calcolo della spesa*, v4.0 del 16/02/2026),
applicate bolletta per bolletta:
- **Vendita**: componenti del venditore (anche a fasce, a scaglioni di consumo, con prezzi a tempo),
  indice PUN/PSV del mese per le variabili (PUN + perdite di rete 10%), dispacciamento, PCV, PPE, CCR, QVD;
- **Rete e oneri**: parametri ARERA del giorno; gas per ambito tariffario della regione, a scaglioni;
- **Imposte**: accisa luce (esenzione residenti fino a 3 kW), accisa e addizionale gas per regione;
- **Sconti**: solo quelli senza condizioni, oppure legati a bolletta online / domiciliazione se li scegli;
- **IVA** 10% luce; gas 10% fino a 480 Smc/anno e 22% oltre e sulle quote fisse; **canone RAI** opzionale.

Verifiche (`npm test`): due offerte calcolate dal Portale (luce 1.274,92 €, gas 1.732,03 €) riprodotte entro
pochi centesimi; tre bollette reali (Hera, Estra, Enel) al centesimo.

## Dati di mercato (`data/dati.json`)
PUN e PSV mensili, metodo di simulazione dei mesi futuri, aliquote gas per regione, CCR/PPE e la copia di
riserva dei parametri ARERA. Per aggiungere il mese chiuso: modifica il file su GitHub e aggiungi il valore in
`indici.pun.mesi` e `indici.psv.mesi`; l'app lo scarica alla prima apertura.

## Sviluppo
```
npm ci
npm test          # motore e lettura del tracciato XML
npm run build     # crea www/app.js
npx cap sync android
node scripts/catalogo-iniziale.mjs <cartella xml> AAAA-MM-GG   # rigenera l'elenco iniziale
```
Ogni push su `main` compila l'APK con GitHub Actions e lo pubblica in Releases.
La chiave di firma `android/app/firma-app.keystore` è nel repository: va bene per un'app personale, non per il Play Store.
