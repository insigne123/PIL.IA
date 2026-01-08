import { config } from 'dotenv';
config();

import '@/ai/flows/analyze-tender-and-suggest-actions.ts';
import '@/ai/flows/answer-questions-about-tender.ts';
import '@/ai/flows/generate-tender-matrix-from-upload.ts';
import '@/ai/flows/identify-risks-from-tender-documents.ts';