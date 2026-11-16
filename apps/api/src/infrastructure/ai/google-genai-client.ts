import { GoogleGenAI } from '@google/genai';
import type { GoogleVertexEnvSettings } from '../../config/ai-config';

/**
 * The Vertex AI client both Google adapters (models and transcription) call.
 * With a key file it signs in as that service account; without one (Cloud
 * Run, #5228) it signs in as the runtime's own identity through Application
 * Default Credentials.
 */
export function googleGenAiClient(
  settings: GoogleVertexEnvSettings,
): GoogleGenAI {
  return new GoogleGenAI({
    enterprise: true,
    project: settings.project,
    location: settings.location,
    googleAuthOptions: {
      ...(settings.credentials ? { credentials: settings.credentials } : {}),
      scopes: ['https://www.googleapis.com/auth/cloud-platform'],
    },
  });
}
