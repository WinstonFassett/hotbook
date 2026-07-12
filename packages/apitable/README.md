# @hotbook/apitable

APITable widget adapter that renders a datasheet view as a hotbook visualization. It supports flat modes (treemap, bands, pie, arc) and hierarchical modes (h-treemap, h-icicle, h-sunburst) based on the active view's grouping. It is currently stale and not actively maintained.

## What it does

- Implements a single React widget (`src/index.tsx`) using `@apitable/widget-sdk` to read the active view, records, fields, and group info.
- Maps numeric APITable fields to a value and builds a `bireactive` `BiNode` tree for grouped records.
- Registers custom elements from `@hotbook/bireactive` under APITable-specific tags and mounts them inside the widget.
- `widget.config.json` contains package metadata, host, and entry point.

## High-level structure

```
src/
  index.tsx        # Widget component and initializeWidget call
  widget.config.json
package.json
```

## Dependencies

- Peer dependency on `react >=17` (APITable widget SDK constraint).
- Uses `@apitable/widget-sdk` and `@apitable/widget-cli`.
- Depends on `@hotbook/core` and `@hotbook/bireactive` from the workspace.

## Setup / develop scripts

This is not a standard npm library; it is a widget project deployed to an APITable space.

```sh
npm install
npm run start   # widget-cli start — dev server with HMR
npm run build   # widget-cli release — bundle and upload to APITable
```

For release, see the root repo README for the full recipe (token, spaceId, host, self-hosted vs. aitable.ai differences). First release to a new `packageId` must be interactive; `--ci` does not bypass the prompt.

## License

AGPL-3.0
