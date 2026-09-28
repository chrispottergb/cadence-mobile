import { useLocalSearchParams, useRouter } from 'expo-router';
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Modal, Pressable, ScrollView, View } from 'react-native';

import { cueSeconds, type CueId, listPlayable, type PlayableTrack } from '@/audiolab/assets';
import { formatClock } from '@/audiolab/timeline';
import { loadSoundtrack, saveSoundtrack } from '@/data/soundtracks';
import type { EngineKind } from '@/playback/engine';
import { isClassActive, seekBy, startClass, stopClass, togglePlay, useClassPlayback } from '@/playback/session';
import {
  addCue,
  addSection,
  addTrackAtFreeSpot,
  type ClassSoundtrack,
  CUE_TYPES,
  type CueType,
  issues,
  laneRows,
  removeCue,
  removeSection,
  removeTrack,
  reorderTrack,
  sectionAt,
  setDuration,
  sortedCues,
  sortedTracks,
  toPlan,
  trackEnd,
  updateCue,
  updateSection,
  updateTrack,
} from '@/soundtrack/model';
import { Button, Card, colors, Field, radius, Screen, space, Text } from '@/ui';

/**
 * First functional Class Soundtrack Builder (Stage B). Deliberately simple:
 * large buttons, tap-to-place at the cursor, and every edit resolves to exact
 * timeline values. The saved model, never a pixel position, is the truth.
 */
const DEFAULT_PX = 3; // pixels per second on the timeline
const MIN_PX = 0.4;
const MAX_PX = 24;
const ROW = 44;
const clock = (s: number) => formatClock(s).replace(/\.\d$/, '');
const cueSec = (a: string) => cueSeconds(a as CueId);

type Sel = { kind: 'track' | 'cue' | 'section'; id: string } | null;

