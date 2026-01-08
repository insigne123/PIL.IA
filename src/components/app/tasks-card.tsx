import { MoreHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { tasks } from "@/lib/data";

export function TasksCard() {
  return (
    <Card className="rounded-[28px]">
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Tareas críticas</CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        <div className="grid gap-3">
          {tasks.map((t) => (
            <div
              key={t.id}
              className="flex items-start gap-3 rounded-[24px] border bg-background p-4"
            >
              <Checkbox id={t.id} defaultChecked={t.done} className="mt-0.5" />
              <label
                htmlFor={t.id}
                className="cursor-pointer text-sm text-muted-foreground"
              >
                {t.label}
              </label>
              <Button
                variant="ghost"
                size="icon"
                className="ml-auto rounded-2xl"
              >
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </div>
          ))}
        </div>
        <Button variant="outline" className="mt-4 w-full rounded-2xl">
          Ver todas las tareas
        </Button>
      </CardContent>
    </Card>
  );
}
