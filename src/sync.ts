import * as fs from 'node:fs';
import * as path from 'node:path';
import { PackageJSONModifier } from './';

export type Options = {
  fileSystem?: typeof fs;
  mainFiles?: string[];
  modules?: string[];
  mainFields?: string[];
  extensions?: string[];
  packageJSONModifier?: PackageJSONModifier;
};

export type RealpathResult = { abs: string; stats: fs.Stats };

// TODO watch mode
// TODO package.json: package field

export default class SyncResolver {
  protected fileSystem: typeof fs;

  protected mainFiles: string[];

  protected modules: string[];

  protected mainFields: string[];

  protected extensions: string[];

  protected packageJSONModifier: PackageJSONModifier | null = null;

  protected resolveFromPackageJSONCache = new Map<string, string | null>();

  protected symlinkCache = new Map<string, string | null | false>();

  protected realpathCache = new Map<string, RealpathResult | null>();

  protected lstatCache = new Map<string, fs.Stats | null>();

  protected nearestNodeModulesCache = new Map<string, string | null>();

  protected resolveNodeModuleCache = new Map<string, string | null>();

  constructor(options?: Options) {
    this.fileSystem = options?.fileSystem ?? fs;
    this.mainFiles = options?.mainFiles ?? ['index'];
    this.extensions = options?.extensions ?? ['.js'];
    this.modules = options?.modules ?? ['node_modules'];
    this.mainFields = options?.mainFields ?? ['main', 'browser'];
    this.packageJSONModifier = options?.packageJSONModifier ?? null;
  }

  resolve(basedir: string, request: string): string | null {
    if (path.isAbsolute(request)) {
      return this.resolveAbsolute(basedir, request);
    }

    if (request.startsWith('.')) {
      return this.resolveRelative(basedir, request);
    }

    return this.resolvePackage(basedir, request);
  }

  private lstat(absPath: string): fs.Stats | null {
    const cached = this.lstatCache.get(absPath);
    if (cached !== undefined) {
      return cached;
    }
    const lstat = this.fileSystem.lstatSync(absPath, { throwIfNoEntry: false }) ?? null;

    if (!lstat) {
      const stat = this.fileSystem.statSync(absPath, { throwIfNoEntry: false }) ?? null;
      this.lstatCache.set(absPath, stat);

      return stat;
    }

    this.lstatCache.set(absPath, lstat);

    return lstat;
  }

  private realpathSync(absPath: string): string | null {
    try {
      return this.fileSystem.realpathSync(absPath);
    } catch {
      return null;
    }
  }

  private realpath(absPath: string): RealpathResult | null {
    const cachedRealpath = this.realpathCache.get(absPath);

    if (cachedRealpath !== undefined) {
      return cachedRealpath;
    }

    const stats = this.lstat(absPath);

    if (!stats) {
      this.realpathCache.set(absPath, null);
      return null;
    }

    let result: RealpathResult = {
      stats,
      abs: absPath,
    };

    let stack = [absPath];
    let cursor: string | undefined;
    const passed: string[] = [];

    // eslint-disable-next-line no-cond-assign
    while ((cursor = stack.pop())) {
      const cachedSymlink = this.symlinkCache.get(cursor);

      if (cachedSymlink) {
        const targetRealpath = path.join(cachedSymlink, absPath.slice(cursor.length));
        // this.realpathCache.set(absPath, newResult);
        result = {
          // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
          stats: this.lstat(targetRealpath)!,
          abs: targetRealpath,
        };
        stack = [targetRealpath];
        continue;
      }

      if (cachedSymlink === null) {
        return null;
      }

      if (cachedSymlink === false) {
        return result;
      }

      const cStats = this.lstat(cursor);

      if (!cStats) {
        this.realpathCache.set(absPath, null);
        this.symlinkCache.set(cursor, null);
        return null;
      }

      if (cStats.isSymbolicLink()) {
        const realpath = this.realpathSync(cursor);

        if (!realpath) {
          this.realpathCache.set(absPath, null);
          this.symlinkCache.set(cursor, null);
          return null;
        }

        const targetRealpath = path.join(realpath, absPath.slice(cursor.length));
        const newResult: RealpathResult = {
          // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
          stats: this.lstat(targetRealpath)!,
          abs: targetRealpath,
        };
        // this.realpathCache.set(targetRealpath, newResult);
        // this.realpathCache.set(absPath, newResult);
        this.symlinkCache.set(cursor, realpath);
        result = newResult;
        stack = [targetRealpath];
        continue;
      }

      const nextDir = path.resolve(cursor, '..');

      if (nextDir !== cursor) {
        passed.push(cursor);
        stack.push(nextDir);
      }
    }

    for (const el of passed) {
      this.symlinkCache.set(el, false);
    }

    this.realpathCache.set(absPath, result);
    return result;
  }

  private tryToResolve(absPath: string): string | null {
    const resolvedFile = this.tryToResolveFile(absPath);

    if (resolvedFile) {
      return resolvedFile;
    }

    return this.tryToResolveInDir(absPath);
  }

