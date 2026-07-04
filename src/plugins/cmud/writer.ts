/**
 * MudletMap → cMUD `.dbm` (SQLite) serializer — the write half of the format.
 *
 * The schema is copied verbatim from a real cMUD-produced Arkadia map so the
 * output opens in cMUD. Encoding conventions observed in that file and kept
 * here:
 *  - `ExitTbl.DirType` stores `DirId - 1`; bidirectional links are two rows
 *    pointing at each other via `ExitIdTo`; one-way exits are unpaired rows
 *    with `ExitIdTo = -1`; unexplored stubs additionally have `ToID = FromID`.
 *  - in/out and special exits carry their command in `Name` with `DirType = -1`
 *    (cMUD's DirTbl has no in/out).
 *  - booleans are `'Y'`/`'N'` text, colors 24-bit BGR ints, `0x1FFFFFFF` means
 *    "inherit".
 *  - `VersTbl` holds next-free-id counters.
 *
 * Mudlet-only data cMUD can't hold goes into the `ArkadiaMetaTbl` sidecar and
 * per-room `ObjectTbl.Content` JSON — see meta.ts. Doors and weights are
 * additionally projected onto cMUD-native columns (`ExitKindID`, `Distance`,
 * `Cost`, `Enabled`) so they show up in cMUD too.
 *
 * Known losses (nothing else is dropped): room hashes (`mRoomIdHash`,
 * `mpRoomDbHashToRoomId`), image labels (pixMap), and cardinal self-loop
 * exits (read back as stubs). Custom lines survive the sidecar, but are not
 * projected back onto `ExitTbl.X0..Z1`, so a cMUD client won't show them.
 */
import type { MudletMap } from 'mudlet-map-editor';
import { createDatabase } from './sqlite';
import { DIRS, DIR_BY_STUB_CODE } from './directions';
import { CMUD_DIR_ROWS } from './directions';
import {
  WRITER_ID,
  FORMAT_VERSION,
  DEFAULT_CELL_SCALE,
  type MudletGlobals,
  type LabelExtra,
  type AreaExtra,
  type RoomSidecar,
} from './meta';

type MudletRoom = MudletMap['rooms'][number];

const INHERIT = 0x1fffffff;

/** Encode RGB channels into cMUD's 24-bit BGR integer (`0x00BBGGRR`). */
function encodeBgr(rgb: { r: number; g: number; b: number }): number {
  return (rgb.r & 0xff) | ((rgb.g & 0xff) << 8) | ((rgb.b & 0xff) << 16);
}

/** Mudlet door state (1 open / 2 closed / 3 locked) → cMUD ExitKind (1 Door / 2 Locked Door). */
function doorKind(door: number | undefined): number {
  if (door === 3) return 2;
  if (door === 1 || door === 2) return 1;
  return 0;
}

