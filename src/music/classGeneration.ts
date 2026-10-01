import type { PlayableTrack } from '@/audiolab/assets';
import { layoutMusic, MIN_PIECE_SECONDS, type GuidedPlan } from '@/soundtrack/guided';
import { generationInput, type InstructorSettings } from '@/soundtrack/instructor';
import { newId } from '@/soundtrack/model';
import { createGeneration, describeError, getGeneration, TERMINAL, type Capabilities, type GenerateInput, type JobState } from './client';

export interface ClassGeneration {
  plan: GuidedPlan;
  tracks: PlayableTrack[];
  requests: number;
  pending?: { key: string; input: GenerateInput; sectionId: string; jobId?: string; state?: JobState; startedAt?: string; processing?: boolean };
  failure?: string;
}

export const musicComplete = (plan: GuidedPlan) => plan.sections.length > 0 && plan.sections.every(s => layoutMusic(s, s.minutes * 60).quietSeconds < MIN_PIECE_SECONDS);

/** One durable state transition. Persist intent BEFORE submitting any paid request.
 * A lost response is retried with the same key, including after an app restart.
 * Caller polls; leaving the screen never starts another request in the background.
 */
export async function advanceGeneration(state: ClassGeneration, settings: InstructorSettings, caps: Capabilities, gymId: string,
  save: (state: ClassGeneration) => Promise<void>): Promise<ClassGeneration> {
  if (state.failure || musicComplete(state.plan)) return state;
  let next = state;
  if (!next.pending) {
    if (next.requests >= 40) throw new Error('Generation paused after 40 requests. Keep the completed music and finish in the music editor.');
    const section = next.plan.sections.find(s => layoutMusic(s, s.minutes * 60).quietSeconds >= MIN_PIECE_SECONDS)!;
    next = { ...next, requests: next.requests + 1, pending: { key: newId('class-music'), sectionId: section.id, startedAt: new Date().toISOString(),
      input: generationInput(settings, section, layoutMusic(section, section.minutes * 60).quietSeconds, caps, gymId) } };
    await save(next);
  }
  const pending = next.pending!;
  await save(next);
  const result = pending.jobId ? await getGeneration(pending.jobId) : await createGeneration(pending.input, pending.key);
  if (!result.ok) throw new Error(describeError(result.error));
  const job = result.data;
  next = { ...next, pending: { ...pending, jobId: job.id, state: job.state,
    startedAt: job.createdAt ?? pending.startedAt ?? new Date().toISOString(),
    processing: job.candidates.some(c => c.status === 'processing' || c.status === 'ready') } };
  await save(next);
  if (!TERMINAL.includes(job.state)) return next;
  const tracks: PlayableTrack[] = job.candidates.filter(c => c.playable && c.status === 'ready' && Number.isFinite(c.durationSeconds) && c.durationSeconds! > 0)
    .map(c => ({ trackId: c.id, title: c.title ?? 'Class music', durationSeconds: c.durationSeconds!, jobId: job.id, label: c.label, ...(c.style ? { style: c.style } : {}) }));
  if (!tracks.length) {
    next = { ...next, failure: 'This music request did not produce a playable track. Completed music is kept. Finish with library music in the editor.' };
  } else {
    next = { ...next, pending: undefined, tracks: [...next.tracks, ...tracks], plan: { ...next.plan, sections: next.plan.sections.map(s => {
      if (s.id !== pending.sectionId) return s;
      const music = [...s.music];
      for (const t of tracks) {
        if (layoutMusic({ ...s, music }, s.minutes * 60).quietSeconds < MIN_PIECE_SECONDS) break;
        music.push({ assetId: t.trackId, label: t.title, durationSeconds: t.durationSeconds });
      }
      return { ...s, music, fill: settings.repeatMusic ? 'repeat' as const : 'quiet' as const };
    }) } };
  }
  await save(next);
  return next;
}
