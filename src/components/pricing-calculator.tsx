"use client";

import { useState } from "react";

/**
 * Foglift-pattern plan calculator: dial in what you actually track and see the
 * observation math + the right plan. An observation = one prompt × one engine
 * × one run — the honest unit every measurement costs.
 */

const PLANS = [
  { id: "free", name: "Free", price: 0, brands: 1, prompts: 5, observations: 200 },
  { id: "solo", name: "Solo", price: 29, brands: 1, prompts: 25, observations: 1500 },
  { id: "growth", name: "Growth", price: 79, brands: 5, prompts: 100, observations: 5000 },
  { id: "agency", name: "Agency", price: 199, brands: 15, prompts: 300, observations: 12000 },
] as const;

const WEEKS_PER_MONTH = 4.33;

export function PricingCalculator() {
  const [brands, setBrands] = useState(1);
  const [promptsPerBrand, setPromptsPerBrand] = useState(15);
  const [engines, setEngines] = useState(4);
  const [runsPerWeek, setRunsPerWeek] = useState(1);

  const totalPrompts = brands * promptsPerBrand;
  const observationsPerMonth = Math.round(totalPrompts * engines * runsPerWeek * WEEKS_PER_MONTH);

  const recommended =
    PLANS.find(
      (p) => p.brands >= brands && p.prompts >= totalPrompts && p.observations >= observationsPerMonth
    ) || null;

  const slider = (
    label: string,
    value: number,
    setValue: (v: number) => void,
    min: number,
    max: number,
    suffix?: string
  ) => (
    <div>
      <div className="flex justify-between text-sm mb-1.5">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-semibold">
          {value.toLocaleString()}
          {suffix}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        value={value}
        onChange={(e) => setValue(parseInt(e.target.value, 10))}
        className="w-full accent-primary"
      />
    </div>
  );

  return (
    <div className="bg-card border border-border rounded-2xl p-6 md:p-8">
      <h3 className="text-xl font-semibold mb-1">What does your tracking actually cost?</h3>
      <p className="text-sm text-muted-foreground mb-6">
        We meter in observations — one prompt on one engine, one run. No credit jargon, no
        per-engine add-ons. Dial in your setup:
      </p>

      <div className="grid md:grid-cols-2 gap-x-10 gap-y-5 mb-6">
        {slider("Brands / clients", brands, setBrands, 1, 20)}
        {slider("Prompts per brand", promptsPerBrand, setPromptsPerBrand, 5, 100)}
        {slider("AI engines", engines, setEngines, 1, 8)}
        {slider("Runs per week", runsPerWeek, setRunsPerWeek, 1, 7, "×")}
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <div className="bg-background border border-border rounded-xl p-5">
          <div className="text-sm text-muted-foreground">Your monthly volume</div>
          <div className="text-3xl font-bold text-primary mt-1">
            {observationsPerMonth.toLocaleString()}
            <span className="text-base font-normal text-muted-foreground"> observations</span>
          </div>
          <div className="text-xs text-muted-foreground mt-2">
            {totalPrompts.toLocaleString()} prompts × {engines} engines × {runsPerWeek}/week
          </div>
        </div>
        <div className="bg-background border border-primary/40 rounded-xl p-5">
          {recommended ? (
            <>
              <div className="text-sm text-muted-foreground">Your plan</div>
              <div className="text-3xl font-bold mt-1">
                {recommended.name}
                <span className="text-primary"> ${recommended.price}</span>
                <span className="text-base font-normal text-muted-foreground">/mo</span>
              </div>
              <div className="text-xs text-muted-foreground mt-2">
                Covers {recommended.brands} brand{recommended.brands === 1 ? "" : "s"},{" "}
                {recommended.prompts} prompts, {recommended.observations.toLocaleString()}{" "}
                observations — every feature included.
              </div>
            </>
          ) : (
            <>
              <div className="text-sm text-muted-foreground">Your plan</div>
              <div className="text-2xl font-bold mt-1">Let&apos;s talk</div>
              <div className="text-xs text-muted-foreground mt-2">
                That volume is beyond Agency — email us for a custom capacity quote (still all
                features, still honest metering).
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
