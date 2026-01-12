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
        1. **Enfoque Materiales**: Si el ítem es "Punto de X" (ej: enchufe, datos), busca el precio de los MATERIALES (placa + módulo + caja). Evita precios de "servicio de instalación" a menos que se especifique "Mano de obra".
        2. **Proveedores**: Prioriza Sodimac, Easy, Rexel, sitios de ferretería online.
        3. **Referencia**: Intenta encontrar 3 referencias.
        4. **Packs**: Fíjate si el precio es por unidad o por pack/tira/caja (ej: "tira 3m", "pack 10 un"). Anótalo claramente.
        
        Resume los hallazgos en un texto detallado que incluya:
           - Nombre del proveedor
           - Precio encontrado
           - Descripción exacta (incluyendo si es pack o unidad)
           - URL (INDISPENSABLE)
        
        Si no encuentras el producto exacto, busca el sustituto más cercano (ej: 'Canaleta 20x10' si no hay medida exacta).
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
            
            Instrucciones Específicas:
            1. **Normalización de Precio**:
               - Si encuentras un "pack", "caja", "rollo" o "tira", divide el precio por la cantidad para obtener el precio unitario base (ej: Tira 3m $3000 -> Precio $1000/m).
               - Si el título dice "2 mt", "3 metros", etc., divide por los metros.
            
            2. **Materiales vs Servicios**:
               - Prioriza siempre MATERIALES de tiendas de construcción (Sodimac, Easy, etc.).
               - Solo si es explícitamente una instalación (mano de obra), busca tarifas de servicios.
               - Si el ítem es "Punto de X" (ej: enchufes), cotiza los MATERIALES para armar ese punto (cajas, placa, cable estimado), NO solo el módulo.
            
            3. **Validación**:
               - **URL es OBLIGATORIA**. Si no hay URL válida, descarta esa fuente o marca confidence='low'.
               - No aceptes fuentes sin precio numérico claro.
            
            4. **Salida**:
               - Extrae los precios encontrados y normalizados.
               - Calcula promedio simple.
               - Si no encontraste nada confiable, marca 'found': false.
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
                    confidence: 'low' as const,
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
                confidence: 'low' as const,
                notes: "Error in pricing flow execution"
            };
        }
    }
);
