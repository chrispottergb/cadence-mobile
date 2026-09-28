import { useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Platform, Pressable, ScrollView, Share, View } from 'react-native';
import * as Application from 'expo-application';
import * as Device from 'expo-device';

import { clearLabCache, cueSeconds, listPlayable, loadCueAssets, type PlayableTrack, resolveTrack } from '@/audiolab/assets';
import type { EngineSnapshot, LabEngine } from '@/audiolab/engine';
import { GraphEngine } from '@/audiolab/graphEngine';
import { clearLab, exportRun, getTest, hermesStats, jsHeapBytes, labEvents, logSize, record, setTest, subscribeLab, summarize } from '@/audiolab/metrics';
import { PlayerEngine } from '@/audiolab/playerEngine';
import { GUIDE, type GuideTest } from '@/audiolab/guide';
import { readPrevious, rotateOnOpen, saveCurrent } from '@/audiolab/persist';
import { type CueSpec, expandCues, formatClock, placeTracks, resolveCollisions, type TimelineTrack, totalDuration } from '@/audiolab/timeline';
import { Button, Card, colors, Screen, space, Text } from '@/ui';

/**
 * AUDIO LAB: Phase 3 Stage A engineering harness. Development builds only
 * (EXPO_PUBLIC_AUDIO_LAB=1). Not a product screen.
 */
export const AUDIO_LAB_ENABLED = process.env.EXPO_PUBLIC_AUDIO_LAB === '1';

type EngineName = 'graph' | 'player';
type Scenario = 'class3' | 'long30' | 'long45';

function buildScenario(s: Scenario, tracks: PlayableTrack[], crossfade: number) {
  const pick = (i: number) => tracks[i % tracks.length]!;
  let seq: PlayableTrack[];
  if (s === 'class3') seq = [pick(0), pick(1), pick(2)];
  else {
    const target = s === 'long30' ? 30 * 60 : 45 * 60;
    seq = [];
    let total = 0;
    for (let i = 0; total < target; i++) {
      seq.push(pick(i));
      total += pick(i).durationSeconds - (i ? crossfade : 0);
    }
  }
  const timeline: TimelineTrack[] = seq.map((t, i) => ({ trackId: t.trackId, sourceDurationSeconds: t.durationSeconds, crossfadeInSeconds: i ? crossfade : 0 }));
  const placed = placeTracks(timeline);
  const total = totalDuration(placed);
  const cue = (id: string, time: number, asset: Parameters<typeof cueSeconds>[0], priority: CueSpec['priority'], extra: Partial<CueSpec> = {}): CueSpec => ({
    id,
    timeSeconds: time,
    assetId: asset,
    assetDurationSeconds: cueSeconds(asset),
    priority,
    duckTo: 0.3,
    ...extra,
  });
  const specs: CueSpec[] =
    s === 'class3'
      ? [
          cue('start-bell', 2, 'bell', 'high'),
          cue('round', 4, 'round', 'high'),
          cue('switch', 15, 'switch', 'normal', { repeatEverySeconds: 15, repeatUntilSeconds: total - 5 }),
          // Deliberate collision: a low cue on top of a high one at 60 s.
          cue('bell-60', 60, 'bell', 'high'),
          cue('cheer-60', 60.3, 'switch', 'low'),
          cue('thirty', Math.max(5, total - 30), 'thirty', 'normal'),
          cue('stop', Math.max(6, total - 3), 'stop', 'high'),
        ]
      : [
          cue('round-bell', 0.5, 'bell', 'high', { repeatEverySeconds: 180, repeatUntilSeconds: total - 5 }),
          cue('switch', 90, 'switch', 'normal', { repeatEverySeconds: 180, repeatUntilSeconds: total - 5 }),
          cue('thirty', 150, 'thirty', 'normal', { repeatEverySeconds: 180, repeatUntilSeconds: total - 5 }),
          cue('stop', Math.max(6, total - 3), 'stop', 'high'),
        ];
  const resolved = resolveCollisions(expandCues(specs, total));
  return { placed, total, cues: resolved.play, dropped: resolved.dropped.length, deferred: resolved.deferred.length, seq };
}

function deviceInfo(engineName: string, test: string) {
  return {
    os: Platform.OS,
    osVersion: String(Platform.Version),
    model: Device.modelName ?? null,
    modelId: Device.modelId ?? null,
    physicalDevice: Device.isDevice ? 'yes' : 'no',
    build: Application.nativeBuildVersion ?? null,
    version: Application.nativeApplicationVersion ?? null,
    engine: engineName,
    test,
  };
}

