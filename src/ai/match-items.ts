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
    1. **Coincidencia Semántica**: Analiza significados (ej: "Muro" = Wall, "Enchufe" = Socket).
    2. **Análisis Dimensional (CRÍTICO)**: 
       - Si la Unidad es "m" (Lineal), prioriza candidatos de tipo "length".
       - Si la Unidad es "un", "u", "c/u" (Cantidad), prioriza candidatos de tipo "block".
       - Dimensiones incompatibles (ej: emparejar "Enchufe (u)" con "Muro (length)") es generalmente INCORRECTO a menos que no exista otra opción.
    3. **Retorna**: El nombre EXACTO de la capa de la lista.
    4. **Confianza**: Alta (0.9) si nombre Y tipo coinciden. Baja (0.4) si solo coincide el nombre pero el tipo es incorrecto.
    
    IMPORTANTE: Responde SIEMPRE en español, incluyendo el campo "reasoning".
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