  private tryToResolveInDir(absPath: string): string | null {
    const resolvedFromPackageJSON = this.tryToResolveFromPackageJSON(absPath);

    if (resolvedFromPackageJSON) {
      return resolvedFromPackageJSON;
    }

    for (const file of this.mainFiles) {
      const resolvedPath = path.join(absPath, file);

      const resolvedFile = this.tryToResolveFile(resolvedPath);

      if (resolvedFile) {
        return resolvedFile;
      }
    }

    return null;
  }

  private tryToResolveFile(absPath: string): string | null {
    let realpath = this.realpath(absPath);

    if (realpath) {
      return realpath.stats.isFile() ? realpath.abs : null;
    }

    for (const ext of this.extensions) {
      const resolvedPath = absPath + ext;

      realpath = this.realpath(resolvedPath);
      if (realpath?.stats.isFile()) {
        return realpath.abs;
      }
    }

    return null;
  }

  private tryToResolveFromPackageJSON(absPath: string): string | null {
    const packageJSONPath = path.join(absPath, 'package.json');
    let resolvedFromPackageJSON = this.resolveFromPackageJSONCache.get(packageJSONPath);

    if (resolvedFromPackageJSON !== undefined) {
      return resolvedFromPackageJSON;
    }

    const realpath = this.realpath(packageJSONPath);

    if (!realpath?.stats.isFile()) {
      if (realpath) {
        this.resolveFromPackageJSONCache.set(realpath.abs, null);
      }

      this.resolveFromPackageJSONCache.set(packageJSONPath, null);

      return null;
    }

    resolvedFromPackageJSON = this.resolveFromPackageJSONCache.get(realpath.abs);

    if (resolvedFromPackageJSON !== undefined) {
      return resolvedFromPackageJSON;
    }

    let packageJSON = JSON.parse(this.fileSystem.readFileSync(realpath.abs, 'utf-8'));
    const modifierResult = this.packageJSONModifier?.(realpath.abs, packageJSON);

    if (modifierResult) {
      packageJSON = modifierResult;
    }

    for (const field of this.mainFields) {
      if (
        // eslint-disable-next-line no-prototype-builtins
        packageJSON.hasOwnProperty(field) &&
        typeof packageJSON[field] === 'string'
      ) {
        const resolved = this.resolveRelative(
          path.dirname(packageJSONPath),
          packageJSON[field]
        );
        this.resolveFromPackageJSONCache.set(packageJSONPath, resolved);
        this.resolveFromPackageJSONCache.set(realpath.abs, resolved);
        return resolved;
      }
    }

    this.resolveFromPackageJSONCache.set(packageJSONPath, null);
    this.resolveFromPackageJSONCache.set(realpath.abs, null);
    return null;
  }

  private resolveRelative(basedir: string, request: string): string | null {
    return this.tryToResolve(path.resolve(basedir, request));
  }

  private resolvePackage(basedir: string, request: string): string | null {
    const cached = this.resolveNodeModuleCache.get(path.resolve(basedir, request));

    if (cached !== undefined) {
      return cached;
    }

    let nearestNodeModule = this.nearestNodeModulesCache.get(basedir);
    const passed = new Set<string>();
    const stack = [nearestNodeModule ?? basedir];
    let cursor;

    // eslint-disable-next-line no-cond-assign
    while ((cursor = stack.pop())) {
      passed.add(cursor);
      nearestNodeModule = this.resolveNodeModuleCache.get(path.resolve(cursor, request));

      if (nearestNodeModule !== undefined) {
        return nearestNodeModule;
      }

      const cachedModulesRoot = this.nearestNodeModulesCache.get(cursor);

      if (cachedModulesRoot && cachedModulesRoot !== cursor) {
        if (!passed.has(cachedModulesRoot)) {
          stack.push(cachedModulesRoot);
          continue;
        }
      }

      for (const modulesDir of this.modules) {
        const resolvedModulesPath = path.resolve(cursor, modulesDir);
        const resolvedPath = path.resolve(resolvedModulesPath, request);

        if (
          !cachedModulesRoot &&
          !path.isAbsolute(modulesDir) &&
          this.lstat(resolvedModulesPath)
        ) {
          for (const el of passed) {
            if (!this.nearestNodeModulesCache.has(el)) {
              this.nearestNodeModulesCache.set(el, cursor);
            }
          }
        }

        const resolvedFile = this.tryToResolveFile(resolvedPath);

        if (resolvedFile) {
          for (const el of passed) {
            this.resolveNodeModuleCache.set(path.resolve(el, request), resolvedFile);
          }

          return resolvedFile;
        }

        const resolvedInDir = this.tryToResolveInDir(resolvedPath);

        if (resolvedInDir) {
          for (const el of passed) {
            this.resolveNodeModuleCache.set(path.resolve(el, request), resolvedInDir);
          }
          return resolvedInDir;
        }
      }

      const nextDir = path.resolve(cursor, '..');

      if (nextDir !== cursor) {
        stack.push(nextDir);
      }
    }

    for (const el of passed) {
      this.resolveNodeModuleCache.set(path.resolve(el, request), null);
    }

    return null;
  }

  private resolveAbsolute(basedir: string, request: string): string | null {
    return this.tryToResolve(path.resolve(basedir, request));
  }
}
