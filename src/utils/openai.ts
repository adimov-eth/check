import { readFile } from 'fs/promises';
import OpenAI from 'openai';
import { config } from '../config';
import { logger } from './logger';

const openai = new OpenAI({ apiKey: config.openaiApiKey });

// Get MIME type from file extension
const getMimeType = (extension: string): string => {
  const mimeTypes: Record<string, string> = {
    mp3: 'audio/mpeg',
    mp4: 'audio/mp4',
    m4a: 'audio/mp4',
    wav: 'audio/wav',
    ogg: 'audio/ogg',
    webm: 'audio/webm',
    flac: 'audio/flac',
  };
  
  return mimeTypes[extension] || `audio/${extension}`;
};

// Transcribe audio file
export const transcribeAudio = async (filePath: string): Promise<string> => {
  try {
    logger.info(`Transcribing audio file: ${filePath}`);
    
    const fileBuffer = await readFile(filePath);
    const fileExtension = filePath.split('.').pop()?.toLowerCase() || 'webm';
    const fileName = `audio.${fileExtension}`;
    const mimeType = getMimeType(fileExtension);
    
    const file = new File([fileBuffer], fileName, { type: mimeType });
    
    const response = await openai.audio.transcriptions.create({
      file,
      model: 'gpt-4o-mini-transcribe',
    });
    
    logger.info(`Transcription completed: ${filePath}`);
    return response.text;
  } catch (error) {
    logger.error(`Transcription failed: ${error instanceof Error ? error.message : String(error)}`);
    throw error;
  }
};

// Generate GPT response
export const generateGptResponse = async (prompt: string): Promise<string> => {
  try {
    logger.info('Generating GPT response');
    
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.7,
      max_tokens: 1000,
    });
    
    logger.info('GPT response generated successfully');
    return response.choices[0].message.content || '';
  } catch (error) {
    logger.error(`GPT response generation failed: ${error instanceof Error ? error.message : String(error)}`);
    throw error;
  }
};