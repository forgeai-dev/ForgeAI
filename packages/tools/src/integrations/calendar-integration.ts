import { createLogger } from '@forgeai/shared';

const logger = createLogger('Tools:Calendar');

export interface CalendarConfig {
  /** OAuth2 access token */
  accessToken: string;
  /** OAuth2 refresh token */
  refreshToken?: string;
  /** Google OAuth2 client ID */
  clientId?: string;
  /** Google OAuth2 client secret */
  clientSecret?: string;
  /** Default calendar ID (default: 'primary') */
  calendarId?: string;
}

export interface CalendarEvent {
  id: string;
  summary: string;
  description: string;
  location: string;
  start: string;
  end: string;
  allDay: boolean;
  status: string;
  htmlLink: string;
  creator: string;
  attendees: CalendarAttendee[];
  reminders: { useDefault: boolean; overrides?: Array<{ method: string; minutes: number }> };
  recurrence?: string[];
  colorId?: string;
}

export interface CalendarAttendee {
  email: string;
  displayName?: string;
  responseStatus: string;
  self?: boolean;
}

export interface CreateEventOptions {
  summary: string;
  description?: string;
  location?: string;
  start: string;
  end: string;
  allDay?: boolean;
  attendees?: string[];
  reminders?: Array<{ method: 'email' | 'popup'; minutes: number }>;
  recurrence?: string[];
  colorId?: string;
  timeZone?: string;
}

export interface UpdateEventOptions {
  summary?: string;
  description?: string;
  location?: string;
  start?: string;
  end?: string;
  attendees?: string[];
  colorId?: string;
}

export interface CalendarListEntry {
  id: string;
  summary: string;
  description?: string;
  primary: boolean;
  backgroundColor: string;
  foregroundColor: string;
  accessRole: string;
}

/**
 * Google Calendar Integration using Google Calendar API v3.
 *
 * Setup:
 * 1. Enable Google Calendar API in Google Cloud Console
 * 2. Configure OAuth2 via Dashboard Settings (Google provider)
 * 3. Grant calendar.readonly + calendar.events scopes
 *
 * Features:
 * - List calendars
 * - List/search events
 * - Create/update/delete events
 * - Quick add (natural language)
 * - Free/busy check
 */
export class CalendarIntegration {
  private config: CalendarConfig | null = null;
  private baseUrl = 'https://www.googleapis.com/calendar/v3';

  constructor() {
    logger.info('Calendar integration initialized');
  }

  configure(config: CalendarConfig): void {
    this.config = config;
    logger.info('Calendar configured');
  }

  isConfigured(): boolean {
    return !!this.config?.accessToken;
  }

  private get calendarId(): string {
    return this.config?.calendarId ?? 'primary';
  }

  private async request<T>(path: string, options?: RequestInit): Promise<T> {
    if (!this.config?.accessToken) throw new Error('Calendar not configured');
    const url = path.startsWith('http') ? path : `${this.baseUrl}${path}`;
    const res = await fetch(url, {
      ...options,
      headers: {
        'Authorization': `Bearer ${this.config.accessToken}`,
        'Content-Type': 'application/json',
        ...(options?.headers ?? {}),
      },
    });
    if (!res.ok) {
      const err = await res.text();
      logger.warn('Calendar API error', { status: res.status, error: err });
      throw new Error(`Calendar API ${res.status}: ${err}`);
    }
    return res.json() as Promise<T>;
  }

  // ─── Calendars ─────────────────────────────

  async getCalendars(): Promise<CalendarListEntry[]> {
    const data = await this.request<{ items?: Array<Record<string, unknown>> }>('/users/me/calendarList');
    return (data.items ?? []).map(c => ({
      id: String(c.id ?? ''),
      summary: String(c.summary ?? ''),
      description: c.description ? String(c.description) : undefined,
      primary: !!c.primary,
      backgroundColor: String(c.backgroundColor ?? '#4285f4'),
      foregroundColor: String(c.foregroundColor ?? '#ffffff'),
      accessRole: String(c.accessRole ?? 'reader'),
    }));
  }