const SCHEMA = [
  `CREATE TABLE ZoneTbl ([ZoneId] INTEGER PRIMARY KEY,[Name] VARCHAR(80),[ZoneFile] VARCHAR(80),[UserID] INTEGER DEFAULT 0,[Modified] TIMESTAMP,[Script] TEXT,[Desc] TEXT,[X] INTEGER DEFAULT 0,[Y] INTEGER DEFAULT 0,[Z] INTEGER DEFAULT 0,[Dx] INTEGER DEFAULT 0,[Dy] INTEGER DEFAULT 0,[MinX] INTEGER DEFAULT 0,[MinY] INTEGER DEFAULT 0,[MinZ] INTEGER DEFAULT 0,[MaxX] INTEGER DEFAULT 0,[MaxY] INTEGER DEFAULT 0,[MaxZ] INTEGER DEFAULT 0,[Background] VARCHAR(80),[XScale] INTEGER DEFAULT 0,[YScale] INTEGER DEFAULT 0,[XOffset] INTEGER DEFAULT 0,[YOffset] INTEGER DEFAULT 0,[Divisor] INTEGER DEFAULT 1,[Multiplier] INTEGER DEFAULT 1,[DefSize] INTEGER DEFAULT 0,[DefSizeY] INTEGER DEFAULT 0,[Res] INTEGER DEFAULT 0,[Color] INTEGER DEFAULT 536870911,[GridXInc] INTEGER DEFAULT 120,[GridYInc] INTEGER DEFAULT 120,[GridXOff] INTEGER DEFAULT 0,[GridYOff] INTEGER DEFAULT 0,[GridCol] INTEGER DEFAULT 0,[Flags] INTEGER DEFAULT 0,[Parent] INTEGER DEFAULT -1)`,
  `CREATE TABLE ObjectTbl ([ObjId] INTEGER PRIMARY KEY,[Name] VARCHAR(255),[IDName] VARCHAR(255),[Hint] VARCHAR(255),[Desc] TEXT,[KindID] INTEGER DEFAULT 0,[IconID] INTEGER DEFAULT -1,[RefNum] INTEGER DEFAULT 0,[fKey] INTEGER DEFAULT 0,[X] INTEGER DEFAULT 0,[Y] INTEGER DEFAULT 0,[Z] INTEGER DEFAULT 0,[Dx] INTEGER DEFAULT 0,[Dy] INTEGER DEFAULT 0,[ExitX] INTEGER DEFAULT 0,[ExitY] INTEGER DEFAULT 0,[ExitZ] INTEGER DEFAULT 0,[Cost] INTEGER DEFAULT 0,[Color] INTEGER DEFAULT 536870911,[MetaID] INTEGER DEFAULT -1,[StyleID] INTEGER DEFAULT 0,[LabelDir] INTEGER DEFAULT 11,[Enabled] BOOLEAN DEFAULT TRUE,[Script] TEXT,[Param] VARCHAR(80),[UserStr] VARCHAR(255),[UserInt] INTEGER DEFAULT 0,[Content] TEXT,[Flags] INTEGER DEFAULT 0,[Deleted] BOOLEAN DEFAULT FALSE,[UserID] INTEGER DEFAULT 0,[Modified] TIMESTAMP,[DateAdded] TIMESTAMP,[ServerID] INTEGER DEFAULT -1,[ZoneID] INTEGER DEFAULT 1)`,
  `CREATE TABLE ExitTbl ([ExitId] INTEGER PRIMARY KEY,[ExitIdTo] INTEGER DEFAULT -1,[FromID] INTEGER DEFAULT -1,[ToID] INTEGER DEFAULT -1,[ExitKindID] INTEGER DEFAULT 0,[Name] VARCHAR(80),[Param] VARCHAR(80),[Label] VARCHAR(80),[X0] INTEGER DEFAULT 0,[Y0] INTEGER DEFAULT 0,[Z0] INTEGER DEFAULT 0,[X1] INTEGER DEFAULT 0,[Y1] INTEGER DEFAULT 0,[Z1] INTEGER DEFAULT 0,[Distance] INTEGER DEFAULT 0,[Script] TEXT,[Color] INTEGER DEFAULT 536870911,[MetaID] INTEGER DEFAULT -1,[DrawRev] BOOLEAN DEFAULT FALSE,[DirType] INTEGER DEFAULT 0,[DirToType] INTEGER DEFAULT 0,[Tested] BOOLEAN DEFAULT TRUE,[Flags] INTEGER DEFAULT 0,[UserID] INTEGER DEFAULT 0,[Modified] TIMESTAMP)`,
  `CREATE TABLE DirTbl ([DirId] INTEGER PRIMARY KEY,[DirName] VARCHAR(80),[DirRef] INTEGER DEFAULT 0,[RevId] INTEGER DEFAULT 0,[Dx] INTEGER DEFAULT 0,[Dy] INTEGER DEFAULT 0,[Dz] INTEGER DEFAULT 0)`,
  `CREATE TABLE DrawTbl ([DrawId] INTEGER PRIMARY KEY,[X] INTEGER DEFAULT 0,[Y] INTEGER DEFAULT 0,[Z] INTEGER DEFAULT 0,[Dx] INTEGER DEFAULT 0,[Dy] INTEGER DEFAULT 0,[Name] VARCHAR(255),[Hint] VARCHAR(255),[MetaID] INTEGER DEFAULT -1,[StyleID] INTEGER DEFAULT 0,[ZoneID] INTEGER DEFAULT -1,[Flags] INTEGER DEFAULT 0,[UserID] INTEGER DEFAULT 0,[Modified] TIMESTAMP)`,
  `CREATE TABLE NoteTbl ([NoteId] INTEGER PRIMARY KEY,[ObjID] INTEGER DEFAULT -1,[Note] TEXT,[Category] INTEGER DEFAULT 0,[Flags] INTEGER DEFAULT 0,[UserID] INTEGER DEFAULT 0,[Deleted] BOOLEAN DEFAULT FALSE,[Modified] TIMESTAMP)`,
  `CREATE TABLE KindTbl ([KindId] INTEGER PRIMARY KEY,[Name] VARCHAR(80),[Desc] VARCHAR(255),[IconID] INTEGER DEFAULT -1,[Color] INTEGER DEFAULT 536870911,[MetaID] INTEGER DEFAULT -1,[Dx] INTEGER DEFAULT 0,[Dy] INTEGER DEFAULT 0,[Ref] INTEGER DEFAULT 0,[Flags] INTEGER DEFAULT 0,[Script] TEXT,[UserID] INTEGER DEFAULT 0,[StyleID] INTEGER DEFAULT 0,[ParentID] INTEGER DEFAULT -1,[DrawDef] BOOLEAN DEFAULT TRUE,[Pen] INTEGER DEFAULT 0,[Modified] TIMESTAMP)`,
  `CREATE TABLE ExitKindTbl ([ExitKindId] INTEGER PRIMARY KEY,[Name] VARCHAR(80),[Desc] VARCHAR(255),[Script] TEXT,[Style] INTEGER DEFAULT 0,[Color] INTEGER DEFAULT 536870911,[InnerWidth] INTEGER DEFAULT 0,[InnerColor] INTEGER DEFAULT 536870911,[FillColor] INTEGER DEFAULT 536870911,[DoorColor] INTEGER DEFAULT 536870911,[Flags] INTEGER DEFAULT 0,[Dx] INTEGER DEFAULT 0,[MetaID] INTEGER DEFAULT -1,[IconID] INTEGER DEFAULT -1,[UserID] INTEGER DEFAULT 0,[ParentID] INTEGER DEFAULT -1,[DrawDef] BOOLEAN DEFAULT TRUE,[Modified] TIMESTAMP)`,
  `CREATE TABLE StyleTbl ([StyleId] INTEGER PRIMARY KEY,[Name] VARCHAR(80),[ParentID] INTEGER DEFAULT -1,[FontName] VARCHAR(80),[FontSize] INTEGER DEFAULT 10,[FontStyle] INTEGER DEFAULT 0,[Color] INTEGER DEFAULT 536870911,[Color2] INTEGER DEFAULT 536870911,[Flags] INTEGER DEFAULT 0,[UserID] INTEGER DEFAULT 0,[Modified] TIMESTAMP)`,
  `CREATE TABLE MetaTbl ([MetaId] INTEGER PRIMARY KEY,[X] INTEGER DEFAULT 0,[Y] INTEGER DEFAULT 0,[Z] INTEGER DEFAULT 0,[Dx] INTEGER DEFAULT 0,[Dy] INTEGER DEFAULT 0,[Label] VARCHAR(255),[DrawData] BLOB,[HasData] BOOLEAN DEFAULT FALSE,[Ref] INTEGER DEFAULT 0,[UID1] INTEGER DEFAULT 0,[UID2] INTEGER DEFAULT 0,[IconID] INTEGER DEFAULT -1,[ZoneID] INTEGER DEFAULT -1,[Color] INTEGER DEFAULT 536870911,[Flags] INTEGER DEFAULT 0,[ParentID] INTEGER DEFAULT -1,[UserID] INTEGER DEFAULT 0,[Modified] TIMESTAMP)`,
  `CREATE TABLE IconTbl ([IconId] INTEGER PRIMARY KEY,[Bitmap] BLOB,[Filename] VARCHAR(255),[UID1] INTEGER DEFAULT 0,[UID2] INTEGER DEFAULT 0,[UserID] INTEGER DEFAULT 0,[Modified] TIMESTAMP)`,
  `CREATE TABLE FavTbl ([FavId] INTEGER PRIMARY KEY,[Name] VARCHAR(80),[KindID] INTEGER DEFAULT -1,[ParentID] INTEGER DEFAULT -1,[ObjID] INTEGER DEFAULT -1)`,
  `CREATE TABLE PortalTbl ([PortalId] INTEGER PRIMARY KEY,[ToID] INTEGER DEFAULT 0,[Cost] INTEGER DEFAULT 0,[ZoneID] INTEGER DEFAULT -1,[Name] VARCHAR(255),[Flags] INTEGER DEFAULT 0,[Enable] BOOLEAN DEFAULT TRUE,[Modified] TIMESTAMP)`,
  `CREATE TABLE VersTbl ([VersId] INTEGER PRIMARY KEY,[VersNum] INTEGER DEFAULT 0,[IconID] INTEGER DEFAULT 1,[MetaID] INTEGER DEFAULT 1,[DrawID] INTEGER DEFAULT 1,[KindID] INTEGER DEFAULT 1,[FavID] INTEGER DEFAULT 1,[ZoneID] INTEGER DEFAULT 1,[ObjID] INTEGER DEFAULT 1,[ExitKindID] INTEGER DEFAULT 1,[NoteID] INTEGER DEFAULT 1,[StyleID] INTEGER DEFAULT 1,[ExitID] INTEGER DEFAULT 1,[PortalID] INTEGER DEFAULT 1,[DirID] INTEGER DEFAULT 1)`,
  `CREATE TABLE ArkadiaMetaTbl ([Key] VARCHAR(80) PRIMARY KEY,[Value] TEXT)`,
  // Indexes cMUD creates on its own files — kept so it doesn't have to rebuild them.
  `CREATE INDEX ObjZoneID ON ObjectTbl ([ZoneID])`,
  `CREATE INDEX OName ON ObjectTbl ([Name])`,
  `CREATE INDEX OX ON ObjectTbl ([X])`,
  `CREATE INDEX OY ON ObjectTbl ([Y])`,
  `CREATE INDEX OZ ON ObjectTbl ([Z])`,
  `CREATE INDEX DObj ON ObjectTbl ([Deleted])`,
  `CREATE INDEX ExitFrom ON ExitTbl ([FromID])`,
  `CREATE INDEX ExitTo ON ExitTbl ([ToID])`,
  `CREATE INDEX ExitToExit ON ExitTbl ([ExitIdTo])`,
  `CREATE INDEX DirExit ON ExitTbl ([DirType])`,
  `CREATE INDEX DirToExit ON ExitTbl ([DirToType])`,
  `CREATE INDEX NoteObjID ON NoteTbl ([ObjID])`,
  `CREATE INDEX NoteCat ON NoteTbl ([Category])`,
  `CREATE INDEX DrawZ ON DrawTbl ([ZoneID])`,
  `CREATE INDEX DrawZone ON ZoneTbl ([ZoneId])`,
];

