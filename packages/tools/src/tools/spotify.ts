import { BaseTool } from '../base.js';
import type { ToolDefinition, ToolResult } from '../base.js';
import { SpotifyIntegration } from '../integrations/spotify-integration.js';

// Global reference so it can be configured from the Gateway
let spotifyInstance: SpotifyIntegration | null = null;

export function setSpotifyRef(instance: SpotifyIntegration): void {
  spotifyInstance = instance;
}

export function getSpotifyRef(): SpotifyIntegration | null {
  return spotifyInstance;
}

export class SpotifyTool extends BaseTool {
  readonly definition: ToolDefinition = {
    name: 'spotify',
    description: `Control Spotify playback via natural language. Actions:
- now_playing: Get currently playing track, device, progress, volume, shuffle/repeat state
- play: Resume playback or play a specific track/playlist/album (optional: query to search and play, uri, device_id)
- pause: Pause playback
- next: Skip to next track
- previous: Go to previous track
- set_volume: Set volume 0-100%
- shuffle: Toggle shuffle on/off
- repeat: Set repeat mode (track, context/playlist, off)
- search: Search for tracks and playlists (query required)
- queue: Add a track to the queue (query to search, or uri)
- devices: List available Spotify devices
- transfer: Transfer playback to another device (device_id or device name)
- playlists: List user's playlists
- play_playlist: Search and play a playlist by name (query required)`,
    category: 'automation',
    parameters: [
      { name: 'action', type: 'string', description: 'Action: now_playing, play, pause, next, previous, set_volume, shuffle, search, queue, devices, transfer, playlists, play_playlist, repeat', required: true },
      { name: 'query', type: 'string', description: 'Search query for play, search, queue, play_playlist actions', required: false },
      { name: 'uri', type: 'string', description: 'Spotify URI (e.g. spotify:track:xxx or spotify:playlist:xxx)', required: false },
      { name: 'volume', type: 'number', description: 'Volume percentage (0-100) for set_volume', required: false },
      { name: 'device_id', type: 'string', description: 'Target device ID for transfer/play', required: false },
      { name: 'device_name', type: 'string', description: 'Target device name for transfer (alternative to device_id)', required: false },
      { name: 'enabled', type: 'boolean', description: 'For shuffle: true/false', required: false },
      { name: 'mode', type: 'string', description: 'For repeat: track, context, off', required: false },
    ],
  };

