import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Pressable, ScrollView, View } from 'react-native';

import { useSession } from '@/auth/session';
import { cueSeconds, type CueId, listPlayable, type PlayableTrack } from '@/audiolab/assets';
import { listMyGyms } from '@/data/gyms';
import { createSoundtrack, loadSoundtrack, saveSoundtrack } from '@/data/soundtracks';
import { isClassActive, startClass, stopClass, useClassPlayback } from '@/playback/session';
import {
  buildSoundtrack,
  CLASS_LENGTHS,
  CUE_KINDS,
  type CueKind,
  cueOffsets,
  type CueRule,
  defaultRounds,
  describeWhen,
  dur,
  type GuidedPlan,
  type GuidedSection,
  guidedState,
  layoutMusic,
  MAX_CLASS_MINUTES,
  newCueRule,
  newPlan,
  newSection,
  roundsSeconds,
  roundsThatFit,
  SECTION_KINDS,
  SECTION_ORDER,
  sectionSpans,
  sectionTitle,
  totalMinutes,
} from '@/soundtrack/guided';
import { type ClassSoundtrack, toPlan } from '@/soundtrack/model';
import { applyTemplate, TEMPLATES, templateMinutes } from '@/soundtrack/templates';
import { Button, Card, colors, Field, radius, Screen, space, Text } from '@/ui';

import { AddCueSheet, CueEditSheet } from './CueEditor';
import { MusicPicker } from './MusicPicker';
import { Chip, ChipRow, DurationBar, IntensityBar, KIND_COLORS, RoundButton, Stepper } from './parts';

/**
 * Guided Class Builder. The instructor describes the CLASS in five short
 * steps (class, sections, music, cues, overview); Cadence builds the audio
 * timeline from it (src/soundtrack/guided.ts). The timeline editor is still
 * there as "Advanced edit". No timestamps, offsets, engines or other audio
 * internals are shown here.
 */
const STEPS = ['Class', 'Sections', 'Music', 'Cues', 'Preview'] as const;
const STEP_TITLES = ['Create class soundtrack', 'Sections', 'Music', 'Cues', 'Preview'] as const;
const OVERVIEW = 4;
const cueSec = (a: string) => cueSeconds(a as CueId);

