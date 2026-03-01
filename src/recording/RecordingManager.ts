import * as fs from 'fs/promises';
import * as path from 'path';
import { RecordingSession, RecordingSessionConfig, RecordedRequest } from './RecordingSession.js';
import { RouteConfig } from '../types/core.js';

export interface RecordingManagerEvents {
  onSessionStarted: (session: RecordingSession) => void;
  onSessionStopped: (session: RecordingSession) => void;
  onRequestRecorded: (session: RecordingSession, request: RecordedRequest) => void;
}

export class RecordingManager {
  private sessions: Map<string, RecordingSession> = new Map();
  private activeSessionId: string | null = null;
  private recordingsPath: string;
  private eventHandlers: Partial<RecordingManagerEvents> = {};

  constructor(workspaceRoot: string | undefined) {
    this.recordingsPath = workspaceRoot
      ? path.join(workspaceRoot, '.mocklify', 'recordings')
      : '';
  }

  async initialize(): Promise<void> {
    if (!this.recordingsPath) return;

    try {
      await fs.mkdir(this.recordingsPath, { recursive: true });
    } catch (error) {
      console.error('Failed to create recordings directory:', error);
    }

    await this.loadSessions();
  }

  setEventHandlers(handlers: Partial<RecordingManagerEvents>): void {
    this.eventHandlers = { ...this.eventHandlers, ...handlers };
  }

  createSession(
    name: string,
    targetUrl: string,
    options?: Partial<RecordingSessionConfig>
  ): RecordingSession {
    const session = new RecordingSession(name, targetUrl, options);
    this.sessions.set(session.id, session);
    return session;
  }

  getSession(sessionId: string): RecordingSession | undefined {
    return this.sessions.get(sessionId);
  }

  getAllSessions(): RecordingSession[] {
    return Array.from(this.sessions.values());
  }

  getActiveSession(): RecordingSession | undefined {
    if (this.activeSessionId) {
      return this.sessions.get(this.activeSessionId);
    }
    return undefined;
  }

  startRecording(sessionId: string): void {
    if (this.activeSessionId && this.activeSessionId !== sessionId) {
      const activeSession = this.sessions.get(this.activeSessionId);
      if (activeSession) activeSession.stop();
    }

    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session not found: ${sessionId}`);

    session.start();
    this.activeSessionId = sessionId;
    this.eventHandlers.onSessionStarted?.(session);
  }

  async stopRecording(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session not found: ${sessionId}`);

    session.stop();

    if (this.activeSessionId === sessionId) {
      this.activeSessionId = null;
    }

    await this.saveSession(session);
    this.eventHandlers.onSessionStopped?.(session);
  }

  pauseRecording(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session not found: ${sessionId}`);
    session.pause();
  }

  resumeRecording(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session not found: ${sessionId}`);
    session.resume();
  }

  recordRequest(request: Omit<RecordedRequest, 'id' | 'timestamp'>): RecordedRequest | null {
    const session = this.getActiveSession();
    if (!session) return null;

    const recorded = session.record(request);
    if (recorded) {
      this.eventHandlers.onRequestRecorded?.(session, recorded);
    }

    return recorded;
  }

  async deleteSession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    if (session.state.status === 'recording' || session.state.status === 'paused') {
      session.stop();
    }

    this.sessions.delete(sessionId);

    if (this.activeSessionId === sessionId) {
      this.activeSessionId = null;
    }

    if (this.recordingsPath) {
      const filePath = path.join(this.recordingsPath, `${sessionId}.json`);
      try {
        await fs.unlink(filePath);
      } catch {
        // File might not exist
      }
    }
  }

  generateRoutesFromSession(
    sessionId: string,
    options?: {
      deduplicatePaths?: boolean;
      extractPathParams?: boolean;
    }
  ): RouteConfig[] {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session not found: ${sessionId}`);
    return session.generateRoutes(options);
  }

  private async saveSession(session: RecordingSession): Promise<void> {
    if (!this.recordingsPath) return;

    const filePath = path.join(this.recordingsPath, `${session.id}.json`);
    const data = JSON.stringify(session.toJSON(), null, 2);

    try {
      await fs.writeFile(filePath, data, 'utf-8');
    } catch (error) {
      console.error('Failed to save recording session:', error);
      throw error;
    }
  }

  private async loadSessions(): Promise<void> {
    if (!this.recordingsPath) return;

    try {
      const files = await fs.readdir(this.recordingsPath);

      for (const file of files) {
        if (!file.endsWith('.json')) continue;

        try {
          const filePath = path.join(this.recordingsPath, file);
          const content = await fs.readFile(filePath, 'utf-8');
          const data = JSON.parse(content);

          const session = RecordingSession.fromJSON(data);
          this.sessions.set(session.id, session);
        } catch (error) {
          console.error(`Failed to load recording session ${file}:`, error);
        }
      }
    } catch {
      // Directory might not exist yet
    }
  }

  async exportSession(sessionId: string, exportPath: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session not found: ${sessionId}`);

    const data = JSON.stringify(session.toJSON(), null, 2);
    await fs.writeFile(exportPath, data, 'utf-8');
  }

  async importSession(importPath: string): Promise<RecordingSession> {
    const content = await fs.readFile(importPath, 'utf-8');
    const data = JSON.parse(content);

    const session = RecordingSession.fromJSON(data);
    this.sessions.set(session.id, session);

    await this.saveSession(session);

    return session;
  }
}
