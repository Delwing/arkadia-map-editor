# Arkadia Map Editor

Web-based map editor for the [Arkadia](https://arkadia.rpg.pl) MUD, built on top of [mudlet-map-editor](https://github.com/Delwing/mudlet-map-editor).

## Features

- Load, edit and save Mudlet `.dat` map files
- Arkadia terrain and POI swatch sets
- GitHub sync — fetch the latest map, acquire an edit lock, and submit changes as a pull request

## GitHub Sync

The **Arkadia** tab in the side panel lets authorised contributors:

1. **Fetch** — download the latest released map directly into the editor
2. **Lock** — acquire a timed edit lock so only one person edits at a time
3. **Save** — stage the current map for upload (without downloading the file)
4. **Upload & create PR** — push the map to a branch and open a pull request with an optional description

Login is handled via GitHub OAuth — no personal access token required.

## Development

Requires [mudlet-map-editor](https://github.com/Delwing/mudlet-map-editor) checked out as a sibling directory.

```
git clone https://github.com/Delwing/mudlet-map-editor
git clone https://github.com/Delwing/arkadia-map-editor
cd arkadia-map-editor
npm install
npm run dev
```

Copy `.env.local.example` to `.env.local` and fill in the values:

```
VITE_GITHUB_CLIENT_ID=
VITE_LOCK_API_URL=
VITE_GITHUB_REPO=Delwing/arkadia-mapa
VITE_GITHUB_MAP_FILE=map_master3.dat
VITE_GITHUB_BRANCH=development
```