  // ─── Events ────────────────────────────────

  async listEvents(opts?: {
    maxResults?: number;
    timeMin?: string;
    timeMax?: string;
    query?: string;
    calendarId?: string;
  }): Promise<CalendarEvent[]> {
    const params = new URLSearchParams();
    params.set('maxResults', String(opts?.maxResults ?? 20));
    params.set('singleEvents', 'true');
    params.set('orderBy', 'startTime');
    if (opts?.timeMin) params.set('timeMin', opts.timeMin);
    else params.set('timeMin', new Date().toISOString());
    if (opts?.timeMax) params.set('timeMax', opts.timeMax);
    if (opts?.query) params.set('q', opts.query);

    const cid = encodeURIComponent(opts?.calendarId ?? this.calendarId);
    const data = await this.request<{ items?: Array<Record<string, unknown>> }>(
      `/calendars/${cid}/events?${params}`
    );
    return (data.items ?? []).map(e => this.parseEvent(e));
  }

  async getEvent(eventId: string, calendarId?: string): Promise<CalendarEvent> {
    const cid = encodeURIComponent(calendarId ?? this.calendarId);
    const data = await this.request<Record<string, unknown>>(
      `/calendars/${cid}/events/${encodeURIComponent(eventId)}`
    );
    return this.parseEvent(data);
  }

  async createEvent(opts: CreateEventOptions, calendarId?: string): Promise<CalendarEvent> {
    const cid = encodeURIComponent(calendarId ?? this.calendarId);
    const body: Record<string, unknown> = {
      summary: opts.summary,
      description: opts.description,
      location: opts.location,
    };

    if (opts.allDay) {
      body.start = { date: opts.start.split('T')[0] };
      body.end = { date: opts.end.split('T')[0] };
    } else {
      const tz = opts.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
      body.start = { dateTime: opts.start, timeZone: tz };
      body.end = { dateTime: opts.end, timeZone: tz };
    }

    if (opts.attendees) {
      body.attendees = opts.attendees.map(email => ({ email }));
    }
    if (opts.reminders) {
      body.reminders = { useDefault: false, overrides: opts.reminders };
    }
    if (opts.recurrence) body.recurrence = opts.recurrence;
    if (opts.colorId) body.colorId = opts.colorId;

    const data = await this.request<Record<string, unknown>>(
      `/calendars/${cid}/events`,
      { method: 'POST', body: JSON.stringify(body) }
    );
    logger.info('Event created', { id: data.id, summary: opts.summary });
    return this.parseEvent(data);
  }

  async updateEvent(eventId: string, opts: UpdateEventOptions, calendarId?: string): Promise<CalendarEvent> {
    const cid = encodeURIComponent(calendarId ?? this.calendarId);
    const body: Record<string, unknown> = {};
    if (opts.summary !== undefined) body.summary = opts.summary;
    if (opts.description !== undefined) body.description = opts.description;
    if (opts.location !== undefined) body.location = opts.location;
    if (opts.start !== undefined) {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      body.start = { dateTime: opts.start, timeZone: tz };
    }
    if (opts.end !== undefined) {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      body.end = { dateTime: opts.end, timeZone: tz };
    }
    if (opts.attendees) body.attendees = opts.attendees.map(email => ({ email }));
    if (opts.colorId !== undefined) body.colorId = opts.colorId;

    const data = await this.request<Record<string, unknown>>(
      `/calendars/${cid}/events/${encodeURIComponent(eventId)}`,
      { method: 'PATCH', body: JSON.stringify(body) }
    );
    logger.info('Event updated', { id: eventId });
    return this.parseEvent(data);
  }

