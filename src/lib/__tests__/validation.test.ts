// Example test for validation utility
import { validateSourceItems, validatePriceSources, SourceItemSchema, PriceSourceSchema } from '../validation';

describe('Validation Utility', () => {
    describe('validateSourceItems', () => {
        it('should validate correct source items', () => {
            const validData = [
                {
                    id: '123e4567-e89b-12d3-a456-426614174000',
                    type: 'block',
                    value_m: 10.5,
                    evidence: 'INSERT entity',
                    name_raw: 'Test Block',
                    unit_raw: 'u',
                    layer_raw: 'LAYER1',
                    value_raw: 10.5,
                    layer_normalized: 'layer1'
                }
            ];

            const result = validateSourceItems(validData);

            expect(result).not.toBeNull();
            expect(result).toHaveLength(1);
            expect(result![0].type).toBe('block');
        });

        it('should return null for invalid source items', () => {
            const invalidData = [
                {
                    id: 'invalid-uuid',
                    type: 'invalid-type',
                    value_m: -5, // negative value
                }
            ];

            const result = validateSourceItems(invalidData);

            expect(result).toBeNull();
        });

        it('should return null for non-array input', () => {
            const result = validateSourceItems('not an array');

            expect(result).toBeNull();
        });
    });

    describe('validatePriceSources', () => {
        it('should validate correct price sources', () => {
            const validData = [
                {
                    url: 'https://example.com/product',
                    price: 1500,
                    title: 'Test Product',
                    vendor: 'Test Vendor'
                }
            ];

            const result = validatePriceSources(validData);

            expect(result).not.toBeNull();
            expect(result).toHaveLength(1);
            expect(result![0].price).toBe(1500);
        });

        it('should return null for invalid URLs', () => {
            const invalidData = [
                {
                    url: 'not-a-url',
                    price: 1500,
                    title: 'Test Product',
                    vendor: 'Test Vendor'
                }
            ];

            const result = validatePriceSources(invalidData);

            expect(result).toBeNull();
        });

        it('should return null for negative prices', () => {
            const invalidData = [
                {
                    url: 'https://example.com/product',
                    price: -100,
                    title: 'Test Product',
                    vendor: 'Test Vendor'
                }
            ];

            const result = validatePriceSources(invalidData);

            expect(result).toBeNull();
        });
    });
});
