/**
 * The slice of the Arkadia web client's plugin API that `client-plugin/index.ts`
 * uses.
 *
 * The client publishes full types as `@arkadia/plugin-types`, a tarball on its
 * GitHub Pages site — but that artifact is rebuilt with a fresh timestamp on
 * every client deploy, so its hash changes even when the types do not. Pinning
 * it in `yarn.lock` therefore breaks `yarn install --frozen-lockfile` in CI
 * after any unrelated client release. Declaring the handful of members we
 * actually call keeps the two repos deploying independently.
 *
 * Keep this in step with `src/client/PluginApi.ts` in arkadia-web-client-extension.
 * It is deliberately narrow: anything not listed here is not used by the plugin,
 * and adding to it should mean the plugin genuinely started calling it.
 */
declare module '@arkadia/plugin-types' {
  /** Room as the client's map reader holds it. Coordinates are y-**down**. */
  export interface ClientRoom {
    id: number;
    area: number;
    name: string;
    x: number;
    y: number;
    z: number;
    userData?: Record<string, string>;
  }

  export interface ClientAreaInfo {
    areaId: number;
    areaName: string;
    rooms: ClientRoom[];
  }

  export interface MapApi {
    getRoom(): ClientRoom | undefined;
    getAreas(): ClientAreaInfo[];
    setLocation(roomId: number): void;
    /**
     * Replace whole areas of the loaded map for this session. Areas arrive in
     * the shape the client loads its map in, coordinates in source orientation
     * (y-up); the client flips y on the way in.
     *
     * @returns how many areas were replaced.
     */
    syncAreas(areas: unknown[]): number;
    /**
     * Replace the entire loaded map for this session — the only call that can
     * change the *set* of areas.
     *
     * @returns false when the payload held no areas.
     */
    replaceMap(mapData: unknown[], colors?: unknown): boolean;
  }

  export interface EventsApi {
    on(event: string, listener: never, options?: unknown): void;
    off(event: string, listener: never): void;
  }

  export interface AliasesApi {
    register(pattern: RegExp, callback: (matches?: RegExpMatchArray) => boolean): string;
    remove(id: string): void;
  }

  export interface OutputApi {
    print(text: string): void;
  }

  export interface PluginApi {
    map: MapApi;
    events: EventsApi;
    aliases: AliasesApi;
    output: OutputApi;
  }

  /** Metadata a plugin returns from `init`. */
  export interface PluginInfo {
    name: string;
    version: string;
    author?: string;
    description?: string;
  }
}
