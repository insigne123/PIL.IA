import React from "react";
import {
  ArrowRight,
  FileSearch,
  FolderKanban,
  Layers,
  LayoutDashboard,
  ShieldCheck,
  Sparkles,
  Workflow,
} from "lucide-react";
import { AppLogo } from "./logo";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { NewTenderDialog } from "./new-tender-dialog";

function NavItem({
  icon,
  label,
  active,
}: {
  icon: React.ReactNode;
  label: string;
  active?: boolean;
}) {
  return (
    <button
      className={`flex w-full items-center gap-2 rounded-2xl px-3 py-2 text-sm transition-colors ${
        active
          ? "bg-muted text-foreground"
          : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
      }`}
    >
      <span className="grid h-8 w-8 place-items-center rounded-2xl border bg-background shadow-sm">
        {icon}
      </span>
      <span className="font-medium">{label}</span>
    </button>
  );
}

export function Sidebar() {
  return (
    <aside className="hidden h-screen w-[280px] shrink-0 border-r bg-background/70 backdrop-blur md:flex md:flex-col">
      <div className="p-4">
        <AppLogo />
      </div>
      <div className="px-3">
        <div className="rounded-[24px] border bg-muted/20 p-2">
          <NavItem
            icon={<LayoutDashboard className="h-4 w-4" />}
            label="Dashboard"
            active
          />
          <NavItem
            icon={<FolderKanban className="h-4 w-4" />}
            label="Licitaciones"
          />
          <NavItem
            icon={<FileSearch className="h-4 w-4" />}
            label="Evidencias"
          />
          <NavItem icon={<Layers className="h-4 w-4" />} label="Plantillas" />
          <NavItem icon={<Workflow className="h-4 w-4" />} label="Flujos" />
          <NavItem
            icon={<ShieldCheck className="h-4 w-4" />}
            label="Seguridad"
          />
        </div>
      </div>

      <div className="mt-4 px-3">
        <div className="rounded-[24px] border bg-background p-3">
          <div className="flex items-start gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-2xl bg-muted">
              <Sparkles className="h-5 w-5" />
            </div>
            <div className="flex-1">
              <div className="text-sm font-semibold">Copiloto listo</div>
              <div className="mt-1 text-xs text-muted-foreground">
                Sube bases y te armo matriz + riesgos.
              </div>
              <NewTenderDialog>
                <Button size="sm" className="mt-3 w-full rounded-2xl">
                  Nueva licitación <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </NewTenderDialog>
            </div>
          </div>
        </div>
      </div>

      <div className="mt-auto p-4">
        <div className="rounded-[24px] border bg-muted/20 p-3">
          <div className="flex items-center justify-between">
            <div className="text-xs text-muted-foreground">Workspace</div>
            <Badge variant="secondary" className="rounded-xl">
              Pro
            </Badge>
          </div>
          <div className="mt-2 text-sm font-semibold">Constructora Andina</div>
          <div className="mt-1 text-xs text-muted-foreground">
            Roles • Auditoría • Evidencias
          </div>
        </div>
      </div>
    </aside>
  );
}