export function GuidedBuilder({ id }: { id?: string }) {
  const router = useRouter();
  const session = useSession();
  const cls = useClassPlayback();
  const [classId, setClassId] = useState<string | null>(id ?? null);
  const [loaded, setLoaded] = useState<ClassSoundtrack | null>(null);
  const [revision, setRevision] = useState(0);
  const [name, setName] = useState('');
  const [plan, setPlan] = useState<GuidedPlan>(() => newPlan(60));
  const [diverged, setDiverged] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [step, setStep] = useState(id ? OVERVIEW : 0);
  const [reached, setReached] = useState(id ? OVERVIEW : 0);
  const [ready, setReady] = useState(!id);
  const [status, setStatus] = useState<string | null>(id ? 'Loading...' : null);
  const [busy, setBusy] = useState(false);
  const [gymId, setGymId] = useState<string | null>(null);
  const [library, setLibrary] = useState<PlayableTrack[]>([]);
  const [libLoading, setLibLoading] = useState(true);
  const [customLength, setCustomLength] = useState(false);
  const [showTemplates, setShowTemplates] = useState(false);
  const [picking, setPicking] = useState<string | null>(null);
  const [addingCue, setAddingCue] = useState<string | null>(null);
  const [editingCue, setEditingCue] = useState<{ sectionId: string; ruleId: string } | null>(null);
  const dirtyRef = useRef(dirty);
  useEffect(() => {
    dirtyRef.current = dirty;
  }, [dirty]);

  const reload = useCallback(async () => {
    if (!classId) return;
    const r = await loadSoundtrack(classId);
    if (!r.value) {
      setStatus(r.error ?? 'Could not load this class.');
      return;
    }
    const st = guidedState(r.value.soundtrack);
    setLoaded(r.value.soundtrack);
    setRevision(r.value.revision);
    setName(r.value.soundtrack.name);
    setPlan(st.plan);
    setDiverged(st.diverged);
    setDirty(false);
    setCustomLength(!(CLASS_LENGTHS as readonly number[]).includes(st.plan.minutes));
    setReady(true);
    setStatus(null);
  }, [classId]);

  const refreshLibrary = useCallback(async () => {
    setLibLoading(true);
    // Real gym music only (demo tracks are an Audio Lab tool).
    const t = await listPlayable();
    setLibrary(t.filter((x) => x.demo === undefined));
    setLibLoading(false);
  }, []);

  useEffect(() => {
    void listMyGyms().then((g) => setGymId(g.gyms[0]?.id ?? null));
  }, []);

  // On every return to this screen: pick up Advanced Edit changes (unless there are unsaved edits here) and new music.
  useFocusEffect(
    useCallback(() => {
      if (!dirtyRef.current) void reload();
      void refreshLibrary();
    }, [reload, refreshLibrary]),
  );

  const doc = useMemo(() => {
    const base = { name: name.trim() || 'Untitled class', musicGain: loaded?.musicGain ?? 1 };
    return diverged && loaded ? { ...loaded, name: base.name } : buildSoundtrack(base, plan);
  }, [name, plan, diverged, loaded]);
  const spans = useMemo(() => sectionSpans(plan), [plan]);
  const spanOf = (sid: string) => {
    const x = spans.find((s) => s.section.id === sid);
    return x ? x.end - x.start : 0;
  };
  const total = totalMinutes(plan);
  const mine = classId !== null && cls.soundtrackId === classId;
  const active = mine && isClassActive(cls);

  const change = (f: (p: GuidedPlan) => GuidedPlan) => {
    setPlan((p) => f(p));
    setDirty(true);
  };
  const changeSection = (sid: string, f: (s: GuidedSection) => GuidedSection) => change((p) => ({ ...p, sections: p.sections.map((s) => (s.id === sid ? f(s) : s)) }));
  const setMinutes = (m: number) => change((p) => ({ ...p, minutes: Math.max(5, Math.min(MAX_CLASS_MINUTES, Math.round(m))) }));
  const go = (i: number) => {
    setStep(i);
    setReached((r) => Math.max(r, i));
  };

  /** Save (creating the class the first time). Returns its id, or null if it could not be saved. */
  const persist = async (): Promise<string | null> => {
    if (classId && !dirty) return classId;
    setBusy(true);
    try {
      if (!classId) {
        const uid = session.session?.user.id;
        if (!gymId || !uid) {
          setStatus('Create or join a gym as staff to save classes.');
          return null;
        }
        const r = await createSoundtrack(gymId, uid, doc);
        if (!r.id) {
          setStatus(`Not saved: ${r.error ?? 'unknown error'}`);
          return null;
        }
        setClassId(r.id);
        setRevision(r.revision ?? 1);
        setLoaded(doc);
        setDirty(false);
        setStatus('Saved');
        return r.id;
      }
      const r = await saveSoundtrack(classId, revision, doc);
      if (!r.revision) {
        setStatus(r.error === 'stale' ? 'Someone else saved this class. Go back and reopen it to see their version.' : `Not saved: ${r.error}`);
        return null;
      }
      setRevision(r.revision);
      setLoaded(doc);
      setDirty(false);
      setStatus('Saved');
      return classId;
    } finally {
      setBusy(false);
    }
  };

  const play = (cid: string) =>
    startClass({ soundtrackId: cid, title: doc.name, plan: toPlan(doc, cueSec), sections: doc.sections, musicGain: doc.musicGain, library, fromSeconds: 0, engineKind: 'media-player' });

  const preview = async () => {
    if (active) {
      await stopClass();
      return;
    }
    const cid = classId ?? (await persist());
    if (cid) void play(cid);
  };

  const startRunning = async () => {
    const cid = await persist();
    if (!cid) return;
    if (!(cls.soundtrackId === cid && isClassActive(cls))) void play(cid);
    router.push({ pathname: '/soundtracks/[id]/run', params: { id: cid } });
  };

  const openAdvanced = async () => {
    const cid = await persist();
    if (cid) router.push({ pathname: '/soundtracks/[id]/advanced', params: { id: cid } });
  };

  const leave = () => {
    if (!dirty) {
      router.back();
      return;
    }
    Alert.alert('Leave without saving?', 'Your changes to this class will be lost.', [
      { text: 'Keep editing', style: 'cancel' },
      { text: 'Save and leave', onPress: () => void persist().then((cid) => cid && router.back()) },
      { text: 'Discard', style: 'destructive', onPress: () => router.back() },
    ]);
  };

  const pickTemplate = (key: string) => {
    const t = TEMPLATES.find((x) => x.key === key);
    if (!t) return;
    const apply = () => {
      change((p) => ({ ...p, sections: applyTemplate(t, p.minutes) }));
      setShowTemplates(false);
    };
    if (!plan.sections.length) apply();
    else Alert.alert('Replace your sections?', `This replaces your sections with ${t.title}.`, [{ text: 'Cancel', style: 'cancel' }, { text: 'Replace', onPress: apply }]);
  };

  const moveSection = (sid: string, dir: -1 | 1) =>
    change((p) => {
      const i = p.sections.findIndex((s) => s.id === sid);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= p.sections.length) return p;
      const next = [...p.sections];
      [next[i], next[j]] = [next[j]!, next[i]!];
      return { ...p, sections: next };
    });

  const addCue = (sid: string, kind: CueKind) => {
    const s = plan.sections.find((x) => x.id === sid);
    if (!s) return;
    const rounds = s.rounds ?? (CUE_KINDS[kind].needsRounds ? defaultRounds(spanOf(sid)) : undefined);
    const rule = newCueRule(kind, { rounds });
    changeSection(sid, (x) => ({ ...x, ...(rounds ? { rounds } : {}), cues: [...x.cues, rule] }));
    setAddingCue(null);
    setEditingCue({ sectionId: sid, ruleId: rule.id });
  };

  if (!ready) {
    return (
      <Screen>
        <Text muted>{status}</Text>
        <Button title="Back" variant="ghost" onPress={() => router.back()} />
      </Screen>
    );
  }

  const pickingSection = plan.sections.find((s) => s.id === picking) ?? null;
  const addingSection = plan.sections.find((s) => s.id === addingCue) ?? null;
  const editSection = plan.sections.find((s) => s.id === editingCue?.sectionId) ?? null;
  const editRule = editSection?.cues.find((r) => r.id === editingCue?.ruleId) ?? null;
  const canContinue = step === 0 ? plan.minutes >= 5 : step === 1 ? plan.sections.length > 0 && total === plan.minutes : true;

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ gap: space.md, paddingBottom: space.xxl }} keyboardShouldPersistTaps="handled">
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <Pressable testID="gb-leave" accessibilityRole="button" onPress={leave} hitSlop={10} style={{ minHeight: 44, justifyContent: 'center' }}>
            <Text style={{ color: colors.accent, fontWeight: '700' }}>‹ Classes</Text>
          </Pressable>
          <Text muted variant="caption">
            {busy ? 'Saving...' : dirty ? 'Not saved yet' : (status ?? '')}
          </Text>
        </View>

        <View style={{ flexDirection: 'row', gap: 4 }}>
          {STEPS.map((label, i) => {
            const enabled = i <= reached && !(diverged && i < OVERVIEW);
            return (
              <Pressable
                key={label}
                testID={`gb-step-${i}`}
                accessibilityRole="button"
                accessibilityLabel={`Step ${i + 1}: ${label}`}
                accessibilityState={{ selected: i === step, disabled: !enabled }}
                disabled={!enabled}
                onPress={() => go(i)}
                style={{ flex: 1, gap: 4, paddingVertical: space.xs }}
              >
                <View style={{ height: 6, borderRadius: 3, backgroundColor: i <= step ? colors.accent : i <= reached ? colors.textFaint : colors.border }} />
                <Text variant="caption" muted={i !== step} style={{ textAlign: 'center', fontWeight: i === step ? '700' : '400' }}>
                  {label}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <Text testID="gb-title" variant="display">
          {STEP_TITLES[step]}
        </Text>

        {step === 0 ? (
          <>
            <Text variant="label" muted>
              Class name
            </Text>
            <Field
              testID="gb-name"
              value={name}
              onChangeText={(v) => {
                setName(v);
                setDirty(true);
              }}
              placeholder="e.g. Tuesday Fundamentals"
              maxLength={80}
            />
            <Text variant="label" muted style={{ marginTop: space.sm }}>
              How long is the class?
            </Text>
            <ChipRow>
              {CLASS_LENGTHS.map((m) => (
                <Chip
                  key={m}
                  testID={`gb-length-${m}`}
                  label={`${m} min`}
                  selected={!customLength && plan.minutes === m}
                  onPress={() => {
                    setCustomLength(false);
                    setMinutes(m);
                  }}
                />
              ))}
              <Chip testID="gb-length-custom" label="Custom" selected={customLength} onPress={() => setCustomLength(true)} />
            </ChipRow>
            {customLength ? (
              <Stepper testID="gb-custom-length" value={`${plan.minutes} min`} minusDisabled={plan.minutes <= 5} onMinus={() => setMinutes(plan.minutes - 5)} onPlus={() => setMinutes(plan.minutes + 5)} />
            ) : null}
          </>
        ) : null}

        {step === 1 ? (
          <>
            <Text muted>How is this class structured? Add sections in order, or start from a template.</Text>
            {!plan.sections.length || showTemplates ? (
              <View style={{ gap: space.sm }}>
                <Text variant="label" muted>
                  Templates
                </Text>
                {TEMPLATES.map((t) => {
                  const own = templateMinutes(t);
                  return (
                    <Pressable key={t.key} testID={`gb-template-${t.key}`} accessibilityRole="button" onPress={() => pickTemplate(t.key)}>
                      <Card style={{ gap: 2 }}>
                        <Text style={{ fontWeight: '700' }}>{t.title}</Text>
                        <Text muted variant="caption">
                          {t.blurb} · {own === plan.minutes ? `${own} min` : `${own} min, fitted to ${plan.minutes} min`}
                        </Text>
                      </Card>
                    </Pressable>
                  );
                })}
              </View>
            ) : (
              <Button testID="gb-show-templates" title="Start from a template instead" variant="ghost" onPress={() => setShowTemplates(true)} />
            )}

            {plan.sections.map((s, i) => {
              const span = spans.find((x) => x.section.id === s.id);
              return (
                <Card key={s.id} testID={`gb-section-${i}`} style={{ gap: space.sm, borderLeftWidth: 6, borderLeftColor: KIND_COLORS[s.kind] }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
                    {s.kind === 'custom' ? (
                      <Field
                        testID={`gb-section-${i}-name`}
                        value={s.label}
                        onChangeText={(v) => changeSection(s.id, (x) => ({ ...x, label: v }))}
                        placeholder="Section name"
                        maxLength={40}
                        style={{ flex: 1 }}
                      />
                    ) : (
                      <Text variant="title" style={{ flex: 1 }}>
                        {sectionTitle(s)}
                      </Text>
                    )}
                    <RoundButton testID={`gb-section-${i}-remove`} label="✕" accessibilityLabel={`Remove ${sectionTitle(s)}`} onPress={() => change((p) => ({ ...p, sections: p.sections.filter((x) => x.id !== s.id) }))} />
                  </View>
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: space.sm }}>
                    <Stepper
                      testID={`gb-section-${i}-minutes`}
                      value={`${s.minutes} MIN`}
                      minusDisabled={s.minutes <= 1}
                      onMinus={() => changeSection(s.id, (x) => ({ ...x, minutes: Math.max(1, x.minutes - 1) }))}
                      onPlus={() => changeSection(s.id, (x) => ({ ...x, minutes: x.minutes + 1 }))}
                    />
                    <View style={{ flexDirection: 'row', gap: space.sm }}>
                      <RoundButton testID={`gb-section-${i}-up`} label="▲" accessibilityLabel={`Move ${sectionTitle(s)} earlier`} disabled={i === 0} onPress={() => moveSection(s.id, -1)} />
                      <RoundButton
                        testID={`gb-section-${i}-down`}
                        label="▼"
                        accessibilityLabel={`Move ${sectionTitle(s)} later`}
                        disabled={i === plan.sections.length - 1}
                        onPress={() => moveSection(s.id, 1)}
                      />
                    </View>
                  </View>
                  <Text muted variant="caption">
                    {span ? `Minute ${Math.round(span.start / 60)} to ${Math.round(span.end / 60)}` : 'Past the end of the class'}
                  </Text>
                </Card>
              );
            })}

            <TotalBar plan={plan} onSetMinutes={setMinutes} onChangeSection={changeSection} />

            <Text variant="label" muted style={{ marginTop: space.sm }}>
              Add a section
            </Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
              {SECTION_ORDER.map((k) => (
                <Pressable
                  key={k}
                  testID={`gb-add-${k}`}
                  accessibilityRole="button"
                  accessibilityLabel={`Add ${SECTION_KINDS[k].label}`}
                  onPress={() => change((p) => ({ ...p, sections: [...p.sections, newSection(k)] }))}
                  style={({ pressed }) => ({
                    width: '48%',
                    minHeight: 76,
                    padding: space.md,
                    borderRadius: radius.lg,
                    backgroundColor: colors.surface,
                    borderWidth: 1,
                    borderColor: colors.border,
                    borderTopWidth: 5,
                    borderTopColor: KIND_COLORS[k],
                    opacity: pressed ? 0.8 : 1,
                  })}
                >
                  <Text style={{ fontWeight: '700' }}>+ {SECTION_KINDS[k].label}</Text>
                  <Text muted variant="caption">
                    {SECTION_KINDS[k].blurb}
                  </Text>
                </Pressable>
              ))}
            </View>
          </>
        ) : null}

        {step === 2 ? (
          <>
            <Text muted>Choose music for each section. Cadence lines the songs up for you.</Text>
            {spans.map(({ section: s, start, end }, i) => {
              const span = end - start;
              const l = layoutMusic(s, span);
              return (
                <Card key={s.id} testID={`gb-music-${i}`} style={{ gap: space.sm, borderLeftWidth: 6, borderLeftColor: KIND_COLORS[s.kind] }}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }}>
                    <Text variant="title">{sectionTitle(s)}</Text>
                    <Text muted>{dur(span)}</Text>
                  </View>
                  <Text variant="label" muted>
                    Intensity
                  </Text>
                  <IntensityBar testID={`gb-music-${i}-intensity`} value={s.intensity} onChange={(v) => changeSection(s.id, (x) => ({ ...x, intensity: v }))} />
                  {s.music.map((m, k) => (
                    <View key={`${m.assetId}-${k}`} style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
                      <Text style={{ flex: 1 }} numberOfLines={1}>
                        ♪ {m.label}
                      </Text>
                      <Text muted>{dur(m.durationSeconds)}</Text>
                      <RoundButton
                        testID={`gb-music-${i}-remove-${k}`}
                        label="✕"
                        accessibilityLabel={`Remove ${m.label}`}
                        onPress={() => changeSection(s.id, (x) => ({ ...x, music: x.music.filter((_, j) => j !== k) }))}
                      />
                    </View>
                  ))}
                  <FillStatus
                    index={i}
                    section={s}
                    span={span}
                    layout={l}
                    onAddSong={() => setPicking(s.id)}
                    onFill={(fill) => changeSection(s.id, (x) => (fill ? { ...x, fill } : { ...x, fill: undefined }))}
                  />
                  <Button testID={`gb-music-${i}-choose`} title={s.music.length ? 'Choose more music' : 'Choose music'} variant={s.music.length ? 'secondary' : 'primary'} onPress={() => setPicking(s.id)} />
                </Card>
              );
            })}
          </>
        ) : null}

        {step === 3 ? (
          <>
            <Text muted>Cues are the calls during class: round start, bells, &quot;30 seconds&quot;, switch. Add them per section.</Text>
            {spans.map(({ section: s, start, end }, i) => {
              const span = end - start;
              return (
                <Card key={s.id} testID={`gb-cues-${i}`} style={{ gap: space.sm, borderLeftWidth: 6, borderLeftColor: KIND_COLORS[s.kind] }}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }}>
                    <Text variant="title">{sectionTitle(s)}</Text>
                    <Text muted>{dur(span)}</Text>
                  </View>
                  {s.rounds ? (
                    <RoundsEditor index={i} section={s} span={span} onChange={(f) => changeSection(s.id, f)} />
                  ) : (
                    <Button testID={`gb-cues-${i}-rounds`} title="Set up rounds" variant="secondary" onPress={() => changeSection(s.id, (x) => ({ ...x, rounds: defaultRounds(span) }))} />
                  )}
                  {s.cues.map((r, k) => (
                    <CueRow key={r.id} testID={`gb-cues-${i}-rule-${k}`} rule={r} times={cueOffsets(r, span, s.rounds).length} onPress={() => setEditingCue({ sectionId: s.id, ruleId: r.id })} />
                  ))}
                  <Button testID={`gb-cues-${i}-add`} title="+ Add cue" onPress={() => setAddingCue(s.id)} />
                </Card>
              );
            })}
          </>
        ) : null}

        {step === OVERVIEW ? (
          <Overview
            doc={doc}
            plan={plan}
            diverged={diverged}
            dirty={dirty}
            busy={busy}
            saved={classId !== null}
            active={active}
            message={mine ? cls.message : null}
            onRebuild={() =>
              Alert.alert('Edit with guided steps?', 'Cadence will rebuild the music and cues from the guided steps. Changes made in Advanced edit will be replaced.', [
                { text: 'Cancel', style: 'cancel' },
                {
                  text: 'Rebuild',
                  style: 'destructive',
                  onPress: () => {
                    setDiverged(false);
                    setDirty(true);
                  },
                },
              ])
            }
            onPreview={() => void preview()}
            onSave={() => void persist()}
            onStart={() => void startRunning()}
            onAdvanced={() => void openAdvanced()}
            onEdit={(i) => go(i)}
          />
        ) : (
          <View style={{ flexDirection: 'row', gap: space.sm, marginTop: space.sm }}>
            {step > 0 ? (
              <View style={{ flex: 1 }}>
                <Button testID="gb-back" title="Back" variant="secondary" onPress={() => go(step - 1)} />
              </View>
            ) : null}
            <View style={{ flex: 2 }}>
              <Button testID="gb-continue" title={`Continue to ${STEPS[step + 1]}`} disabled={!canContinue} onPress={() => go(step + 1)} />
            </View>
          </View>
        )}
      </ScrollView>

      <MusicPicker
        key={picking ?? 'closed'}
        section={pickingSection}
        spanSeconds={pickingSection ? spanOf(pickingSection.id) : 0}
        filledSeconds={pickingSection ? layoutMusic({ music: pickingSection.music }, spanOf(pickingSection.id)).filledSeconds : 0}
        library={library}
        loading={libLoading}
        onChoose={(t) => {
          if (!pickingSection) return;
          changeSection(pickingSection.id, (x) => ({ ...x, music: [...x.music, { assetId: t.trackId, label: t.title, durationSeconds: t.durationSeconds }] }));
          setPicking(null);
        }}
        onGenerate={(r) => {
          setPicking(null);
          router.push({ pathname: '/generator', params: { description: r.description, style: r.style, seconds: String(r.seconds) } });
        }}
        onClose={() => setPicking(null)}
      />
      <AddCueSheet section={addingSection} onPick={(k) => addingSection && addCue(addingSection.id, k)} onClose={() => setAddingCue(null)} />
      <CueEditSheet
        section={editSection}
        spanSeconds={editSection ? spanOf(editSection.id) : 0}
        rule={editRule}
        onChange={(r) => editSection && changeSection(editSection.id, (x) => ({ ...x, cues: x.cues.map((c) => (c.id === r.id ? r : c)) }))}
        onRemove={() => {
          if (editSection && editRule) changeSection(editSection.id, (x) => ({ ...x, cues: x.cues.filter((c) => c.id !== editRule.id) }));
          setEditingCue(null);
        }}
        onClose={() => setEditingCue(null)}
      />
    </Screen>
  );
}

