"use client";

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import type { SovTrendPoint } from "@/lib/engines/share-of-voice";

export function SovTrendChart({ points }: { points: SovTrendPoint[] }) {
  if (points.length < 2) return null;

  const data = points.map((p) => ({
    date: new Date(p.date).toLocaleDateString(undefined, { month: "short", day: "numeric" }),
    sov: Math.round(p.shareOfVoice * 100),
    rank: p.rank,
  }));

  const first = points[0].shareOfVoice;
  const last = points[points.length - 1].shareOfVoice;
  const deltaPts = Math.round((last - first) * 100);
  const up = deltaPts >= 0;

  return (
    <div className="bg-card border border-border rounded-xl p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold">AI Share of Voice Over Time</h2>
        <span className={`text-sm font-medium ${up ? "text-green-400" : "text-red-400"}`}>
          {up ? "+" : ""}{deltaPts} pts since first run
        </span>
      </div>
      <ResponsiveContainer width="100%" height={240}>
        <LineChart data={data} margin={{ top: 8, right: 16, bottom: 4, left: -8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#2a2a3a" />
          <XAxis dataKey="date" stroke="#8888a0" fontSize={12} />
          <YAxis stroke="#8888a0" fontSize={12} unit="%" domain={[0, 100]} />
          <Tooltip
            contentStyle={{ background: "#12121a", border: "1px solid #2a2a3a", borderRadius: 8 }}
            formatter={(value) => [`${value}%`, "Share of Voice"]}
          />
          <Line
            type="monotone"
            dataKey="sov"
            stroke="#6366f1"
            strokeWidth={2.5}
            dot={{ r: 3, fill: "#6366f1" }}
            activeDot={{ r: 5 }}
            name="Share of Voice"
          />
        </LineChart>
      </ResponsiveContainer>
      <p className="text-xs text-muted-foreground mt-2">
        Prominence-weighted share of voice per scan, oldest to newest. Each point is computed only
        from that run&apos;s measured AI answers.
      </p>
    </div>
  );
}
