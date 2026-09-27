import * as Crypto from 'expo-crypto';
import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, ScrollView, Switch, View } from 'react-native';

import { listMyGyms } from '@/data/gyms';
import { useExperience } from '@/experience/store';
import {
  type Candidate,
  type Capabilities,
  createGeneration,
  describeError,
  fetchCapabilities,
  type GenerationJob,
  getGeneration,
  getPlaybackUrl,
  setLifecycle,
  TERMINAL,
} from '@/music/client';
import { clearActiveJob, loadActiveJob, saveActiveJob } from '@/music/activeJob';
import { estimateProgress, formatRemaining } from '@/music/progress';
import { Button, Card, colors, Field, Screen, space, Text } from '@/ui';

/**
 * DEVELOPMENT generator. Exercises the real pipeline end to end: normalized
 * controls from the service's capabilities, one idempotency key per press,
 * status polling against OUR service, candidates A and B with preview and
 * select. Not the final Class Soundtrack Builder.
 */
const fmt = (s: number | null) => (s === null ? '--:--' : `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`);

export default function Generator() {
  const router = useRouter();
  const { selected } = useExperience();
  const [caps, setCaps] = useState<Capabilities | null>(null);
  const [gymId, setGymId] = useState<string | null>(null);
  const [description, setDescription] = useState('Driving, steady warmup for pad work');
  const [style, setStyle] = useState('electronic, driving');
  const [instrumental, setInstrumental] = useState(true);
  const [duration, setDuration] = useState('120');
  const [job, setJob] = useState<GenerationJob | null>(null);
  // Earlier generations stay on screen (and keep playing) while a new one runs.
  const [previous, setPrevious] = useState<GenerationJob[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const pressKey = useRef<string | null>(null);

  useEffect(() => {
    void fetchCapabilities().then((r) => (r.ok ? setCaps(r.data) : setError(describeError(r.error))));
    if (selected === 'instructor') void listMyGyms().then((r) => setGymId(r.gyms[0]?.id ?? null));
  }, [selected]);

  // Pick up a generation that was running when the user left or closed the app.
  useEffect(() => {
    void loadActiveJob().then((id) => {
      if (id) void getGeneration(id).then((r) => (r.ok ? setJob(r.data) : void clearActiveJob()));
    });
  }, []);

  // Poll OUR service until the job is terminal. Never the provider.
  useEffect(() => {
    if (!job) return;
    if (TERMINAL.includes(job.state)) {
      void clearActiveJob();
      return;
    }
    const t = setTimeout(() => {
      void getGeneration(job.id).then((r) => r.ok && setJob(r.data));
    }, 3000);
    return () => clearTimeout(t);
  }, [job]);

  // Refresh at once when the app comes back to the foreground.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active' && job && !TERMINAL.includes(job.state)) void getGeneration(job.id).then((r) => r.ok && setJob(r.data));
    });
    return () => sub.remove();
  }, [job]);

  const generate = useCallback(async () => {
    setBusy(true);
    setError(null);
    // One key per intent; a retry of the same press reuses it.
    pressKey.current ??= Crypto.randomUUID();
    const seconds = Number(duration);
    const r = await createGeneration(
      {
        mode: 'description',
        description,
        title: description.slice(0, 40),
        style: { tags: style.split(',').map((s) => s.trim()).filter(Boolean), exclude: [] },
        instrumental,
        ...(Number.isFinite(seconds) && seconds > 0 ? { targetDurationSeconds: Math.round(seconds) } : {}),
        subject: selected === 'instructor' && gymId ? { type: 'gym', gymId } : { type: 'profile' },
      },
      pressKey.current,
    );
    setBusy(false);
    if (r.ok) {
      if (job && job.id !== r.data.id) setPrevious((p) => [job, ...p.filter((x) => x.id !== job.id)].slice(0, 5));
      setJob(r.data);
      void saveActiveJob(r.data.id);
      pressKey.current = null; // the next press is a new intent
    } else if (r.error !== 'network') {
      pressKey.current = null; // definitive answer; a new press starts fresh
      setError(describeError(r.error));
    } else {
      setError(describeError(r.error)); // keep the key so "Generate" retries the same intent
    }
  }, [description, style, instrumental, duration, selected, gymId, job]);

  const onLifecycle = async (c: Candidate, l: 'selected' | 'unselected' | 'previewed') => {
    const r = await setLifecycle(c.id, l);
    if (!r.ok) return;
    if (job?.id === r.data.id) setJob(r.data);
    else setPrevious((p) => p.map((x) => (x.id === r.data.id ? r.data : x)));
  };

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ gap: space.md, paddingBottom: space.xxl }}>
        <Text variant="label" muted>
          Development
        </Text>
        <Text variant="display">Generator</Text>
        <Text muted>
          {selected === 'instructor' ? (gymId ? 'Class music: uses the gym allowance.' : 'No gym found; using your personal allowance.') : 'Personal music: uses your allowance.'}
        </Text>

        <Card style={{ gap: space.sm }}>
          <Text variant="label" muted>
            Describe the music
          </Text>
          <Field testID="gen-description" value={description} onChangeText={setDescription} multiline maxLength={caps?.descriptionMode.maxChars ?? 400} />
          {caps?.styleTags.supported ? (
            <>
              <Text variant="label" muted>
                Style (comma separated)
              </Text>
              <Field testID="gen-style" value={style} onChangeText={setStyle} />
            </>
          ) : null}
          {caps?.targetDuration.supported ? (
            <>
              <Text variant="label" muted>
                Target length, seconds ({caps.targetDuration.minSeconds}-{caps.targetDuration.maxSeconds})
              </Text>
              <Field testID="gen-duration" value={duration} onChangeText={setDuration} keyboardType="number-pad" />
            </>
          ) : null}
          {caps?.instrumental ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <Text>Instrumental</Text>
              <Switch testID="gen-instrumental" value={instrumental} onValueChange={setInstrumental} trackColor={{ true: colors.accent }} />
            </View>
          ) : null}
          <Button testID="gen-go" title="Generate" onPress={generate} loading={busy} disabled={!caps || !description.trim()} />
        </Card>

        {error ? <Text style={{ color: colors.danger }}>{error}</Text> : null}

        {[...(job ? [job] : []), ...previous].map((j) => (
          <Card key={j.id} style={{ gap: space.sm }}>
            {j.id === job?.id ? (
              <>
                <Text variant="label" muted>
                  Status
                </Text>
                <GenProgress job={j} />
              </>
            ) : (
              <Text variant="label" muted>
                Earlier
              </Text>
            )}
            {j.candidates.map((c) => (
              <CandidateRow key={c.id} c={c} onLifecycle={onLifecycle} />
            ))}
            {j.candidates.length === 0 && !TERMINAL.includes(j.state) ? <Text muted>Waiting for takes...</Text> : null}
          </Card>
        ))}

        <Button title="Back" variant="ghost" onPress={() => router.back()} />
      </ScrollView>
    </Screen>
  );
}

