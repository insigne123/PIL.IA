"use client";

import { useState, useEffect } from "react";
import { useProject } from "@/context/ProjectContext";
import { useAuth } from "@/components/auth/AuthProvider";
import { useRouter } from "next/navigation";
import { Plus, FolderOpen, Trash2, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function Dashboard() {
  const { user, loading: authLoading, signOut } = useAuth();
  const { projects, createProject, deleteProject, selectProject, loading: projectsLoading } = useProject();
  const router = useRouter();
  const [isNewOpen, setIsNewOpen] = useState(false);
  const [formData, setFormData] = useState({ name: "", client: "", notes: "" });

  useEffect(() => {
    if (!authLoading && !user) {
      router.push('/login');
    }
  }, [user, authLoading, router]);

  if (authLoading || projectsLoading) {
    return <div className="min-h-screen flex items-center justify-center text-slate-500">Cargando...</div>;
  }

  if (!user) return null;

  const handleCreate = async () => {
    if (!formData.name || !formData.client) return;
    await createProject(formData.name, formData.client, formData.notes);
    setIsNewOpen(false);
    setFormData({ name: "", client: "", notes: "" });
  };

  const handleOpenProject = (id: string) => {
    selectProject(id);
    router.push(`/project/${id}`);
  };

  return (
    <div className="container mx-auto py-10 px-4">
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-4xl font-bold tracking-tight text-slate-900">Proyectos</h1>
          <p className="text-slate-500 mt-2">Gestiona tus licitaciones y presupuestos.</p>
        </div>
        <div className="flex gap-4">
          <Button variant="outline" onClick={signOut}>
            <LogOut className="h-4 w-4 mr-2" /> Salir
          </Button>
          <Dialog open={isNewOpen} onOpenChange={setIsNewOpen}>
            <DialogTrigger asChild>
              <Button size="lg" className="gap-2 bg-blue-600 hover:bg-blue-700">
                <Plus className="h-5 w-5" /> Nuevo Proyecto
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Crear Nuevo Proyecto</DialogTitle>
                <DialogDescription>
                  Ingresa los datos básicos para comenzar una nueva licitación.
                </DialogDescription>
              </DialogHeader>
              <div className="grid gap-4 py-4">
                <div className="grid grid-cols-4 items-center gap-4">
                  <Label htmlFor="name" className="text-right">Proyecto</Label>
                  <Input
                    id="name"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    className="col-span-3"
                    placeholder="Edificio Centro"
                  />
                </div>
                <div className="grid grid-cols-4 items-center gap-4">
                  <Label htmlFor="client" className="text-right">Cliente</Label>
                  <Input
                    id="client"
                    value={formData.client}
                    onChange={(e) => setFormData({ ...formData, client: e.target.value })}
                    className="col-span-3"
                    placeholder="Constructora X"
                  />
                </div>
                <div className="grid grid-cols-4 items-center gap-4">
                  <Label htmlFor="notes" className="text-right">Notas</Label>
                  <Input
                    id="notes"
                    value={formData.notes}
                    onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                    className="col-span-3"
                    placeholder="Opcional"
                  />
                </div>
              </div>
              <DialogFooter>
                <Button onClick={handleCreate}>Crear Proyecto</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        {projects.length === 0 && (
          <div className="col-span-full text-center py-20 text-slate-400 border-2 border-dashed rounded-xl">
            No hay proyectos creados. Comienza creando uno nuevo.
          </div>
        )}
        {projects.map((project) => (
          <Card key={project.id} className="hover:shadow-lg transition-shadow cursor-pointer border-slate-200">
            <CardHeader className="pb-2">
              <div className="flex justify-between items-start">
                <div onClick={() => handleOpenProject(project.id)} className="flex-1">
                  <CardTitle className="text-xl mb-1 hover:underline">{project.name}</CardTitle>
                  <CardDescription>{project.client}</CardDescription>
                </div>
                <Button variant="ghost" size="icon" className="text-red-400 hover:text-red-600 hover:bg-red-50" onClick={(e) => { e.stopPropagation(); deleteProject(project.id); }}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-slate-500 line-clamp-2">
                {project.notes || "Sin notas adicionales."}
              </p>
            </CardContent>
            <CardFooter className="pt-2 flex justify-between text-xs text-slate-400">
              <span>Creado: {new Date(project.createdAt).toLocaleDateString()}</span>
              <Button variant="outline" size="sm" onClick={() => handleOpenProject(project.id)}>
                <FolderOpen className="mr-2 h-3 w-3" /> Abrir
              </Button>
            </CardFooter>
          </Card>
        ))}
      </div>
    </div>
  );
}
