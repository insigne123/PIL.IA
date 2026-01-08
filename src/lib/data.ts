export type Tender = {
  id: string;
  name: string;
  client: string;
  due: string;
  status: "En análisis" | "En armado" | "En revisión" | "Entregada";
  risk: "Bajo" | "Medio" | "Alto";
  compliance: number;
};

export const tenders: Tender[] = [
  {
    id: "LC-1021",
    name: "Hospital San Gabriel — OOCC",
    client: "Servicio de Salud",
    due: "13 Ene",
    status: "En revisión",
    risk: "Medio",
    compliance: 91,
  },
  {
    id: "PR-5580",
    name: "Edificio Norte — Eléctrica",
    client: "Inmobiliaria",
    due: "18 Ene",
    status: "En armado",
    risk: "Bajo",
    compliance: 84,
  },
  {
    id: "MOP-771",
    name: "Mejoramiento Ruta G-45",
    client: "MOP",
    due: "22 Ene",
    status: "En análisis",
    risk: "Alto",
    compliance: 63,
  },
];

export const tasks = [
  {
    id: "t1",
    done: false,
    label: "Validar boleta de seriedad (formato + glosa)",
  },
  { id: "t2", done: true, label: "Adjuntar certificados ISO (vigencia)" },
  { id: "t3", done: false, label: "Revisar anexo de garantías y multas" },
  {
    id: "t4",
    done: false,
    label: "Completar experiencia específica (tabla)",
  },
];
