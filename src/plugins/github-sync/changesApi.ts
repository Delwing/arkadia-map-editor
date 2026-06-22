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

/** Fetch the edit history of a single map object, newest first. */
export async function fetchChanges(entityKey: string): Promise<MapChange[]> {
    const res = await fetch(`${LOCK_API}/api/changes?entityKey=${encodeURIComponent(entityKey)}`);
    if (!res.ok) return [];
    return res.json();
}

/** Fetch all changes within an area (the area itself plus its rooms/labels). */
export async function fetchAreaChanges(areaId: number): Promise<MapChange[]> {
    const res = await fetch(`${LOCK_API}/api/changes?areaId=${areaId}`);
    if (!res.ok) return [];
    return res.json();
}
