import { Discipline } from "@/types";

/**
 * Detect discipline from filename or path using heuristic keywords
 */
export function detectDiscipline(filename: string): Discipline {
    const lower = filename.toLowerCase();

    if (lower.includes('elec') || lower.includes('ilum') || lower.includes('enchufe') || lower.includes('cinc') || lower.includes('corrientes')) return 'ELEC';
    if (lower.includes('sani') || lower.includes('agua') || lower.includes('alcan') || lower.includes('desague') || lower.includes('plom')) return 'SANI';
    if (lower.includes('arqui') || lower.includes('arq') || lower.includes('planta') || lower.includes('corte') || lower.includes('elev')) return 'ARQUI'; // Arquitectura suele ser default si dice "planta"
    if (lower.includes('estr') || lower.includes('calculo') || lower.includes('horm')) return 'ESTR';
    if (lower.includes('clima') || lower.includes('hvac') || lower.includes('aire')) return 'CLIMA';
    if (lower.includes('gas')) return 'GAS';

    // Default fallback
    return 'UNKNOWN';
}

/**
 * Check if disciplines match or if one is general
 */
export function isDisciplineMatch(itemDisc: Discipline, scopeDisc: Discipline): boolean {
    if (!itemDisc || !scopeDisc) return true; // Loose matching if tag missing
    if (itemDisc === 'UNKNOWN' || scopeDisc === 'UNKNOWN') return true;
    if (itemDisc === 'GENERAL' || scopeDisc === 'GENERAL') return true;

    return itemDisc === scopeDisc;
}
