/**
 * Unit tests for unit-classifier
 */

import {
    classifyItemIntent,
    typeMatches,
    getExpectedMeasureType,
    getTypeForUnit,
    type ExpectedType,
    type ClassificationResult
} from '../unit-classifier';

describe('unit-classifier', () => {
    describe('getTypeForUnit - Single Source of Truth', () => {
        it('should map m to LENGTH', () => {
            expect(getTypeForUnit('m')).toBe('LENGTH');
            expect(getTypeForUnit('ml')).toBe('LENGTH');
            expect(getTypeForUnit('mts')).toBe('LENGTH');
        });

        it('should map m2 to AREA', () => {
            expect(getTypeForUnit('m2')).toBe('AREA');
            expect(getTypeForUnit('m²')).toBe('AREA');
            expect(getTypeForUnit('metros cuadrados')).toBe('AREA');
        });

        it('should map m3 to VOLUME', () => {
            expect(getTypeForUnit('m3')).toBe('VOLUME');
            expect(getTypeForUnit('m³')).toBe('VOLUME');
        });

        it('should map un to BLOCK', () => {
            expect(getTypeForUnit('un')).toBe('BLOCK');
            expect(getTypeForUnit('u')).toBe('BLOCK');
            expect(getTypeForUnit('unidad')).toBe('BLOCK');
            expect(getTypeForUnit('punto')).toBe('BLOCK');
        });

        it('should map gl to GLOBAL', () => {
            expect(getTypeForUnit('gl')).toBe('GLOBAL');
            expect(getTypeForUnit('global')).toBe('GLOBAL');
            expect(getTypeForUnit('servicio')).toBe('GLOBAL');
        });

        it('should return UNKNOWN for unrecognized units', () => {
            expect(getTypeForUnit('kg')).toBe('UNKNOWN');
            expect(getTypeForUnit('')).toBe('UNKNOWN');
            expect(getTypeForUnit('xyz')).toBe('UNKNOWN');
        });
    });

    describe('classifyItemIntent - Unit is Authority', () => {
        describe('With explicit units (unit overrides keywords)', () => {
            it('should classify by unit even if description suggests different type', () => {
                // Description says "tablero" (BLOCK keyword), but unit is 'm' (LENGTH)
                const result = classifyItemIntent('Tablero eléctrico', 'm');
                expect(result.type).toBe('LENGTH');
                expect(result.confidence).toBe(1.0);
                expect(result.method).toBe('unit_hard');
            });

            it('should use unit for area even with length keywords', () => {
                // Description says "cable" (LENGTH keyword), but unit is 'm2' (AREA)
                const result = classifyItemIntent('Cable en piso', 'm2');
                expect(result.type).toBe('AREA');
                expect(result.confidence).toBe(1.0);
            });

            it('should use unit for blocks even with length descriptions', () => {
                const result = classifyItemIntent('Tubería PVC', 'un');
                expect(result.type).toBe('BLOCK');
                expect(result.confidence).toBe(1.0);
            });

            it('should handle normalized units', () => {
                const result = classifyItemIntent('Cualquier descripción', 'ml');
                expect(result.type).toBe('LENGTH');
                expect(result.confidence).toBe(1.0);
            });
        });

        describe('Without units (keywords as hints)', () => {
            it('should use global keywords when no unit', () => {
                const result = classifyItemIntent('Instalación eléctrica', '');
                expect(result.type).toBe('GLOBAL');
                expect(result.confidence).toBeLessThan(1.0);
                expect(result.method).toBe('keyword_strong');
            });

            it('should use LENGTH keywords when no unit', () => {
                const result = classifyItemIntent('Tubería PVC 50mm', '');
                expect(result.type).toBe('LENGTH');
                expect(result.confidence).toBeLessThan(1.0);
            });

            it('should use BLOCK keywords when no unit', () => {
                const result = classifyItemIntent('Tablero eléctrico', '');
                expect(result.type).toBe('BLOCK');
                expect(result.confidence).toBeLessThan(1.0);
            });

            it('should return UNKNOWN when no unit and no keywords', () => {
                const result = classifyItemIntent('Lorem ipsum dolor', '');
                expect(result.type).toBe('UNKNOWN');
                expect(result.confidence).toBe(0.0);
            });
        });

        describe('Special cases', () => {
            it('should handle "punto" in different contexts', () => {
                // "Punto de red" without unit -> BLOCK
                const result1 = classifyItemIntent('Punto de red', '');
                expect(result1.type).toBe('BLOCK');

                // "Punto" with canalización context -> should skip the "punto" keyword
                const result2 = classifyItemIntent('Punto de canalización', '');
                // Should not match "punto" keyword due to "canaliz" context
                expect(result2.type).not.toBe('BLOCK');
            });

            it('should handle weak heuristics (starts with punto)', () => {
                const result = classifyItemIntent('Puntos varios', '');
                expect(result.type).toBe('BLOCK');
                expect(result.method).toBe('keyword_weak');
                expect(result.confidence).toBeLessThan(0.7);
            });
        });

        describe('Global keyword detection', () => {
            const globalKeywords = [
                'instalacion',
                'instalación',
                'certificado',
                'tramite',
                'legaliza',
                'capacitacion',
                'planos'
            ];

            globalKeywords.forEach(keyword => {
                it(`should detect '${keyword}' as GLOBAL (without unit)`, () => {
                    const result = classifyItemIntent(`Descripción con ${keyword}`, '');
                    expect(result.type).toBe('GLOBAL');
                });
            });
        });
    });

    describe('typeMatches', () => {
        it('should match LENGTH with LENGTH', () => {
            expect(typeMatches('LENGTH', 'LENGTH')).toBe(true);
        });

        it('should not match LENGTH with AREA', () => {
            expect(typeMatches('LENGTH', 'AREA')).toBe(false);
        });

        it('should match BLOCK with BLOCK', () => {
            expect(typeMatches('BLOCK', 'BLOCK')).toBe(true);
        });

        it('should not match BLOCK with LENGTH', () => {
            expect(typeMatches('BLOCK', 'LENGTH')).toBe(false);
        });

        it('should match AREA with AREA', () => {
            expect(typeMatches('AREA', 'AREA')).toBe(true);
        });

        it('should match VOLUME with VOLUME', () => {
            expect(typeMatches('VOLUME', 'VOLUME')).toBe(true);
        });

        it('should match anything with UNKNOWN', () => {
            expect(typeMatches('LENGTH', 'UNKNOWN')).toBe(true);
            expect(typeMatches('AREA', 'UNKNOWN')).toBe(true);
            expect(typeMatches('BLOCK', 'UNKNOWN')).toBe(true);
            expect(typeMatches('VOLUME', 'UNKNOWN')).toBe(true);
        });

        it('should not match anything with GLOBAL', () => {
            expect(typeMatches('LENGTH', 'GLOBAL')).toBe(false);
            expect(typeMatches('AREA', 'GLOBAL')).toBe(false);
            expect(typeMatches('BLOCK', 'GLOBAL')).toBe(false);
        });

        it('should not match TEXT with anything (TEXT prohibited)', () => {
            expect(typeMatches('TEXT', 'LENGTH')).toBe(false);
            expect(typeMatches('TEXT', 'AREA')).toBe(false);
            expect(typeMatches('TEXT', 'BLOCK')).toBe(false);
            // TEXT should only match UNKNOWN
            expect(typeMatches('TEXT', 'UNKNOWN')).toBe(true);
        });
    });

    describe('getExpectedMeasureType', () => {
        it('should return correct types for all standard units', () => {
            expect(getExpectedMeasureType('m')).toBe('LENGTH');
            expect(getExpectedMeasureType('m2')).toBe('AREA');
            expect(getExpectedMeasureType('m3')).toBe('VOLUME');
            expect(getExpectedMeasureType('un')).toBe('BLOCK');
            expect(getExpectedMeasureType('gl')).toBe('GLOBAL');
        });

        it('should handle unit variants', () => {
            expect(getExpectedMeasureType('ml')).toBe('LENGTH');
            expect(getExpectedMeasureType('m²')).toBe('AREA');
            expect(getExpectedMeasureType('punto')).toBe('BLOCK');
        });

        it('should return UNKNOWN for invalid units', () => {
            expect(getExpectedMeasureType('')).toBe('UNKNOWN');
            expect(getExpectedMeasureType('xyz')).toBe('UNKNOWN');
        });
    });

    describe('Integration tests - No keyword override', () => {
        it('CRITICAL: unit=m2 should NEVER return LENGTH even with LENGTH keywords', () => {
            const testCases = [
                'Cable THHN 12 AWG',
                'Tubería PVC 50mm',
                'Canalización eléctrica',
                'Ducto metálico',
                'Bandeja portacables'
            ];

            testCases.forEach(description => {
                const result = classifyItemIntent(description, 'm2');
                expect(result.type).toBe('AREA');
                expect(result.confidence).toBe(1.0);
                expect(result.method).toBe('unit_hard');
            });
        });

        it('CRITICAL: unit=un should NEVER return LENGTH even with LENGTH keywords', () => {
            const testCases = [
                'Tubería PVC 50mm',
                'Cable de cobre',
                'Ducto flexible'
            ];

            testCases.forEach(description => {
                const result = classifyItemIntent(description, 'un');
                expect(result.type).toBe('BLOCK');
                expect(result.confidence).toBe(1.0);
            });
        });

        it('CRITICAL: unit=m should NEVER return BLOCK even with BLOCK keywords', () => {
            const testCases = [
                'Tablero eléctrico',
                'Luminaria LED',
                'Sensor de movimiento',
                'Interruptor doble'
            ];

            testCases.forEach(description => {
                const result = classifyItemIntent(description, 'm');
                expect(result.type).toBe('LENGTH');
                expect(result.confidence).toBe(1.0);
            });
        });

        it('CRITICAL: unit=gl should ALWAYS return GLOBAL', () => {
            const result = classifyItemIntent('Anything at all', 'gl');
            expect(result.type).toBe('GLOBAL');
            expect(result.confidence).toBe(1.0);
        });
    });
});
