/**
 * Unit tests for unit-validator
 */

import {
    validateExcelUnit,
    normalizeUnit,
    requiresGeometry,
    getValidUnits,
    getUnitVariants
} from '../unit-validator';

describe('unit-validator', () => {
    describe('validateExcelUnit', () => {
        describe('Length units (m)', () => {
            const lengthVariants = ['m', 'ml', 'mts', 'mt', 'metro', 'metros', 'mts.', 'mt.', 'm.', 'ml.'];

            lengthVariants.forEach(variant => {
                it(`should normalize '${variant}' to 'm'`, () => {
                    const result = validateExcelUnit(variant);
                    expect(result.isValid).toBe(true);
                    expect(result.normalizedUnit).toBe('m');
                    expect(result.confidence).toBeGreaterThan(0.8);
                });
            });

            it('should handle uppercase variants', () => {
                const result = validateExcelUnit('ML');
                expect(result.isValid).toBe(true);
                expect(result.normalizedUnit).toBe('m');
            });

            it('should handle extra spaces', () => {
                const result = validateExcelUnit('  m  ');
                expect(result.isValid).toBe(true);
                expect(result.normalizedUnit).toBe('m');
            });
        });

        describe('Area units (m2)', () => {
            const areaVariants = ['m2', 'm²', 'm^2', 'metro cuadrado', 'metros cuadrados', 'm2.', 'm².'];

            areaVariants.forEach(variant => {
                it(`should normalize '${variant}' to 'm2'`, () => {
                    const result = validateExcelUnit(variant);
                    expect(result.isValid).toBe(true);
                    expect(result.normalizedUnit).toBe('m2');
                });
            });
        });

        describe('Volume units (m3)', () => {
            const volumeVariants = ['m3', 'm³', 'm^3', 'metro cubico', 'metros cubicos', 'metro cúbico', 'metros cúbicos'];

            volumeVariants.forEach(variant => {
                it(`should normalize '${variant}' to 'm3'`, () => {
                    const result = validateExcelUnit(variant);
                    expect(result.isValid).toBe(true);
                    expect(result.normalizedUnit).toBe('m3');
                });
            });
        });

        describe('Count/Unit units (un)', () => {
            const countVariants = ['u', 'un', 'und', 'unid', 'unidad', 'unidades', 'pza', 'pieza', 'piezas'];

            countVariants.forEach(variant => {
                it(`should normalize '${variant}' to 'un'`, () => {
                    const result = validateExcelUnit(variant);
                    expect(result.isValid).toBe(true);
                    expect(result.normalizedUnit).toBe('un');
                });
            });
        });

        describe('Point units (un)', () => {
            const pointVariants = ['punto', 'puntos', 'pto', 'ptos', 'pto.', 'ptos.'];

            pointVariants.forEach(variant => {
                it(`should normalize '${variant}' to 'un'`, () => {
                    const result = validateExcelUnit(variant);
                    expect(result.isValid).toBe(true);
                    expect(result.normalizedUnit).toBe('un');
                });
            });
        });

        describe('Global/Service units (gl)', () => {
            const globalVariants = [
                'gl', 'glb', 'global', 'alcance', 'servicio',
                'instalacion', 'instalación', 'inst', 'inst.',
                'por mandante', 'mandante', 'p/mandante', 'pm',
                'est', 'est.', 'estimado', 'pa', 'paquete'
            ];

            globalVariants.forEach(variant => {
                it(`should normalize '${variant}' to 'gl'`, () => {
                    const result = validateExcelUnit(variant);
                    expect(result.isValid).toBe(true);
                    expect(result.normalizedUnit).toBe('gl');
                });
            });
        });

        describe('Invalid units', () => {
            it('should reject null', () => {
                const result = validateExcelUnit(null);
                expect(result.isValid).toBe(false);
                expect(result.skipReason).toBe('no_unit');
                expect(result.normalizedUnit).toBeNull();
            });

            it('should reject undefined', () => {
                const result = validateExcelUnit(undefined);
                expect(result.isValid).toBe(false);
                expect(result.skipReason).toBe('no_unit');
            });

            it('should reject empty string', () => {
                const result = validateExcelUnit('');
                expect(result.isValid).toBe(false);
                expect(result.skipReason).toBe('no_unit');
            });

            it('should reject unrecognized units', () => {
                const result = validateExcelUnit('kg');
                expect(result.isValid).toBe(false);
                expect(result.skipReason).toBe('invalid_unit');
            });

            it('should reject very long strings', () => {
                const result = validateExcelUnit('this is a very long string that is not a unit at all');
                expect(result.isValid).toBe(false);
                expect(result.skipReason).toBe('no_unit');
            });
        });

        describe('Edge cases', () => {
            it('should handle "c.u" (short for cantidad unitaria)', () => {
                const result = validateExcelUnit('c.u');
                // Should try to normalize to 'un' or mark as invalid
                // Based on implementation, this should be invalid
                expect(result.isValid).toBe(false);
            });

            it('should handle mixed case and spaces', () => {
                const result = validateExcelUnit('  Metro Cuadrado  ');
                expect(result.isValid).toBe(true);
                expect(result.normalizedUnit).toBe('m2');
            });
        });
    });

    describe('normalizeUnit', () => {
        it('should return normalized unit for valid input', () => {
            expect(normalizeUnit('ml')).toBe('m');
            expect(normalizeUnit('m2')).toBe('m2');
            expect(normalizeUnit('un')).toBe('un');
            expect(normalizeUnit('gl')).toBe('gl');
        });

        it('should return null for invalid input', () => {
            expect(normalizeUnit(null)).toBeNull();
            expect(normalizeUnit('')).toBeNull();
            expect(normalizeUnit('kg')).toBeNull();
        });
    });

    describe('requiresGeometry', () => {
        it('should return true for geometric units', () => {
            expect(requiresGeometry('m')).toBe(true);
            expect(requiresGeometry('m2')).toBe(true);
            expect(requiresGeometry('m3')).toBe(true);
            expect(requiresGeometry('un')).toBe(true);
        });

        it('should return false for global/service units', () => {
            expect(requiresGeometry('gl')).toBe(false);
        });
    });

    describe('getValidUnits', () => {
        it('should return all unique normalized units', () => {
            const validUnits = getValidUnits();
            expect(validUnits).toContain('m');
            expect(validUnits).toContain('m2');
            expect(validUnits).toContain('m3');
            expect(validUnits).toContain('un');
            expect(validUnits).toContain('gl');
        });

        it('should not have duplicates', () => {
            const validUnits = getValidUnits();
            const uniqueUnits = Array.from(new Set(validUnits));
            expect(validUnits.length).toBe(uniqueUnits.length);
        });
    });

    describe('getUnitVariants', () => {
        it('should return all variants for m', () => {
            const variants = getUnitVariants('m');
            expect(variants).toContain('m');
            expect(variants).toContain('ml');
            expect(variants).toContain('mts');
            expect(variants.length).toBeGreaterThan(5);
        });

        it('should return all variants for gl', () => {
            const variants = getUnitVariants('gl');
            expect(variants).toContain('gl');
            expect(variants).toContain('global');
            expect(variants).toContain('servicio');
        });
    });
});
