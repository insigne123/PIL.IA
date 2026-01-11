// Example test for database types
import { isSourceItem, isPriceSource } from '../database';

describe('Database Type Guards', () => {
    describe('isSourceItem', () => {
        it('should return true for valid source item', () => {
            const validItem = {
                id: '123e4567-e89b-12d3-a456-426614174000',
                type: 'block',
                value_m: 10.5,
                evidence: 'INSERT entity',
                name_raw: 'Test',
                unit_raw: 'u',
                layer_raw: 'LAYER1',
                value_raw: 10.5,
                layer_normalized: 'layer1'
            };

            expect(isSourceItem(validItem)).toBe(true);
        });

        it('should return false for invalid type', () => {
            const invalidItem = {
                id: '123',
                type: 'invalid',
                value_m: 10.5
            };

            expect(isSourceItem(invalidItem)).toBe(false);
        });

        it('should return false for null', () => {
            expect(isSourceItem(null)).toBe(false);
        });

        it('should return false for undefined', () => {
            expect(isSourceItem(undefined)).toBe(false);
        });
    });

    describe('isPriceSource', () => {
        it('should return true for valid price source', () => {
            const validSource = {
                url: 'https://example.com',
                price: 1500,
                title: 'Product',
                vendor: 'Vendor'
            };

            expect(isPriceSource(validSource)).toBe(true);
        });

        it('should return false for missing fields', () => {
            const invalidSource = {
                url: 'https://example.com',
                price: 1500
                // missing title and vendor
            };

            expect(isPriceSource(invalidSource)).toBe(false);
        });

        it('should return false for wrong types', () => {
            const invalidSource = {
                url: 'https://example.com',
                price: 'not a number',
                title: 'Product',
                vendor: 'Vendor'
            };

            expect(isPriceSource(invalidSource)).toBe(false);
        });
    });
});
