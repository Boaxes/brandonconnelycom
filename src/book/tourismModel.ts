/**
 * A line-for-line port of model() from github.com/Boaxes/Tourism-Tax-Optimization (Model.py), run with the
 * paper's Juneau inputs (revenue $250 a visitor, 280,000 t of non-visitor carbon, 25 simulated years). It
 * reproduces the paper's best case exactly: E 1.2637, 2,191,244 visitors, capacity 4,404,575. The tourism
 * page's diagram plays these years back.
 */
export interface Year {
  year: number;
  visitors: number;
  gained: number;
  lossPct: number;
  money: { infra: number; programs: number; conservation: number };
  capacity: number;
  crowded: boolean;
  revenue: number;
  carbon: number;
  carbonScore: number;
  revenueScore: number;
  E: number;
}

export const POLICY = { tax: 100, infra: 0.65, programs: 0.1, conservation: 0.25 };

export function runModel(tax = POLICY.tax, infT = POLICY.infra, proT = POLICY.programs, conT = POLICY.conservation): Year[] {
  // location
  let visitors = 1_600_000;
  const visitorRevenue = 250;
  const visitorFootprintInitial = 2;
  let capacity = 1_600_000;
  let externalCarbon = 280_000;
  const years = 26; // (Model.py loops range(1, Years): 25 simulated years)
  // weights
  const capacityCost = 1000;
  const capacityDegradation = 3000;
  const visitorLossRate = 0.12;
  const infraDraw = 500, programsDraw = 4000, conservationDraw = 1000;
  const infraCarbonEff = 3500, programsCarbonEff = 2000;
  const infraEnvEffect = 0.05;
  const infraEconomicStrength = 100;
  const crowdThreshold = 0.9, crowdPenalty = 0.95;
  const mindful = 0.1;
  // initial state
  const carbonInitial = visitors * visitorFootprintInitial + externalCarbon;
  const revenueInitial = visitors * visitorRevenue;
  const capacityInitial = capacity;

  let infraMoney = 0, programsMoney = 0, conservationMoney = 0;
  const out: Year[] = [];
  for (let x = 1; x < years; x++) {
    const gained = infraMoney / infraDraw + programsMoney / programsDraw + conservationMoney / conservationDraw;
    const lossPct = (100 - visitorLossRate * tax) / 100;
    visitors = Math.min(Math.max((visitors + gained) * lossPct, 0), capacity);

    infraMoney = visitors * tax * infT;
    programsMoney = visitors * tax * proT;
    conservationMoney = visitors * tax * conT;

    capacity = capacity + infraMoney / capacityCost - capacityDegradation;
    const infraScore = capacity / capacityInitial;

    let visitorRevenueTotal = visitors * visitorRevenue * (1 - mindful) + visitors * (visitorRevenue - tax) * mindful;
    const crowded = visitors / capacity > crowdThreshold;
    if (crowded) visitorRevenueTotal *= crowdPenalty;
    const totalRevenue = visitorRevenueTotal + infraEconomicStrength * infraScore * 1000;

    const visitorFootprint = visitorFootprintInitial - infraScore * infraEnvEffect;
    // (as in Model.py, conservation money is divided by the programs rate here)
    externalCarbon -= infraMoney / infraCarbonEff + programsMoney / programsCarbonEff + conservationMoney / programsCarbonEff;
    const carbon = visitorFootprint * visitors + externalCarbon;

    const carbonScore = carbonInitial / carbon;
    const revenueScore = totalRevenue / revenueInitial;
    const E = 0.5 * carbonScore + 0.5 * revenueScore - 0.425 * Math.abs(carbonScore - revenueScore);
    out.push({
      year: x, visitors, gained, lossPct,
      money: { infra: infraMoney, programs: programsMoney, conservation: conservationMoney },
      capacity, crowded, revenue: totalRevenue, carbon, carbonScore, revenueScore, E,
    });
  }
  return out;
}
