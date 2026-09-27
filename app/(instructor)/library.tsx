import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Modal, Pressable, RefreshControl, ScrollView, View } from 'react-native';

import { useSession } from '@/auth/session';
import { addToPlaylist, createPlaylist, listPlaylists, type Playlist, type PlaylistOwner, removeFromPlaylist } from '@/data/playlists';
import { listMyGyms } from '@/data/gyms';
import { type Candidate, getPlaybackUrl, listGenerations } from '@/music/client';
import { Button, Card, colors, Field, radius, Screen, space, Text } from '@/ui';

/**
 * Library: every generated track this instructor's gym owns, plus playlists.
 * The + on a track opens "Add to playlist" with a quick "New playlist".
 */
const fmt = (s: number | null) => (s === null ? '--:--' : `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`);

type Track = Candidate;

export default function Library() {
  const session = useSession();
  const [owner, setOwner] = useState<PlaylistOwner | null>(null);
  const [tracks, setTracks] = useState<Track[]>([]);
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState<Track | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  // One player for the whole screen: switching tracks replaces its source
  // instead of creating and releasing players (which crashed on iOS).
  const player = useAudioPlayer(null);
  const status = useAudioPlayerStatus(player);
  const [current, setCurrent] = useState<string | null>(null);

  const toggle = useCallback(
    async (id: string) => {
      if (current === id) {
        if (status.playing) player.pause();
        else player.play();
        return;
      }
      const r = await getPlaybackUrl(id);
      if (!r.ok) {
        setError('Could not play that track. Try again.');
        return;
      }
      player.replace({ uri: r.data.url });
      setCurrent(id);
      player.play();
    },
    [current, status.playing, player],
  );
  const playing = (id: string) => current === id && status.playing;

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const gyms = await listMyGyms();
    const uid = session.session?.user.id;
    const o: PlaylistOwner | null = gyms.gyms[0] ? { type: 'gym', id: gyms.gyms[0].id } : uid ? { type: 'profile', id: uid } : null;
    setOwner(o);
    const g = await listGenerations();
    if (g.ok) {
      setTracks(g.data.generations.flatMap((job) => job.candidates.filter((c) => c.playable)));
    } else setError('Could not load your music. Pull down to try again.');
    if (o) {
      const p = await listPlaylists(o);
      setPlaylists(p.playlists);
      if (p.error) setError(p.error);
    }
    setLoading(false);
  }, [session.session?.user.id]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const byId = new Map(tracks.map((t) => [t.id, t]));

  return (
    <Screen>
      <ScrollView
        contentContainerStyle={{ gap: space.md, paddingBottom: space.xxl }}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={colors.accent} />}
      >
        <Text variant="display">Library</Text>
        {error ? <Text style={{ color: colors.danger }}>{error}</Text> : null}

        <Text variant="label" muted>
          Playlists
        </Text>
        {playlists.length === 0 ? <Text muted>No playlists yet. Tap + on a track to start one.</Text> : null}
        {playlists.map((p) => (
          <Card key={p.id} style={{ gap: space.xs }}>
            <Pressable testID={`playlist-${p.name}`} onPress={() => setOpen(open === p.id ? null : p.id)} style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <Text variant="title">{p.name}</Text>
              <Text muted>
                {p.trackIds.length} {p.trackIds.length === 1 ? 'track' : 'tracks'}
              </Text>
            </Pressable>
            {open === p.id
              ? p.trackIds.map((id) => {
                  const t = byId.get(id);
                  return t ? (
                    <TrackRow
                      key={id}
                      t={t}
                      playing={playing(id)}
                      onToggle={toggle}
                      action={{
                        label: 'Remove',
                        onPress: () => void removeFromPlaylist(p.id, id).then(load),
                      }}
                    />
                  ) : null;
                })
              : null}
          </Card>
        ))}

        <Text variant="label" muted style={{ marginTop: space.md }}>
          All tracks
        </Text>
        {!loading && tracks.length === 0 ? <Text muted>No music yet. Generated tracks appear here.</Text> : null}
        {tracks.map((t) => (
          <Card key={t.id}>
            <TrackRow t={t} playing={playing(t.id)} onToggle={toggle} action={{ label: '+', onPress: () => setAdding(t) }} />
          </Card>
        ))}
      </ScrollView>

      <AddToPlaylist track={adding} playlists={playlists} owner={owner} onClose={() => setAdding(null)} onChanged={load} />
    </Screen>
  );
}