function TotalBar({ plan, onSetMinutes, onChangeSection }: { plan: GuidedPlan; onSetMinutes: (m: number) => void; onChangeSection: (sid: string, f: (s: GuidedSection) => GuidedSection) => void }) {
  if (!plan.sections.length) return null;
  const total = totalMinutes(plan);
  const diff = plan.minutes - total;
  const last = plan.sections.at(-1)!;
  const longest = [...plan.sections].sort((a, b) => b.minutes - a.minutes)[0]!;
  return (
    <Card style={{ gap: space.sm }}>
      <Text testID="gb-total" variant="title" style={{ color: diff === 0 ? colors.success : colors.text }}>
        Total: {total} / {plan.minutes} minutes
      </Text>
      <DurationBar testID="gb-duration-bar" total={plan.minutes} parts={plan.sections.map((s) => ({ key: s.id, kind: s.kind, minutes: s.minutes }))} />
      {diff > 0 ? (
        <>
          <Text muted>{diff} min not planned yet.</Text>
          <Button testID="gb-fix-extend" title={`Add ${diff} min to ${sectionTitle(last)}`} variant="secondary" onPress={() => onChangeSection(last.id, (x) => ({ ...x, minutes: x.minutes + diff }))} />
          <Button testID="gb-fix-length" title={`Make the class ${total} min`} variant="ghost" onPress={() => onSetMinutes(total)} />
        </>
      ) : null}
      {diff < 0 ? (
        <>
          <Text style={{ color: colors.danger }}>{-diff} min too long.</Text>
          {longest.minutes + diff >= 1 ? (
            <Button testID="gb-fix-trim" title={`Take ${-diff} min off ${sectionTitle(longest)}`} variant="secondary" onPress={() => onChangeSection(longest.id, (x) => ({ ...x, minutes: x.minutes + diff }))} />
          ) : null}
          <Button testID="gb-fix-length" title={`Make the class ${total} min`} variant="ghost" onPress={() => onSetMinutes(total)} />
        </>
      ) : null}
    </Card>
  );
}