function GenProgress({ job }: { job: GenerationJob }) {
  const [now, setNow] = useState(() => Date.now());
  const done = TERMINAL.includes(job.state);
  useEffect(() => {
    if (done) return;
    const i = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(i);
  }, [done]);
  const p = estimateProgress(job, now);
  return (
    <View style={{ gap: space.xs }}>
      <Text testID="gen-state" variant="title">
        {p.label}
      </Text>
      <View style={{ height: 10, borderRadius: 5, backgroundColor: colors.border, overflow: 'hidden' }}>
        <View testID="gen-progress" style={{ width: `${Math.round(p.fraction * 100)}%`, height: '100%', backgroundColor: job.state === 'FAILED' ? colors.danger : colors.accent }} />
      </View>
      <Text muted>
        {fmt(p.elapsedSeconds)} elapsed{done ? '' : ` � ${formatRemaining(p)}`}
      </Text>
      {!done ? <Text muted>You can leave the app. The music keeps generating and will be here when you come back.</Text> : null}
    </View>
  );
}

function CandidateRow({ c, onLifecycle }: { c: Candidate; onLifecycle: (c: Candidate, l: 'selected' | 'unselected' | 'previewed') => void }) {
  const [url, setUrl] = useState<string | null>(null);
  const player = useAudioPlayer(url ? { uri: url } : null);
  const status = useAudioPlayerStatus(player);

  const toggle = async () => {
    if (!url) {
      const r = await getPlaybackUrl(c.id);
      if (!r.ok) return;
      setUrl(r.data.url);
      onLifecycle(c, 'previewed');
      return;
    }
    if (status.playing) player.pause();
    else player.play();
  };

  useEffect(() => {
    if (url && status.isLoaded && !status.playing && status.currentTime === 0) player.play();
    // Start playback once the freshly signed URL has loaded.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, status.isLoaded]);

  return (
    <View testID={`candidate-${c.label}`} style={{ borderTopWidth: 1, borderTopColor: colors.border, paddingTop: space.sm, gap: space.xs }}>
      <Text variant="title">
        Take {c.label}: {c.title ?? (c.status === 'failed' ? 'failed' : c.status)}
      </Text>
      <Text muted>
        {fmt(c.durationSeconds)} · {c.status} · {c.lifecycle}
      </Text>
      {c.playable ? (
        <View style={{ flexDirection: 'row', gap: space.sm }}>
          <View style={{ flex: 1 }}>
            <Button testID={`play-${c.label}`} title={status.playing ? 'Pause' : 'Play'} variant="secondary" onPress={toggle} />
          </View>
          <View style={{ flex: 1 }}>
            <Button
              testID={`select-${c.label}`}
              title={c.lifecycle === 'selected' ? 'Selected' : 'Select'}
              onPress={() => onLifecycle(c, c.lifecycle === 'selected' ? 'unselected' : 'selected')}
            />
          </View>
        </View>
      ) : null}
    </View>
  );
}
