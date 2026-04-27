import i18n from 'i18next';
import type { EditorPlugin, PluginCheckResult } from 'mudlet-map-editor';

type ArkadiaMap = Parameters<NonNullable<EditorPlugin['mapChecks']>>[0];

const VALID_DIRS = new Set(['north', 'south', 'east', 'west', 'northeast', 'northwest', 'southeast', 'southwest', 'up', 'down']);

const DIR_FIELDS: [string, string][] = [
  ['north', 'n'], ['south', 's'], ['east', 'e'], ['west', 'w'],
  ['northeast', 'ne'], ['northwest', 'nw'], ['southeast', 'se'], ['southwest', 'sw'],
  ['up', 'u'], ['down', 'd'], ['in', 'in'], ['out', 'out'],
];

function getRoomExits(room: NonNullable<ArkadiaMap['rooms'][number]>): Set<string> {
  const exits = new Set<string>();
  for (const [field, abbr] of DIR_FIELDS) {
    if (((room as unknown as Record<string, unknown>)[field] as number) > 0) exits.add(abbr);
  }
  for (const key of Object.keys(room.mSpecialExits ?? {})) exits.add(key);
  return exits;
}

export function checkMap(map: ArkadiaMap): PluginCheckResult[] {
  const results: PluginCheckResult[] = [];

  for (const [idStr, room] of Object.entries(map.rooms)) {
    if (!room) continue;
    const roomId = Number(idStr);
    const ud = room.userData;

    // dir_bind: key must be a short dir, command must not be empty
    const dirBindRaw = ud?.['dir_bind'];
    if (dirBindRaw) {
      for (const pair of dirBindRaw.split('&').filter(Boolean)) {
        const eq = pair.indexOf('=');
        const dir = eq === -1 ? pair : pair.slice(0, eq);
        const cmd = eq === -1 ? '' : pair.slice(eq + 1);
        if (!VALID_DIRS.has(dir)) {
          results.push({
            id: `dir-bind-invalid-key:${roomId}:${dir}`,
            message: i18n.t('checks.dirBindInvalidDirMsg', { ns: 'arkadia', dir }),
            detail: i18n.t('checks.dirBindInvalidDirDetail', { ns: 'arkadia', roomId, dir }),
            roomId,
          });
        } else if (!cmd.trim()) {
          results.push({
            id: `dir-bind-empty-cmd:${roomId}:${dir}`,
            message: i18n.t('checks.dirBindEmptyCmdMsg', { ns: 'arkadia', dir }),
            detail: i18n.t('checks.dirBindEmptyCmdDetail', { ns: 'arkadia', roomId, dir }),
            roomId,
          });
        }
      }
    }

    // team_follow_link: "to" must be an actual exit of this room
    const teamFollowRaw = ud?.['team_follow_link'];
    if (teamFollowRaw) {
      const exits = getRoomExits(room);
      for (const pair of teamFollowRaw.split('#').filter(Boolean)) {
        const star = pair.indexOf('*');
        const to = star === -1 ? '' : pair.slice(star + 1);
        if (to && !exits.has(to)) {
          results.push({
            id: `team-follow-invalid-exit:${roomId}:${to}`,
            message: i18n.t('checks.teamFollowBadExitMsg', { ns: 'arkadia', exit: to }),
            detail: i18n.t('checks.teamFollowBadExitDetail', { ns: 'arkadia', roomId, exit: to }),
            roomId,
          });
        }
      }
    }

    // gps: every entry must have at least one trigger line
    const gpsRaw = ud?.['gps'];
    if (gpsRaw) {
      try {
        const entries: { gps_string_lines?: string[] }[] = JSON.parse(gpsRaw);
        if (Array.isArray(entries)) {
          entries.forEach((entry, idx) => {
            if (!entry.gps_string_lines || entry.gps_string_lines.length === 0) {
              results.push({
                id: `gps-empty:${roomId}:${idx}`,
                message: i18n.t('checks.gpsEmptyMsg', { ns: 'arkadia', idx: idx + 1 }),
                detail: i18n.t('checks.gpsEmptyDetail', { ns: 'arkadia', roomId, idx: idx + 1 }),
                roomId,
              });
            }
          });
        }
      } catch {
        // unparseable GPS userData — ignore
      }
    }
  }

  return results;
}
