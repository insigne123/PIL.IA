import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { TriangleAlert } from "lucide-react";

export function ComplianceTabs() {
  return (
    <div className="mt-4">
      <Tabs defaultValue="cumplimiento" className="w-full">
        <TabsList className="rounded-2xl">
          <TabsTrigger value="cumplimiento" className="rounded-2xl">
            Cumplimiento
          </TabsTrigger>
          <TabsTrigger value="riesgos" className="rounded-2xl">
            Riesgos
          </TabsTrigger>
          <TabsTrigger value="equipo" className="rounded-2xl">
            Equipo
          </TabsTrigger>
        </TabsList>

        <TabsContent value="cumplimiento" className="mt-3">
          <Card className="rounded-[28px]">
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm font-semibold">
                    Mapa de cumplimiento
                  </div>
                  <div className="mt-1 text-sm text-muted-foreground">
                    Secciones típicas de bases y anexos.
                  </div>
                </div>
                <Badge variant="outline" className="rounded-xl">
                  Evidencia vinculada
                </Badge>
              </div>

              <div className="mt-5 grid gap-4 md:grid-cols-2">
                {["Administrativo", "Técnico", "Garantías", "Experiencia"].map(
                  (s, i) => {
                    const v = [88, 72, 61, 79][i];
                    return (
                      <div
                        key={s}
                        className="rounded-[24px] border bg-muted/20 p-4"
                      >
                        <div className="flex items-center justify-between">
                          <div className="text-sm font-medium">{s}</div>
                          <div className="text-xs text-muted-foreground">
                            {v}%
                          </div>
                        </div>
                        <Progress value={v} className="mt-3 h-2" />
                        <div className="mt-2 text-xs text-muted-foreground">
                          {v >= 80
                            ? "Bien encaminado"
                            : v >= 70
                            ? "Faltan evidencias"
                            : "Crítico: revisar requisitos"}
                        </div>
                      </div>
                    );
                  }
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="riesgos" className="mt-3">
          <Card className="rounded-[28px]">
            <CardContent className="p-6">
              <div className="flex items-center gap-3">
                <div className="grid h-10 w-10 place-items-center rounded-2xl border bg-muted/30 shadow-sm">
                  <TriangleAlert className="h-5 w-5" />
                </div>
                <div>
                  <div className="text-sm font-semibold">
                    Riesgos destacados por la IA
                  </div>
                  <div className="text-sm text-muted-foreground">
                    Con foco en vencimientos y formatos.
                  </div>
                </div>
              </div>
              <Separator className="my-5" />
              <div className="grid gap-3">
                {[
                  "Boleta: glosa incompleta (Anexo 3)",
                  "Plazo de vigencia: inconsistente entre bases y anexo",
                  "Formato de experiencia: tabla exige unidad específica",
                ].map((x) => (
                  <div
                    key={x}
                    className="flex items-start gap-3 rounded-[24px] border bg-background p-4"
                  >
                    <TriangleAlert className="mt-0.5 h-4 w-4" />
                    <div className="text-sm">
                      <div className="font-medium">{x}</div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        Acción sugerida: revisar + adjuntar evidencia.
                      </div>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      className="ml-auto rounded-2xl"
                    >
                      Ver
                    </Button>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="equipo" className="mt-3">
          <Card className="rounded-[28px]">
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm font-semibold">Carga del equipo</div>
                  <div className="mt-1 text-sm text-muted-foreground">
                    Asignaciones por etapa.
                  </div>
                </div>
                <Button variant="outline" className="rounded-2xl">
                  Administrar roles
                </Button>
              </div>
              <div className="mt-5 grid gap-3 md:grid-cols-3">
                {["Oficina Técnica", "Legal/Adm.", "Operaciones"].map(
                  (r, i) => (
                    <div
                      key={r}
                      className="rounded-[24px] border bg-muted/20 p-4"
                    >
                      <div className="text-sm font-medium">{r}</div>
                      <div className="mt-2 text-2xl font-semibold">
                        {[4, 2, 5][i]}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        tareas activas
                      </div>
                    </div>
                  )
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
