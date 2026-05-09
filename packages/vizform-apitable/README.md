# @winstonfassett/vizform-apitable

[APITable](https://aitable.ai) widget that renders a datasheet view as a vizform visualization. Supports all six viz modes (treemap, radial, bands, h-treemap, h-icicle, h-radial) driven by real datasheet records.

## Setup

This package uses `@apitable/widget-cli` and is not a standard npm library — it's a widget project you deploy to an APITable space.

```sh
npm install
npm run start    # widget-cli start — serves dev bundle with HMR
npm run build    # widget-cli release — bundles and uploads to APITable
```

## Deploy

See the [root repo README](../../README.md) for the full release recipe (token, spaceId, `widget.config.json` fields, self-hosted vs. aitable.ai differences).

Short version for aitable.ai cloud:

```sh
./node_modules/.bin/widget-cli release \
  --version 0.1.x \
  --host    https://aitable.ai \
  --token   <usk-token>
# first release only: answer the "Y/n?" prompt interactively
```

## Notes

- Requires React 17 (APITable widget SDK constraint)
- First release to a new `packageId` must be run interactively — `--ci` will not bypass the prompt
- For self-hosted APITable, also pass `--uploadHost http://your-host` or the bundle uploads to the wrong CDN
