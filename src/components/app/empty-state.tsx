import { ArrowRight, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { NewTenderDialog } from "./new-tender-dialog";

export function EmptyState() {
  return (
    <Card className="rounded-[28px]">
      <CardContent className="p-8">
        <div className="flex flex-col items-center text-center">
          <div className="grid h-14 w-14 place-items-center rounded-2xl border bg-muted/30 shadow-sm">
            <Upload className="h-6 w-6" />
          </div>
          <div className="mt-4 text-lg font-semibold">Tu app parte acá</div>
          <div className="mt-1 max-w-md text-sm text-muted-foreground">
            Crea una licitación y sube las bases/anexos. El copiloto genera
            matriz, riesgos críticos y tareas.
          </div>
          <div className="mt-5 flex flex-col gap-2 sm:flex-row">
            <NewTenderDialog>
              <Button className="rounded-2xl">
                Nueva licitación <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </NewTenderDialog>
            <Button variant="outline" className="rounded-2xl">
              Ver ejemplo
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