function FillStatus({
  index,
  section,
  span,
  layout,
  onAddSong,
  onFill,
}: {
  index: number;
  section: GuidedSection;
  span: number;
  layout: ReturnType<typeof layoutMusic>;
  onAddSong: () => void;
  onFill: (f: 'repeat' | 'quiet' | null) => void;
}) {
  const id = `gb-music-${index}`;
  if (!section.music.length) {
    return (
      <Text testID={`${id}-status`} muted>
        No music yet. This section will be quiet.
      </Text>
    );
  }
  if (section.fill === 'repeat') {
    return (
      <View style={{ gap: space.xs }}>
        <Text testID={`${id}-status`}>Your songs repeat to fill {dur(span)}.</Text>
        <Button testID={`${id}-fill-reset`} title="Change" variant="ghost" onPress={() => onFill(null)} />
      </View>
    );
  }
  if (layout.quietSeconds > 0 && section.fill === 'quiet') {
    return (
      <View style={{ gap: space.xs }}>
        <Text testID={`${id}-status`}>The last {dur(layout.quietSeconds)} stay quiet.</Text>
        <Button testID={`${id}-fill-reset`} title="Change" variant="ghost" onPress={() => onFill(null)} />
      </View>
    );
  }
  if (layout.quietSeconds > 0) {
    return (
      <View style={{ gap: space.sm, padding: space.sm, borderRadius: radius.md, borderWidth: 1, borderColor: colors.accent }}>
        <Text testID={`${id}-status`} style={{ fontWeight: '700' }}>
          Music covers {dur(layout.filledSeconds)} of {dur(span)}. {dur(layout.quietSeconds)} left.
        </Text>
        <Button testID={`${id}-fill-add`} title="+ Add another song" onPress={onAddSong} />
        <View style={{ flexDirection: 'row', gap: space.sm }}>
          <View style={{ flex: 1 }}>
            <Button testID={`${id}-fill-repeat`} title="Repeat music" variant="secondary" onPress={() => onFill('repeat')} />
          </View>
          <View style={{ flex: 1 }}>
            <Button testID={`${id}-fill-quiet`} title="Leave it quiet" variant="secondary" onPress={() => onFill('quiet')} />
          </View>
        </View>
      </View>
    );
  }
  return (
    <Text testID={`${id}-status`} muted>
      Music fills the section.{layout.cutSeconds > 0 ? ` The last song ends ${dur(layout.cutSeconds)} early and fades out.` : ''}
    </Text>
  );
}

