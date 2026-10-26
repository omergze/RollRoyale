import type { GameSimulation } from '../simulation/GameSimulation';
import type { GameEvent, MatchConfig, PlayerInputCommand, SimulationSnapshot } from '../types/game';

/**
 * NetworkAdapter abstraction layer that decouples input submission and state snapshots
 * from the underlying transport.
 *
 * - Current release: `LocalLoopbackAdapter` runs `GameSimulation` directly in-process.
 * - Future multiplayer: `ColyseusNetworkAdapter` sends `PlayerInputCommand` packets over
 *   WebSockets and reconciles authoritative `SimulationSnapshot` updates.
 */
export interface INetworkAdapter {
  startMatch(config: MatchConfig): void;
  sendInput(input: PlayerInputCommand): void;
  setPaused(paused: boolean): void;
  update(deltaSeconds: number): { snapshot: SimulationSnapshot; events: GameEvent[]; alpha: number };
  dispose(): void;
}

export class LocalLoopbackAdapter implements INetworkAdapter {
  private simulation: GameSimulation;

  constructor(simulation: GameSimulation) {
    this.simulation = simulation;
  }

  public startMatch(config: MatchConfig): void {
    this.simulation.startMatch(config);
  }

  public sendInput(input: PlayerInputCommand): void {
    this.simulation.setPlayerInput(input);
  }

  public setPaused(paused: boolean): void {
    this.simulation.setPaused(paused);
  }

  public update(deltaSeconds: number): {
    snapshot: SimulationSnapshot;
    events: GameEvent[];
    alpha: number;
  } {
    const alpha = this.simulation.update(deltaSeconds);
    const snapshot = this.simulation.getSnapshot();
    const events = this.simulation.drainEvents();
    return { snapshot, events, alpha };
  }

  public getSimulation(): GameSimulation {
    return this.simulation;
  }

  public dispose(): void {
    this.simulation.dispose();
  }
}
