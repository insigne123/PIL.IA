import { runPreflight, hasBlockingIssues, getPreflightSummary } from '../preflight';

describe('Preflight Module', () => {
    describe('runPreflight', () => {
        it('should detect XREFs in DXF content', () => {
            const dxfWithXref = `
0
SECTION
2
HEADER
9
$INSUNITS
70
6
0
ENDSEC
0
SECTION
2
BLOCKS
0
BLOCK_RECORD
2
EXTERNAL_REF
70
16
0
ENDSEC
0
SECTION
2
ENTITIES
0
LINE
67
0
10
0.0
20
0.0
11
10.0
21
10.0
0
ENDSEC
0
EOF
`;

            const result = runPreflight(dxfWithXref);

            expect(result.hasXrefs).toBe(true);
            expect(result.xrefCount).toBeGreaterThan(0);
            expect(result.warnings.length).toBeGreaterThan(0);
            expect(result.recommendations.length).toBeGreaterThan(0);
        });

        it('should detect unit from $INSUNITS', () => {
            const dxfWithMeterUnit = `
0
SECTION
2
HEADER
9
$INSUNITS
70
6
0
ENDSEC
0
EOF
`;

            const result = runPreflight(dxfWithMeterUnit);
            expect(result.detectedUnit).toBe('m');
        });

        it('should calculate bounding box from entities', () => {
            const dxfWithGeometry = `
0
SECTION
2
ENTITIES
0
LINE
67
0
10
0.0
20
0.0
11
100.0
21
100.0
0
LINE
10
50.0
20
50.0
11
150.0
21
150.0
0
ENDSEC
0
EOF
`;

            const result = runPreflight(dxfWithGeometry);

            expect(result.boundingBox.minX).toBe(0);
            expect(result.boundingBox.minY).toBe(0);
            expect(result.boundingBox.maxX).toBe(150);
            expect(result.boundingBox.maxY).toBe(150);
            expect(result.boundingBox.diagonal).toBeGreaterThan(0);
        });

        it('should calculate dynamic minimum length based on bbox', () => {
            const dxfLarge = `
0
SECTION
2
ENTITIES
0
LINE
10
0.0
20
0.0
11
1000.0
21
1000.0
0
ENDSEC
0
EOF
`;

            const result = runPreflight(dxfLarge);

            // Dynamic min length should be 0.2% of diagonal
            const expectedMin = Math.max(0.5, result.boundingBox.diagonal * 0.002);
            expect(result.dynamicMinLength).toBeCloseTo(expectedMin, 3);
        });

        it('should count ModelSpace vs PaperSpace entities', () => {
            const dxfMixed = `
0
SECTION
2
ENTITIES
0
LINE
67
0
10
0.0
20
0.0
11
10.0
21
10.0
0
LINE
67
1
10
0.0
20
0.0
11
10.0
21
10.0
0
LINE
10
5.0
20
5.0
11
15.0
21
15.0
0
ENDSEC
0
EOF
`;

            const result = runPreflight(dxfMixed);

            expect(result.modelSpaceEntityCount).toBe(2); // Lines without 67=1
            expect(result.paperSpaceEntityCount).toBe(1); // Line with 67=1
        });

        it('should warn when PaperSpace has more entities than ModelSpace', () => {
            const dxfPaperHeavy = `
0
SECTION
2
ENTITIES
0
LINE
67
1
10
0.0
20
0.0
11
10.0
21
10.0
0
LINE
67
1
10
5.0
20
5.0
11
15.0
21
15.0
0
LINE
67
1
10
10.0
20
10.0
11
20.0
21
20.0
0
ENDSEC
0
EOF
`;

            const result = runPreflight(dxfPaperHeavy);

            expect(result.paperSpaceEntityCount).toBeGreaterThan(result.modelSpaceEntityCount);
            expect(result.warnings.some(w => w.includes('PaperSpace'))).toBe(true);
        });
    });

    describe('hasBlockingIssues', () => {
        it('should return true when XREFs exist and ModelSpace is empty', () => {
            const preflight = {
                hasXrefs: true,
                xrefCount: 2,
                xrefNames: ['REF1', 'REF2'],
                modelSpaceEntityCount: 5,
                paperSpaceEntityCount: 0,
                detectedUnit: 'm' as const,
                boundingBox: {
                    minX: 0, minY: 0, maxX: 100, maxY: 100,
                    width: 100, height: 100, diagonal: 141.42
                },
                warnings: [],
                recommendations: [],
                dynamicMinLength: 0.5,
                stats: { hatchCount: 0, polylineCount: 0, lineCount: 5, insertCount: 0, textCount: 0 },
                hasAreaCandidates: false,
                hasLengthCandidates: true,
                hasInserts: false
            };

            expect(hasBlockingIssues(preflight)).toBe(true);
        });

        it('should return true when ModelSpace has zero entities', () => {
            const preflight = {
                hasXrefs: false,
                xrefCount: 0,
                xrefNames: [],
                modelSpaceEntityCount: 0,
                paperSpaceEntityCount: 10,
                detectedUnit: 'm' as const,
                boundingBox: {
                    minX: 0, minY: 0, maxX: 0, maxY: 0,
                    width: 0, height: 0, diagonal: 0
                },
                warnings: [],
                recommendations: [],
                dynamicMinLength: 0.5,
                stats: { hatchCount: 0, polylineCount: 0, lineCount: 0, insertCount: 0, textCount: 10 },
                hasAreaCandidates: false,
                hasLengthCandidates: false,
                hasInserts: false
            };

            expect(hasBlockingIssues(preflight)).toBe(true);
        });

        it('should return false for valid DXF', () => {
            const preflight = {
                hasXrefs: false,
                xrefCount: 0,
                xrefNames: [],
                modelSpaceEntityCount: 100,
                paperSpaceEntityCount: 20,
                detectedUnit: 'm' as const,
                boundingBox: {
                    minX: 0, minY: 0, maxX: 100, maxY: 100,
                    width: 100, height: 100, diagonal: 141.42
                },
                warnings: [],
                recommendations: [],
                dynamicMinLength: 0.5,
                stats: { hatchCount: 50, polylineCount: 50, lineCount: 0, insertCount: 0, textCount: 0 },
                hasAreaCandidates: true,
                hasLengthCandidates: true,
                hasInserts: false
            };

            expect(hasBlockingIssues(preflight)).toBe(false);
        });
    });

    describe('getPreflightSummary', () => {
        it('should generate readable summary', () => {
            const preflight = {
                hasXrefs: true,
                xrefCount: 2,
                xrefNames: ['REF1'],
                modelSpaceEntityCount: 50,
                paperSpaceEntityCount: 10,
                detectedUnit: 'm' as const,
                boundingBox: {
                    minX: 0, minY: 0, maxX: 100, maxY: 100,
                    width: 100, height: 100, diagonal: 141.42
                },
                warnings: [],
                recommendations: [],
                dynamicMinLength: 0.783,
                stats: { hatchCount: 0, polylineCount: 0, lineCount: 50, insertCount: 0, textCount: 0 },
                hasAreaCandidates: false,
                hasLengthCandidates: true,
                hasInserts: false
            };

            const summary = getPreflightSummary(preflight);

            expect(summary).toContain('ModelSpace: 50');
            expect(summary).toContain('PaperSpace: 10');
            expect(summary).toContain('2 XREFs');
            expect(summary).toContain('Unidad: m');
            expect(summary).toContain('141.42m diagonal');
            expect(summary).toContain('0.783m');
        });
    });
});
