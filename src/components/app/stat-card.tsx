import React from "react";
import { Card, CardContent } from "@/components/ui/card";

type StatCardProps = {
  title: string;
  value: string;
  hint: string;
  icon: React.ReactNode;
  tone?: "default" | "warn" | "good";
};

export function StatCard({
  title,
  value,
  hint,
  icon,
  tone = "default",
}: StatCardProps) {
  const ring =
    tone === "warn"
      ? "ring-1 ring-amber-500/30"
      : tone === "good"
      ? "ring-1 ring-emerald-500/25"
      : "";

  return (
    <Card className={`rounded-[28px] ${ring}`}>
      <CardContent className="p-6">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-sm text-muted-foreground">{title}</div>
            <div className="mt-2 text-2xl font-semibold tracking-tight">
              {value}
            </div>
            <div className="mt-1 text-xs text-muted-foreground">{hint}</div>
          </div>
          <div className="grid h-11 w-11 place-items-center rounded-2xl border bg-muted/30 shadow-sm">
            {icon}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
