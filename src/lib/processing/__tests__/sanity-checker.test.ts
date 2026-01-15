import { checkQuantitySanity, checkBatchSanity, getSanitySummary } from '../sanity-checker';

describe('Sanity Checker', () => {
    describe('Length Checks', () => {
        it('should pass for normal lengths', () => {
            const result = checkQuantitySanity(50, 'length');
            expect(result.passed).toBe(true);
            expect(result.severity).toBe('ok');
        });

        it('should detect suspiciously large lengths (unconverted mm)', () => {
            const result = checkQuantitySanity(150000, 'length'); // 150km seems like 150000mm
            expect(result.passed).toBe(false);
            expect(result.severity).toBe('error');
            expect(result.issues[0].type).toBe('unconverted_units');
            expect(result.issues[0].message).toContain('mm sin convertir');
        });

        it('should warn for very large but possible lengths', () => {
            const result = checkQuantitySanity(15000, 'length'); // 15km
            expect(result.passed).toBe(false);
            expect(result.severity).toBe('warning');
        });

        it('should warn for very small lengths', () => {
            const result = checkQuantitySanity(0.001, 'length'); // 1mm
            expect(result.passed).toBe(false);
            expect(result.severity).toBe('warning');
            expect(result.issues[0].message).toContain('ruido');
        });

        it('should pass for zero', () => {
            const result = checkQuantitySanity(0, 'length');
            expect(result.issues.some(i => i.type === 'zero_quantity')).toBe(true);
        });

        it('should error for negative values', () => {
            const result = checkQuantitySanity(-10, 'length');
            expect(result.passed).toBe(false);
            expect(result.severity).toBe('error');
            expect(result.issues[0].type).toBe('impossible_value');
        });
    });

    describe('Area Checks', () => {
        it('should pass for normal areas', () => {
            const result = checkQuantitySanity(500, 'area'); // 500m²
            expect(result.passed).toBe(true);
        });

        it('should detect suspiciously large areas', () => {
            const result = checkQuantitySanity(2000000, 'area'); // 2km²
            expect(result.passed).toBe(false);
            expect(result.severity).toBe('error');
            expect(result.issues[0].type).toBe('unconverted_units');
        });

        it('should warn for very large buildings', () => {
            const result = checkQuantitySanity(150000, 'area'); // 15 hectares
            expect(result.passed).toBe(false);
            expect(result.severity).toBe('warning');
        });

        it('should warn for very small areas', () => {
            const result = checkQuantitySanity(0.005, 'area'); // 50cm²
            expect(result.passed).toBe(false);
            expect(result.severity).toBe('warning');
        });
    });

    describe('Volume Checks', () => {
        it('should pass for normal volumes', () => {
            const result = checkQuantitySanity(100, 'volume'); // 100m³
            expect(result.passed).toBe(true);
        });

        it('should detect impossibly large volumes', () => {
            const result = checkQuantitySanity(2000000, 'volume');
            expect(result.passed).toBe(false);
            expect(result.severity).toBe('error');
        });
    });

    describe('Count Checks', () => {
        it('should pass for integer counts', () => {
            const result = checkQuantitySanity(42, 'count');
            expect(result.passed).toBe(true);
        });

        it('should warn for non-integer counts', () => {
            const result = checkQuantitySanity(42.5, 'count');
            expect(result.passed).toBe(false);
            expect(result.severity).toBe('warning');
            expect(result.issues[0].type).toBe('type_mismatch');
            expect(result.issues[0].message).toContain('no es entero');
        });

        it('should warn for suspiciously high counts', () => {
            const result = checkQuantitySanity(100000, 'count');
            expect(result.passed).toBe(false);
            expect(result.severity).toBe('warning');
        });
    });

    describe('Service Checks', () => {
        it('should pass for 1', () => {
            const result = checkQuantitySanity(1, 'service');
            expect(result.passed).toBe(true);
        });

        it('should pass for 0', () => {
            const result = checkQuantitySanity(0, 'service');
            // Zero is OK but should have zero_quantity issue
            expect(result.issues.some(i => i.type === 'zero_quantity')).toBe(true);
        });

        it('should warn for other values', () => {
            const result = checkQuantitySanity(5, 'service');
            expect(result.passed).toBe(false);
            expect(result.issues[0].type).toBe('outlier');
        });
    });

    describe('Unknown Kind', () => {
        it('should pass for unknown measure kinds', () => {
            const result = checkQuantitySanity(12345, 'unknown');
            expect(result.passed).toBe(true);
        });
    });

    describe('Batch Checking', () => {
        it('should check multiple values', () => {
            const values = [
                { qty: 50, measureKind: 'length' as const, description: 'Cable' },
                { qty: 200000, measureKind: 'length' as const, description: 'Tubería' }, // Error
                { qty: 500, measureKind: 'area' as const, description: 'Muro' },
                { qty: 42.5, measureKind: 'count' as const, description: 'Tablero' }, // Warning
            ];

            const result = checkBatchSanity(values);

            expect(result.totalChecked).toBe(4);
            expect(result.passed).toBe(2);
            expect(result.warnings).toBe(1);
            expect(result.errors).toBe(1);
        });
    });

    describe('getSanitySummary', () => {
        it('should return OK for passed checks', () => {
            const result = checkQuantitySanity(50, 'length');
            expect(getSanitySummary(result)).toBe('✅ OK');
        });

        it('should return warning summary', () => {
            const result = checkQuantitySanity(0.001, 'length');
            const summary = getSanitySummary(result);
            expect(summary).toContain('⚠️');
            expect(summary).toContain('ruido');
        });

        it('should return error summary', () => {
            const result = checkQuantitySanity(200000, 'length');
            const summary = getSanitySummary(result);
            expect(summary).toContain('❌');
            expect(summary).toContain('mm sin convertir');
        });
    });

    describe('Real-world scenarios', () => {
        it('should detect 5000m cable as likely 5000mm unconverted', () => {
            const result = checkQuantitySanity(5000, 'length', {
                description: 'Cable THHN',
                unit: 'm'
            });
            // 5000m = 5km, possible but suspicious for a cable
            expect(result.passed).toBe(false);
            expect(result.severity).toBe('warning');
        });

        it('should pass 150m cable as normal', () => {
            const result = checkQuantitySanity(150, 'length', {
                description: 'Cable THHN',
                unit: 'm'
            });
            expect(result.passed).toBe(true);
        });

        it('should detect 50000m² wall area as likely unconverted', () => {
            const result = checkQuantitySanity(50000, 'area', {
                description: 'Muro',
                unit: 'm2'
            });
            // 50000m² = 5 hectares, possible but suspicious
            expect(result.passed).toBe(false);
            expect(result.severity).toBe('warning');
        });
    });
});
