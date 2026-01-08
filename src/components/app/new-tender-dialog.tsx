import React from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type NewTenderDialogProps = {
  children: React.ReactNode;
};

export function NewTenderDialog({ children }: NewTenderDialogProps) {
  return (
    <Dialog>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>Crear licitación</DialogTitle>
          <DialogDescription>
            Crea el proyecto y sube las bases/anexos. El copiloto te genera
            matriz, riesgos y próximos pasos.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <Input
            className="h-11 rounded-2xl"
            placeholder="Nombre (ej: Hospital X - OOCC)"
          />
          <div className="grid gap-2 sm:grid-cols-2">
            <Input
              className="h-11 rounded-2xl"
              placeholder="Mandante / Cliente"
            />
            <Input
              className="h-11 rounded-2xl"
              placeholder="Fecha cierre (dd/mm)"
            />
          </div>
          <Input
            className="h-11 rounded-2xl"
            placeholder="Etiquetas (ej: MOP, OOCC, eléctrica)"
          />
        </div>
        <DialogFooter>
          <Button variant="outline" className="rounded-2xl">
            Cancelar
          </Button>
          <Button className="rounded-2xl">Crear y subir archivos</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
