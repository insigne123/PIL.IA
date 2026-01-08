import React from "react";
import {
  CheckCircle2,
  ChevronDown,
  MoreHorizontal,
  TriangleAlert,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Progress } from "@/components/ui/progress";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tender, tenders } from "@/lib/data";
import { EmptyState } from "./empty-state";

function StatusBadge({ status }: { status: Tender["status"] }) {
  const variant =
    status === "Entregada"
      ? "secondary"
      : status === "En revisión"
      ? "outline"
      : status === "En armado"
      ? "secondary"
      : "outline";

  return (
    <Badge variant={variant} className="rounded-xl">
      {status}
    </Badge>
  );
}

function RiskPill({ risk }: { risk: Tender["risk"] }) {
  if (risk === "Alto") {
    return (
      <Badge variant="destructive" className="rounded-xl border-transparent">
        <TriangleAlert className="mr-1 h-3.5 w-3.5" /> Alto
      </Badge>
    );
  }
  if (risk === "Medio") {
    return (
      <Badge variant="secondary" className="rounded-xl bg-amber-400/20 text-amber-700 hover:bg-amber-400/30 dark:bg-amber-400/10 dark:text-amber-400 dark:hover:bg-amber-400/20 border-amber-400/30">
        <TriangleAlert className="mr-1 h-3.5 w-3.5" /> Medio
      </Badge>
    );
  }
  return (
    <Badge variant="secondary" className="rounded-xl bg-emerald-400/20 text-emerald-700 hover:bg-emerald-400/30 dark:bg-emerald-400/10 dark:text-emerald-400 dark:hover:bg-emerald-400/20 border-emerald-400/30">
      <CheckCircle2 className="mr-1 h-3.5 w-3.5" /> Bajo
    </Badge>
  );
}

export function TendersTable() {
  const hasData = tenders.length > 0;

  return (
    <Card className="rounded-[28px]">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <CardTitle className="text-base">Licitaciones recientes</CardTitle>
            <div className="mt-1 text-sm text-muted-foreground">
              Estado, riesgo y avance de cumplimiento.
            </div>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" className="rounded-2xl">
                Acciones <ChevronDown className="ml-2 h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem>Exportar vista</DropdownMenuItem>
              <DropdownMenuItem>Crear plantilla</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem>Configurar columnas</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        {!hasData ? (
          <EmptyState />
        ) : (
          <div className="rounded-[20px] border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[120px]">ID</TableHead>
                  <TableHead>Proyecto</TableHead>
                  <TableHead className="hidden md:table-cell">
                    Cliente
                  </TableHead>
                  <TableHead>Vence</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead>Riesgo</TableHead>
                  <TableHead className="w-[180px]">Cumplimiento</TableHead>
                  <TableHead className="w-[44px]"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {tenders.map((t) => (
                  <TableRow key={t.id} className="hover:bg-muted/30">
                    <TableCell className="font-medium">{t.id}</TableCell>
                    <TableCell>
                      <div className="font-medium">{t.name}</div>
                      <div className="text-xs text-muted-foreground md:hidden">
                        {t.client}
                      </div>
                    </TableCell>
                    <TableCell className="hidden md:table-cell text-muted-foreground">
                      {t.client}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {t.due}
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={t.status} />
                    </TableCell>
                    <TableCell>
                      <RiskPill risk={t.risk} />
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <Progress value={t.compliance} className="h-2" />
                        <div className="w-10 text-right text-xs text-muted-foreground">
                          {t.compliance}%
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="rounded-2xl"
                      >
                        <MoreHorizontal className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