export async function writeMudletMapToDbm(map: MudletMap): Promise<Uint8Array> {
  const S = DEFAULT_CELL_SCALE;
  const db = await createDatabase();
  try {
    db.run('BEGIN');
    for (const stmt of SCHEMA) db.run(stmt);

    // --- static reference rows -------------------------------------------
    for (const d of CMUD_DIR_ROWS) {
      db.run('INSERT INTO DirTbl (DirId, DirName, DirRef, RevId, Dx, Dy, Dz) VALUES (?,?,?,?,?,?,?)', [
        d.DirId, d.DirName, d.DirRef, d.RevId, d.Dx, d.Dy, d.Dz,
      ]);
    }
    db.run("INSERT INTO KindTbl (KindId, Name, Desc, DrawDef) VALUES (0, 'Room', '', 'Y')");
    db.run("INSERT INTO StyleTbl (StyleId, Name, FontName, FontSize) VALUES (0, 'Default', 'Courier New', 8)");
    db.run("INSERT INTO ExitKindTbl (ExitKindId, Name, Flags) VALUES (0, 'Normal Exit', 0)");
    db.run("INSERT INTO ExitKindTbl (ExitKindId, Name, Flags) VALUES (1, 'Door', 1)");
    db.run("INSERT INTO ExitKindTbl (ExitKindId, Name, Flags) VALUES (2, 'Locked Door', 3)");

    // --- zones -------------------------------------------------------------
    const zoneIds = new Set<number>([
      ...Object.keys(map.areaNames).map(Number),
      ...Object.keys(map.areas).map(Number),
      ...Object.values(map.rooms).map((r) => r.area),
    ]);
    const zoneStmt = db.prepare(
      'INSERT INTO ZoneTbl (ZoneId, Name, DefSize, DefSizeY, Divisor, Multiplier, MinX, MinY, MinZ, MaxX, MaxY, MaxZ, Parent) VALUES (?,?,?,?,1,1,?,?,?,?,?,?,-1)',
    );
    for (const zoneId of [...zoneIds].sort((a, b) => a - b)) {
      const area = map.areas[zoneId];
      // Mudlet y flips to cMUD -y, so min/max y swap roles.
      zoneStmt.run([
        zoneId,
        map.areaNames[zoneId] ?? '',
        S, S,
        Math.round((area?.min_x ?? 0) * S), Math.round(-(area?.max_y ?? 0) * S), area?.min_z ?? 0,
        Math.round((area?.max_x ?? 0) * S), Math.round(-(area?.min_y ?? 0) * S), area?.max_z ?? 0,
      ]);
    }
    zoneStmt.free();

    // --- rooms + notes -------------------------------------------------------
    const roomStmt = db.prepare(
      `INSERT INTO ObjectTbl (ObjId, Name, Desc, KindID, X, Y, Z, Cost, Color, StyleID, Enabled, UserStr, UserInt, Content, Flags, Deleted, ZoneID)
       VALUES (?,?,?,0,?,?,?,?,?,-1,?,?,?,?,0,'N',?)`,
    );
    const noteStmt = db.prepare(
      "INSERT INTO NoteTbl (NoteId, ObjID, Note, Category, Flags, Deleted) VALUES (?,?,?,?,0,'N')",
    );
    let nextNoteId = 1;
    for (const [idStr, room] of Object.entries(map.rooms)) {
      const id = Number(idStr);
      const envColor = map.mCustomEnvColors[room.environment];
      const sidecar = buildRoomSidecar(room);
      roomStmt.run([
        id,
        room.name,
        room.userData['cmud.description'] ?? '',
        // Coordinates may be fractional cells (cMUD imports); cMUD units are ints.
        Math.round(room.x * S),
        Math.round(-room.y * S),
        Math.round(room.z),
        room.weight > 1 ? room.weight : 0,
        envColor ? encodeBgr(envColor) : INHERIT,
        room.isLocked ? 'N' : 'Y',
        room.symbol || null,
        room.environment,
        sidecar,
        room.area,
      ]);
      for (const [key, value] of Object.entries(room.userData)) {
        if (key !== 'cmud.note' && !key.startsWith('cmud.note.')) continue;
        const cat = key === 'cmud.note' ? 0 : Number(key.slice('cmud.note.'.length));
        noteStmt.run([nextNoteId++, id, value, Number.isInteger(cat) ? cat : 0]);
      }
    }
    roomStmt.free();
    noteStmt.free();

    // --- exits ---------------------------------------------------------------
    const nextExitId = writeExits(db, map);

    // --- labels ---------------------------------------------------------------
    const drawStmt = db.prepare(
      "INSERT INTO DrawTbl (DrawId, ZoneID, X, Y, Z, Dx, Dy, Name, MetaID, StyleID, Flags) VALUES (?,?,?,?,?,?,?,?,-1,0,0)",
    );
    const labelExtras: Record<number, LabelExtra> = {};
    let nextDrawId = 1;
    for (const [areaIdStr, list] of Object.entries(map.labels)) {
      const areaId = Number(areaIdStr);
      for (const label of list) {
        if (!label.text) continue; // image-only labels can't be represented
        const drawId = nextDrawId++;
        drawStmt.run([
          drawId,
          areaId,
          Math.round(label.pos[0] * S),
          Math.round(-label.pos[1] * S),
          Math.round(label.pos[2]),
          Math.round(label.size[0] * S),
          Math.round(label.size[1] * S),
          label.text,
        ]);
        labelExtras[drawId] = {
          fg: label.fgColor,
          bg: label.bgColor,
          noScaling: label.noScaling,
          showOnTop: label.showOnTop,
          pos: label.pos,
          size: label.size,
        };
      }
    }
    drawStmt.free();

    // --- version counters (cMUD uses these to allocate new ids) --------------
    const maxId = (nums: number[]) => nums.reduce((a, b) => Math.max(a, b), 0) + 1;
    db.run(
      'INSERT INTO VersTbl (VersId, VersNum, ZoneID, ObjID, ExitID, NoteID, DrawID, DirID, KindID, StyleID, ExitKindID) VALUES (1, 42, ?,?,?,?,?,11,1,1,3)',
      [
        maxId([...zoneIds]),
        maxId(Object.keys(map.rooms).map(Number)),
        nextExitId,
        nextNoteId,
        nextDrawId,
      ],
    );

    // --- round-trip sidecar ---------------------------------------------------
    const globals: MudletGlobals = {
      version: map.version,
      envColors: map.envColors,
      mCustomEnvColors: map.mCustomEnvColors,
      mUserData: map.mUserData,
      mapSymbolFont: map.mapSymbolFont,
      mapFontFudgeFactor: map.mapFontFudgeFactor,
      useOnlyMapFont: map.useOnlyMapFont,
    };
    const areaExtras: Record<number, AreaExtra> = {};
    for (const [idStr, area] of Object.entries(map.areas)) {
      if (area.gridMode || Object.keys(area.userData).length > 0) {
        areaExtras[Number(idStr)] = { gridMode: area.gridMode, userData: area.userData };
      }
    }
    const metaStmt = db.prepare('INSERT INTO ArkadiaMetaTbl ([Key], [Value]) VALUES (?,?)');
    const metaRows: [string, string][] = [
      ['writer', WRITER_ID],
      ['formatVersion', String(FORMAT_VERSION)],
      ['cellScale', String(S)],
      ['mudletGlobals', JSON.stringify(globals)],
      ['labelExtras', JSON.stringify(labelExtras)],
      ['areaExtras', JSON.stringify(areaExtras)],
    ];
    for (const [key, value] of metaRows) metaStmt.run([key, value]);
    metaStmt.free();

    db.run('COMMIT');
    return db.export();
  } finally {
    db.close();
  }
}