function RoundsEditor({ index, section, span, onChange }: { index: number; section: GuidedSection; span: number; onChange: (f: (s: GuidedSection) => GuidedSection) => void }) {
  const r = section.rounds!;
  const need = roundsSeconds(r);
  const fit = roundsThatFit(r, span);
  const setR = (patch: Partial<typeof r>) => onChange((x) => ({ ...x, rounds: { ...x.rounds!, ...patch } }));
  const id = `gb-cues-${index}`;
  return (
    <View style={{ gap: space.sm, padding: space.sm, borderRadius: radius.md, backgroundColor: colors.bg }}>
      <Text variant="label" muted>
        Rounds
      </Text>
      <LabeledStepper label="Round" testID={`${id}-work`} value={dur(r.workSeconds)} minusDisabled={r.workSeconds <= 30} onMinus={() => setR({ workSeconds: r.workSeconds - 30 })} onPlus={() => setR({ workSeconds: r.workSeconds + 30 })} />
      <LabeledStepper
        label="Rest"
        testID={`${id}-rest`}
        value={r.restSeconds ? dur(r.restSeconds) : 'none'}
        minusDisabled={r.restSeconds <= 0}
        onMinus={() => setR({ restSeconds: Math.max(0, r.restSeconds - 15) })}
        onPlus={() => setR({ restSeconds: r.restSeconds + 15 })}
      />
      <LabeledStepper label="Rounds" testID={`${id}-count`} value={String(r.count)} minusDisabled={r.count <= 1} onMinus={() => setR({ count: r.count - 1 })} onPlus={() => setR({ count: r.count + 1 })} />
      <Text testID={`${id}-rounds-summary`} muted={need <= span} style={need > span ? { color: colors.danger } : undefined}>
        {r.count} {r.count === 1 ? 'round takes' : 'rounds take'} {dur(need)}
        {need > span ? `, but this section is ${dur(span)}. ${fit} ${fit === 1 ? 'fits' : 'fit'}.` : ` of ${dur(span)}.`}
      </Text>
      {need > span ? <Button testID={`${id}-fit`} title={`Use ${fit} ${fit === 1 ? 'round' : 'rounds'}`} variant="secondary" onPress={() => setR({ count: fit })} /> : null}
      <Button
        testID={`${id}-no-rounds`}
        title="No rounds in this section"
        variant="ghost"
        onPress={() =>
          onChange((x) => {
            const { rounds: _drop, ...rest } = x;
            return { ...rest, cues: x.cues.filter((c) => !CUE_KINDS[c.kind].needsRounds && !['round_start', 'round_end', 'rest_start', 'before_round_end'].includes(c.when.at)) };
          })
        }
      />
    </View>
  );
}

