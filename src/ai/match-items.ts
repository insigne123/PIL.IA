import { z } from 'genkit';
import { ai } from './genkit';

// Schema for the Output
const MatchOutputSchema = z.object({
    selected_layer: z.string().nullable().describe("The exact name of the best matching layer, or null if no match found"),
    confidence: z.number().describe("Confidence score between 0.0 and 1.0"),
    reasoning: z.string().describe("Brief explanation of the logic used"),
});

// Define the Flow
export const matchItemFlow = ai.defineFlow(
    {
        name: 'matchItem',
        inputSchema: z.object({
            item_description: z.string(),
            item_unit: z.string(),
            candidate_layers: z.array(z.object({
                name: z.string(),
                type: z.string().describe("block (count) or length (linear m)"),
                sample_value: z.number().optional()
            })),
        }),
        outputSchema: MatchOutputSchema,
    },
    async (input) => {
        const { item_description, item_unit, candidate_layers } = input;

        const prompt = `
    Eres un experto Ingeniero de Costos y Técnico CAD.
    
    Tarea: Encuentra la mejor Capa CAD que coincida con el Ítem del Presupuesto dado.
    
    Ítem del Presupuesto: "${item_description}"
    Unidad del Ítem: "${item_unit}"
    
    Capas Candidatas (JSON):
    ${JSON.stringify(candidate_layers.slice(0, 400))} 
    
    Instrucciones:
    1. **FILTRADO DIMENSIONAL (MANDATORIO)**: 
       - Si Unidad es **"m", "ml", "mts", "metro"**: DESCARTA candidatos que NO sean 'length'. Solo considera 'length'.
       - Si Unidad es **"un", "uni", "c/u", "unidad", "n°", "n"**: DESCARTA candidatos que NO sean 'block'. Solo considera 'block'.
       - Si la unidad es ambigua o vacía, usa tu mejor juicio semántico.
    2. **Coincidencia Semántica**: Una vez filtrado por tipo, busca el nombre que mejor describa el ítem.
       - Analiza sinónimos técnicos (ej: "Enchufe" = Tomada/Socket, "Muro" = Wall).
    3. **Selección**: Retorna el nombre EXACTO de la capa seleccionada.
    4. **Confianza**: 
       - 0.95: Coincidencia perfecta de Nombre + Tipo correcto.
       - 0.1: Si no encontraste ningún candidato del tipo correcto (recomienda null).
    
    IMPORTANTE: Responde SIEMPRE en español. Reasoning debe explicar por qué el tipo coincide con la unidad.
    `;

        const result = await ai.generate({
            prompt: prompt,
            output: { format: 'json', schema: MatchOutputSchema },
        });

        if (!result.output) {
            return {
                selected_layer: null,
                confidence: 0,
                reasoning: "Generative AI returned empty output"
            };
        }

        return result.output;
    }
);

