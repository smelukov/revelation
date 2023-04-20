# revelation

[![npm version](https://badge.fury.io/js/revelation-resolver.svg)](https://badge.fury.io/js/revelation-resolver)

Fast node.js modules resolver.

## Why 

- supports webpack-like [mainFiles](https://webpack.js.org/configuration/resolve/#resolvemainfiles) option
- provides [packageJSONModifier](#packagejsonmodifier-packagejsonmodifier) option to modify or collect any `package.json`
- works fast

## Install

```shell
npm i revelation-resolver --save
# or
yarn add revelation-resolver
# or
pnpm add revelation-resolver --save-prod
```

## Using

```typescript
import Revelation from 'revelation-resolver';

const resolver = new Revelation();

console.log(resolver.resolve('/base/dir', './foo'));
```

## API

### constructor(options: Options)

Possible options:

```typescript
type Options = {
    fileSystem?: typeof fs; // default: require('node:fs')
    mainFiles?: string[]; // default: ['index']
    modules?: string[]; // default: ['node_modules']
    mainFields?: string[]; // default: ['main', 'browser']
    extensions?: string[]; // default: ['.js']
    packageJSONModifier?: PackageJSONModifier;
}

type PackageJSONModifier = (
    absPath: string,
    packageJSON: Record<string, unknown>,
) => Record<string, unknown> | null | undefined;
```

#### `fileSystem: typeof fs`

Target file system (e.g. [memfs](https://www.npmjs.com/package/memfs))

`require('node:fs')` by default

#### `mainFiles: string[]`

A list of main files in directories

`['index']` by default

#### modules?: string[]

A list of directories to resolve modules from, might be absolute path or folder name

`['node_modules']` by default

#### mainFields?: string[]

A list of main fields in description files

`['main', 'browser']` by default

#### extensions?: string[]

A list of extensions which should be tried for files

`['.js']` by default

#### packageJSONModifier?: PackageJSONModifier

A function that will be executing for every `package.json` (once for every `package.json`) for modifying purposes

### resolve(basedir: string, request: string): string | null

Resolves `request` from `basedir`.

`request` may be absolute, relative or package-based path.

## Using with jest

__rev-resolver.js:__

```js
const Revelation = require('revelation-resolver').default;
const rev = new Revelation(options);
module.exports = (request, options) => rev.resolve(options.basedir, request);
```

__jest.config.js:__

```js
module.exports = {
  resolver: './path/to/rev-resolver'
};
```
