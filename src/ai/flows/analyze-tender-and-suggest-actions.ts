'use server';
/**
 * @fileOverview Analyzes tender documents and suggests the next best action.
 *
 * - analyzeTenderAndSuggestActions - A function that analyzes tender documents and suggests actions.
 * - AnalyzeTenderAndSuggestActionsInput - The input type for the analyzeTenderAndSuggestActions function.
 * - AnalyzeTenderAndSuggestActionsOutput - The return type for the analyzeTenderAndSuggestActions function.
 */

import {ai} from '@/ai/genkit';
import {z} from 'genkit';

const AnalyzeTenderAndSuggestActionsInputSchema = z.object({
  tenderDocuments: z.string().describe('The tender documents to analyze.'),
});
export type AnalyzeTenderAndSuggestActionsInput = z.infer<typeof AnalyzeTenderAndSuggestActionsInputSchema>;

const AnalyzeTenderAndSuggestActionsOutputSchema = z.object({
  suggestedAction: z.string().describe('The suggested next best action.'),
  reason: z.string().describe('The reason for the suggested action.'),
});
export type AnalyzeTenderAndSuggestActionsOutput = z.infer<typeof AnalyzeTenderAndSuggestActionsOutputSchema>;

export async function analyzeTenderAndSuggestActions(input: AnalyzeTenderAndSuggestActionsInput): Promise<AnalyzeTenderAndSuggestActionsOutput> {
  return analyzeTenderAndSuggestActionsFlow(input);
}

const prompt = ai.definePrompt({
  name: 'analyzeTenderAndSuggestActionsPrompt',
  input: {schema: AnalyzeTenderAndSuggestActionsInputSchema},
  output: {schema: AnalyzeTenderAndSuggestActionsOutputSchema},
  prompt: `You are an AI Copilot designed to analyze tender documents and suggest the next best action to streamline the bidding process.\n
  Analyze the following tender documents:\n  {{{tenderDocuments}}}\n
  Based on the analysis, suggest the next best action and provide a reason for the suggestion. The suggested action should be a concrete next step, such as generating a compliance matrix or identifying key risks.\n
  Format your response as:\n  {{"suggestedAction": "the suggested action", "reason": "the reason for the suggested action"}}`,
});

const analyzeTenderAndSuggestActionsFlow = ai.defineFlow(
  {
    name: 'analyzeTenderAndSuggestActionsFlow',
    inputSchema: AnalyzeTenderAndSuggestActionsInputSchema,
    outputSchema: AnalyzeTenderAndSuggestActionsOutputSchema,
  },
  async input => {
    const {output} = await prompt(input);
    return output!;
  }
);
