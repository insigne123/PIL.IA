import { z } from 'genkit';
import { ai } from './genkit';

// Output Schema
const PriceOutputSchema = z.object({
    found: z.boolean().describe("True if reasonable prices were found"),
    average_price: z.number().describe("Average unit price found in CLP (Pesos Chilenos)"),
    currency: z.string().describe("Currency code, usually CLP"),
    unit_ref: z.string().describe("Unit of the price found (e.g. 'm', 'tira 3m', 'unidad')"),
    sources: z.array(z.object({
        vendor: z.string(),
        price: z.number(),
        url: z.string().optional(),
        title: z.string()
    })).describe("List of up to 3 sources found"),
    confidence: z.enum(['high', 'medium', 'low']),
    notes: z.string().optional()
});

// Define Flow
export const findPriceFlow = ai.defineFlow(
    {
        name: 'findPrice',
        inputSchema: z.object({
            item_description: z.string(),
            item_unit: z.string(), // 'm', 'un', 'gl'
            country: z.string().default('Chile')
        }),
        outputSchema: PriceOutputSchema,
    },
    async (input) => {
        const { item_description, item_unit, country } = input;

        // 1. Construct Search Query
        // Optimize for Chilean construction suppliers
        const query = `precio ${item_description} ${item_unit} ${country} sodimac easy conmet`;

        // 2. Perform Search (using the tool)
        // We need a search tool. For now, we'll try to use the 'search' tool if registered, 
        // or prompt the LLM to use its grounding if enabled.
        // Since I cannot call `search_web` directly from here (it's an agent tool, not a Genkit tool yet),
        // I will assume we have a `searchTool` registered in our Genkit instance or I will create a wrapper.
        // For this implementation, let's assume `ai.generate` with `googleSearchRetrieval` if available, 
        // or we rely on a custom tool we will build.

        // Let's use a robust prompt that ASKS the model to Search.
        // Note: For this to work, the model needs a tool. 
        // I'll assume we pass a tool named 'webSearch' or similar.

        const prompt = `
        Eres un experto Cotizador de Construcción en ${country}.
        Tarea: Encuentra el precio de mercado actual para: "${item_description}"
        Unidad requerida: "${item_unit}"
        
        Instrucciones:
        1. Busca en proveedores locales (Sodimac, Easy, Rexel, etc.).
        2. Encuentra 3 precios de referencias.
        3. Calcula el promedio.
        4. Asegúrate que el precio corresponda a la UNIDAD pedida.
           - Si pido 'm' y venden 'rollo 100m', divide el precio por 100.
           - Si pido 'm' y venden 'tira 3m', divide por 3.
        5. Retorna precios en CLP (Pesos Chilenos) sin separadores de miles.
        
        Si no encuentras nada específico, busca un sustituto estándar y acláralo en 'notes'.
        `;

        const result = await ai.generate({
            model: 'googleai/gemini-2.0-flash',
            prompt: prompt,
            config: {
                // Enable Google Search for real-time pricing data
                googleSearchRetrieval: {}
            },
            output: { format: 'json', schema: PriceOutputSchema },
        });

        if (!result.output) {
            throw new Error("Failed to generate price");
        }

        return result.output;
    }
);
