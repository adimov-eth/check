#!/usr/bin/env bun
import { config } from '@/config';
import OpenAI from 'openai';

interface OpenAIError extends Error {
  status?: number;
  response?: {
    headers?: Record<string, string>;
    data?: unknown;
  };
}

const checkOpenAIQuota = async (): Promise<void> => {
  try {
    if (!config.openaiApiKey) {
      console.error('❌ OPENAI_API_KEY not configured');
      process.exit(1);
    }

    console.log('🔍 Checking OpenAI API status...\n');
    
    const openai = new OpenAI({
      apiKey: config.openaiApiKey,
    });

    // Try a minimal API call to check if the key works
    try {
      const models = await openai.models.list();
      console.log('✅ OpenAI API Key is valid');
      console.log(`📋 Available models: ${models.data.length}`);
      
      // Try a test transcription with a tiny audio file
      console.log('\n🎤 Testing Whisper API...');
      
      // Create a tiny test audio file (1 second of silence)
      const testAudio = Buffer.from([
        // WAV header for 1 second of silence at 8000Hz
        0x52, 0x49, 0x46, 0x46, 0x24, 0x1F, 0x00, 0x00, 0x57, 0x41, 0x56, 0x45,
        0x66, 0x6D, 0x74, 0x20, 0x10, 0x00, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00,
        0x40, 0x1F, 0x00, 0x00, 0x40, 0x1F, 0x00, 0x00, 0x01, 0x00, 0x08, 0x00,
        0x64, 0x61, 0x74, 0x61, 0x00, 0x1F, 0x00, 0x00,
        ...Array(8000).fill(0x80) // 8000 samples of silence
      ]);
      
      const file = new File([testAudio], 'test.wav', { type: 'audio/wav' });
      
      const transcription = await openai.audio.transcriptions.create({
        file,
        model: 'whisper-1',
      });
      
      console.log('✅ Whisper API is working');
      console.log(`📝 Test transcription result: "${transcription.text || '(empty)'}"`);
      
    } catch (error: unknown) {
      if (error instanceof Error && 'status' in error) {
        const apiError = error as OpenAIError;
        
        if (apiError.status === 429) {
          console.error('\n❌ OpenAI API Quota Exceeded!');
          console.error('💳 You have exceeded your current quota.');
          console.error('🔗 Please check your plan and billing: https://platform.openai.com/usage');
          
          if (apiError.response?.headers) {
            const retryAfter = apiError.response.headers['retry-after'];
            const rateLimitRemaining = apiError.response.headers['x-ratelimit-remaining'];
            const rateLimitReset = apiError.response.headers['x-ratelimit-reset'];
            
            if (retryAfter) {
              console.error(`⏰ Retry after: ${retryAfter} seconds`);
            }
            if (rateLimitRemaining !== undefined) {
              console.error(`📊 Rate limit remaining: ${rateLimitRemaining}`);
            }
            if (rateLimitReset) {
              const resetDate = new Date(parseInt(rateLimitReset) * 1000);
              console.error(`🔄 Rate limit resets at: ${resetDate.toLocaleString()}`);
            }
          }
        } else if (apiError.status === 401) {
          console.error('\n❌ Invalid OpenAI API Key');
          console.error('🔑 Please check your OPENAI_API_KEY environment variable');
        } else {
          console.error('\n❌ OpenAI API Error:', error.message);
          if (apiError.response?.data) {
            console.error('📋 Error details:', JSON.stringify(apiError.response.data, null, 2));
          }
        }
      } else {
        console.error('\n❌ Unexpected error:', error);
      }
      process.exit(1);
    }

    console.log('\n✅ OpenAI API is fully operational');
    console.log('\n💡 Tips:');
    console.log('- Check your usage at: https://platform.openai.com/usage');
    console.log('- Upgrade your plan at: https://platform.openai.com/settings/organization/billing');
    console.log('- Monitor rate limits in production logs');
    
  } catch (error) {
    console.error('❌ Unexpected error:', error);
    process.exit(1);
  }
};

// Run the check
checkOpenAIQuota().catch(console.error); 