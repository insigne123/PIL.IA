"use client";

import React from "react";
import {
  Calendar,
  Sparkles,
  ShieldCheck,
  Users,
  ArrowRight,
  FolderKanban,
  FileSearch,
  TriangleAlert,
  Gauge,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { StatCard } from "./stat-card";
import { TendersTable } from "./tenders-table";
import { ComplianceTabs } from "./compliance-tabs";
import { CopilotCard } from "./copilot-card";
import { TasksCard } from "./tasks-card";
import { NewTenderDialog } from "./new-tender-dialog";

function GridGlow() {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 overflow-hidden"
    >
      <div className="absolute inset-0 opacity-[0.14] [background-image:linear-gradient(to_right,rgba(148,163,184,0.30)_1px,transparent_1px),linear-gradient(to_bottom,rgba(148,163,184,0.30)_1px,transparent_1px)] [background-size:60px_60px]" />
      <div className="absolute -top-40 left-1/2 h-80 w-[54rem] -translate-x-1/2 rounded-full bg-gradient-to-r from-sky-500/18 via-indigo-500/14 to-cyan-400/14 blur-3xl" />
      <div className="absolute -bottom-44 right-[-8rem] h-96 w-96 rounded-full bg-gradient-to-r from-emerald-400/10 via-sky-500/12 to-indigo-500/10 blur-3xl" />
    </div>
  );
}

export function DashboardContent() {
  return (
    <div className="relative">
      <GridGlow />
      <div className="relative px-4 py-6 md:px-6">
        <div className="animate-in fade-in slide-in-from-top-2 duration-300 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <div className="text-xs text-muted-foreground">Dashboard</div>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight md:text-3xl">
              Control de propuestas y cumplimiento
            </h1>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Badge className="rounded-xl" variant="secondary">
                <Sparkles className="mr-1 h-3.5 w-3.5" /> Copiloto activo
              </Badge>
              <Badge className="rounded-xl" variant="outline">
                <ShieldCheck className="mr-1 h-3.5 w-3.5" /> Evidencia primero
              </Badge>
              <Badge className="rounded-xl" variant="outline">
                <Users className="mr-1 h-3.5 w-3.5" /> Equipo: 6
              </Badge>
            </div>
          </div>

          <div className="flex gap-2">
            <Button variant="outline" className="rounded-2xl">
              <Calendar className="mr-2 h-4 w-4" /> Calendario
            </Button>
            <NewTenderDialog>
              <Button className="rounded-2xl">
                Nueva licitación <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </NewTenderDialog>
          </div>
        </div>

        <div className="mt-6 grid gap-4 md:grid-cols-2 lg:grid-cols-4 animate-in fade-in slide-in-from-top-4 duration-500">
          <StatCard
            title="Licitaciones activas"
            value="3"
            hint="2 en armado • 1 en revisión"
            icon={<FolderKanban className="h-5 w-5" />}
          />
          <StatCard
            title="Requisitos detectados"
            value="128"
            hint="en la última licitación analizada"
            icon={<FileSearch className="h-5 w-5" />}
          />
          <StatCard
            title="Riesgos críticos"
            value="7"
            hint="plazos, boletas, formatos"
            icon={<TriangleAlert className="h-5 w-5" />}
            tone="warn"
          />
          <StatCard
            title="Cumplimiento promedio"
            value="79%"
            hint="sube con evidencias faltantes"
            icon={<Gauge className="h-5 w-5" />}
            tone="good"
          />
        </div>

        <div className="mt-6 grid gap-4 lg:grid-cols-12">
          <div className="lg:col-span-8">
            <TendersTable />
            <ComplianceTabs />
          </div>

          <div className="lg:col-span-4">
            <div className="grid gap-4">
              <CopilotCard />
              <TasksCard />
            </div>
          </div>
        </div>

        <div className="mt-6 text-center text-xs text-muted-foreground">
          Tip: Esta pantalla es tu “base” para el resto de la app. De aquí cuelgan: Licitaciones → (Matriz, Evidencias,
          Chat, Entrega) y Settings/Seguridad.
        </div>
      </div>
    </div>
  );
}
