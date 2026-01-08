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
            candidate_layers: z.array(z.string()),
        }),
        outputSchema: MatchOutputSchema,
    },
    async (input) => {
        const { item_description, candidate_layers } = input;

        const prompt = `
    You are an expert Quantity Surveyor and CAD Technician.
    
    Task: Find the best matching CAD Layer for the given Bill of Quantities (BoQ) Item.
    
    BoQ Item: "${item_description}"
    
    Candidate Layers:
    ${JSON.stringify(candidate_layers.slice(0, 500))} 
    
    Instructions:
    1. Analyze the semantic meaning of the BoQ Item (e.g., "Muro H.A." means Reinforced Concrete Wall).
    2. Look for technical abbreviations in Layer names (e.g., "CONC" = Concrete, "WALL" = Muro).
    3. Return the EXACT layer name from the list that is the best match.
    4. If no layer is a plausible match, return null.
    `;

        const result = await ai.generate({
            prompt: prompt,
            output: { format: 'json', schema: MatchOutputSchema },
        });

        return result.output;
    }
);
