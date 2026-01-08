import {
  ArrowRight,
  Bell,
  ChevronDown,
  FileSearch,
  Upload,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { AppLogo } from "./logo";
import { NewTenderDialog } from "./new-tender-dialog";

export function Topbar() {
  return (
    <div className="sticky top-0 z-30 border-b bg-background/75 backdrop-blur">
      <div className="flex items-center gap-3 px-4 py-3 md:px-6">
        <div className="md:hidden">
          <AppLogo />
        </div>

        <div className="hidden flex-1 items-center gap-3 md:flex">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" className="rounded-2xl">
                Constructora Andina <ChevronDown className="ml-2 h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuLabel>Workspaces</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem>Constructora Andina</DropdownMenuItem>
              <DropdownMenuItem>Oficina Técnica Norte</DropdownMenuItem>
              <DropdownMenuItem>Consorcio Infra Vial</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <div className="relative w-full max-w-xl">
            <Input
              className="h-11 rounded-2xl pl-11"
              placeholder="Buscar licitaciones, anexos, requisitos..."
            />
            <div className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">
              <FileSearch className="h-4 w-4" />
            </div>
          </div>
        </div>

        <div className="ml-auto flex items-center gap-2">
          <Button variant="outline" className="rounded-2xl hidden sm:inline-flex">
            <Upload className="mr-2 h-4 w-4" /> Subir archivos
          </Button>

          <NewTenderDialog>
             <Button className="rounded-2xl">
                Nueva licitación <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
          </NewTenderDialog>

          <Button variant="ghost" size="icon" className="rounded-2xl">
            <Bell className="h-5 w-5" />
          </Button>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" className="rounded-2xl px-2.5">
                <span className="hidden sm:inline">Nicolás</span>
                <ChevronDown className="h-4 w-4 sm:ml-2" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>Cuenta</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem>Perfil</DropdownMenuItem>
              <DropdownMenuItem>Equipo</DropdownMenuItem>
              <DropdownMenuItem>Configuración</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem>Cerrar sesión</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Mobile search row */}
      <div className="px-4 pb-3 md:hidden">
        <div className="relative">
          <Input className="h-11 rounded-2xl pl-11" placeholder="Buscar..." />
          <div className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">
            <FileSearch className="h-4 w-4" />
          </div>
        </div>
      </div>
    </div>
  );
}
