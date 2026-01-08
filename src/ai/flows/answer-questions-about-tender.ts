'use server';

/**
 * @fileOverview A flow that answers questions about tender documents.
 *
 * - answerQuestionsAboutTender - A function that handles the question answering process.
 * - AnswerQuestionsAboutTenderInput - The input type for the answerQuestionsAboutTender function.
 * - AnswerQuestionsAboutTenderOutput - The return type for the answerQuestionsAboutTender function.
 */

import {ai} from '@/ai/genkit';
import {z} from 'genkit';

const AnswerQuestionsAboutTenderInputSchema = z.object({
  question: z.string().describe('The question to ask about the tender.'),
  tenderDocuments:
    z.string()
      .describe("The tender documents as a single string."),
});

export type AnswerQuestionsAboutTenderInput = z.infer<
  typeof AnswerQuestionsAboutTenderInputSchema
>;

const AnswerQuestionsAboutTenderOutputSchema = z.object({
  answer: z.string().describe('The answer to the question.'),
  citations: z.array(z.string()).describe('The sections of the document cited in the answer.'),
});

export type AnswerQuestionsAboutTenderOutput = z.infer<
  typeof AnswerQuestionsAboutTenderOutputSchema
>;

export async function answerQuestionsAboutTender(
  input: AnswerQuestionsAboutTenderInput
): Promise<AnswerQuestionsAboutTenderOutput> {
  return answerQuestionsAboutTenderFlow(input);
}

const prompt = ai.definePrompt({
  name: 'answerQuestionsAboutTenderPrompt',
  input: {schema: AnswerQuestionsAboutTenderInputSchema},
  output: {schema: AnswerQuestionsAboutTenderOutputSchema},
  prompt: `You are an AI assistant helping users understand tender documents.
  Answer the user's question using the provided tender documents, and cite the specific sections used to form your answer.

Tender Documents: {{{tenderDocuments}}}

Question: {{{question}}}

Answer:`,
});

const answerQuestionsAboutTenderFlow = ai.defineFlow(
  {
    name: 'answerQuestionsAboutTenderFlow',
    inputSchema: AnswerQuestionsAboutTenderInputSchema,
    outputSchema: AnswerQuestionsAboutTenderOutputSchema,
  },
  async input => {
    const {output} = await prompt(input);
    return output!;
  }
);
