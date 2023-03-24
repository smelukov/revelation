import * as fs from 'node:fs';

import {Volume} from 'memfs';

import Sync from './sync';

function makeFS(struct: Record<string, string>): typeof fs {
    const volume = Volume.fromJSON(struct) as unknown as typeof fs;
    const statSyncFn = volume.statSync.bind(volume);
    const lstatSyncFn = volume.lstatSync.bind(volume);
    const realpathSyncFn = volume.realpathSync.bind(volume);
    const readFileSyncFn = volume.readFileSync.bind(volume);

    jest.spyOn(volume, 'statSync').mockImplementation(statSyncFn);
    jest.spyOn(volume, 'lstatSync').mockImplementation(lstatSyncFn);
    jest.spyOn(volume, 'realpathSync').mockImplementation(realpathSyncFn);
    jest.spyOn(volume, 'readFileSync').mockImplementation(readFileSyncFn);

    return volume;
}

function exec(fileSystem: typeof fs, fn: () => void) {
    fn();
    // @ts-ignore
    expect(fileSystem.statSync.mock.calls).toMatchSnapshot('statSync');
    // @ts-ignore
    expect(fileSystem.lstatSync.mock.calls).toMatchSnapshot('lstatSync');
    // @ts-ignore
    expect(fileSystem.realpathSync.mock.calls).toMatchSnapshot('realpathSync');
    // @ts-ignore
    expect(fileSystem.readFileSync.mock.calls).toMatchSnapshot('readFileSync');
    // @ts-ignore
    fileSystem.statSync.mockClear();
    // @ts-ignore
    fileSystem.lstatSync.mockClear();
    // @ts-ignore
    fileSystem.realpathSync.mockClear();
    // @ts-ignore
    fileSystem.readFileSync.mockClear();
    fn();
    expect(fileSystem.statSync).not.toBeCalled();
    expect(fileSystem.lstatSync).not.toBeCalled();
    expect(fileSystem.realpathSync).not.toBeCalled();
    expect(fileSystem.readFileSync).not.toBeCalled();
}

describe('file resolving', () => {
    it('absolute', () => {
        const fileSystem = makeFS({
            '/1/2/foo.js': '',
        });
        const resolver = new Sync({
            fileSystem,
        });

        exec(fileSystem, () => {
            expect(resolver.resolve('/', '/baz')).toBe(null);
            expect(resolver.resolve('/', '/1/2/foo.js')).toBe('/1/2/foo.js');
            expect(resolver.resolve('/1/2', '/1/2/foo.js')).toBe('/1/2/foo.js');
        });
    });
    it('relative', () => {
        const fileSystem = makeFS({
            '/1/2/foo.js': '',
            '/1/2/3': '',
        });
        const resolver = new Sync({
            fileSystem,
        });

        exec(fileSystem, () => {
            expect(resolver.resolve('/', './1/2/foo.js')).toBe('/1/2/foo.js');
            expect(resolver.resolve('/1/2/3', '../foo.js')).toBe('/1/2/foo.js');
            expect(resolver.resolve('/1/2/3', '../../foo.js')).toBe(null);
        });
    });

    it('extensions property', () => {
        const fileSystem = makeFS({
            '/1/2/foo.js': '',
            '/1/2/foo.css': '',
            '/1/2/bar.css': '',
            '/1/2/baz.json': '',
        });
        const resolver = new Sync({
            fileSystem,
            extensions: ['.js', '.css'],
        });

        exec(fileSystem, () => {
            expect(resolver.resolve('', '/1/2/foo')).toBe('/1/2/foo.js');
            expect(resolver.resolve('', '/1/2/bar')).toBe('/1/2/bar.css');
            expect(resolver.resolve('', '/1/2/baz')).toBe(null);
            expect(resolver.resolve('', '/1/2/baz.json')).toBe('/1/2/baz.json');
            expect(resolver.resolve('', '/1/2/quux')).toBe(null);
        });
    });

    it('mainFiles property', () => {
        const fileSystem = makeFS({
            '/1/index.js': '',
            '/2/index.custom.js': '',
            '/2/index.js': '',
            '/3/foo.js': '',
        });
        const resolver = new Sync({
            fileSystem,
            mainFiles: ['index.custom', 'index'],
            extensions: ['.js'],
        });

        exec(fileSystem, () => {
            expect(resolver.resolve('', '/1')).toBe('/1/index.js');
            expect(resolver.resolve('', '/2')).toBe('/2/index.custom.js');
            expect(resolver.resolve('', '/3')).toBe(null);
        });
    });
});

