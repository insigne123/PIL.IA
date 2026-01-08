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
    You are an expert Quantity Surveyor and CAD Technician.
    
    Task: Find the best matching CAD Layer for the given Bill of Quantities (BoQ) Item.
    
    BoQ Item: "${item_description}"
    BoQ Unit: "${item_unit}"
    
    Candidate Layers (JSON):
    ${JSON.stringify(candidate_layers.slice(0, 400))} 
    
    Instructions:
    1. **Semantic Match**: Analyze meanings (e.g., "Muro" = Wall, "Enchufe" = Socket).
    2. **Dimensional Analysis (CRITICAL)**: 
       - If BoQ Unit is "m" (Linear), prioritize candidates of type "length".
       - If BoQ Unit is "un", "u", "c/u" (Count), prioritize candidates of type "block".
       - Mismatched dimensions (e.g. matching "Socket (u)" to "Wall (length)") is usually WRONG unless no other option exists.
    3. **Return**: The EXACT layer name from the list.
    4. **Confidence**: High (0.9) if name AND type match. Low (0.4) if only name matches but type is wrong.
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

