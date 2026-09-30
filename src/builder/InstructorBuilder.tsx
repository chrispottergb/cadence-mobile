import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useRef, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSession } from '@/auth/session';
import { listPlayable, type PlayableTrack } from '@/audiolab/assets';
import { listMyGyms } from '@/data/gyms';
import { advanceGeneration, musicComplete, type ClassGeneration } from '@/music/classGeneration';
import { fetchCapabilities, describeError, type Capabilities } from '@/music/client';
import { dur, roundsSeconds, type GuidedPlan, type CueWhen } from '@/soundtrack/guided';
import { defaultInstructorSettings, fillFromLibrary, proposeClass, PURPOSES, setupError, VOCALS, type InstructorSettings, type Instruction } from '@/soundtrack/instructor';
import { newId } from '@/soundtrack/model';
import { Button, Card, Field, Screen, space, Text } from '@/ui';
import { Chip, ChipRow } from './parts';
import { GuidedBuilder } from './GuidedBuilder';

type Draft = { version: 1; settings: InstructorSettings; generation?: ClassGeneration; preview?: GuidedPlan };
const STEPS = ['My class', 'Timing', 'Cues', 'Music'];

export function InstructorBuilder() {
  const { session } = useSession();
  const [gymId, setGymId] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => { let live = true; void listMyGyms().then(g => { if (live) { setGymId(g.gyms[0]?.id ?? null); setLoaded(true); } }); return () => { live = false; }; }, [session?.user.id]);
  if (!loaded) return <Screen><Text>Loading your class builder…</Text></Screen>;
  if (!gymId || !session) return <Screen><Text>Sign in and join a gym as staff to create a class.</Text></Screen>;
  return <Setup key={`${session.user.id}:${gymId}`} storageKey={`instructor-class:v1:${session.user.id}:${gymId}`} gymId={gymId} />;
}

