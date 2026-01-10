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

        // STEP 1: RESEARCH (Text Output + Search Tool)
        // We prompt the model to search and return a text summary.
        // This is allowed because we are NOT asking for JSON output here.
        const searchPrompt = `
        Investiga el precio de mercado actual en ${country} para: "${item_description}"
        Unidad requerida: "${item_unit}"
        
        Instrucciones:
        1. Busca en proveedores locales (Sodimac, Easy, Rexel, sitios de construcción, etc.).
        2. Intenta encontrar al menos 3 referencias de precio.
        3. Resume los hallazgos en un texto detallado que incluya:
           - Nombre del proveedor
           - Precio encontrado
           - Descripción del producto encontrado (para verificar si coincide)
           - URL si es posible
        
        Si no encuentras el producto exacto, busca el sustituto más cercano y acláralo.
        Responde SOLO con el resumen de la investigación en texto plano.
        `;

        try {
            const searchResult = await ai.generate({
                model: 'googleai/gemini-2.5-flash',
                prompt: searchPrompt,
                config: {
                    googleSearchRetrieval: {} // ✅ Allowed with Text output
                }
            });

            const researchText = searchResult.text;
            console.log(`[PricingAI] Research for '${item_description}':`, researchText.substring(0, 100) + "...");

            // STEP 2: EXTRACTION (JSON Output + No Tool)
            // We feed the research text back to the model to structure it.
            // No capabilities enabled here, just pure text processing.
            const extractionPrompt = `
            Actúa como un extractor de datos estructurados.
            
            Tu tarea es convertir el siguiente reporte de investigación de precios en un formato JSON estricto.
            
            Reporte de Investigación:
            """
            ${researchText}
            """
            
            Item Buscado: "${item_description}" (${item_unit})
            
            Instrucciones:
            1. Extrae los precios encontrados.
            2. Calcula el precio promedio en CLP.
            3. Analiza la confianza basada en la calidad de los hallazgos.
            4. Si la investigación dice que no encontró nada, marca 'found': false.
            `;

            const extractionResult = await ai.generate({
                model: 'googleai/gemini-2.5-flash',
                prompt: extractionPrompt,
                output: { format: 'json', schema: PriceOutputSchema } // ✅ Allowed without Tools
            });

            if (!extractionResult.output) {
                console.error("Failed to parse pricing JSON");
                return {
                    found: false,
                    average_price: 0,
                    currency: 'CLP',
                    unit_ref: item_unit,
                    sources: [],
                    confidence: 'low',
                    notes: "Error parsing AI response"
                };
            }

            return extractionResult.output;

        } catch (error) {
            console.error("AI Pricing Flow Error:", error);
            return {
                found: false,
                average_price: 0,
                currency: 'CLP',
                unit_ref: item_unit,
                sources: [],
                confidence: 'low',
                notes: "Error in pricing flow execution"
            };
        }
    }
);