function LabeledStepper({ label, ...p }: { label: string } & Parameters<typeof Stepper>[0]) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
      <Text style={{ fontWeight: '600' }}>{label}</Text>
      <Stepper {...p} />
    </View>
  );
}

function CueRow({ rule, times, onPress, testID }: { rule: CueRule; times: number; onPress: () => void; testID?: string }) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => ({ minHeight: 56, padding: space.sm, borderRadius: radius.md, backgroundColor: colors.surfaceRaised, opacity: pressed ? 0.85 : 1, gap: 2 })}
    >
      <Text style={{ fontWeight: '700' }}>🔔 {rule.name.trim() || CUE_KINDS[rule.kind].label}</Text>
      <Text muted variant="caption">
        {describeWhen(rule.when)} · {times === 0 ? 'never plays here' : times === 1 ? 'once' : `${times} times`} · tap to change
      </Text>
    </Pressable>
  );
}

function Overview({
  doc,
  plan,
  diverged,
  dirty,
  busy,
  saved,
  active,
  message,
  onRebuild,
  onPreview,
  onSave,
  onStart,
  onAdvanced,
  onEdit,
}: {
  doc: ClassSoundtrack;
  plan: GuidedPlan;
  diverged: boolean;
  dirty: boolean;
  busy: boolean;
  saved: boolean;
  active: boolean;
  message: string | null;
  onRebuild: () => void;
  onPreview: () => void;
  onSave: () => void;
  onStart: () => void;
  onAdvanced: () => void;
  onEdit: (step: number) => void;
}) {
  const unplanned = plan.minutes - totalMinutes(plan);
  const rows = diverged
    ? [...doc.sections]
        .sort((a, b) => a.startSeconds - b.startSeconds)
        .map((x) => ({
          key: x.id,
          title: x.label,
          color: colors.textFaint,
          minutes: Math.round((x.endSeconds - x.startSeconds) / 60),
          songs: doc.tracks.filter((t) => t.startSeconds >= x.startSeconds && t.startSeconds < x.endSeconds).length,
          cues: doc.cues.filter((c) => c.timeSeconds >= x.startSeconds && c.timeSeconds < x.endSeconds).length,
          note: null as string | null,
        }))
    : sectionSpans(plan).map(({ section: s, start, end }) => {
        const l = layoutMusic(s, end - start);
        return {
          key: s.id,
          title: sectionTitle(s),
          color: KIND_COLORS[s.kind],
          minutes: Math.round((end - start) / 60),
          songs: s.music.length,
          cues: s.cues.length,
          note: !s.music.length ? 'No music' : l.quietSeconds > 0 ? `${dur(l.quietSeconds)} quiet` : s.fill === 'repeat' ? 'Music repeats' : null,
        };
      });

  return (
    <View style={{ gap: space.md }}>
      <View>
        <Text testID="gb-class-heading" variant="title">
          {Math.round(doc.durationSeconds / 60)} MIN {doc.name.toUpperCase()}
        </Text>
        <Text muted>
          {dur(doc.durationSeconds)} · {rows.length} {rows.length === 1 ? 'section' : 'sections'}
        </Text>
      </View>

      {diverged ? (
        <Card testID="gb-diverged" style={{ gap: space.sm, borderColor: colors.accent }}>
          <Text style={{ fontWeight: '700' }}>This class was changed in Advanced edit.</Text>
          <Text muted>It plays exactly as edited there. Keep editing it in Advanced edit, or rebuild it from the guided steps (this replaces those edits).</Text>
          <Button testID="gb-rebuild" title="Rebuild with guided steps" variant="secondary" onPress={onRebuild} />
        </Card>
      ) : null}

      {rows.map((r, i) => (
        <Pressable
          key={r.key}
          testID={`gb-overview-${i}`}
          accessibilityRole="button"
          disabled={diverged}
          onPress={() => onEdit(2)}
          style={{ flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.md, borderRadius: radius.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderLeftWidth: 6, borderLeftColor: r.color }}
        >
          <View style={{ flex: 1 }}>
            <Text style={{ fontWeight: '700' }}>{r.title}</Text>
            <Text muted variant="caption">
              {r.songs} {r.songs === 1 ? 'song' : 'songs'} · {r.cues} {r.cues === 1 ? 'cue' : 'cues'}
              {r.note ? ` · ${r.note}` : ''}
            </Text>
          </View>
          <Text variant="title">{r.minutes} min</Text>
        </Pressable>
      ))}
      {!diverged && unplanned > 0 ? <Text muted>{unplanned} min at the end have no section.</Text> : null}
      {!rows.length ? <Text muted>No sections yet.</Text> : null}
      {message ? <Text style={{ color: colors.danger }}>{message}</Text> : null}

      <Button testID="gb-start" title={active ? 'Open class view' : 'START CLASS'} onPress={onStart} loading={busy} />
      <View style={{ flexDirection: 'row', gap: space.sm }}>
        <View style={{ flex: 1 }}>
          <Button testID="gb-preview" title={active ? '■ Stop' : '▶ Preview class'} variant="secondary" onPress={onPreview} />
        </View>
        <View style={{ flex: 1 }}>
          <Button testID="gb-save" title={dirty || !saved ? 'Save class' : 'Saved'} variant="secondary" disabled={(!dirty && saved) || busy} onPress={onSave} />
        </View>
      </View>
      <Button testID="gb-advanced" title="Advanced edit" variant="ghost" onPress={onAdvanced} />
    </View>
  );
}
