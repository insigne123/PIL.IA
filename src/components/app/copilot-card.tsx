import {
  ArrowRight,
  MessagesSquare,
  Sparkles,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";

export function CopilotCard() {
  return (
    <Card className="rounded-[28px]">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">Copiloto IA</CardTitle>
          <Badge variant="secondary" className="rounded-xl">
            Live
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        <div className="rounded-[24px] border bg-muted/20 p-4">
          <div className="flex items-start gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-2xl border bg-background shadow-sm">
              <Sparkles className="h-5 w-5" />
            </div>
            <div>
              <div className="text-sm font-semibold">Siguiente mejor acción</div>
              <div className="mt-1 text-sm text-muted-foreground">
                Generar matriz de la licitación{" "}
                <span className="font-medium">MOP-771</span> y crear tareas.
              </div>
              <div className="mt-3 flex gap-2">
                <Button size="sm" className="rounded-2xl">
                  Generar matriz
                </Button>
                <Button size="sm" variant="outline" className="rounded-2xl">
                  Ver fuentes
                </Button>
              </div>
            </div>
          </div>
        </div>

        <div className="mt-4">
          <div className="text-xs font-semibold text-muted-foreground">
            Pregunta rápida
          </div>
          <div className="mt-2 flex gap-2">
            <Input
              className="h-11 rounded-2xl"
              placeholder="Ej: ¿Qué garantías exige y dónde lo dice?"
            />
            <Button className="h-11 rounded-2xl" size="icon">
              <ArrowRight className="h-4 w-4" />
            </Button>
          </div>
          <div className="mt-2 text-xs text-muted-foreground">
            Respuestas con citas a bases/anexos (modo evidencia).
          </div>
        </div>

        <Separator className="my-5" />

        <div className="grid gap-3">
          <div className="text-xs font-semibold text-muted-foreground">
            Insights recientes
          </div>
          {[
            "Detecté 3 requisitos con plazo interno distinto al cierre.",
            "Falta evidencia para experiencia específica (tabla).",
            "Anexo 3: glosa de boleta debe ser textual.",
          ].map((x) => (
            <div
              key={x}
              className="flex items-start gap-3 rounded-[24px] border bg-background p-4"
            >
              <MessagesSquare className="mt-0.5 h-4 w-4" />
              <div className="text-sm text-muted-foreground">{x}</div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