export default function Builder() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [doc, setDoc] = useState<ClassSoundtrack | null>(null);
  const [revision, setRevision] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [status, setStatus] = useState<string>('Loading...');
  const [cursor, setCursor] = useState(0);
  const [sel, setSel] = useState<Sel>(null);
  const [library, setLibrary] = useState<PlayableTrack[]>([]);
  const [picking, setPicking] = useState<'music' | 'cue' | null>(null);
  const [engineKind, setEngineKind] = useState<EngineKind>('media-player');
  const [previewStale, setPreviewStale] = useState(false);
  // Playback lives in the app-wide class player (mini-player), not in this screen.
  const cls = useClassPlayback();
  const mine = cls.soundtrackId === id;
  const snap = mine ? cls.snapshot : null;
  const active = mine && isClassActive(cls);
  const preparing = mine && cls.preparing;
  /** Timeline zoom in pixels per second; pinch or the zoom buttons change it. Display only. */
  const [px, setPx] = useState(DEFAULT_PX);
  const pinch = useRef<{ dist: number; px: number } | null>(null);

  useEffect(() => {
    if (!id) return;
    void loadSoundtrack(id).then((r) => {
      if (r.value) {
        setDoc(r.value.soundtrack);
        setRevision(r.value.revision);
        setStatus('Saved');
      } else setStatus(r.error ?? 'Could not load.');
    });
    // Real gym tracks only here (demo tracks are an Audio Lab tool).
    void listPlayable().then((t) => setLibrary(t.filter((x) => x.demo === undefined)));
  }, [id]);

  const edit = useCallback((f: (d: ClassSoundtrack) => ClassSoundtrack) => {
    setDoc((d) => (d ? f(d) : d));
    setDirty(true);
    setPreviewStale(true);
  }, []);

  /** Commit an already-computed document (used when the new ids must be selected). */
  const commit = (n: ClassSoundtrack, select: Sel) => {
    setDoc(n);
    setDirty(true);
    setPreviewStale(true);
    setSel(select);
  };

  const save = async () => {
    if (!doc || !id) return;
    setStatus('Saving...');
    const r = await saveSoundtrack(id, revision, doc);
    if (r.revision) {
      setRevision(r.revision);
      setDirty(false);
      setStatus('Saved');
    } else setStatus(r.error === 'stale' ? 'Someone else saved this soundtrack. Reopen it to see their version.' : `Not saved: ${r.error}`);
  };

  const playing = snap?.state === 'PLAYING';
  const playhead = active && snap && snap.state !== 'IDLE' ? snap.positionSeconds : cursor;

  const preview = (from: number) => {
    if (!doc || !id) return;
    setPreviewStale(false);
    void startClass({
      soundtrackId: id,
      title: doc.name,
      plan: toPlan(doc, cueSec),
      sections: doc.sections,
      musicGain: doc.musicGain,
      library,
      fromSeconds: from,
      engineKind,
    });
  };

  const nudge = (d: number) => {
    if (active) seekBy(d);
    else setCursor((c) => Math.max(0, Math.min(doc?.durationSeconds ?? 0, c + d)));
  };

  const onPlay = () => {
    if (active && !preparing) togglePlay();
    else if (!preparing) preview(cursor);
  };

  const stopPreview = async () => {
    const at = await stopClass();
    setCursor(Math.round(at));
  };

  const tracks = useMemo(() => (doc ? sortedTracks(doc) : []), [doc]);
  const cues = useMemo(() => (doc ? sortedCues(doc) : []), [doc]);
  const warn = useMemo(() => (doc ? issues(doc) : []), [doc]);

  if (!doc) {
    return (
      <Screen>
        <Text muted>{status}</Text>
        <Button title="Back" variant="ghost" onPress={() => router.back()} />
      </Screen>
    );
  }

  const width = Math.max(320, doc.durationSeconds * px);
  const rows = laneRows(tracks);
  const musicRows = Math.max(1, ...[...rows.values()].map((x) => x + 1));
  // Ruler spacing adapts to zoom so labels never crowd: 10 s, 30 s, 1 min or 5 min.
  const tick = px >= 12 ? 10 : px >= 5 ? 30 : px >= 1.5 ? 60 : 300;
  const onTouchMove = (ev: { nativeEvent: { touches: { pageX: number; pageY: number }[] } }) => {
    const t = ev.nativeEvent.touches;
    if (t.length !== 2) return;
    const dist = Math.hypot(t[0]!.pageX - t[1]!.pageX, t[0]!.pageY - t[1]!.pageY);
    if (!pinch.current) pinch.current = { dist, px };
    else setPx(Math.min(MAX_PX, Math.max(MIN_PX, pinch.current.px * (dist / pinch.current.dist))));
  };
  const onTouchEnd = () => {
    pinch.current = null;
  };
  const selTrack = sel?.kind === 'track' ? doc.tracks.find((t) => t.id === sel.id) : undefined;
  const selCue = sel?.kind === 'cue' ? doc.cues.find((c) => c.id === sel.id) : undefined;
  const selSection = sel?.kind === 'section' ? doc.sections.find((x) => x.id === sel.id) : undefined;
  const at = (e: { nativeEvent: { locationX: number } }) => Math.max(0, Math.min(doc.durationSeconds, Math.round(e.nativeEvent.locationX / px)));

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ gap: space.md, paddingBottom: space.xxl }}>
        <Field testID="st-title" value={doc.name} onChangeText={(v) => edit((d) => ({ ...d, name: v }))} maxLength={80} />
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
          <Text muted style={{ flex: 1 }}>
            {mine && cls.message ? cls.message : status}
            {dirty ? ' · unsaved changes' : ''}
          </Text>
          <Button testID="st-save" title="Save" onPress={save} disabled={!dirty} />
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
          <Button title="-5 min" variant="secondary" onPress={() => edit((d) => setDuration(d, d.durationSeconds - 300))} />
          <Text variant="title" style={{ flex: 1, textAlign: 'center' }}>
            Class {clock(doc.durationSeconds)}
          </Text>
          <Button title="+5 min" variant="secondary" onPress={() => edit((d) => setDuration(d, d.durationSeconds + 300))} />
        </View>

        {/* Timeline: sections / music / cues, with the playhead. Tap a row to move the cursor. */}
        {warn.some((w) => w.kind === 'overlap') ? (
          <Text style={{ color: colors.danger }}>Two songs overlap and will play at the same time. Select one and move it, or add fades.</Text>
        ) : null}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
          <View style={{ flex: 1 }}>
            <Button testID="st-zoom-out" title="Zoom out" variant="secondary" onPress={() => setPx((v) => Math.max(MIN_PX, v / 1.6))} />
          </View>
          <View style={{ flex: 1 }}>
            <Button testID="st-zoom-in" title="Zoom in" variant="secondary" onPress={() => setPx((v) => Math.min(MAX_PX, v * 1.6))} />
          </View>
        </View>
        <Text muted variant="caption">
          Pinch the timeline to zoom. Tap a lane to move the cursor; tap a block to edit it.
        </Text>
        <Card style={{ padding: space.sm }} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd} onTouchCancel={onTouchEnd}>
          <ScrollView horizontal>
            <View style={{ width }}>
              <Pressable onPress={(e) => setCursor(at(e))} style={{ height: 22 }}>
                {Array.from({ length: Math.floor(doc.durationSeconds / tick) + 1 }, (_, k) => (
                  <Text key={k} variant="caption" muted style={{ position: 'absolute', left: k * tick * px + 2 }}>
                    {clock(k * tick)}
                  </Text>
                ))}
              </Pressable>
              <Lane label="Sections" onPress={(e) => setCursor(at(e))}>
                {doc.sections.map((x) => (
                  <Block
                    key={x.id}
                    left={x.startSeconds * px}
                    width={(x.endSeconds - x.startSeconds) * px}
                    color={colors.surfaceRaised}
                    active={sel?.id === x.id}
                    label={x.label}
                    onPress={() => setSel({ kind: 'section', id: x.id })}
                  />
                ))}
              </Lane>
              <Lane label="Music" rows={musicRows} onPress={(e) => setCursor(at(e))}>
                {tracks.map((t) => (
                  <Block
                    key={t.id}
                    row={rows.get(t.id) ?? 0}
                    left={t.startSeconds * px}
                    width={t.durationSeconds * px}
                    color="#2B3A55"
                    active={sel?.id === t.id}
                    label={`${t.label} · ${clock(t.durationSeconds)}`}
                    onPress={() => setSel({ kind: 'track', id: t.id })}
                  />
                ))}
              </Lane>
              <Lane label="Cues" onPress={(e) => setCursor(at(e))}>
                {cues.map((c) => (
                  <Pressable
                    key={c.id}
                    onPress={() => setSel({ kind: 'cue', id: c.id })}
                    hitSlop={10}
                    style={{
                      position: 'absolute',
                      left: c.timeSeconds * px - 7,
                      top: 6,
                      width: 14,
                      height: ROW - 12,
                      borderRadius: 7,
                      backgroundColor: c.priority === 'high' ? colors.danger : c.priority === 'normal' ? colors.accent : colors.textFaint,
                      borderWidth: sel?.id === c.id ? 2 : 0,
                      borderColor: colors.text,
                    }}
                  />
                ))}
              </Lane>
              <View pointerEvents="none" style={{ position: 'absolute', left: playhead * px, top: 0, bottom: 0, width: 2, backgroundColor: colors.success }} />
            </View>
          </ScrollView>
        </Card>

        <Card style={{ gap: space.sm }}>
          <Text variant="display" style={{ textAlign: 'center' }}>
            {clock(playhead)}
          </Text>
          <Text muted style={{ textAlign: 'center' }}>
            {sectionAt(doc, playhead)?.label ?? 'No section'}
            {active && snap ? ` · ${snap.state.toLowerCase()}` : ''}
            {previewStale && active ? ' · edits not in this preview' : ''}
          </Text>
          <View style={{ flexDirection: 'row', gap: space.sm }}>
            {[-30, -5, 5, 30].map((d) => (
              <View key={d} style={{ flex: 1 }}>
                <Button title={`${d > 0 ? '+' : ''}${d}s`} variant="secondary" onPress={() => nudge(d)} />
              </View>
            ))}
          </View>
          <View style={{ flexDirection: 'row', gap: space.sm }}>
            <View style={{ flex: 2 }}>
              <Button
                testID="st-preview"
                title={preparing ? 'Preparing...' : playing ? 'Pause' : snap?.state === 'PAUSED' || snap?.state === 'INTERRUPTED' ? 'Resume' : 'Preview from here'}
                onPress={onPlay}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Button title="Stop" variant="secondary" disabled={!active && !preparing} onPress={() => void stopPreview()} />
            </View>
          </View>
          <Button title={`Engine: ${engineKind} (test)`} variant="ghost" onPress={() => setEngineKind((k) => (k === 'media-player' ? 'audio-graph' : 'media-player'))} />
        </Card>

        <View style={{ flexDirection: 'row', gap: space.sm }}>
          <View style={{ flex: 1 }}>
            <Button testID="st-add-music" title="+ Music here" onPress={() => setPicking('music')} />
          </View>
          <View style={{ flex: 1 }}>
            <Button testID="st-add-cue" title="+ Cue here" onPress={() => setPicking('cue')} />
          </View>
        </View>
        <Button
          title="+ Section here (5 min)"
          variant="secondary"
          onPress={() => {
            const n = addSection(doc, `Section ${doc.sections.length + 1}`, cursor, cursor + 300);
            commit(n, { kind: 'section', id: n.sections.at(-1)!.id });
          }}
        />

        {selTrack ? (
          <Card style={{ gap: space.sm }}>
            <Text variant="title">{selTrack.label}</Text>
            <Text muted>
              Starts {clock(selTrack.startSeconds)} · plays {clock(selTrack.durationSeconds)} from {clock(selTrack.sourceOffsetSeconds)} of {clock(selTrack.assetDurationSeconds)} ·
              ends {clock(trackEnd(selTrack))}
            </Text>
            <Row
              label="Start"
              onMinus={() => edit((d) => updateTrack(d, selTrack.id, { startSeconds: selTrack.startSeconds - 5 }))}
              onPlus={() => edit((d) => updateTrack(d, selTrack.id, { startSeconds: selTrack.startSeconds + 5 }))}
            />
            <Button title="Start at cursor" variant="secondary" onPress={() => edit((d) => updateTrack(d, selTrack.id, { startSeconds: cursor }))} />
            <Row
              label="Trim start"
              onMinus={() => edit((d) => updateTrack(d, selTrack.id, { sourceOffsetSeconds: selTrack.sourceOffsetSeconds - 5 }))}
              onPlus={() => edit((d) => updateTrack(d, selTrack.id, { sourceOffsetSeconds: selTrack.sourceOffsetSeconds + 5 }))}
            />
            <Row
              label="Length"
              onMinus={() => edit((d) => updateTrack(d, selTrack.id, { durationSeconds: selTrack.durationSeconds - 5 }))}
              onPlus={() => edit((d) => updateTrack(d, selTrack.id, { durationSeconds: selTrack.durationSeconds + 5 }))}
            />
            <Row
              label={`Fade in ${selTrack.fadeInSeconds}s / out ${selTrack.fadeOutSeconds}s`}
              minusTitle="Fades off"
              plusTitle="Fades 3s"
              onMinus={() => edit((d) => updateTrack(d, selTrack.id, { fadeInSeconds: 0, fadeOutSeconds: 0 }))}
              onPlus={() => edit((d) => updateTrack(d, selTrack.id, { fadeInSeconds: 3, fadeOutSeconds: 3 }))}
            />
            <Row
              label="Order"
              minusTitle="Earlier"
              plusTitle="Later"
              onMinus={() => edit((d) => reorderTrack(d, selTrack.id, -1))}
              onPlus={() => edit((d) => reorderTrack(d, selTrack.id, 1))}
            />
            <Button
              title="Remove track"
              variant="ghost"
              onPress={() => {
                edit((d) => removeTrack(d, selTrack.id));
                setSel(null);
              }}
            />
          </Card>
        ) : null}

        {selCue ? (
          <Card style={{ gap: space.sm }}>
            <Text variant="title">
              {CUE_TYPES[selCue.type].label} at {clock(selCue.timeSeconds)}
            </Text>
            <Row
              label="Time"
              minusTitle="-1s"
              plusTitle="+1s"
              onMinus={() => edit((d) => updateCue(d, selCue.id, { timeSeconds: selCue.timeSeconds - 1 }))}
              onPlus={() => edit((d) => updateCue(d, selCue.id, { timeSeconds: selCue.timeSeconds + 1 }))}
            />
            <Button title="Move to cursor" variant="secondary" onPress={() => edit((d) => updateCue(d, selCue.id, { timeSeconds: cursor }))} />
            <Text variant="label" muted>
              Repeat
            </Text>
            <Chips
              options={[0, 15, 30, 60, 180].map((n) => ({ key: String(n), label: n ? `every ${n < 60 ? `${n}s` : `${n / 60}m`}` : 'once' }))}
              value={String(selCue.repeatEverySeconds ?? 0)}
              onPick={(k) => edit((d) => updateCue(d, selCue.id, { repeatEverySeconds: Number(k) || undefined }))}
            />
            <Text variant="label" muted>
              Priority (who wins if cues collide)
            </Text>
            <Chips
              options={['high', 'normal', 'low'].map((p) => ({ key: p, label: p }))}
              value={selCue.priority}
              onPick={(k) => edit((d) => updateCue(d, selCue.id, { priority: k as 'high' | 'normal' | 'low' }))}
            />
            <Button
              title="Remove cue"
              variant="ghost"
              onPress={() => {
                edit((d) => removeCue(d, selCue.id));
                setSel(null);
              }}
            />
          </Card>
        ) : null}

        {selSection ? (
          <Card style={{ gap: space.sm }}>
            <Field value={selSection.label} onChangeText={(v) => edit((d) => updateSection(d, selSection.id, { label: v }))} maxLength={40} />
            <Text muted>
              {clock(selSection.startSeconds)} to {clock(selSection.endSeconds)}
            </Text>
            <Row
              label="Start"
              minusTitle="-30s"
              plusTitle="+30s"
              onMinus={() => edit((d) => updateSection(d, selSection.id, { startSeconds: selSection.startSeconds - 30 }))}
              onPlus={() => edit((d) => updateSection(d, selSection.id, { startSeconds: selSection.startSeconds + 30 }))}
            />
            <Row
              label="End"
              minusTitle="-30s"
              plusTitle="+30s"
              onMinus={() => edit((d) => updateSection(d, selSection.id, { endSeconds: selSection.endSeconds - 30 }))}
              onPlus={() => edit((d) => updateSection(d, selSection.id, { endSeconds: selSection.endSeconds + 30 }))}
            />
            <Button
              title="Remove section"
              variant="ghost"
              onPress={() => {
                edit((d) => removeSection(d, selSection.id));
                setSel(null);
              }}
            />
          </Card>
        ) : null}

        {warn.length ? (
          <Card style={{ gap: space.xs }}>
            <Text variant="label" muted>
              Check
            </Text>
            {warn.map((w, i) => (
              <Text key={i} muted>
                {clock(w.at)} · {w.detail}
              </Text>
            ))}
          </Card>
        ) : null}

        <Button title="Back" variant="ghost" onPress={() => router.back()} />
      </ScrollView>

      <Modal visible={picking !== null} transparent animationType="slide" onRequestClose={() => setPicking(null)}>
        <Pressable style={{ flex: 1, backgroundColor: '#0008' }} onPress={() => setPicking(null)} />
        <View style={{ maxHeight: '70%', backgroundColor: colors.surface, padding: space.lg, gap: space.sm, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg }}>
          <Text variant="title">{picking === 'music' ? `Add music at ${clock(cursor)}` : `Add a cue at ${clock(cursor)}`}</Text>
          <ScrollView contentContainerStyle={{ gap: space.sm }}>
            {picking === 'music'
              ? library.length
                ? library.map((t) => (
                    <Button
                      key={t.trackId}
                      title={`${t.title} · ${clock(t.durationSeconds)}`}
                      variant="secondary"
                      onPress={() => {
                        const n = addTrackAtFreeSpot(doc, { assetId: t.trackId, label: t.title, durationSeconds: t.durationSeconds }, cursor);
                        commit(n, { kind: 'track', id: n.tracks.at(-1)!.id });
                        setPicking(null);
                      }}
                    />
                  ))
                : [
                    <Text key="none" muted>
                      No gym music yet. Generated tracks appear here.
                    </Text>,
                  ]
              : (Object.keys(CUE_TYPES) as CueType[]).map((k) => (
                  <Button
                    key={k}
                    title={`${CUE_TYPES[k].label} (${CUE_TYPES[k].priority})`}
                    variant="secondary"
                    onPress={() => {
                      const n = addCue(doc, k, cursor);
                      commit(n, { kind: 'cue', id: n.cues.at(-1)!.id });
                      setPicking(null);
                    }}
                  />
                ))}
          </ScrollView>
          {picking === 'music' ? (
            <Button
              title="Generate new music"
              variant="secondary"
              onPress={() => {
                setPicking(null);
                router.push('/generator');
              }}
            />
          ) : null}
          <Button title="Cancel" variant="ghost" onPress={() => setPicking(null)} />
        </View>
      </Modal>
    </Screen>
  );
}

