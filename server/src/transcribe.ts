import fs from 'node:fs';

export type RawSegment = { start: number; end: number; text: string };
export type RawTranscript = { language: string; duration: number; segments: RawSegment[] };

/** Transcribes via OpenAI's Whisper API (verbose_json gives per-segment timestamps). */
export async function transcribe(audioPath: string): Promise<RawTranscript> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY is not set — cannot transcribe.');

  const form = new FormData();
  form.append('file', new Blob([fs.readFileSync(audioPath)]), 'audio.mp3');
  form.append('model', 'whisper-1');
  form.append('response_format', 'verbose_json');
  form.append('timestamp_granularities[]', 'segment');

  const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });

  if (!res.ok) throw new Error(`OpenAI transcription ${res.status}: ${await res.text()}`);
  const json: any = await res.json();

  return {
    language: json.language,
    duration: json.duration,
    segments: (json.segments ?? []).map((s: any) => ({
      start: s.start,
      end: s.end,
      text: String(s.text).trim(),
    })),
  };
}
