"use client";

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";

interface ScoreHistoryChartProps {
  data: Array<{ date: string; score: number; ai: number; search: number }>;
}

export function ScoreHistoryChart({ data }: ScoreHistoryChartProps) {
  return (
    <div className="bg-card border border-border rounded-xl p-6">
      <h2 className="text-lg font-semibold mb-4">Score History</h2>
      <ResponsiveContainer width="100%" height={280}>
        <LineChart data={data}>
          <CartesianGrid strokeDasharray="3 3" stroke="#2a2a3a" />
          <XAxis dataKey="date" stroke="#8888a0" fontSize={12} />
          <YAxis domain={[0, 100]} stroke="#8888a0" fontSize={12} />
          <Tooltip
            contentStyle={{ background: "#12121a", border: "1px solid #2a2a3a", borderRadius: 8 }}
            labelStyle={{ color: "#f0f0f5" }}
          />
          <Legend />
          <Line type="monotone" dataKey="score" stroke="#6366f1" strokeWidth={2} name="OmniPresence" dot />
          <Line type="monotone" dataKey="ai" stroke="#22d3ee" strokeWidth={1.5} name="AI Visibility" dot={false} />
          <Line type="monotone" dataKey="search" stroke="#34d399" strokeWidth={1.5} name="Search" dot={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