/** Per-room sidecar JSON for `ObjectTbl.Content`, or null when nothing to keep. */
function buildRoomSidecar(room: MudletRoom): string | null {
  const sidecar: RoomSidecar = {};
  const extraUserData: Record<string, string> = {};
  for (const [key, value] of Object.entries(room.userData)) {
    if (key === 'cmud.description' || key === 'cmud.note' || key.startsWith('cmud.note.')) continue;
    extraUserData[key] = value;
  }
  if (Object.keys(extraUserData).length) sidecar.ud = extraUserData;
  if (Object.keys(room.customLines).length) {
    sidecar.cl = room.customLines;
    sidecar.cla = room.customLinesArrow;
    sidecar.clc = room.customLinesColor;
    sidecar.cls = room.customLinesStyle;
  }
  if (room.exitLocks.length) sidecar.el = room.exitLocks;
  if (room.mSpecialExitLocks.length) sidecar.sel = room.mSpecialExitLocks;
  if (Object.keys(room.doors).length) sidecar.d = room.doors;
  return Object.keys(sidecar).length ? JSON.stringify(sidecar) : null;
}

/**
 * Emit ExitTbl rows for every cardinal exit (paired when the reverse exit
 * exists), stub, in/out and special exit. Returns the next free exit id.
 */
