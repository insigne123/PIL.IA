import { describe, it, expect } from '@jest/globals';
import { classifyExcelSubtype, getSubtypeLabel, getSubtypeCategory } from '../subtype-classifier';

describe('Subtype Classifier', () => {
    describe('Area Subtypes', () => {
        it('should classify floor items', () => {
            const tests = [
                'Sobrelosa de 8cm',
                'Pavimento de hormigón',
                'Piso cerámico',
                'Radier e=10cm',
                'Baldosa porcelanato'
            ];

            for (const desc of tests) {
                const result = classifyExcelSubtype(desc, 'AREA');
                expect(result.subtype).toBe('floor_area');
                expect(result.confidence).toBeGreaterThan(0.7);
                expect(result.matched_keywords).toBeDefined();
                expect(result.matched_keywords!.length).toBeGreaterThan(0);
            }
        });

        it('should classify ceiling items', () => {
            const tests = [
                'Cielo raso yeso cartón',
                'Plafón acústico',
                'Cielo falso'
            ];

            for (const desc of tests) {
                const result = classifyExcelSubtype(desc, 'AREA');
                expect(result.subtype).toBe('ceiling_area');
                expect(result.confidence).toBeGreaterThan(0.7);
            }
        });

        it('should classify wall items', () => {
            const tests = [
                'Muro de albañilería',
                'Tabique de yeso cartón',
                'Revestimiento cerámico',
                'Pintura muro interior',
                'Estuco exterior'
            ];

            for (const desc of tests) {
                const result = classifyExcelSubtype(desc, 'AREA');
                expect(result.subtype).toBe('wall_area');
                expect(result.confidence).toBeGreaterThan(0.7);
            }
        });

        it('should classify roof items', () => {
            const tests = [
                'Cubierta de zinc',
                'Techo de tejas',
                'Impermeabilización asfaltica'
            ];

            for (const desc of tests) {
                const result = classifyExcelSubtype(desc, 'AREA');
                expect(result.subtype).toBe('roof_area');
                expect(result.confidence).toBeGreaterThan(0.7);
            }
        });

        it('should classify opening items', () => {
            const tests = [
                'Ventana de aluminio',
                'Puerta de madera',
                'Cristal templado'
            ];

            for (const desc of tests) {
                const result = classifyExcelSubtype(desc, 'AREA');
                expect(result.subtype).toBe('opening_area');
                expect(result.confidence).toBeGreaterThan(0.7);
            }
        });

        it('should default to generic for unknown items', () => {
            const result = classifyExcelSubtype('Superficie xyz', 'AREA');
            expect(result.subtype).toBe('generic_area');
            expect(result.confidence).toBeLessThan(0.5);
        });
    });

    describe('Length Subtypes', () => {
        it('should classify wall length', () => {
            const tests = [
                'Muro perimetral',
                'Tabique divisorio'
            ];

            for (const desc of tests) {
                const result = classifyExcelSubtype(desc, 'LENGTH');
                expect(result.subtype).toBe('wall_length');
                expect(result.confidence).toBeGreaterThan(0.7);
            }
        });

        it('should classify beam length', () => {
            const tests = [
                'Viga de hormigón',
                'Dintel metálico',
                'Cadena superior'
            ];

            for (const desc of tests) {
                const result = classifyExcelSubtype(desc, 'LENGTH');
                expect(result.subtype).toBe('beam_length');
                expect(result.confidence).toBeGreaterThan(0.7);
            }
        });

        it('should classify pipe length', () => {
            const tests = [
                'Cañería de cobre',
                'Tubería PVC',
                'Ducto de ventilación'
            ];

            for (const desc of tests) {
                const result = classifyExcelSubtype(desc, 'LENGTH');
                expect(result.subtype).toBe('pipe_length');
                expect(result.confidence).toBeGreaterThan(0.7);
            }
        });

        it('should classify cable length', () => {
            const tests = [
                'Cable NYA 2.5mm',
                'Conductor de cobre',
                'Alimentador eléctrico'
            ];

            for (const desc of tests) {
                const result = classifyExcelSubtype(desc, 'LENGTH');
                expect(result.subtype).toBe('cable_length');
                expect(result.confidence).toBeGreaterThan(0.7);
            }
        });

        it('should classify border length', () => {
            const tests = [
                'Guardapolvo de madera',
                'Zócalo cerámico',
                'Moldura decorativa'
            ];

            for (const desc of tests) {
                const result = classifyExcelSubtype(desc, 'LENGTH');
                expect(result.subtype).toBe('border_length');
                expect(result.confidence).toBeGreaterThan(0.7);
            }
        });
    });

    describe('Block Subtypes', () => {
        it('should classify electrical blocks', () => {
            const tests = [
                'Tablero eléctrico',
                'Enchufe 10A',
                'Interruptor simple',
                'Tomacorriente doble'
            ];

            for (const desc of tests) {
                const result = classifyExcelSubtype(desc, 'BLOCK');
                expect(result.subtype).toBe('electrical');
                expect(result.confidence).toBeGreaterThan(0.7);
            }
        });

        it('should classify plumbing blocks', () => {
            const tests = [
                'Lavatorio de loza',
                'Inodoro con estanque',
                'Ducha cromada',
                'Llave mezcladora'
            ];

            for (const desc of tests) {
                const result = classifyExcelSubtype(desc, 'BLOCK');
                expect(result.subtype).toBe('plumbing');
                expect(result.confidence).toBeGreaterThan(0.7);
            }
        });

        it('should classify HVAC blocks', () => {
            const tests = [
                'Rejilla de ventilación',
                'Difusor circular',
                'Aire acondicionado split'
            ];

            for (const desc of tests) {
                const result = classifyExcelSubtype(desc, 'BLOCK');
                expect(result.subtype).toBe('hvac');
                expect(result.confidence).toBeGreaterThan(0.7);
            }
        });

        it('should classify fixture blocks', () => {
            const tests = [
                'Luminaria LED',
                'Lámpara decorativa',
                'Downlight empotrado'
            ];

            for (const desc of tests) {
                const result = classifyExcelSubtype(desc, 'BLOCK');
                expect(result.subtype).toBe('fixture');
                expect(result.confidence).toBeGreaterThan(0.7);
            }
        });
    });

    describe('Helper Functions', () => {
        it('should get correct subtype category', () => {
            expect(getSubtypeCategory('floor_area')).toBe('area');
            expect(getSubtypeCategory('wall_length')).toBe('length');
            expect(getSubtypeCategory('electrical')).toBe('block');
        });

        it('should get human-readable labels', () => {
            expect(getSubtypeLabel('floor_area')).toBe('Área de Piso');
            expect(getSubtypeLabel('wall_area')).toBe('Área de Muro');
            expect(getSubtypeLabel('electrical')).toBe('Eléctrico');
        });
    });

    describe('Confidence Scoring', () => {
        it('should have higher confidence for exact matches', () => {
            const exact = classifyExcelSubtype('Piso', 'AREA');
            const partial = classifyExcelSubtype('Piso cerámico de alta resistencia', 'AREA');

            expect(exact.confidence).toBeGreaterThanOrEqual(partial.confidence);
        });

        it('should provide alternative subtypes for ambiguous cases', () => {
            const result = classifyExcelSubtype('Revestimiento', 'AREA');

            if (result.alternative_subtypes) {
                expect(result.alternative_subtypes.length).toBeGreaterThan(0);
                expect(result.alternative_subtypes[0].confidence).toBeLessThan(result.confidence);
            }
        });
    });
});
