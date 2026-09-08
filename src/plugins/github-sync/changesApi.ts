const LOCK_API = import.meta.env.VITE_LOCK_API_URL as string;

export type ChangeType = 'added' | 'deleted' | 'updated';
export type EntityType = 'room' | 'label' | 'area';

export interface ChangeContext {
    name?: string;
    area?: string;
    text?: string;
    coords?: number[];
}

export interface MapChange {
    _id: string;
    entityKey: string;
    entityType: EntityType;
    entityId: number | string;
    areaId?: number;
    changeType: ChangeType;
    /** Present for added/deleted — full sanitized entity snapshot. */
    entity?: Record<string, unknown>;
    /** Present for updated — per-field diff from mudlet-map-diff. */
    changes?: Record<string, unknown>;
    context?: ChangeContext;
    version: string;
    commit?: string;
    author?: { name?: string; email?: string; actor?: string };
    /** ISO string (BSON Date serialized over JSON). */
    timestamp?: string;
}

export interface ChangesPage {
    /** Query window: how many documents to fetch (server caps at 500). */
    limit?: number;
    /** How many to skip — the offset of the next page. */
    skip?: number;
}

function changesUrl(params: Record<string, string | number | undefined>): string {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v !== undefined) qs.set(k, String(v));
    return `${LOCK_API}/api/changes?${qs}`;
}

/** Fetch the edit history of a single map object, newest first. */
export async function fetchChanges(entityKey: string, page: ChangesPage = {}): Promise<MapChange[]> {
    const res = await fetch(changesUrl({ entityKey, limit: page.limit, skip: page.skip }));
    if (!res.ok) return [];
    return res.json();
}

/** Fetch changes within an area (the area itself plus its rooms/labels),
 *  newest first. Paged: the endpoint returns at most `limit` documents, so the
 *  caller asks for the next window with `skip` once the user wants more. */
export async function fetchAreaChanges(areaId: number, page: ChangesPage = {}): Promise<MapChange[]> {
    const res = await fetch(changesUrl({ areaId, limit: page.limit, skip: page.skip }));
    if (!res.ok) return [];
    return res.json();
}