  async execute(params: Record<string, unknown>): Promise<ToolResult> {
    const validationError = this.validateParams(params);
    if (validationError) return { success: false, error: validationError, duration: 0 };

    if (!spotifyInstance || !spotifyInstance.isConfigured()) {
      return { success: false, error: 'Spotify is not configured. Please set up Spotify in Dashboard Settings.', duration: 0 };
    }
    if (!spotifyInstance.isAuthenticated()) {
      return { success: false, error: 'Spotify is not connected. Please authorize Spotify in Dashboard Settings.', duration: 0 };
    }

    const action = String(params['action']);

    const { result, duration } = await this.timed(async () => {
      switch (action) {
        case 'now_playing': {
          const playback = await spotifyInstance!.getPlayback();
          if (!playback.track) return { status: 'Nothing is currently playing', is_playing: false };
          const progressSec = Math.floor(playback.progress_ms / 1000);
          const durationSec = Math.floor(playback.track.duration_ms / 1000);
          return {
            is_playing: playback.is_playing,
            track: playback.track.name,
            artist: playback.track.artist,
            album: playback.track.album,
            progress: `${Math.floor(progressSec / 60)}:${String(progressSec % 60).padStart(2, '0')} / ${Math.floor(durationSec / 60)}:${String(durationSec % 60).padStart(2, '0')}`,
            device: playback.device?.name || 'Unknown',
            volume: playback.volume + '%',
            shuffle: playback.shuffle,
            repeat: playback.repeat,
          };
        }

        case 'play': {
          const query = params['query'] as string | undefined;
          const uri = params['uri'] as string | undefined;
          const deviceId = params['device_id'] as string | undefined;

          if (uri) {
            if (uri.includes(':track:')) {
              await spotifyInstance!.play({ uris: [uri], deviceId });
            } else {
              await spotifyInstance!.play({ contextUri: uri, deviceId });
            }
            return { action: 'play', uri, result: 'Playing' };
          }

          if (query) {
            const results = await spotifyInstance!.search(query, ['track'], 1);
            if (results.tracks.length === 0) return { action: 'play', error: `No tracks found for "${query}"` };
            const track = results.tracks[0];
            await spotifyInstance!.play({ uris: [track.uri], deviceId });
            return { action: 'play', track: track.name, artist: track.artist, result: 'Playing' };
          }

          await spotifyInstance!.play({ deviceId });
          return { action: 'play', result: 'Resumed playback' };
        }

        case 'pause': {
          await spotifyInstance!.pause();
          return { action: 'pause', result: 'Paused' };
        }

        case 'next': {
          await spotifyInstance!.next();
          return { action: 'next', result: 'Skipped to next track' };
        }

        case 'previous': {
          await spotifyInstance!.previous();
          return { action: 'previous', result: 'Went to previous track' };
        }

        case 'set_volume': {
          const vol = Number(params['volume']);
          if (isNaN(vol) || vol < 0 || vol > 100) throw new Error('volume must be 0-100');
          await spotifyInstance!.setVolume(vol);
          return { action: 'set_volume', volume: vol + '%', result: 'Volume set' };
        }

        case 'shuffle': {
          const enabled = params['enabled'] !== false && params['enabled'] !== 'false';
          await spotifyInstance!.setShuffle(enabled);
          return { action: 'shuffle', enabled, result: `Shuffle ${enabled ? 'on' : 'off'}` };
        }

        case 'repeat': {
          const mode = (params['mode'] as string) || 'off';
          if (!['track', 'context', 'off'].includes(mode)) throw new Error('mode must be: track, context, off');
          await spotifyInstance!.setRepeat(mode as 'track' | 'context' | 'off');
          return { action: 'repeat', mode, result: `Repeat set to ${mode}` };
        }

        case 'search': {
          const query = params['query'] as string;
          if (!query) throw new Error('query is required for search');
          const results = await spotifyInstance!.search(query, ['track', 'playlist'], 5);
          return { tracks: results.tracks, playlists: results.playlists };
        }

        case 'queue': {
          const uri = params['uri'] as string | undefined;
          const query = params['query'] as string | undefined;

          if (uri) {
            await spotifyInstance!.addToQueue(uri);
            return { action: 'queue', uri, result: 'Added to queue' };
          }
          if (query) {
            const results = await spotifyInstance!.search(query, ['track'], 1);
            if (results.tracks.length === 0) return { error: `No tracks found for "${query}"` };
            const track = results.tracks[0];
            await spotifyInstance!.addToQueue(track.uri);
            return { action: 'queue', track: track.name, artist: track.artist, result: 'Added to queue' };
          }
          throw new Error('query or uri is required for queue');
        }

        case 'devices': {
          const devices = await spotifyInstance!.getDevices();
          return { devices, count: devices.length };
        }

        case 'transfer': {
          const deviceId = params['device_id'] as string | undefined;
          const deviceName = params['device_name'] as string | undefined;

          if (deviceId) {
            await spotifyInstance!.transferPlayback(deviceId);
            return { action: 'transfer', device_id: deviceId, result: 'Playback transferred' };
          }
          if (deviceName) {
            const devices = await spotifyInstance!.getDevices();
            const match = devices.find(d => d.name.toLowerCase().includes(deviceName.toLowerCase()));
            if (!match) return { error: `No device found matching "${deviceName}". Available: ${devices.map(d => d.name).join(', ')}` };
            await spotifyInstance!.transferPlayback(match.id);
            return { action: 'transfer', device: match.name, result: 'Playback transferred' };
          }
          throw new Error('device_id or device_name is required for transfer');
        }

        case 'playlists': {
          const playlists = await spotifyInstance!.getMyPlaylists(20);
          return { playlists: playlists.map(p => ({ name: p.name, tracks: p.tracks_total, uri: p.uri })), count: playlists.length };
        }

        case 'play_playlist': {
          const query = params['query'] as string;
          if (!query) throw new Error('query is required for play_playlist');
          const deviceId = params['device_id'] as string | undefined;

          // Search user playlists first
          const myPlaylists = await spotifyInstance!.getMyPlaylists(50);
          const match = myPlaylists.find(p => p.name.toLowerCase().includes(query.toLowerCase()));
          if (match) {
            await spotifyInstance!.play({ contextUri: match.uri, deviceId });
            return { action: 'play_playlist', playlist: match.name, tracks: match.tracks_total, result: 'Playing' };
          }

          // Fallback to Spotify search
          const results = await spotifyInstance!.search(query, ['playlist'], 1);
          if (results.playlists.length === 0) return { error: `No playlist found for "${query}"` };
          const playlist = results.playlists[0];
          await spotifyInstance!.play({ contextUri: playlist.uri, deviceId });
          return { action: 'play_playlist', playlist: playlist.name, tracks: playlist.tracks_total, result: 'Playing' };
        }

        default:
          throw new Error(`Unknown action: ${action}. Valid: now_playing, play, pause, next, previous, set_volume, shuffle, repeat, search, queue, devices, transfer, playlists, play_playlist`);
      }
    });

    return { success: true, data: result, duration };
  }
}