describe('packages modules resolving', () => {
    it('modules property', () => {
        const fileSystem = makeFS({
            '/1/2/3/4/5': '',
            '/1/2/3/node_modules/foo.js': '',
            '/1/2/custom_modules/foo.js': '',
            '/1/2/node_modules/foo.js': '',
            '/1/2/node_modules/bar.js': '',
            '/1/node_modules/foo.js': '',
        });
        const resolver = new Sync({
            fileSystem,
            modules: ['custom_modules', 'node_modules'],
            extensions: ['.js'],
        });

        exec(fileSystem, () => {
            expect(resolver.resolve('/1/2/3/4/5', 'foo')).toBe(
                '/1/2/3/node_modules/foo.js',
            );
            expect(resolver.resolve('/1/2/3/4/5', 'bar')).toBe(
                '/1/2/node_modules/bar.js',
            );
            expect(resolver.resolve('/1/2/3/4/5', 'baz')).toBe(null);
            expect(resolver.resolve('/1/2/3', 'foo')).toBe(
                '/1/2/3/node_modules/foo.js',
            );
            expect(resolver.resolve('/1/2', 'foo')).toBe(
                '/1/2/custom_modules/foo.js',
            );
            expect(resolver.resolve('/1/2', 'bar')).toBe(
                '/1/2/node_modules/bar.js',
            );
            expect(resolver.resolve('/', 'foo')).toBe(null);
        });
    });

    describe('package.json', () => {
        it('mainFields property', () => {
            const fileSystem = makeFS({
                '/node_modules/1/package.json':
                    '{"main": "./foo.js", "browser": "./bar.js"}',
                '/node_modules/1/foo.js': '',
                '/node_modules/1/bar.js': '',
                '/node_modules/1/baz.js': '',
                '/node_modules/2/package.json': '{"browser": "./bar.js"}',
                '/node_modules/2/bar.js': '',
                '/node_modules/3/package.json': '{}',
                '/node_modules/3/index.js': '',
                '/node_modules/4/index.js': '',
                '/node_modules/5/6/index.js': '',
            });
            const resolver = new Sync({
                fileSystem,
                modules: ['node_modules'],
                mainFields: ['main', 'browser'],
                mainFiles: ['index'],
                extensions: ['.js'],
            });

            exec(fileSystem, () => {
                expect(resolver.resolve('/', '1')).toBe(
                    '/node_modules/1/foo.js',
                );
                expect(resolver.resolve('/', '1/package.json')).toBe(
                    '/node_modules/1/package.json',
                );
                expect(resolver.resolve('/', '1/baz')).toBe(
                    '/node_modules/1/baz.js',
                );
                expect(resolver.resolve('/', '2')).toBe(
                    '/node_modules/2/bar.js',
                );
                expect(resolver.resolve('/', '3')).toBe(
                    '/node_modules/3/index.js',
                );
                expect(resolver.resolve('/', '4')).toBe(
                    '/node_modules/4/index.js',
                );
                expect(resolver.resolve('/', '5')).toBe(null);
            });
        });

        it('packageJSONModifier property', () => {
            const fileSystem = makeFS({
                '/node_modules/1/package.json':
                    '{"main": "./foo", "browser": "./bar"}',
                '/node_modules/1/foo.js': '',
                '/node_modules/2/package.json':
                    '{"main": "./foo.js", "browser": "./bar.js", "modifyMe": true}',
                '/node_modules/2/bar.js': '',
                '/node_modules/3/package.json':
                    '{"main": "./foo.js", "browser": "./bar.js"}',
                '/node_modules/3/bar.js': '',
            });
            const resolver = new Sync({
                fileSystem,
                modules: ['node_modules'],
                mainFields: ['main', 'browser'],
                extensions: ['.js'],
                packageJSONModifier: (
                    absPath,
                    packageJSON,
                ): Record<string, unknown> | undefined | null => {
                    if (
                        absPath === '/node_modules/3/package.json' ||
                        packageJSON.modifyMe
                    ) {
                        return {...packageJSON, main: packageJSON.browser};
                    }

                    return null;
                },
            });

            exec(fileSystem, () => {
                expect(resolver.resolve('/', '1')).toBe(
                    '/node_modules/1/foo.js',
                );
                expect(resolver.resolve('/', '2')).toBe(
                    '/node_modules/2/bar.js',
                );
                expect(resolver.resolve('/', '3')).toBe(
                    '/node_modules/3/bar.js',
                );
            });
        });
    });
});

describe('symlinks', () => {
    it('modules property', () => {
        const fileSystem = makeFS({
            '/1/2/3/4/5': '',
            '/original/node_modules/foo.js': '',
            '/original/node_modules/bar.js': '',
        });
        const resolver = new Sync({
            fileSystem,
            modules: ['custom_modules', 'node_modules'],
            extensions: ['.js'],
        });
        fileSystem.symlinkSync('/original/node_modules/', '/1/2/node_modules');
        fileSystem.symlinkSync('/original/node_modules/bar.js', '/1/2/bar.js');
        fileSystem.symlinkSync('/nope', '/1/2/foo.js');

        exec(fileSystem, () => {
            expect(resolver.resolve('/1/2/3/4/5', 'foo')).toBe(
                '/original/node_modules/foo.js',
            );
            expect(resolver.resolve('/1/2/3/4/5', 'bar')).toBe(
                '/original/node_modules/bar.js',
            );
            expect(resolver.resolve('', '/1/2/bar.js')).toBe(
                '/original/node_modules/bar.js',
            );
            expect(resolver.resolve('', '/1/2/foo.js')).toBe(null);
        });
    });
});