export default function AudioLab() {
  const router = useRouter();
  const [engineName, setEngineName] = useState<EngineName>('player');
  const [advanced, setAdvanced] = useState(false);
  const [guide, setGuide] = useState<GuideTest | null>(null);
  const [verdict, setVerdict] = useState<string | null>(null);
  const [mode, setMode] = useState<'download' | 'stream'>('download');
  const [crossfade, setCrossfade] = useState(0);
  const [shortLinks, setShortLinks] = useState(false);
  const [test, setTestState] = useState(getTest());
  const [hasPrevious, setHasPrevious] = useState(false);
  // Memory A/B: lean logging stops the 5 s log save and slows the on-screen refresh.
  const [lean, setLean] = useState(false);
  const leanRef = useRef(false);
  const [tracks, setTracks] = useState<PlayableTrack[]>([]);
  const [info, setInfo] = useState<string>('');
  const [snap, setSnap] = useState<EngineSnapshot | null>(null);
  const engine = useRef<LabEngine | null>(null);
  const [totalSeconds, setTotalSeconds] = useState(0);
  const events = useSyncExternalStore(subscribeLab, labEvents, labEvents);

  // Crash-safe log: keep the last session's run, then save this one every 5 s.
  const infoRef = useRef({ engineName, test });
  useEffect(() => {
    infoRef.current = { engineName, test };
  }, [engineName, test]);
  useEffect(() => {
    leanRef.current = lean;
    record('lab', 'lean_logging', { on: lean });
  }, [lean]);
  useEffect(() => {
    void rotateOnOpen().then(setHasPrevious);
    const s = setInterval(() => {
      if (!leanRef.current) void saveCurrent(deviceInfo(infoRef.current.engineName, infoRef.current.test));
    }, 5000);
    return () => clearInterval(s);
  }, []);

  useEffect(() => {
    void listPlayable().then((t) => {
      setTracks(t);
      record('lab', 'playable', { count: t.length });
    });
    let ticks = 0;
    const i = setInterval(() => {
      ticks += 1;
      if (leanRef.current && ticks % 4 !== 0) return; // lean: refresh once a second
      if (engine.current) setSnap(engine.current.snapshot());
    }, 250);
    // Heartbeat for drift and memory over long sessions: engine position vs wall clock.
    let playStart: { wall: number; pos: number } | null = null;
    const hb = setInterval(() => {
      const e = engine.current;
      if (!e) return;
      const sn = e.snapshot();
      if (sn.state !== 'PLAYING') {
        playStart = null;
        return;
      }
      playStart ??= { wall: Date.now(), pos: sn.positionSeconds };
      const wall = (Date.now() - playStart.wall) / 1000;
      record('lab', 'heartbeat', {
        engine: e.name,
        position: Number(sn.positionSeconds.toFixed(3)),
        wallElapsed: Number(wall.toFixed(3)),
        driftMs: Math.round((sn.positionSeconds - playStart.pos - wall) * 1000),
        heapBytes: jsHeapBytes(),
        route: sn.route,
        lean: leanRef.current,
        ...Object.fromEntries(Object.entries(hermesStats()).map(([k, v]) => [`h_${k}`, v])),
        ...Object.fromEntries(Object.entries(e.diagnostics?.() ?? {}).map(([k, v]) => [`e_${k}`, v])),
        logEvents: logSize().events,
      });
    }, 30_000);
    return () => {
      clearInterval(i);
      clearInterval(hb);
      void engine.current?.dispose();
    };
  }, []);

  const load = useCallback(
    async (s: Scenario, over?: { engine?: EngineName; mode?: 'download' | 'stream'; crossfade?: number; shortLinks?: boolean }) => {
      const engineName_ = over?.engine ?? engineName;
      const mode_ = over?.mode ?? mode;
      const crossfade_ = over?.crossfade ?? crossfade;
      const shortLinks_ = over?.shortLinks ?? shortLinks;
      if (tracks.length < 2) {
        setInfo('Need at least two playable tracks for this account.');
        return;
      }
      // Fully stop the previous class before replacing it, then release it.
      const prev = engine.current;
      engine.current = null;
      if (prev) {
        await prev.stop().catch(() => undefined);
        await prev.dispose();
      }
      const e = engineName_ === 'graph' ? new GraphEngine(() => undefined) : new PlayerEngine(() => undefined);
      engine.current = e;
      const sc = buildScenario(s, tracks, crossfade_);
      setTotalSeconds(sc.total);
      const unique = [...new Map(sc.seq.map((t) => [t.trackId, t])).values()];
      setInfo(`Loading ${unique.length} tracks...`);
      const loaded = [];
      for (const t of unique) loaded.push(await resolveTrack(t, mode_, shortLinks_ ? 90 : undefined));
      const assets = await loadCueAssets();
      await e.load(sc.placed, loaded, sc.cues, assets);
      record('lab', 'scenario', {
        scenario: s,
        engine: e.name,
        mode: mode_,
        crossfade: crossfade_,
        shortLinks: shortLinks_,
        demo: sc.seq.every((t) => t.demo !== undefined),
        totalSeconds: Number(sc.total.toFixed(2)),
        segments: sc.placed.length,
        cues: sc.cues.length,
        dropped: sc.dropped,
        deferred: sc.deferred,
      });
      setInfo(`${s}: ${sc.placed.length} segments, ${formatClock(sc.total)}, ${sc.cues.length} cues (${sc.dropped} dropped, ${sc.deferred} deferred by policy)`);
      setSnap(e.snapshot());
    },
    [tracks, engineName, mode, crossfade, shortLinks],
  );

  const startGuide = useCallback(
    async (g: GuideTest) => {
      setGuide(g);
      setVerdict(null);
      setTest(g.id);
      setTestState(g.id);
      await load(g.scenario, { engine: engineName, mode: g.source, crossfade: g.crossfade, shortLinks: g.shortLinks });
    },
    [load, engineName],
  );

  const shareRun = useCallback(() => {
    void Share.share({ message: exportRun(deviceInfo(engine.current?.name ?? engineName, test)) });
  }, [engineName, test]);

  const late = events.filter((e) => e.kind === 'cue_fired').map((e) => Number(e.data.lateMs));
  const stats = summarize(late);
  const sp = snap;
  const act = useCallback((action: 'play' | 'pause' | 'resume' | 'stop' | 'seek', delta = 0) => {
    const e = engine.current;
    if (!e) return;
    if (action === 'play') void e.play(0);
    else if (action === 'pause') void e.pause();
    else if (action === 'resume') void e.resume();
    else if (action === 'stop') void e.stop();
    else void e.seek(e.snapshot().positionSeconds + delta);
  }, []);

  if (!advanced) {
    const playing = sp?.state === 'PLAYING';
    const ready = sp && sp.state !== 'IDLE' && sp.state !== 'LOADING' && sp.state !== 'ERROR';
    return (
      <Screen>
        <ScrollView contentContainerStyle={{ gap: space.md, paddingBottom: space.xxl }}>
          <Text variant="display">Audio tests</Text>
          {!guide ? (
            <>
              <Text muted>Pick a test. Each one sets itself up; just follow the steps.</Text>
              <Button testID="lab-lean" title={`Memory test mode: ${lean ? 'lean logging ON' : 'normal logging'}`} variant="secondary" onPress={() => setLean((v) => !v)} />
              <Button
                testID="lab-engine-simple"
                title={`Engine: ${engineName === 'player' ? 'Media player (recommended)' : 'Audio graph'}`}
                variant="secondary"
                onPress={() => setEngineName(engineName === 'player' ? 'graph' : 'player')}
              />
              {GUIDE.map((g) => (
                <Pressable key={g.id} testID={`guide-${g.id}`} onPress={() => void startGuide(g)}>
                  <Card style={{ gap: space.xs }}>
                    <Text variant="title">{g.title}</Text>
                    <Text muted>{g.minutes}</Text>
                  </Card>
                </Pressable>
              ))}
              {hasPrevious ? (
                <Button
                  title="App crashed last time? Send that run"
                  variant="secondary"
                  onPress={() =>
                    void readPrevious().then((m) => {
                      if (m) void Share.share({ message: m });
                    })
                  }
                />
              ) : null}
            </>
          ) : (
            <>
              <Text variant="title">{guide.title}</Text>
              <Card style={{ gap: space.sm }}>
                {guide.steps.map((st, i) => (
                  <Text key={i}>
                    {i + 1}. {st}
                  </Text>
                ))}
              </Card>

              <Card style={{ gap: space.xs, alignItems: 'center' }}>
                <Text testID="lab-clock" variant="display">
                  {formatClock(sp?.positionSeconds ?? 0)} / {formatClock(totalSeconds)}
                </Text>
                <Text muted>
                  {!ready
                    ? info || 'Getting ready...'
                    : playing
                      ? 'Playing'
                      : sp?.state === 'INTERRUPTED'
                        ? 'Paused by the phone'
                        : sp?.state === 'COMPLETED'
                          ? 'Finished'
                          : 'Paused'}
                </Text>
                {sp?.lastError ? <Text style={{ color: colors.danger }}>Error: {sp.lastError}</Text> : null}
              </Card>

              <Button
                testID="lab-bigplay"
                title={playing ? 'Pause' : sp?.state === 'PAUSED' || sp?.state === 'INTERRUPTED' ? 'Play' : 'Play from start'}
                disabled={!ready}
                onPress={() => act(playing ? 'pause' : sp?.state === 'PAUSED' || sp?.state === 'INTERRUPTED' ? 'resume' : 'play')}
              />
              <View style={{ flexDirection: 'row', gap: space.sm }}>
                <View style={{ flex: 1 }}>
                  <Button title="+10s" variant="secondary" disabled={!ready} onPress={() => act('seek', 10)} />
                </View>
                <View style={{ flex: 1 }}>
                  <Button title="+60s" variant="secondary" disabled={!ready} onPress={() => act('seek', 60)} />
                </View>
              </View>

              {guide.marks.length ? (
                <>
                  <Text variant="label" muted>
                    Tap when it happens
                  </Text>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
                    {guide.marks.map((m) => (
                      <Button
                        key={m}
                        title={m}
                        variant="secondary"
                        onPress={() => record('tester', 'mark', { note: m, position: Number((engine.current?.snapshot().positionSeconds ?? 0).toFixed(3)) })}
                      />
                    ))}
                  </View>
                </>
              ) : null}

              <Text variant="label" muted>
                How did it go?
              </Text>
              <View style={{ flexDirection: 'row', gap: space.sm }}>
                <View style={{ flex: 1 }}>
                  <Button
                    testID="lab-worked"
                    title={verdict === 'pass' ? 'Worked (saved)' : 'It worked'}
                    variant={verdict === 'pass' ? 'primary' : 'secondary'}
                    onPress={() => {
                      setVerdict('pass');
                      record('tester', 'verdict', { result: 'pass' });
                    }}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Button
                    testID="lab-problem"
                    title={verdict === 'fail' ? 'Problem (saved)' : 'Problem'}
                    variant={verdict === 'fail' ? 'primary' : 'secondary'}
                    onPress={() => {
                      setVerdict('fail');
                      record('tester', 'verdict', { result: 'fail' });
                    }}
                  />
                </View>
              </View>
              <Button testID="lab-send" title="Send results" onPress={shareRun} />
              <Button
                title="Back to tests"
                variant="ghost"
                onPress={() => {
                  void engine.current?.stop();
                  setGuide(null);
                }}
              />
            </>
          )}
          <Button title="Advanced (engineering controls)" variant="ghost" onPress={() => setAdvanced(true)} />
          <Button title="Back" variant="ghost" onPress={() => router.back()} />
        </ScrollView>
      </Screen>
    );
  }

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ gap: space.md, paddingBottom: space.xxl }}>
        <Button title="Simple test mode" variant="secondary" onPress={() => setAdvanced(false)} />
        <Text variant="label" muted>
          Development only
        </Text>
        <Text variant="display">Audio Lab</Text>
        {!AUDIO_LAB_ENABLED ? <Text muted>Not available in this build.</Text> : null}

        <Card style={{ gap: space.sm }}>
          <Text variant="label" muted>
            Which test are you running? (tags every measurement)
          </Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
            {['T1 Basic', 'T2 Bluetooth', 'T3 Interrupt', 'T4 Cues', 'T5 Ducking', 'T6 Transitions', 'T7 30 min', 'T8 45 min', 'Links', 'Network'].map((l) => (
              <Button
                key={l}
                title={test === l ? `● ${l}` : l}
                variant={test === l ? 'primary' : 'secondary'}
                onPress={() => {
                  setTest(l);
                  setTestState(l);
                }}
              />
            ))}
          </View>
        </Card>

        <Card style={{ gap: space.sm }}>
          <Text variant="label" muted>
            Setup ({tracks.length} authorized tracks)
          </Text>
          <View style={{ flexDirection: 'row', gap: space.sm }}>
            <View style={{ flex: 1 }}>
              <Button testID="lab-engine" title={`Engine: ${engineName}`} variant="secondary" onPress={() => setEngineName(engineName === 'graph' ? 'player' : 'graph')} />
            </View>
            <View style={{ flex: 1 }}>
              <Button testID="lab-mode" title={`Source: ${mode}`} variant="secondary" onPress={() => setMode(mode === 'download' ? 'stream' : 'download')} />
            </View>
          </View>
          <Button testID="lab-xfade" title={`Crossfade: ${crossfade}s`} variant="secondary" onPress={() => setCrossfade(crossfade ? 0 : 3)} />
          <Button testID="lab-shortlinks" title={`Signed links: ${shortLinks ? '90 s (expiry test)' : 'normal'}`} variant="secondary" onPress={() => setShortLinks(!shortLinks)} />
          <View style={{ flexDirection: 'row', gap: space.sm }}>
            {(['class3', 'long30', 'long45'] as Scenario[]).map((s) => (
              <View key={s} style={{ flex: 1 }}>
                <Button testID={`lab-load-${s}`} title={s} onPress={() => void load(s)} />
              </View>
            ))}
          </View>
          <Text variant="caption" muted>
            {info}
          </Text>
        </Card>

        <Card style={{ gap: space.xs }}>
          <Text testID="lab-clock" variant="display">
            {formatClock(sp?.positionSeconds ?? 0)} / {formatClock(totalSeconds)}
          </Text>
          <Text testID="lab-state">State: {sp?.state ?? 'IDLE'}</Text>
          <Text>Track: {sp?.currentTrackIds.map((id) => id.slice(0, 8)).join(' + ') || '-'}</Text>
          <Text>Next cue: {sp?.nextCueKey ?? '-'}</Text>
          <Text>Route: {sp?.route ?? '-'}</Text>
          {sp?.lastError ? <Text style={{ color: colors.danger }}>Error: {sp.lastError}</Text> : null}
        </Card>

        <View style={{ flexDirection: 'row', gap: space.sm }}>
          <View style={{ flex: 1 }}>
            <Button testID="lab-play" title="Play" onPress={() => act('play')} />
          </View>
          <View style={{ flex: 1 }}>
            <Button testID="lab-pause" title="Pause" variant="secondary" onPress={() => act('pause')} />
          </View>
          <View style={{ flex: 1 }}>
            <Button testID="lab-resume" title="Resume" variant="secondary" onPress={() => act('resume')} />
          </View>
        </View>
        <View style={{ flexDirection: 'row', gap: space.sm }}>
          {[-10, 10, 60].map((d) => (
            <View key={d} style={{ flex: 1 }}>
              <Button testID={`lab-seek-${d}`} title={`${d > 0 ? '+' : ''}${d}s`} variant="secondary" onPress={() => act('seek', d)} />
            </View>
          ))}
          <View style={{ flex: 1 }}>
            <Button testID="lab-stop" title="Stop" variant="secondary" onPress={() => act('stop')} />
          </View>
        </View>

        <Card style={{ gap: space.xs }}>
          <Text variant="label" muted>
            Measurements
          </Text>
          <Text>
            Cue lateness (JS-fired, ms): n={stats.n} mean={stats.mean} p50={stats.p50} p95={stats.p95} max={stats.max}
          </Text>
          <Text muted>Audio-graph cues are scheduled on the audio clock; their timing is read from the device log.</Text>
          <Text muted>Logged events: {events.length}</Text>
        </Card>

        <Card style={{ gap: space.sm }}>
          <Text variant="label" muted>
            Test log
          </Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
            {['BT on', 'BT off', 'Locked', 'Unlocked', 'Call', 'Other app', 'Network off', 'Network on', 'Heard cue'].map((m) => (
              <Button
                key={m}
                title={m}
                variant="secondary"
                onPress={() => record('tester', 'mark', { note: m, position: Number((engine.current?.snapshot().positionSeconds ?? 0).toFixed(3)) })}
              />
            ))}
          </View>
          <Button
            testID="lab-share"
            title="Share results"
            onPress={() =>
              void Share.share({
                message: exportRun(deviceInfo(engine.current?.name ?? engineName, test)),
              })
            }
          />
          {hasPrevious ? (
            <Button
              testID="lab-share-previous"
              title="Share previous run (use after a crash)"
              variant="secondary"
              onPress={() =>
                void readPrevious().then((m) => {
                  if (m) void Share.share({ message: m });
                })
              }
            />
          ) : null}
          <Button title="Clear log" variant="ghost" onPress={clearLab} />
        </Card>
        <Button title="Clear lab audio cache" variant="ghost" onPress={() => void clearLabCache()} />
        <Button title="Back" variant="ghost" onPress={() => router.back()} />
      </ScrollView>
    </Screen>
  );
}
