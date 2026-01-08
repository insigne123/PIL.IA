'use server';
/**
 * @fileOverview Generates a compliance matrix from uploaded tender documents.
 *
 * - generateTenderMatrix - A function that handles the generation of the compliance matrix.
 * - GenerateTenderMatrixInput - The input type for the generateTenderMatrix function.
 * - GenerateTenderMatrixOutput - The return type for the generateTenderMatrix function.
 */

import {ai} from '@/ai/genkit';
import {z} from 'genkit';

const GenerateTenderMatrixInputSchema = z.object({
  tenderDocumentDataUri: z
    .string()
    .describe(
      "A tender document, as a data URI that must include a MIME type and use Base64 encoding. Expected format: 'data:<mimetype>;base64,<encoded_data>'."
    ),
});
export type GenerateTenderMatrixInput = z.infer<typeof GenerateTenderMatrixInputSchema>;

const GenerateTenderMatrixOutputSchema = z.object({
  complianceMatrix: z.string().describe('The generated compliance matrix in markdown format.'),
});
export type GenerateTenderMatrixOutput = z.infer<typeof GenerateTenderMatrixOutputSchema>;

export async function generateTenderMatrix(input: GenerateTenderMatrixInput): Promise<GenerateTenderMatrixOutput> {
  return generateTenderMatrixFlow(input);
}

const prompt = ai.definePrompt({
  name: 'generateTenderMatrixPrompt',
  input: {schema: GenerateTenderMatrixInputSchema},
  output: {schema: GenerateTenderMatrixOutputSchema},
  prompt: `You are an AI assistant specialized in analyzing tender documents and generating compliance matrices.

  Analyze the uploaded tender document and generate a compliance matrix in markdown format.
  The compliance matrix should identify key requirements and obligations from the document.

  Tender Document: {{media url=tenderDocumentDataUri}}
  `,
});

const generateTenderMatrixFlow = ai.defineFlow(
  {
    name: 'generateTenderMatrixFlow',
    inputSchema: GenerateTenderMatrixInputSchema,
    outputSchema: GenerateTenderMatrixOutputSchema,
  },
  async input => {
    const {output} = await prompt(input);
    return output!;
  }
);
