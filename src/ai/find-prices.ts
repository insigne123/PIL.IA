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
            country: z.string().default('Chile'),
            pricing_mode: z.enum(['material', 'service', 'mixed']).default('material')
        }),
        outputSchema: PriceOutputSchema,
    },
    async (input) => {
        const { item_description, item_unit, country, pricing_mode } = input;

        // MODE SPECIFIC INSTRUCTIONS
        let modeInstructions = "";
        if (pricing_mode === 'service') {
            modeInstructions = `
            🛑 MODO SERVICIO DETECTADO:
            - Este ítem es un SERVICIO (Mano de obra, Instalación, Trámite, Certificación).
            - NO busques productos físicos (cables, tubos, módulos).
            - Busca tarifas de referencia de mano de obra, costos por metro lineal de instalación, o valores de trámites.
            - Si no encuentras una tarifa exacta, busca "Costo mano de obra electricista ${country}" o similar.
            - Evita URLs de Sodimac/Easy a menos que sean servicios de instalación ofrecidos por la tienda.
            `;
        } else if (pricing_mode === 'material') {
            modeInstructions = `
            🛑 MODO MATERIAL DETECTADO:
            - Este ítem es un PRODUCTO FÍSICO.
            - Prioriza Sodimac, Easy, Rexel, sitios de ferretería.
            - Si el ítem es "Punto de X", cotiza los MATERIALES para armar ese punto (cajas, placa, cable estimado).
            `;
        }

        // STEP 1: RESEARCH (Text Output + Search Tool)
        const searchPrompt = `
        Investiga el precio de mercado actual en ${country} para: "${item_description}"
        Unidad requerida: "${item_unit}"
        Modo de Pricing: "${pricing_mode}"
        
        Instrucciones:
        ${modeInstructions}
        
        Reglas Generales:
        1. **Proveedores**: Prioriza fuentes confiables locales.
        2. **Referencia**: Intenta encontrar 3 referencias.
        3. **Packs**: Fíjate si el precio es por unidad o por pack/tira/caja (ej: "tira 3m", "pack 10 un"). Anótalo claramente.
        
        Resume los hallazgos en un texto detallado que incluya:
           - Nombre del proveedor
           - Precio encontrado
           - Descripción exacta (incluyendo si es pack o unidad)
           - URL (INDISPENSABLE)
        
        Si no encuentras el producto exacto, busca el sustituto más cercano.
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
            console.log(`[PricingAI] Research for '${item_description}' (Mode: ${pricing_mode}):`, researchText.substring(0, 100) + "...");

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
            Modo: ${pricing_mode}
            
            Instrucciones Específicas:
            1. **Normalización de Precio**:
               - Si encuentras un "pack", "caja", "rollo" o "tira", divide el precio por la cantidad para obtener el precio unitario base (ej: Tira 3m $3000 -> Precio $1000/m).
               - Si el título dice "2 mt", "3 metros", etc., divide por los metros.
            
            2. **Materiales vs Servicios**:
               ${pricing_mode === 'service' ?
                    "- Prioriza TARIFAS de mano de obra o servicios. Si hay productos mezclados, IGNÓRALOS o dales baja prioridad." :
                    "- Prioriza MATERIALES de construcción. Si hay servicios mezclados, IGNÓRALOS."}
            
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
