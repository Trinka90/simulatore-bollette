import { test } from "node:test";
import assert from "node:assert/strict";
import { soglie, fraseSoglie, conConsumo, areaSTG } from "../src/stg.js";

const c = (arr) => arr.map(([kwh, diff]) => ({ kwh, diff }));

test("soglie di convenienza con interpolazione", () => {
  assert.equal(fraseSoglie(soglie(c([[1000, 20], [2000, 10], [3000, -10], [4000, -30]])), [1000, 4000]), "conviene da circa 2.500 kWh in su");
  assert.equal(fraseSoglie(soglie(c([[1000, -20], [2000, -5], [3000, 15]])), [1000, 3000]), "conviene fino a circa 2.250 kWh");
  assert.equal(fraseSoglie(soglie(c([[1000, -1], [2000, -5]])), [1000, 2000]), "conviene sempre tra 1.000 e 2.000 kWh");
  assert.equal(fraseSoglie(soglie(c([[1000, 1], [2000, 5]])), [1000, 2000]), "non conviene mai tra 1.000 e 2.000 kWh");
  assert.equal(fraseSoglie(soglie(c([[1000, 5], [2000, -5], [3000, 5]])), [1000, 3000]), "conviene tra circa 1.500 e 2.500 kWh");
});

test("consumo diverso: mesi inseriti a mano riproporzionati", () => {
  const u = { luce: { annuo: 1200, mesi: { 1: 200, 2: 100, 3: 0 } } };
  const n = conConsumo(u, 600);
  assert.equal(n.luce.annuo, 600);
  assert.equal(n.luce.mesi[1], 400); assert.equal(n.luce.mesi[2], 200);
  assert.equal(u.luce.mesi[1], 200);
});

test("area STG: Arezzo è Centro 3, Hera Comm", () => {
  assert.deepEqual(areaSTG("AR"), { area: "Centro 3", venditore: "Hera Comm", sito: "heracomm.gruppohera.it" });
  assert.equal(areaSTG("MI"), null);
});
