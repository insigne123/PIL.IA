'use server';

/**
 * @fileOverview This file defines a Genkit flow to analyze tender documents and identify potential risks.
 *
 * It exports:
 * - `identifyRisks` - An async function to trigger the risk identification flow.
 * - `IdentifyRisksInput` - The input type for the identifyRisks function.
 * - `IdentifyRisksOutput` - The output type for the identifyRisks function.
 */

import {ai} from '@/ai/genkit';
import {z} from 'genkit';

const IdentifyRisksInputSchema = z.object({
  tenderDocumentDataUri: z
    .string()
    .describe(
      "A tender document, as a data URI that must include a MIME type and use Base64 encoding. Expected format: 'data:<mimetype>;base64,<encoded_data>'."
    ),
});
export type IdentifyRisksInput = z.infer<typeof IdentifyRisksInputSchema>;

const IdentifyRisksOutputSchema = z.object({
  risks:
    z
      .array(z.string())
      .describe('A list of potential risks identified in the tender document.'),
});
export type IdentifyRisksOutput = z.infer<typeof IdentifyRisksOutputSchema>;

export async function identifyRisks(input: IdentifyRisksInput): Promise<IdentifyRisksOutput> {
  return identifyRisksFlow(input);
}

const identifyRisksPrompt = ai.definePrompt({
  name: 'identifyRisksPrompt',
  input: {schema: IdentifyRisksInputSchema},
  output: {schema: IdentifyRisksOutputSchema},
  prompt: `You are an AI assistant specialized in analyzing tender documents and identifying potential risks.

  Analyze the following tender document and identify any potential risks related to inconsistent deadlines, non-compliant formats, or any other factors that could negatively impact the chances of winning the bid.

  Tender Document: {{media url=tenderDocumentDataUri}}

  Provide a list of potential risks. Be specific about the risk and where it can be found in the document. Focus on risks related to deadlines and compliance.
  `,
});

const identifyRisksFlow = ai.defineFlow(
  {
    name: 'identifyRisksFlow',
    inputSchema: IdentifyRisksInputSchema,
    outputSchema: IdentifyRisksOutputSchema,
  },
  async input => {
    const {output} = await identifyRisksPrompt(input);
    return output!;
  }
);