  async deleteEvent(eventId: string, calendarId?: string): Promise<boolean> {
    const cid = encodeURIComponent(calendarId ?? this.calendarId);
    if (!this.config?.accessToken) throw new Error('Calendar not configured');
    const res = await fetch(
      `${this.baseUrl}/calendars/${cid}/events/${encodeURIComponent(eventId)}`,
      {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${this.config.accessToken}` },
      }
    );
    logger.info('Event deleted', { id: eventId, status: res.status });
    return res.status === 204 || res.ok;
  }

  async quickAdd(text: string, calendarId?: string): Promise<CalendarEvent> {
    const cid = encodeURIComponent(calendarId ?? this.calendarId);
    const data = await this.request<Record<string, unknown>>(
      `/calendars/${cid}/events/quickAdd?text=${encodeURIComponent(text)}`,
      { method: 'POST' }
    );
    logger.info('Quick add event', { text, id: data.id });
    return this.parseEvent(data);
  }

  // ─── Free/Busy ─────────────────────────────

  async getFreeBusy(timeMin: string, timeMax: string, calendarIds?: string[]): Promise<Record<string, Array<{ start: string; end: string }>>> {
    const data = await this.request<{ calendars?: Record<string, { busy?: Array<{ start: string; end: string }> }> }>(
      '/freeBusy',
      {
        method: 'POST',
        body: JSON.stringify({
          timeMin,
          timeMax,
          items: (calendarIds ?? [this.calendarId]).map(id => ({ id })),
        }),
      }
    );
    const result: Record<string, Array<{ start: string; end: string }>> = {};
    for (const [cid, cal] of Object.entries(data.calendars ?? {})) {
      result[cid] = cal.busy ?? [];
    }
    return result;
  }

  // ─── Today / Upcoming helpers ──────────────

  async getToday(calendarId?: string): Promise<CalendarEvent[]> {
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const endOfDay = new Date(startOfDay.getTime() + 86400000);
    return this.listEvents({
      timeMin: startOfDay.toISOString(),
      timeMax: endOfDay.toISOString(),
      calendarId,
    });
  }

  async getUpcoming(days: number = 7, calendarId?: string): Promise<CalendarEvent[]> {
    const now = new Date();
    const end = new Date(now.getTime() + days * 86400000);
    return this.listEvents({
      timeMin: now.toISOString(),
      timeMax: end.toISOString(),
      maxResults: 50,
      calendarId,
    });
  }

  // ─── Parser ────────────────────────────────

  private parseEvent(e: Record<string, unknown>): CalendarEvent {
    const start = e.start as Record<string, string> | undefined;
    const end = e.end as Record<string, string> | undefined;
    const allDay = !!start?.date;
    const attendees = (e.attendees as Array<Record<string, unknown>> | undefined) ?? [];
    const creator = e.creator as Record<string, string> | undefined;
    const reminders = e.reminders as Record<string, unknown> | undefined;

    return {
      id: String(e.id ?? ''),
      summary: String(e.summary ?? '(sem título)'),
      description: String(e.description ?? ''),
      location: String(e.location ?? ''),
      start: allDay ? (start?.date ?? '') : (start?.dateTime ?? ''),
      end: allDay ? (end?.date ?? '') : (end?.dateTime ?? ''),
      allDay,
      status: String(e.status ?? 'confirmed'),
      htmlLink: String(e.htmlLink ?? ''),
      creator: creator?.email ?? '',
      attendees: attendees.map(a => ({
        email: String(a.email ?? ''),
        displayName: a.displayName ? String(a.displayName) : undefined,
        responseStatus: String(a.responseStatus ?? 'needsAction'),
        self: !!a.self,
      })),
      reminders: {
        useDefault: !!(reminders?.useDefault),
        overrides: (reminders?.overrides as Array<{ method: string; minutes: number }>) ?? undefined,
      },
      recurrence: e.recurrence as string[] | undefined,
      colorId: e.colorId ? String(e.colorId) : undefined,
    };
  }
}

export function createCalendarIntegration(): CalendarIntegration {
  return new CalendarIntegration();
}
