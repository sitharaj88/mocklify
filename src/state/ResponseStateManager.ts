import { ResponseConfig } from '../types/core.js';

export interface ResponseSequence {
  responses: ResponseConfig[];
  currentIndex: number;
  resetAfter?: number; // Reset after N calls, or undefined for no reset
  resetOnTime?: number; // Reset after N milliseconds
  lastCalledAt?: Date;
}

export interface RouteCallState {
  callCount: number;
  firstCalledAt?: Date;
  lastCalledAt?: Date;
  sequence?: ResponseSequence;
}

export class ResponseStateManager {
  private routeStates: Map<string, RouteCallState> = new Map();
  private serverStates: Map<string, Map<string, RouteCallState>> = new Map();

  /**
   * Get or create state for a route
   */
  getRouteState(serverId: string, routeId: string): RouteCallState {
    const key = `${serverId}:${routeId}`;
    
    if (!this.routeStates.has(key)) {
      this.routeStates.set(key, {
        callCount: 0,
      });
    }

    return this.routeStates.get(key)!;
  }

  /**
   * Record a call to a route and return the current call count
   */
  recordCall(serverId: string, routeId: string): number {
    const state = this.getRouteState(serverId, routeId);
    const now = new Date();

    if (!state.firstCalledAt) {
      state.firstCalledAt = now;
    }
    state.lastCalledAt = now;
    state.callCount++;

    return state.callCount;
  }

  /**
   * Set up a response sequence for a route
   */
  setSequence(
    serverId: string,
    routeId: string,
    responses: ResponseConfig[],
    options?: { resetAfter?: number; resetOnTime?: number }
  ): void {
    const state = this.getRouteState(serverId, routeId);

    state.sequence = {
      responses,
      currentIndex: 0,
      resetAfter: options?.resetAfter,
      resetOnTime: options?.resetOnTime,
    };
  }

  /**
   * Get the next response in a sequence for a route
   * Returns null if no sequence is configured
   */
  getNextSequenceResponse(serverId: string, routeId: string): ResponseConfig | null {
    const state = this.getRouteState(serverId, routeId);

    if (!state.sequence || state.sequence.responses.length === 0) {
      return null;
    }

    const sequence = state.sequence;
    const now = new Date();

    // Check time-based reset
    if (
      sequence.resetOnTime &&
      sequence.lastCalledAt &&
      now.getTime() - sequence.lastCalledAt.getTime() > sequence.resetOnTime
    ) {
      sequence.currentIndex = 0;
    }

    // Get current response
    const response = sequence.responses[sequence.currentIndex];

    // Advance index
    sequence.currentIndex++;
    sequence.lastCalledAt = now;

    // Check call-count-based reset
    if (sequence.resetAfter && sequence.currentIndex >= sequence.resetAfter) {
      sequence.currentIndex = 0;
    }

    // Wrap around if at end
    if (sequence.currentIndex >= sequence.responses.length) {
      // Stay at last response unless reset is configured
      if (!sequence.resetAfter) {
        sequence.currentIndex = sequence.responses.length - 1;
      } else {
        sequence.currentIndex = 0;
      }
    }

    return response;
  }

  /**
   * Check if a route has a sequence configured
   */
  hasSequence(serverId: string, routeId: string): boolean {
    const state = this.getRouteState(serverId, routeId);
    return !!state.sequence && state.sequence.responses.length > 0;
  }

  /**
   * Reset state for a specific route
   */
  resetRoute(serverId: string, routeId: string): void {
    const key = `${serverId}:${routeId}`;
    this.routeStates.delete(key);
  }

  /**
   * Reset all state for a server
   */
  resetServer(serverId: string): void {
    const prefix = `${serverId}:`;
    for (const key of this.routeStates.keys()) {
      if (key.startsWith(prefix)) {
        this.routeStates.delete(key);
      }
    }
  }

  /**
   * Reset all state
   */
  resetAll(): void {
    this.routeStates.clear();
  }

  /**
   * Get call count for a route
   */
  getCallCount(serverId: string, routeId: string): number {
    return this.getRouteState(serverId, routeId).callCount;
  }

  /**
   * Get all route states for a server
   */
  getServerStats(serverId: string): Map<string, RouteCallState> {
    const stats = new Map<string, RouteCallState>();
    const prefix = `${serverId}:`;

    for (const [key, state] of this.routeStates.entries()) {
      if (key.startsWith(prefix)) {
        const routeId = key.slice(prefix.length);
        stats.set(routeId, { ...state });
      }
    }

    return stats;
  }

  /**
   * Export state to JSON for persistence
   */
  toJSON(): object {
    const data: Record<string, RouteCallState> = {};
    for (const [key, state] of this.routeStates.entries()) {
      data[key] = {
        ...state,
        sequence: state.sequence
          ? {
              ...state.sequence,
              responses: state.sequence.responses,
            }
          : undefined,
      };
    }
    return data;
  }

  /**
   * Import state from JSON
   */
  fromJSON(data: Record<string, RouteCallState>): void {
    this.routeStates.clear();
    for (const [key, state] of Object.entries(data)) {
      this.routeStates.set(key, {
        ...state,
        firstCalledAt: state.firstCalledAt ? new Date(state.firstCalledAt) : undefined,
        lastCalledAt: state.lastCalledAt ? new Date(state.lastCalledAt) : undefined,
        sequence: state.sequence
          ? {
              ...state.sequence,
              lastCalledAt: state.sequence.lastCalledAt
                ? new Date(state.sequence.lastCalledAt)
                : undefined,
            }
          : undefined,
      });
    }
  }
}

// Singleton instance
export const responseStateManager = new ResponseStateManager();
