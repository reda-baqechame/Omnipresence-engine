"use client";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import type { VisibilityResult } from "@/types/database";

interface CompetitorChartProps {
  results: VisibilityResult[];
  brandName: string;
  competitors: string[];
}

export function CompetitorChart({ results, brandName, competitors }: CompetitorChartProps) {
  const measured = results.filter(
    (r) => r.data_source !== "simulated" && r.data_source !== "unavailable" && r.measurement_mode !== "unavailable"
  );
  const brandMentions = measured.filter((r) => r.brand_mentioned).length;
  const brandCitations = measured.filter((r) => r.brand_cited).length;

  const chartData = [
    {
      name: brandName,
      mentions: brandMentions,
      citations: brandCitations,
    },
    ...competitors.slice(0, 5).map((comp) => ({
      name: comp,
      mentions: measured.filter((r) => r.competitor_mentions?.[comp]).length,
      citations: measured.filter((r) => r.competitor_citations?.[comp]).length,
    })),
  ];

  return (
    <div className="bg-card border border-border rounded-xl p-6">
      <h2 className="text-lg font-semibold mb-4">Competitor Visibility Comparison</h2>
      <ResponsiveContainer width="100%" height={260}>
        <BarChart data={chartData} layout="vertical">
          <CartesianGrid strokeDasharray="3 3" stroke="#2a2a3a" />
          <XAxis type="number" stroke="#8888a0" fontSize={12} />
          <YAxis dataKey="name" type="category" width={120} stroke="#8888a0" fontSize={11} />
          <Tooltip
            contentStyle={{ background: "#12121a", border: "1px solid #2a2a3a", borderRadius: 8 }}
          />
          <Legend />
          <Bar dataKey="mentions" fill="#6366f1" name="Mentions" radius={[0, 4, 4, 0]} />
          <Bar dataKey="citations" fill="#22d3ee" name="Citations" radius={[0, 4, 4, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