function writeExits(db: Awaited<ReturnType<typeof createDatabase>>, map: MudletMap): number {
  const stmt = db.prepare(
    `INSERT INTO ExitTbl (ExitId, ExitIdTo, FromID, ToID, ExitKindID, Name, Distance, DirType, DirToType, Tested, Flags)
     VALUES (?,?,?,?,?,?,?,?,?,'Y',1)`,
  );
  let nextId = 1;
  const emit = (
    exitIdTo: number,
    fromId: number,
    toId: number,
    dirType: number,
    dirToType: number,
    name: string | null,
    room: MudletRoom,
    weightKey: string,
  ): number => {
    const id = nextId++;
    const door = room.doors[weightKey];
    const weight = room.exitWeights[weightKey];
    stmt.run([
      id, exitIdTo, fromId, toId,
      doorKind(door),
      name,
      weight !== undefined && weight > 1 ? weight : 0,
      dirType, dirToType,
    ]);
    return id;
  };

  // Directed cardinal exits, keyed "fromId|cmudDirId" → target room id.
  const directed = new Map<string, number>();
  for (const [idStr, room] of Object.entries(map.rooms)) {
    const id = Number(idStr);
    for (const dir of DIRS) {
      if (dir.cmudDirId === null) continue;
      const to = room[dir.field] as number;
      if (to > 0) directed.set(`${id}|${dir.cmudDirId}`, to);
    }
  }

  const dirById = new Map(DIRS.filter((d) => d.cmudDirId !== null).map((d) => [d.cmudDirId as number, d]));
  const consumed = new Set<string>();
  for (const [key, to] of directed) {
    if (consumed.has(key)) continue;
    consumed.add(key);
    const [fromStr, dirIdStr] = key.split('|');
    const from = Number(fromStr);
    const dirId = Number(dirIdStr);
    const dir = dirById.get(dirId)!;
    const revId = dir.cmudRevDirId!;
    const revDir = dirById.get(revId)!;
    const fromRoom = map.rooms[from];
    const revKey = `${to}|${revId}`;
    const bidirectional = to !== from && directed.get(revKey) === from && !consumed.has(revKey);
    if (bidirectional) {
      consumed.add(revKey);
      const toRoom = map.rooms[to];
      const idA = emit(-1, from, to, dirId - 1, revId - 1, null, fromRoom, dir.short);
      const idB = emit(idA, to, from, revId - 1, dirId - 1, null, toRoom, revDir.short);
      db.run('UPDATE ExitTbl SET ExitIdTo = ? WHERE ExitId = ?', [idB, idA]);
    } else {
      emit(-1, from, to, dirId - 1, revId - 1, null, fromRoom, dir.short);
    }
  }

  // Stubs, in/out, and special exits.
  for (const [idStr, room] of Object.entries(map.rooms)) {
    const id = Number(idStr);
    for (const code of room.stubs) {
      const dir = DIR_BY_STUB_CODE.get(code);
      if (!dir) continue;
      if (dir.cmudDirId !== null) {
        emit(-1, id, id, dir.cmudDirId - 1, dir.cmudRevDirId! - 1, null, room, dir.short);
      } else {
        emit(-1, id, id, -1, -1, dir.field, room, dir.short);
      }
    }
    for (const dir of DIRS) {
      if (dir.cmudDirId !== null) continue; // in/out only
      const to = room[dir.field] as number;
      if (to > 0) emit(-1, id, to, -1, -1, dir.field, room, dir.short);
    }
    for (const [name, to] of Object.entries(room.mSpecialExits)) {
      emit(-1, id, to, -1, -1, name, room, name);
    }
  }

  stmt.free();
  return nextId;
}