function Setup({ storageKey, gymId }: { storageKey: string; gymId: string }) {
  const router = useRouter();
  const [draft, setDraft] = useState<Draft>({ version: 1, settings: defaultInstructorSettings() });
  const draftRef = useRef(draft);
  const [ready, setReady] = useState(false);
  const [step, setStep] = useState(0);
  const [library, setLibrary] = useState<PlayableTrack[]>([]);
  const [caps, setCaps] = useState<Capabilities | null>(null);
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const running = useRef(false);
  const mounted = useRef(true);
  const writes = useRef<Promise<void>>(Promise.resolve());
  useEffect(() => {
    mounted.current = true;
    void Promise.all([AsyncStorage.getItem(storageKey), listPlayable()]).then(([stored, tracks]) => {
      if (!mounted.current) return;
      if (stored) {
        const value = JSON.parse(stored) as Draft;
        if (value.version !== 1 || !value.settings || !Array.isArray(value.settings.instructions) || !Array.isArray(value.settings.selectedTracks)) throw new Error('The saved draft could not be opened.');
        draftRef.current = value; setDraft(value);
        if (value.generation) setStep(3);
      }
      setLibrary(tracks.filter(t => t.demo === undefined));
    }).catch(e => { if (mounted.current) setStatus(e instanceof Error ? e.message : 'Could not restore draft.'); })
      .finally(() => { if (mounted.current) setReady(true); });
    void fetchCapabilities().then(r => { if (mounted.current) { if (r.ok) setCaps(r.data); } });
    return () => { mounted.current = false; running.current = false; };
  }, [storageKey]);

  const store = async (next: Draft) => {
    draftRef.current = next;
    if (mounted.current) setDraft(next);
    // Serialize writes so an older UI update cannot overwrite a durable request intent.
    const write = writes.current.catch(() => undefined).then(() => AsyncStorage.setItem(storageKey, JSON.stringify(next)));
    writes.current = write;
    await write;
  };
  const update = (patch: Partial<InstructorSettings>) => {
    const next = { ...draftRef.current, settings: { ...draftRef.current.settings, ...patch } };
    draftRef.current = next; setDraft(next);
    void store(next).catch(() => setStatus('Draft could not be saved on this device.'));
  };
  const s = draft.settings;
  const instruction = (id: string, patch: Partial<Instruction>) => update({ instructions: s.instructions.map(i => i.id === id ? { ...i, ...patch } : i) });
  const showPreview = async (plan: GuidedPlan) => { await store({ ...draftRef.current, preview: plan }); };
  const build = async () => {
    if (running.current) return;
    const error = setupError(s);
    if (error) { setStatus(error); return; }
    running.current = true; setBusy(true); setStatus('');
    try {
      if (s.source === 'library') {
        const selected = s.selectedTracks.map(id => library.find(t => t.trackId === id)).filter((t): t is PlayableTrack => !!t);
        if (!selected.length) throw new Error('Choose at least one track from your library.');
        await showPreview(fillFromLibrary(proposeClass(s), selected, s.repeatMusic));
        return;
      }
      let capabilities = caps;
      if (!capabilities) { const r = await fetchCapabilities(); if (!r.ok) throw new Error(describeError(r.error)); capabilities = r.data; setCaps(r.data); }
      let generation = draftRef.current.generation ?? { plan: proposeClass(s), tracks: [], requests: 0 };
      await store({ ...draftRef.current, generation });
      while (mounted.current && running.current && !musicComplete(generation.plan) && !generation.failure) {
        setStatus(`Creating music · ${generation.tracks.length} tracks ready. You can leave and resume later.`);
        generation = await advanceGeneration(generation, s, capabilities, gymId, async next => { await store({ ...draftRef.current, generation: next }); });
        if (generation.pending && !generation.failure) await new Promise(resolve => setTimeout(resolve, 2500));
      }
      if (mounted.current && musicComplete(generation.plan)) await showPreview(generation.plan);
      else if (generation.failure && mounted.current) setStatus(generation.failure);
    } catch (e) { if (mounted.current) setStatus(e instanceof Error ? e.message : 'Could not create class. Your completed music is kept.'); }
    finally { running.current = false; if (mounted.current) setBusy(false); }
  };

  if (!ready) return <Screen><Text>Restoring your draft…</Text></Screen>;
  if (draft.preview) return <GuidedBuilder initialPlan={draft.preview} initialName={s.name || `${s.purpose === 'Custom' ? s.customPurpose : s.purpose} · ${s.minutes} min`}
    initialLibrary={[...library, ...(draft.generation?.tracks ?? [])]} onSaved={async () => { await writes.current; await AsyncStorage.removeItem(storageKey); }} />;

  const frozen = !!draft.generation;
  return <Screen><ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: space.md, paddingBottom: space.xxl }}>
    <Button title="‹ Classes" variant="ghost" onPress={() => router.back()} />
    <Text variant="display">Create your class</Text>
    <Text muted>{step + 1} of 4 · {STEPS[step]}</Text>
    {frozen ? <Card><Text>Your music request and completed tracks are saved. Resume here, or continue to the editor with what is ready.</Text></Card> : <>
      {step === 0 ? <>
        <Text variant="title">What are you teaching?</Text>
        <Field accessibilityLabel="Class name" testID="ic-name" placeholder="Class name (optional)" value={s.name} maxLength={80} onChangeText={name => update({ name })} />
        <Text>Class length</Text><ChipRow>{[30, 45, 60, 90].map(minutes => <Chip key={minutes} label={`${minutes} min`} selected={s.minutes === minutes} onPress={() => update({ minutes })} />)}</ChipRow>
        <NumberField label="Class length in minutes" value={s.minutes} onChange={minutes => update({ minutes })} />
        <Text>Class purpose</Text><ChipRow>{PURPOSES.map(purpose => <Chip key={purpose} label={purpose} selected={s.purpose === purpose} onPress={() => update({ purpose })} />)}</ChipRow>
        {s.purpose === 'Custom' ? <Field accessibilityLabel="Class purpose" placeholder="What should this class achieve?" value={s.customPurpose} maxLength={140} onChangeText={customPurpose => update({ customPurpose })} /> : null}
        <Text muted>We’ll propose warm-up, main work, and cooldown. You can adjust the sections in Preview.</Text>
        <NumberField label="Warm-up minutes" value={s.warmup} onChange={warmup => update({ warmup })} />
        <NumberField label="Cooldown minutes" value={s.cooldown} onChange={cooldown => update({ cooldown })} />
      </> : null}
      {step === 1 ? <>
        <Text variant="title">Does the main work use timed rounds?</Text>
        <Choice value={s.timed} onChange={timed => update({ timed })} yes="Timed rounds" no="Continuous practice" />
        <Text muted>Main work: {Math.max(0, s.minutes - s.warmup - s.cooldown)} minutes.</Text>
        {s.timed ? <>
          <NumberField label="Work seconds per round" value={s.workSeconds} onChange={workSeconds => update({ workSeconds })} />
          <NumberField label="Rest seconds between rounds" value={s.restSeconds} onChange={restSeconds => update({ restSeconds })} />
          <NumberField label="Number of rounds" value={s.rounds} onChange={rounds => update({ rounds })} />
          <Text>{dur(roundsSeconds({ count: s.rounds, workSeconds: s.workSeconds, restSeconds: s.restSeconds }))} of rounds and rest. No rest after the final round.</Text>
          <Text muted>{dur(Math.max(0, (s.minutes - s.warmup - s.cooldown) * 60 - roundsSeconds({ count: s.rounds, workSeconds: s.workSeconds, restSeconds: s.restSeconds })))} of continuous practice follows the rounds.</Text>
        </> : null}
      </> : null}
      {step === 2 ? <>
        <Text variant="title">What should the class hear?</Text>
        <Choice value={s.cuesEnabled} onChange={cuesEnabled => update({ cuesEnabled })} yes="Music with cues" no="Music only" />
        {s.cuesEnabled ? <>
          {s.timed ? <><Text>Announce round starts and sound the bell at the end?</Text><Choice value={s.roundCues} onChange={roundCues => update({ roundCues })} /></> : null}
          <Text muted>Spoken instructions play over quieter music. They are separate from song lyrics.</Text>
          {s.instructions.map((i, index) => <Card key={i.id} style={{ gap: space.sm }}>
            <Text variant="title">Cue {index + 1}</Text>
            <ChipRow>{(['speech', 'bell', 'switch', 'thirty'] as const).map(sound => <Chip key={sound} label={{ speech: 'Speak my text', bell: 'Bell', switch: 'Switch partners', thirty: '30 seconds' }[sound]} selected={i.sound === sound} onPress={() => instruction(i.id, { sound })} />)}</ChipRow>
            {i.sound === 'speech' ? <Field accessibilityLabel={`Spoken instruction ${index + 1}`} placeholder="e.g. Switch partners and reset" value={i.text} multiline maxLength={240} onChangeText={text => instruction(i.id, { text })} /> : null}
            <Text>Where?</Text><ChipRow>{(['class', ...(s.warmup ? ['warmup' as const] : []), 'main', ...(s.cooldown ? ['cooldown' as const] : [])] as const).map(scope => <Chip key={scope} label={{ class: 'Whole class', warmup: 'Warm-up', main: 'Main work', cooldown: 'Cooldown' }[scope]} selected={i.scope === scope} onPress={() => instruction(i.id, { scope, when: { at: 'every', seconds: 120 } })} />)}</ChipRow>
            <Text>When?</Text><ChipRow>{(['every', 'once', 'section_start', 'before_section_end', ...(s.timed && i.scope === 'main' ? ['every_round' as const, 'round_start' as const, 'before_round_end' as const] : [])] as const).map(at => <Chip key={at} label={{ every: 'At intervals', once: 'At one time', section_start: 'At the start', before_section_end: 'Before the end', every_round: 'During each work round', round_start: 'Each round start', before_round_end: 'Before each round ends' }[at]} selected={i.when.at === at} onPress={() => instruction(i.id, { when: ['every', 'every_round', 'once', 'before_section_end', 'before_round_end'].includes(at) ? { at, seconds: 30 } as CueWhen : { at } as CueWhen })} />)}</ChipRow>
            {'seconds' in i.when ? <NumberField label={i.when.at === 'every' || i.when.at === 'every_round' ? 'Repeat every (seconds)' : i.when.at.startsWith('before') ? 'Seconds before the end' : 'Seconds after the start'} value={i.when.seconds} onChange={seconds => instruction(i.id, { when: { ...i.when, seconds } as CueWhen })} /> : null}
            <Button title="Remove cue" variant="ghost" onPress={() => update({ instructions: s.instructions.filter(x => x.id !== i.id) })} />
          </Card>)}
          <Button title="Add a cue or spoken instruction" variant="secondary" onPress={() => update({ instructions: [...s.instructions, { id: newId('instruction'), text: '', sound: 'speech', scope: 'main', when: { at: 'every', seconds: 120 } }] })} />
        </> : <Text muted>Your cue settings are kept. You can turn them back on in Preview.</Text>}
      </> : null}
      {step === 3 ? <>
        <Text variant="title">Choose the music</Text>
        <ChipRow><Chip label="Use my library" selected={s.source === 'library'} onPress={() => update({ source: 'library' })} /><Chip label="Generate new music" selected={s.source === 'generate'} onPress={() => update({ source: 'generate' })} /></ChipRow>
        {s.source === 'generate' ? <>
          <Field accessibilityLabel="Music style" placeholder="Music style, e.g. ambient, house, hip-hop" value={s.genre} maxLength={140} onChangeText={genre => update({ genre })} />
          <Field accessibilityLabel="Target BPM" placeholder="BPM · choose for me" keyboardType="number-pad" value={s.bpm} onChangeText={bpm => update({ bpm })} />
          <Text>Vocals</Text><ChipRow>{VOCALS.map(vocals => <Chip key={vocals} label={vocals === 'Instrumental' ? 'Instrumental · no lyrics' : vocals} selected={s.vocals === vocals} onPress={() => update({ vocals })} />)}</ChipRow>
          {s.vocals !== 'Instrumental' ? <Field accessibilityLabel="Optional song lyrics" placeholder="Song lyrics (optional). Leave empty for generated lyrics." multiline maxLength={caps?.customLyrics.maxChars ?? 3000} value={s.lyrics} onChangeText={lyrics => update({ lyrics })} /> : null}
          <Text muted>Style and BPM guide generation; listen to Preview to confirm the result. Music generation uses your gym’s allowance and may take several minutes. This service does not report your remaining allowance here.</Text>
        </> : <>
          <Text muted>Tap tracks in the order you want. Style and vocals come from the tracks you select.</Text>
          {!library.length ? <Text>No library music is available. Choose Generate new music.</Text> : null}
          {library.map(t => <Chip key={t.trackId} label={`${s.selectedTracks.includes(t.trackId) ? `${s.selectedTracks.indexOf(t.trackId) + 1}. ` : ''}${t.title} · ${dur(t.durationSeconds)}`} selected={s.selectedTracks.includes(t.trackId)} onPress={() => update({ selectedTracks: s.selectedTracks.includes(t.trackId) ? s.selectedTracks.filter(id => id !== t.trackId) : [...s.selectedTracks, t.trackId] })} />)}
        </>}
        <Text>May tracks repeat to fill the class?</Text><Choice value={s.repeatMusic} onChange={repeatMusic => update({ repeatMusic })} yes="Allow repeats" no="Use different tracks" />
        <Text muted>{s.repeatMusic ? 'Tracks may repeat. Each section ends on time.' : s.source === 'generate' ? 'We’ll request more music until each section is filled, up to 40 requests.' : 'Any unfilled time will be shown as quiet in Preview.'}</Text>
      </> : null}
    </>}
    {status ? <Text accessibilityLiveRegion="polite">{status}</Text> : null}
    {step < 3 ? <Button testID="ic-next" title="Continue" onPress={() => { const error = setupError(s); if (error) setStatus(error); else { setStatus(''); setStep(step + 1); } }} /> : <Button testID="ic-build" title={frozen ? 'Resume music generation' : s.source === 'generate' ? 'Generate my class music' : 'Build my class'} loading={busy} disabled={!!draft.generation?.failure} onPress={() => void build()} />}
    {frozen && !busy ? <Button title="Keep completed music and open Preview" variant="secondary" onPress={() => void showPreview(draft.generation!.plan).catch(() => setStatus('Could not save draft.'))} /> : null}
    {busy ? <Button title="Pause after current request" variant="secondary" onPress={() => { running.current = false; setStatus('Pausing. Your request and completed tracks will be kept.'); }} /> : null}
    {step > 0 && !frozen ? <Button title="Back" variant="ghost" onPress={() => { setStatus(''); setStep(step - 1); }} /> : null}
  </ScrollView></Screen>;
}

function Choice({ value, onChange, yes = 'Yes', no = 'No' }: { value: boolean; onChange: (value: boolean) => void; yes?: string; no?: string }) {
  return <ChipRow><Chip label={yes} selected={value} onPress={() => onChange(true)} /><Chip label={no} selected={!value} onPress={() => onChange(false)} /></ChipRow>;
}
function NumberField({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) {
  return <View style={{ gap: space.xs }}><Text>{label}</Text><Field accessibilityLabel={label} value={value === 0 ? '' : String(value)} keyboardType="number-pad" placeholder="0" maxLength={5} onChangeText={text => onChange(Number(text))} /></View>;
}
