import { Building2 } from "lucide-react";

export function AppLogo() {
  return (
    <div className="flex items-center gap-2">
      <div className="grid h-10 w-10 place-items-center rounded-2xl border bg-gradient-to-br from-slate-900 to-slate-700 text-white shadow-sm">
        <Building2 className="h-5 w-5" />
      </div>
      <div className="leading-tight">
        <div className="text-sm font-semibold">BidWise</div>
        <div className="text-[11px] text-muted-foreground">
          IA para licitaciones
        </div>
      </div>
    </div>
  );
}
