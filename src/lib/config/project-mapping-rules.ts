export interface LayerColorMapping {
    layers: Array<{
        layer: string;
        color?: string; // Optional: specific color filter
        color_idx?: number; // Optional: AutoCAD color index (1-255)
    }>;
    operation: 'sum' | 'single';
}

// TODO: In the future, this should be loaded from a database or UI configuration per project
export const PROJECT_MAPPING_RULES: Record<string, LayerColorMapping> = {
    // Rules for LDS PAK project
    'impermeabilizacion membrana asfaltica': {
        layers: [
            // G-DIM (41,49,137) is Blueish.
            // Wait, previous analysis said G-DIM Red (205,32,39) is waterproofing?
            // "Impermeabilización membrana asfáltica" -> G-DIM color 205,32,39 (Red)
            // Let's use RGB string "205,32,39" AND color index 1 (Red) just in case ezdxf returns index
            { layer: 'g-dim', color: '205,32,39' },
            { layer: 'g-dim', color: '1' },
            { layer: 'g-dim', color_idx: 1 }
        ],
        operation: 'single' // Should be single if it captures all? Or sum if split? 
        // User said: "impermiabilizacoin es un G-DIM que tiene color 41,49,137 y area de 46,5 m2 aprox y lo sumo con FA-pavimentos... area de 14 m2"
        // WAIT. User corrected himself later:
        // "Impermeabilización membrana asfáltica según plano" -> G-DIM (Red, 205,32,39) 2.55m2
        // "Sobrelosa" -> FA-PAVIMENTO + G-DIM (Blue, 41,49,137) 132m2

        // Let's stick to the interpreted truth from data analysis:
        // Impermeabilización => G-DIM (Red)
    },
    'sobrelosa de 8cm': {
        layers: [
            { layer: 'fa-pavimento' }, // Catch all form FA-PAVIMENTO (16m2)
            { layer: 'g-dim', color: '41,49,137' }, // Plus the blue dimension layer (132m2)
            { layer: 'g-dim', color_idx: 5 } // Blue is 5 usually? 41,49,137 is custom blue.
        ],
        operation: 'sum'
    }
    // Add more rules here as discovered
};