function Lane({ label, children, onPress, rows = 1 }: { label: string; children: ReactNode; rows?: number; onPress: (e: { nativeEvent: { locationX: number } }) => void }) {
  return (
    <View style={{ height: ROW * rows, marginBottom: space.xs }}>
      <Pressable onPress={onPress} style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backgroundColor: colors.bg, borderRadius: radius.sm }} />
      {children}
      <View pointerEvents="none" style={{ position: 'absolute', left: 4, top: 2, backgroundColor: '#000b', borderRadius: 4, paddingHorizontal: 4 }}>
        <Text variant="caption" style={{ color: colors.textMuted }}>
          {label}
        </Text>
      </View>
    </View>
  );
}

function Block({
  left,
  width,
  color,
  label,
  active,
  onPress,
  row = 0,
}: {
  left: number;
  width: number;
  color: string;
  label: string;
  active: boolean;
  onPress: () => void;
  row?: number;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={{
        position: 'absolute',
        left,
        width: Math.max(8, width),
        top: row * ROW + 4,
        height: ROW - 8,
        backgroundColor: color,
        borderRadius: radius.sm,
        borderWidth: active ? 2 : 1,
        borderColor: active ? colors.accent : colors.border,
        justifyContent: 'flex-end',
        paddingBottom: 2,
        paddingHorizontal: 6,
      }}
    >
      <Text variant="caption" numberOfLines={1} style={{ color: colors.text }}>
        {label}
      </Text>
    </Pressable>
  );
}

function Row({
  label,
  onMinus,
  onPlus,
  minusTitle = '-5s',
  plusTitle = '+5s',
}: {
  label: string;
  onMinus: () => void;
  onPlus: () => void;
  minusTitle?: string;
  plusTitle?: string;
}) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
      <View style={{ flex: 1 }}>
        <Button title={minusTitle} variant="secondary" onPress={onMinus} />
      </View>
      <Text style={{ flex: 1.3, textAlign: 'center' }} numberOfLines={2}>
        {label}
      </Text>
      <View style={{ flex: 1 }}>
        <Button title={plusTitle} variant="secondary" onPress={onPlus} />
      </View>
    </View>
  );
}

function Chips({ options, value, onPick }: { options: { key: string; label: string }[]; value: string; onPick: (k: string) => void }) {
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
      {options.map((o) => (
        <Button key={o.key} title={o.label} variant={o.key === value ? 'primary' : 'secondary'} onPress={() => onPick(o.key)} />
      ))}
    </View>
  );
}