function TrackRow({ t, action, playing, onToggle }: { t: Track; action: { label: string; onPress: () => void }; playing: boolean; onToggle: (id: string) => void }) {
  const toggle = () => onToggle(t.id);
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
      <Pressable
        testID={`play-${t.id}`}
        onPress={toggle}
        style={{
          width: 40,
          height: 40,
          borderRadius: 20,
          backgroundColor: colors.accent,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Text style={{ color: colors.bg, fontWeight: '700' }}>{playing ? '||' : '▶'}</Text>
      </Pressable>
      <View style={{ flex: 1 }}>
        <Text numberOfLines={1}>{t.title ?? `Take ${t.label}`}</Text>
        <Text muted variant="caption" numberOfLines={1}>
          {fmt(t.durationSeconds)}
          {t.style ? ` · ${t.style}` : ''}
        </Text>
      </View>
      <Pressable
        testID={`action-${t.id}`}
        accessibilityLabel={action.label === '+' ? 'Add to playlist' : action.label}
        onPress={action.onPress}
        hitSlop={8}
        style={{
          minWidth: 40,
          height: 40,
          borderRadius: radius.md,
          borderWidth: 1,
          borderColor: colors.border,
          alignItems: 'center',
          justifyContent: 'center',
          paddingHorizontal: space.sm,
        }}
      >
        <Text variant={action.label === '+' ? 'title' : 'caption'}>{action.label}</Text>
      </Pressable>
    </View>
  );
}

function AddToPlaylist({
  track,
  playlists,
  owner,
  onClose,
  onChanged,
}: {
  track: Track | null;
  playlists: Playlist[];
  owner: PlaylistOwner | null;
  onClose: () => void;
  onChanged: () => Promise<void>;
}) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const close = () => {
    setName('');
    setMsg(null);
    onClose();
  };

  const add = async (p: Playlist) => {
    if (!track) return;
    setBusy(true);
    const e = await addToPlaylist(p, track.id);
    setBusy(false);
    if (e) setMsg(e);
    else {
      await onChanged();
      close();
    }
  };

  const createAndAdd = async () => {
    if (!track || !owner || !name.trim()) return;
    setBusy(true);
    const c = await createPlaylist(owner, name);
    if (c.error || !c.id) {
      setBusy(false);
      setMsg(c.error ?? 'Could not create the playlist.');
      return;
    }
    const e = await addToPlaylist({ id: c.id, name, trackIds: [] }, track.id);
    setBusy(false);
    if (e) setMsg(e);
    else {
      await onChanged();
      close();
    }
  };

  return (
    <Modal visible={!!track} transparent animationType="slide" onRequestClose={close}>
      <Pressable style={{ flex: 1, backgroundColor: '#0008' }} onPress={close} />
      <View
        style={{
          backgroundColor: colors.surface,
          padding: space.lg,
          gap: space.sm,
          borderTopLeftRadius: radius.lg,
          borderTopRightRadius: radius.lg,
        }}
      >
        <Text variant="title">Add to playlist</Text>
        <Text muted numberOfLines={1}>
          {track?.title ?? ''}
        </Text>
        {playlists.map((p) => (
          <Button
            key={p.id}
            title={p.trackIds.includes(track?.id ?? '') ? `${p.name} (added)` : p.name}
            variant="secondary"
            disabled={busy || p.trackIds.includes(track?.id ?? '')}
            onPress={() => void add(p)}
          />
        ))}
        <Text variant="label" muted style={{ marginTop: space.sm }}>
          New playlist
        </Text>
        <Field testID="new-playlist-name" value={name} onChangeText={setName} placeholder="e.g. Tuesday kickboxing" maxLength={80} />
        <Button testID="create-playlist" title="Create and add" onPress={createAndAdd} loading={busy} disabled={!name.trim() || !owner} />
        {msg ? <Text style={{ color: colors.danger }}>{msg}</Text> : null}
        <Button title="Cancel" variant="ghost" onPress={close} />
      </View>
    </Modal>
  );
}
