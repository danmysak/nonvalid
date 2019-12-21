const nonvalid = require('./nonvalid');
const random = require('random-seed');

function serialize(object) {
    return JSON.stringify(object, (key, value) => {
        switch (typeof value) {
            case 'function':
                return value.toString();
            case 'bigint':
                return value.toString() + 'n';
            default:
                return value;
        }
    });
}

function generateInt(g) {
    const MAX_VALUE = 1000;
    return g.intBetween(-MAX_VALUE, MAX_VALUE);
}

function generateFloat(g) {
    const MIN_VALUE = 0;
    const MAX_VALUE = 1;
    return g.floatBetween(MIN_VALUE, MAX_VALUE);
}

function generateString(g) {
    const MIN_LENGTH = 10;
    const MAX_LENGTH = 15;
    return g.string(g.intBetween(MIN_LENGTH, MAX_LENGTH));
}

function generateBoolean(g) {
    return Boolean(g.range(2));
}

function generatePrimitive(g) {
    switch (g.range(9)) {
        case 0:
            return generateInt(g);
        case 1:
            return generateFloat(g);
        case 2:
            return generateString(g);
        case 3:
            return generateBoolean(g);
        case 4:
            return null;
        case 5:
            return undefined;
        case 6:
            return BigInt(generateInt(g));
        case 7:
            return Symbol();
        case 8:
            return () => 0;
    }
}

function generateTrees(args, nv, g) {
    const { depth, breadth, injection } = args;
    const path = injection ? args.path || [] : null;
    if (depth === 0) {
        return { trees: injection, path };
    }
    const injectionIndex = injection ? g.range(breadth) : -1;
    const keys = generateBoolean(g)
        ? new Array(breadth).fill(0).map(_ => generateBoolean(g) ? generateString(g) : Symbol())
        : null;
    const values = new Array(breadth).fill(0).map((_, index) => {
        const inject = index === injectionIndex;
        if (inject || depth > 1 && generateBoolean(g)) {
            return generateTrees({
                ...args,
                depth: depth - 1,
                injection: inject ? args.injection : null,
                path: inject ? [...path, keys ? keys[index] : index] : null
            }, nv, g);
        } else {
            const value = generatePrimitive(g);
            return {
                trees: [
                    value,
                    typeof value === 'function' || generateBoolean(g) ? value : v => v !== value
                ],
                path: null
            };
        }
    });
    return {
        trees: [0, 1]
            .map(n => keys
                ? Object.fromEntries(values.map((item, i) => [keys[i], item.trees[n]]))
                : values.map(item => item.trees[n])
            ).map((sub, n) => n === 1 && generateBoolean(g) ? v => nv(v, sub) : sub),
        path: values.reduce((path, item) => path || item.path, null)
    };
}

function perform(value, schema, result, error, extraErrorPath = []) {
    const PARAMS = [[0, 0], [1, 1], [1, 10], [10, 1], [2, 4], [4, 2], [7, 7]];
    for (const [depth, breadth] of PARAMS) {
        const nv = nonvalid.instance();
        const runSchema = (...args) => schema(nv, trees[0], path)(...args);
        const options = {
            depth,
            breadth,
            injection: [
                value,
                typeof schema === 'function' ? runSchema : schema
            ]
        };
        const {trees, path} = generateTrees(options, nv, random.create(serialize(options)));
        const run = () => nv(...trees);
        if (error) {
            expect(run).toThrow(new Error(error));
        } else {
            expect(run()).toBe(result);
            if (result) {
                expect(nv.errorPath()).toEqual([...path, ...extraErrorPath]);
            } else {
                expect(nv.errorPath()).toBe(null);
            }
        }
    }
}

const CANTPROCEED = 'Cannot proceed with validation after an error';

beforeEach(() => {
    jest.useFakeTimers();
});

afterEach(() => {
    jest.runAllTimers();
});

describe('primitives', () => {
    test('number', () => {
        perform(123, 123, false);
        perform(123, 123.5, true);
        perform(123.5, 123.5, false);
        perform(123.52, 123.51, true);
        perform(123, -123, true);
    });

    test('string', () => {
        perform('abc', 'abc', false);
        perform('abc', 'abcd', true);
        perform('abc', 'ab', true);
    });

    test('boolean', () => {
        perform(true, true, false);
        perform(false, false, false);
        perform(true, false, true);
        perform(false, true, true);
    });

    test('null', () => {
        perform(null, null, false);
    });

    test('undefined', () => {
        perform(undefined, undefined, false);
    });

    test('bigint', () => {
        perform(BigInt(123), BigInt(123), false);
        perform(BigInt(123), BigInt(124), true);
        perform(BigInt(123), BigInt(-123), true);
    });

    test('symbol', () => {
        const test = Symbol('test');
        perform(test, test, false);
        perform(test, Symbol('test'), true);
    });

    test('function', () => {
        const f = () => 0;
        const g = () => 0;
        perform(f, nv => v => v !== f, false);
        perform(f, nv => v => v !== g, true);
    });

    test('cross-type', () => {
        const performBothWays = (a, b) => {
            perform(a, b, true);
            perform(b, a, true);
        };

        performBothWays('123', 123);
        performBothWays(false, 0);
        performBothWays(false, '');
        performBothWays(null, 0);
        performBothWays(null, '');
        performBothWays(null, false);
        performBothWays(undefined, 0);
        performBothWays(undefined, '');
        performBothWays(undefined, false);
        performBothWays(undefined, null);
        performBothWays(BigInt(123), 123);
        performBothWays(BigInt(123), '123');
        performBothWays(BigInt(123), '123n');
        performBothWays(Symbol('test'), 'test');
        performBothWays(Symbol('test'), false);
        performBothWays(Symbol('test'), null);
        performBothWays(Symbol('test'), undefined);

        const f = () => 0;
        perform(f, f.toString(), true);
        perform(f, false, true);
        perform(f, null, true);
        perform(f, undefined, true);
    });
});

describe('matchers', () => {
    const E = 'test error';
    const OUT = name => new Error(`${name}() called without arguments outside of any context`);
    const ARGS = 'Matchers are supposed to be run with exactly one or no arguments';

    test('number', () => {
        expect(() => nonvalid.instance().number()).toThrow(OUT('number'));
        expect(nonvalid.instance().number(123)).toBe(true);
        expect(nonvalid.instance().number('123')).toBe(false);
        expect(() => nonvalid.instance().number(1, 2)).toThrow(new Error(ARGS));
        perform(123, nv => v => !nv.number(), false);
        perform(-123, nv => v => !nv.number(v), false);
        perform(NaN, nv => v => !nv.number(), true);
        perform(Infinity, nv => v => !nv.number(v) && E, E);
        perform(-Infinity, nv => v => !nv.number(), true);
        perform('123', nv => v => !nv.number(v), true);
        perform('-123', nv => v => !nv.number() && E, E);
        perform('-123', nv => v => !nv.number('a', 'b') && E, null, ARGS);
    });

    test('string', () => {
        expect(() => nonvalid.instance().string()).toThrow(OUT('string'));
        expect(nonvalid.instance().string('123')).toBe(true);
        expect(nonvalid.instance().string(123)).toBe(false);
        perform('', nv => v => !nv.string(), false);
        perform('123', nv => v => !nv.string(v), false);
        perform('abc', nv => v => !nv.string(), false);
        perform(123, nv => v => !nv.string() && E, E);
        perform(null, nv => v => !nv.string(v), true);
    });

    test('boolean', () => {
        expect(() => nonvalid.instance().boolean()).toThrow(OUT('boolean'));
        expect(nonvalid.instance().boolean(false)).toBe(true);
        expect(nonvalid.instance().boolean(null)).toBe(false);
        perform(false, nv => v => !nv.boolean(), false);
        perform(true, nv => v => !nv.boolean(v), false);
        perform(null, nv => v => !nv.boolean(v) && E, E);
        perform(undefined, nv => v => !nv.boolean(), true);
        perform('false', nv => v => !nv.boolean() && E, E);
        perform('true', nv => v => !nv.boolean(v), true);
    });

    test('null', () => {
        expect(() => nonvalid.instance().null()).toThrow(OUT('null'));
        expect(nonvalid.instance().null(null)).toBe(true);
        expect(nonvalid.instance().null(false)).toBe(false);
        perform(null, nv => v => !nv.null(), false);
        perform(null, nv => v => !nv.null(v), false);
        perform(undefined, nv => v => !nv.null(), true);
        perform('null', nv => v => !nv.null(v) && E, E);
    });

    test('undefined', () => {
        expect(() => nonvalid.instance().undefined()).toThrow(OUT('undefined'));
        expect(nonvalid.instance().undefined(undefined)).toBe(true);
        expect(nonvalid.instance().undefined(null)).toBe(false);
        perform(undefined, nv => v => !nv.undefined(), false);
        perform(undefined, nv => v => !nv.undefined(v), false);
        perform(null, nv => v => !nv.undefined() && E, E);
        perform('undefined', nv => v => !nv.undefined(v), true);
    });

    test('defined', () => {
        expect(() => nonvalid.instance().defined()).toThrow(OUT('defined'));
        expect(nonvalid.instance().defined(null)).toBe(true);
        expect(nonvalid.instance().defined(undefined)).toBe(false);
        perform('undefined', nv => v => !nv.defined(), false);
        perform(null, nv => v => !nv.defined(v), false);
        perform(false, nv => v => !nv.defined(v), false);
        perform(undefined, nv => v => !nv.defined(), true);
        perform(undefined, nv => v => !nv.defined(v) && E, E);
    });

    test('bigint', () => {
        expect(() => nonvalid.instance().bigint()).toThrow(OUT('bigint'));
        expect(nonvalid.instance().bigint(BigInt(123))).toBe(true);
        expect(nonvalid.instance().bigint(123)).toBe(false);
        perform(BigInt(123), nv => v => !nv.bigint(), false);
        perform(BigInt(-123), nv => v => !nv.bigint(v), false);
        perform(123, nv => v => !nv.bigint(v), true);
        perform('123n', nv => v => !nv.bigint() && E, E);
    });

    test('symbol', () => {
        expect(() => nonvalid.instance().symbol()).toThrow(OUT('symbol'));
        expect(nonvalid.instance().symbol(Symbol())).toBe(true);
        expect(nonvalid.instance().symbol({})).toBe(false);
        perform(Symbol('test'), nv => v => !nv.symbol(), false);
        perform('Symbol', nv => v => !nv.symbol(v), true);
        perform({}, nv => v => !nv.symbol() && E, E);
    });

    test('function', () => {
        expect(() => nonvalid.instance().function()).toThrow(OUT('function'));
        expect(nonvalid.instance().function(() => {})).toBe(true);
        expect(nonvalid.instance().function({})).toBe(false);
        perform(() => 0, nv => v => !nv.function(), false);
        perform(() => 0, nv => v => nv.function(), true);
        perform(() => 0, nv => v => !nv.function(v), false);
        perform(() => 0, nv => v => nv.function(v), true);
        perform(() => 0, nv => v => nv.path().length === 0
            ? !nv.function(() => nv.value()) : nv.function(() => nv.root()), false);
        perform(() => 0, nv => v => nv.path().length === 0
            ? nv.function(() => nv.value()) : !nv.function(() => nv.root()), true);
        perform({}, nv => v => !nv.function(), true);
        perform('function', nv => v => !nv.function(v) && E, E);
    });

    test('array', () => {
        expect(() => nonvalid.instance().array()).toThrow(OUT('array'));
        expect(nonvalid.instance().array([])).toBe(true);
        expect(nonvalid.instance().array({})).toBe(false);
        perform([], nv => v => !nv.array(), false);
        perform([1, 2, 3], nv => v => !nv.array(v), false);
        perform({}, nv => v => !nv.array() && E, E);
        perform('[]', nv => v => !nv.array(v), true);
    });

    test('object', () => {
        expect(() => nonvalid.instance().object()).toThrow(OUT('object'));
        expect(nonvalid.instance().object({})).toBe(true);
        expect(nonvalid.instance().object([])).toBe(false);
        expect(nonvalid.instance().object(() => {})).toBe(false);
        perform({}, nv => v => !nv.object(), false);
        perform({a: 'bc'}, nv => v => !nv.object(v), false);
        perform([], nv => v => !nv.object(v) && E, E);
        perform(null, nv => v => !nv.object(), true);
        perform(() => 0, nv => v => !nv.object() && E, E);
    });

    test('get', () => {
        expect(() => nonvalid.instance().get()).toThrow(OUT('get'));
        expect(nonvalid.instance().get(123)).toBe(123);
        expect(nonvalid.instance().get(['a', 'b', 'c'])).toEqual(['a', 'b', 'c']);
        perform(123, nv => v => nv.get() !== 123, false);
        perform('abc', nv => v => nv.get(v) !== 'abc', false);
        perform(123, nv => v => nv.get(v) === 123 && E, E);
        perform('abc', nv => v => nv.get() === 'abc', true);
    });

    test('adding matcher', () => {
        const nv = nonvalid.instance();
        nv.addMatcher('addOne', n => n + 1);
        expect(() => nv.addOne()).toThrow(OUT('addOne'));
        expect(() => nv.addOne(1, 2)).toThrow(new Error(ARGS));
        expect(nv.addOne(5)).toBe(6);
        const s = Symbol('abc');
        nv.addMatcher(s, n => typeof n);
        nv(123, () => {
            nv.addMatcher(function subtractOne(n) { return n - 1; });
            expect(nv.addOne(6)).toBe(7);
            expect(nv.subtractOne(10)).toBe(9);
            expect(nv.addOne()).toBe(124);
            expect(nv.subtractOne()).toBe(122);
            expect(nv.addOne(() => nv.value())).toBe(124);
            expect(nv.subtractOne(() => nv.value())).toBe(122);
            expect(nv[s](() => nv.value())).toBe('number');
            nv.addMatcher('anotherMatcher', function wrongName(n) { return n; });
            expect(nv.anotherMatcher('abc')).toBe('abc');
            expect(() => nv.wrongName('abc')).toThrow();
            expect(() => nv.anotherMatcher(() => {}, () => {})).toThrow(new Error(ARGS));
        });

        const NONNAMEDFUNC = 'Single addMatcher argument must be a named function';
        const NONFUNC2 = 'Second addMatcher argument must be a function';
        const NUMARGSA = 'addMatcher expects exactly one or two arguments';
        const NUMARGSM = 'Matcher must accept exactly one parameter';
        const TYPE = 'Name of a matcher should be either string or symbol';
        const EXIST = name => `Validator already has property "${name}"`;

        expect(() => nv.addMatcher({})).toThrow(new Error(NONNAMEDFUNC));
        expect(() => nv.addMatcher(() => {})).toThrow(new Error(NONNAMEDFUNC));
        expect(() => nv.addMatcher('addTwo', +2)).toThrow(new Error(NONFUNC2));
        expect(() => nv.addMatcher()).toThrow(new Error(NUMARGSA));
        expect(() => nv.addMatcher('addThree', n => n + 3, n => n)).toThrow(new Error(NUMARGSA));
        expect(() => nv.addMatcher('addFour', () => 4)).toThrow(new Error(NUMARGSM));
        expect(() => nv.addMatcher('addFive', (n, m) => n + 5)).toThrow(new Error(NUMARGSM));
        expect(() => nv.addMatcher(3, n => n + 6)).toThrow(new Error(TYPE));
        expect(() => nv.addMatcher(function a(){}, function b(){})).toThrow(new Error(TYPE));
        expect(() => nv.addMatcher(function addOne(n) { return n + 1; }))
            .toThrow(new Error(EXIST('addOne')));
        expect(() => nv.addMatcher('subtractOne', n => n - 1))
            .toThrow(new Error(EXIST('subtractOne')));
        expect(() => nv.addMatcher('value', n => n)).toThrow(new Error(EXIST('value')));
        expect(() => nv.addMatcher('other', n => n)).toThrow(new Error(EXIST('other')));
        expect(() => nv.addMatcher(s, n => n)).toThrow(new Error(EXIST(s.toString())));
    });
});

describe('keys and values', () => {
    const VALUE_OUT = 'value() called outside of any context';
    const KEY_OUT = 'key() called outside of any context';
    const INDEX_OUT = 'index() called outside of any context';
    const INDEX_OBJECT = 'index() can be called for arrays only';
    const KEY_ARRAY = 'key() can be called for objects only';
    const VALUES = [123, { abc: 123 }, ['abc', 123]];

    test('context errors', () => {
        expect(() => nonvalid.instance().value()).toThrow(new Error(VALUE_OUT));
        expect(() => nonvalid.instance().key()).toThrow(new Error(KEY_OUT));
        expect(() => nonvalid.instance().index()).toThrow(new Error(INDEX_OUT));

        for (const value of VALUES) {
            const nv = nonvalid.instance();
            expect(() => nv(value, () => nv.key())).toThrow(new Error(KEY_OUT));
        }

        for (const value of VALUES) {
            const nv = nonvalid.instance();
            expect(() => nv(value, () => nv.index())).toThrow(new Error(INDEX_OUT));
        }

        const s = Symbol();
        perform({ abc: 123 }, nv => v => nv(v, { abc: () => nv.index() }), null, INDEX_OBJECT);
        perform({ [s]: 'abc' }, nv => v => nv(v, { [s]: () => nv.index() }), null, INDEX_OBJECT);
        perform({ abc: 123 }, nv => v => nv({ [nv.other]: () => nv.index() }), null, INDEX_OBJECT);

        perform([123], nv => v => nv([() => nv.key()]), null, KEY_ARRAY);
        perform([123], nv => v => nv(v, [nv.end, () => nv.key()]), null, KEY_ARRAY);
    });

    test('retrieving keys and values', () => {
        for (const value of VALUES) {
            perform(value, (nv, tree, path) => (...args) => {
                expect(args.length).toBe(2);
                expect(args[0]).toBe(value);
                expect(nv.value()).toBe(value);
                if (path.length > 0) {
                    const key = path[path.length - 1];
                    expect(args[1]).toBe(key);
                    if (typeof key === 'number') {
                        expect(nv.index()).toBe(key);
                    } else {
                        expect(nv.key()).toBe(key);
                    }
                } else {
                    expect(args[1]).toBe(undefined);
                }
                return false;
            }, false);
        }
    });
});

describe('navigation', () => {
    const ROOT_OUT = 'root() called outside of any object or array';
    const UP_OUT = 'up() call navigates above any object or array';
    const VALUES = [123, { abc: 123 }, ['abc', 123]];

    test('root', () => {
        expect(() => nonvalid.instance().root()).toThrow(new Error(ROOT_OUT));
        for (const value of VALUES) {
            const nv = nonvalid.instance();
            expect(() => nv(value, () => nv.root())).toThrow(new Error(ROOT_OUT));
        }

        for (const value of VALUES) {
            perform(value, (nv, tree, path) => () => {
                if (path.length > 0) {
                    expect(nv.root()).toBe(tree);
                }
                return false;
            }, false);
        }
    });

    test('up', () => {
        expect(() => nonvalid.instance().up()).toThrow(new Error(UP_OUT));
        for (const value of VALUES) {
            const nv = nonvalid.instance();
            expect(() => nv(value, () => nv.up())).toThrow(new Error(UP_OUT));
        }

        for (const value of VALUES) {
            perform(value, (nv, tree, path) => () => nv.up(path.length), null, UP_OUT);
            perform(value, (nv, tree, path) => () => nv.up(path.length * 2), null, UP_OUT);

            perform(value, (nv, tree, path) => () => {
                if (path.length > 0) {
                    let current = tree;
                    for (let i = path.length - 1; i >= 0; i--) {
                        expect(nv.up(i)).toBe(current);
                        if (i === 0) {
                            expect(nv.up()).toBe(current);
                        } else {
                            current = current[path[path.length - i - 1]];
                        }
                    }
                }
                return false;
            }, false);
        }
    });

    test('safe', () => {
        const E = { error: 'test' };

        const navigate = (object, path) => {
            let result = object;
            for (const key of path) {
                result = result[key];
            }
            return result;
        };

        for (const value of VALUES) {
            const nv = nonvalid.instance();
            expect(nv.defined(() => nv.root())).toBe(true);
            expect(nv.object(() => nv.root())).toBe(false);
        }
        for (const value of VALUES) {
            const nv = nonvalid.instance();
            expect(() => nv(value, () => nv.null(() => nv.root()))).toThrow(new Error(ROOT_OUT));
        }

        for (const value of VALUES) {
            const nv = nonvalid.instance();
            expect(nv.undefined(() => nv.up())).toBe(false);
            expect(nv.function(() => nv.up())).toBe(true);
        }
        for (const value of VALUES) {
            const nv = nonvalid.instance();
            expect(() => nv(value, () => nv.get(() => nv.up()))).toThrow(new Error(UP_OUT));
        }

        for (const value of VALUES) {
            const nv = nonvalid.instance();
            expect(nv.undefined(() => nv.value())).toBe(false);
            expect(nv.function(() => nv.value())).toBe(true);
        }

        for (const value of VALUES) {
            perform(value, (nv, tree, treePath) => () => {
                if (treePath.length > 0) {
                    let extraPath;
                    if (Array.isArray(value)) {
                        extraPath = [0];
                    } else if (typeof value === 'object') {
                        extraPath = [Object.keys(value)[0]];
                    } else {
                        extraPath = [];
                    }
                    const path = [...treePath, ...extraPath];
                    let current = tree;
                    for (let i = 0; i <= path.length; i++) {
                        const getRoot = () => navigate(nv.root(), path.slice(0, i));
                        const getUp = () => navigate(nv.up(treePath.length - 1), path.slice(0, i));
                        const getUpOrValue = () => i < treePath.length
                            ? nv.up(treePath.length - 1 - i)
                            : (i === treePath.length ? nv.value() : nv.value()[extraPath[0]]);
                        expect(nv.get(() => getRoot())).toBe(current);
                        expect(nv.get(() => getUp())).toBe(current);
                        expect(nv.get(() => getUpOrValue())).toBe(current);
                        expect(nv.get(() => getRoot().__n0)).toBe(undefined);
                        expect(nv.get(() => getUp().__n0)).toBe(undefined);
                        expect(nv.get(() => getUpOrValue().__n0)).toBe(undefined);
                        expect(nv.get(() => getRoot().__n0.__n1)).toBe(undefined);
                        expect(nv.get(() => getUp().__n0.__n1)).toBe(undefined);
                        expect(nv.get(() => getUpOrValue().__n0.__n1)).toBe(undefined);
                        expect(nv.get(() => getRoot()[Symbol()])).toBe(undefined);
                        expect(nv.get(() => getUp()[Symbol()])).toBe(undefined);
                        expect(nv.get(() => getUpOrValue()[Symbol()])).toBe(undefined);
                        if (i < path.length) {
                            current = current[path[i]];
                        }
                    }
                }
                return false;
            }, false);

            perform(value, (nv, tree, path) =>
                () => path.length === 0 ? E : nv.defined(() => nv.root()) && E, E);
            perform(value, (nv, tree, path) =>
                () => path.length === 0 ? false : nv.undefined(() => nv.root()) && E, false);
            perform(value, (nv, tree, path) => () => path.length === 0 ? true :
                nv.object(() => nv.up()) || nv.array(() => nv.up()), true);
            perform(value, (nv, tree, path) => () => path.length === 0 ? false :
                nv.object(() => nv.up().__n0) || nv.array(() => nv.up().__n0), false);
            perform(value, (nv, tree, path) =>
                () => path.length === 0 ? false : nv.defined(() => nv.root().__n0) && E, false);
            perform(value, (nv, tree, path) =>
                () => path.length === 0 ? E : nv.undefined(() => nv.root().__n0) && E, E);
            perform(value, (nv, tree, path) => () => path.length === 0 ? E :
                !nv.null(() => nv.value()) && E, E);
            perform(value, (nv, tree, path) => () => path.length === 0 ? true :
                !nv.null(() => nv.value().__n0) && true, true);
        }
    });

    test('safe, unconsumed', () => {
        const UNCONSUMED = 'Value created in safe context was not consumed by any matcher';

        const nv = nonvalid.instance();
        nv(123, () => nv.get(() => {
            nv.value();
            return nv.value();
        }));

        expect(() => jest.runAllTimers()).toThrow(new Error(UNCONSUMED));
    });

    test('safe, misused', () => {
        const MISUSED = 'Value created in safe context was used improperly';

        const nv = nonvalid.instance();
        nv({ v: 123 }, () => nv.get(() => {
            const a = nv.value();
            expect(Object.hasOwnProperty.call(a, 'v')).toBe(false);
            const b = [][a];
            return a;
        }));

        expect(() => jest.runAllTimers()).toThrow(new Error(MISUSED));
    });

    test('safe, unreturned', () => {
        const UNRETURNED = 'Callback didn’t perform traversal or didn’t return its result';
        {
            const nv = nonvalid.instance();
            expect(() => nv(123, () => {
                expect(() => nv.get(() => 123)).toThrow(new Error(UNRETURNED));
            })).toThrow(new Error(CANTPROCEED));
        }
        {
            const nv = nonvalid.instance();
            expect(() => nv(123, () => {
                expect(() => nv.get(() => ({ unwrap: 'fake' }))).toThrow(new Error(UNRETURNED));
            })).toThrow(new Error(CANTPROCEED));
        }
    });

    test('safe multilevel', () => {
        const E = 'safe error';

        perform(
            { a: { aa: 1, ab: 2 }, b: { ba: 3, bb: 'aa' } },
            nv => () => nv({
                a: () => false,
                b: { ba: () => false, bb: () => nv.undefined(() => nv.up(1).a[nv.value()]) && E }
            }), false
        );
        perform(
            { a: { aa: 1, ab: 2 }, b: { ba: 3, bb: 'ba' } },
            nv => () => nv({
                a: () => false,
                b: { ba: () => false, bb: () => nv.undefined(() => nv.up(1).a[nv.value()]) && E }
            }), E, false, ['b', 'bb']
        );

        const objectA = {
            a: { b: { bb: 'cc' } },
            c: { d: { aa: 'bb' } },
            e: { f: 'aa' }
        };
        {
            const nv = nonvalid.instance();
            expect(nv(objectA,
                () => nv.get(() => nv.value().a.b[nv.value().c.d[nv.value().e.f]])))
                .toBe('cc');
        }
        {
            const nv = nonvalid.instance();
            expect(nv(objectA,
                () => nv.get(() => nv.value().a.b[
                    nv.get(() => nv.value().c.d[nv.get(() => nv.value().e.f)])
                ]))).toBe('cc');
        }
        {
            const nv = nonvalid.instance();
            expect(nv(objectA,
                () => nv.undefined(() => nv.value().a.b[nv.value().c.d[nv.value().e.f]])))
                .toBe(false);
        }
        const objectsA = [
            {
                aa: { b: { bb: 'cc' } },
                c: { d: { aa: 'bb' } },
                e: { f: 'aa' }
            },
            {
                a: { bb: { bb: 'cc' } },
                c: { d: { aa: 'bb' } },
                e: { f: 'aa' }
            },
            {
                a: { b: { bb: 'cc' } },
                cc: { d: { aa: 'bb' } },
                e: { f: 'aa' }
            },
            {
                a: { b: { bb: 'cc' } },
                c: { dd: { aa: 'bb' } },
                e: { f: 'aa' }
            },
            {
                a: { b: { bb: 'cc' } },
                c: { d: { aa: 'bb' } },
                ee: { f: 'aa' }
            },
            {
                a: { b: { bb: 'cc' } },
                c: { d: { aa: 'bb' } },
                e: { ff: 'aa' }
            },
            {
                a: { b: { bb: 'cc' } },
                c: { d: { aa: 'bb' } },
                e: { f: 'aaa' }
            },
            {
                a: { b: { bb: 'cc' } },
                c: { d: { aa: 'bbb' } },
                e: { f: 'aa' }
            },
            {},
            null
        ];
        for (const o of objectsA) {
            const nv = nonvalid.instance();
            expect(nv(o, () => nv.undefined(() => nv.value().a.b[nv.value().c.d[nv.value().e.f]])))
                .toBe(true);
        }

        const objectB = {
            a: { b: 'aa' },
            aa: { c: { d: 'bb' } },
            bb: { e: { f: 'cc' } }
        };
        {
            const nv = nonvalid.instance();
            expect(nv(objectB,
                () => nv.get(() => nv.value()[nv.value()[nv.value().a.b].c.d].e.f)))
                .toBe('cc');
        }
        {
            const nv = nonvalid.instance();
            expect(nv(objectB,
                () => nv.get(() => nv.value()[
                    nv.get(() => nv.value()[nv.get(() => nv.value().a.b)].c.d)
                ].e.f))).toBe('cc');
        }
        {
            const nv = nonvalid.instance();
            expect(nv(objectB,
                () => nv.undefined(() => nv.value()[nv.value()[nv.value().a.b].c.d].e.f)))
                .toBe(false);
        }
        const objectsB = [
            {
                aaa: { b: 'aa' },
                aa: { c: { d: 'bb' } },
                bb: { e: { f: 'cc' } }
            },
            {
                a: { bb: 'aa' },
                aa: { c: { d: 'bb' } },
                bb: { e: { f: 'cc' } }
            },
            {
                a: { b: 'aa' },
                aaa: { c: { d: 'bb' } },
                bb: { e: { f: 'cc' } }
            },
            {
                a: { b: 'aa' },
                aa: { cc: { d: 'bb' } },
                bb: { e: { f: 'cc' } }
            },
            {
                a: { b: 'aa' },
                aa: { c: { dd: 'bb' } },
                bb: { e: { f: 'cc' } }
            },
            {
                a: { b: 'aa' },
                aa: { c: { d: 'bb' } },
                bbb: { e: { f: 'cc' } }
            },
            {
                a: { b: 'aa' },
                aa: { c: { d: 'bb' } },
                bb: { ee: { f: 'cc' } }
            },
            {
                a: { b: 'aa' },
                aa: { c: { d: 'bb' } },
                bb: { e: { ff: 'cc' } }
            },
            {},
            null
        ];
        for (const o of objectsB) {
            const nv = nonvalid.instance();
            expect(nv(o, () => nv.undefined(() => nv.value()[nv.value()[nv.value().a.b].c.d].e.f)))
                .toBe(true);
        }

        const objectC = { a: 'a', b: 'b' };
        {
            const nv = nonvalid.instance();
            expect(nv(objectC, {
                a: () => nv.get(() => nv.root()[nv.up()[nv.value()]]),
                b: 'b'
            })).toBe('a');
        }
        {
            const nv = nonvalid.instance();
            expect(nv(objectC, {
                a: () => nv.get(() => nv.get() === 'a' ? nv.root().a : nv.root().b),
                b: 'b'
            })).toBe('a');
        }
        {
            const nv = nonvalid.instance();
            expect(nv(objectC, {
                a: () => nv.get(() => nv.get() === 'z' ? nv.root().a : nv.root().b),
                b: 'b'
            })).toBe('b');
        }
        {
            const nv = nonvalid.instance();
            expect(nv(objectC, {
                a: () => nv.get(() => nv.get('z') === 'z' ? nv.root().a : nv.root().b),
                b: 'b'
            })).toBe('a');
        }
        {
            const nv = nonvalid.instance();
            let t;
            expect(nv(objectC, {
                a: () => nv.defined(() => nv.value()[t = nv.value()]),
                b: () => nv.get(() => nv.root()[t])
            })).toBe('a');
        }
        {
            const nv = nonvalid.instance();
            let t;
            expect(nv(objectC, {
                a: () => nv.undefined(() => t = nv.root()),
                b: () => nv.undefined(() => nv.root()[t])
            })).toBe(true);
        }
        {
            const nv = nonvalid.instance();
            const string = 'string';
            const symbol = Symbol();
            let counter = 0;
            nv({
                1: 'v1',
                25: 'v25',
                n1: 1,
                n25: 25,
                s25: '25',
                true: 'true',
                null: 'null',
                tTrue: true,
                sTrue: 'true',
                tNull: null,
                sNull: 'null',
                array: [2, 100, string, symbol, 'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'],
                string: string,
                [symbol]: symbol
            }, {
                1: () => false,
                25: () => false,
                true: () => false,
                null: () => false,
                n1: () => false,
                n25: () => false,
                s25: () => false,
                tTrue: () => false,
                sTrue: () => false,
                tNull: () => false,
                sNull: () => false,
                array: () => {
                    expect(nv.get(() => nv.value()[nv.value()[0]])).toBe(string);
                    expect(nv.get(() => nv.value()[nv.value()['0']])).toBe(string);
                    expect(nv.get(() => nv.value()[nv.value()['+0']])).toBe(undefined);
                    expect(nv.get(() => nv.value()[12])).toBe('i');
                    expect(nv.get(() => nv.value()['12'])).toBe('i');
                    expect(nv.get(() => nv.value()['12.'])).toBe(undefined);
                    expect(nv.get(() => nv.value()['abc'])).toBe(undefined);
                    expect(nv.get(() => nv.value()[symbol])).toBe(undefined);
                    expect(nv.get(() => nv.value()[nv.value()[1]])).toBe(undefined);
                    expect(nv.get(() => nv.value()[nv.value()[2]])).toBe(undefined);
                    expect(nv.get(() => nv.value()[nv.value()[3]])).toBe(undefined);
                    expect(nv.get(() => nv.value()[nv.value()[100]])).toBe(undefined);
                    expect(nv.get(() => nv.value()[symbol])).toBe(undefined);
                    expect(nv.get(() => nv.value()[nv.root()[symbol]])).toBe(undefined);
                    counter++;
                    return false;
                },
                string: () => {
                    expect(nv.get(() => nv.root()[string])).toBe(string);
                    expect(nv.get(() => nv.root()[25])).toBe('v25');
                    expect(nv.get(() => nv.root()['1'])).toBe('v1');
                    expect(nv.get(() => nv.root()['25'])).toBe('v25');
                    expect(nv.get(() => nv.root()[symbol])).toBe(symbol);
                    expect(nv.get(() => nv.root()[true])).toBe('true');
                    expect(nv.get(() => nv.root()[null])).toBe('null');
                    expect(nv.get(() => nv.root()[nv.value()])).toBe(string);
                    expect(nv.get(() => nv.root()[nv.root().n25])).toBe('v25');
                    expect(nv.get(() => nv.root()[nv.root().n1])).toBe('v1');
                    expect(nv.get(() => nv.root()[nv.root().s25])).toBe('v25');
                    expect(nv.get(() => nv.root()[nv.root()[symbol]])).toBe(symbol);
                    expect(nv.get(() => nv.root()[nv.root().tTrue])).toBe(undefined);
                    expect(nv.get(() => nv.root()[nv.root().sTrue])).toBe('true');
                    expect(nv.get(() => nv.root()[nv.root().tNull])).toBe(undefined);
                    expect(nv.get(() => nv.root()[nv.root().sNull])).toBe('null');
                    counter++;
                    return false;
                },
                [symbol]: () => false
            });
            expect(counter).toBe(2);
        }
    });

    test('paths', () => {
        perform(null, (nv, tree, path) => () => {
            expect(nv.path()).toEqual(path);
            return false;
        }, false);

        const E = {};
        const BEFORE = 'path() called before validation';
        const AFTER = 'path() called after validation';
        const ERRBEFORE = 'errorPath() called before validation is completed';

        const nv = nonvalid.instance();
        expect(() => nv.path()).toThrow(BEFORE);
        expect(() => nv.errorPath()).toThrow(ERRBEFORE);
        const path = ['test', 0, Symbol('abc'), 1, '"\'`'];
        const stringPaths = [
            'json["test"]',
            'json["test"][0]',
            'json["test"][0][Symbol(abc)]',
            'json["test"][0][Symbol(abc)][1]',
            'json["test"][0][Symbol(abc)][1]["\\"\'`"]'
        ];
        const error = nv({
            [path[0]]: [{
                [path[2]]: [0, {
                   [path[4]]: null
                }]
            }]
        }, () => {
            expect(nv.path()).toEqual([]);
            expect(nv.path('json')).toEqual('json');
            return nv({
                [path[0]]: () => {
                    expect(nv.path()).toEqual(path.slice(0, 1));
                    expect(nv.path('json')).toEqual(stringPaths[0]);
                    return nv([() => {
                        expect(nv.path()).toEqual(path.slice(0, 2));
                        expect(nv.path('json')).toEqual(stringPaths[1]);
                        return nv({
                            [path[2]]: () => {
                                expect(nv.path()).toEqual(path.slice(0, 3));
                                expect(nv.path('json')).toEqual(stringPaths[2]);
                                return nv([0, () => {
                                    expect(nv.path()).toEqual(path.slice(0, 4));
                                    expect(nv.path('json')).toEqual(stringPaths[3]);
                                    return nv({
                                        [path[4]]: () => {
                                            expect(nv.path()).toEqual(path.slice(0, 5));
                                            expect(nv.path('json')).toEqual(stringPaths[4]);
                                            expect(() => nv.errorPath()).toThrow(ERRBEFORE);
                                            return E;
                                        }
                                    });
                                }]);
                            }
                        });
                        }
                    ]);
                }
            });
        });
        expect(error).toEqual(E);
        expect(nv.errorPath()).toEqual(path);
        expect(nv.errorPath('json')).toBe(stringPaths[stringPaths.length - 1]);
        expect(() => nv.path()).toThrow(AFTER);
    });
});

describe('structure comparison', () => {
    test('catch-other callback for objects', () => {
        const E = 'false';
        const AE = 5;
        const N = null;
        const NONFUNC = 'The catch-other callback must be a function';
        const UNEXPECTED = 'Symbol(nonvalid.end) is not expected in an object schema';

        const vars = [
            ['a', 'b', 'c', 'd'],
            [Symbol('a'), Symbol('b'), Symbol('c'), 'd'],
            ['a', Symbol('b'), Symbol('c'), 'd'],
            [Symbol('a'), 'b', 'c', 'd'],
            [Symbol('a'), 'b', 'c', Symbol('d')],
        ];

        for (const [a, b, c, d] of vars) {
            perform({ [a]: a, [b]: b, [c]: c }, { [a]: a, [b]: b, [c]: c }, false);
            perform({ [a]: a, [b]: b, [c]: c }, { [a]: a, [c]: c }, true);
            perform({ [a]: a, [c]: c }, { [a]: a, [b]: b, [c]: c }, true, N, [b]);
            perform({ [a]: a, [b]: b, [c]: c }, nv => () =>
                nv({ [a]: a, [c]: c, [nv.other]: (v, key) => key !== b, [nv.error]: AE }), false);
            perform({ [a]: a, [b]: b, [c]: c }, nv => () =>
                nv({ [a]: a, [c]: c, [nv.other]: () => E }), E, N, [b]);
            perform({ [a]: a, [b]: b, [c]: c, [d]: d }, nv => () =>
                nv({ [a]: a, [c]: c, [nv.other]: v => v !== b && E }), E, N, [d]);
            perform({ [a]: a, [b]: b, [c]: c, [d]: d }, nv => () =>
                nv({ [a]: a, [c]: c, [nv.other]: v => v !== d && E, [nv.error]: AE }), E, N, [b]);
            perform({ [a]: a, [b]: b, [c]: c, [d]: d }, nv => () =>
                nv({ [a]: a, [c]: c, [nv.other]: v => v !== b && v !== d && E }), false);
            perform({ [a]: a, [b]: b, [c]: c }, nv => () =>
                nv({ [a]: a, [c]: c, [b]: b, [nv.other]: () => E }), false);

            perform({ [a]: a, [b]: b, [c]: c }, nv => () =>
                nv({ [a]: a, [c]: c, [nv.other]: E }), N, NONFUNC);
            perform({ [a]: a, [c]: c }, nv => () =>
                nv({ [a]: a, [c]: c, [nv.other]: E }), N, NONFUNC);
            perform({ [a]: a }, nv => () =>
                nv({ [a]: a, [c]: c, [nv.other]: E }), N, NONFUNC);
        }
        perform({}, nv => () => nv({ [nv.end]: () => E }), null, UNEXPECTED);
    });

    test('comparing objects to non-objects', () => {
        const E = Symbol();
        const NONVALID = 'The shape error must be a non-function truthy value';

        perform({}, {}, false);
        perform([], {}, true);
        perform(null, {}, true);
        perform(() => {}, {}, true);
        perform(undefined, {}, true);
        perform(false, nv => () => nv({ [nv.error]: E }), E);
        perform({}, nv => () => nv({ [nv.error]: E }), false);

        perform(false, nv => () => nv({ [nv.error]: false }), null, NONVALID);
        perform(false, nv => () => nv({ [nv.error]: null }), null, NONVALID);
        perform({}, nv => () => nv({ [nv.error]: '' }), null, NONVALID);
        perform({}, nv => () => nv({ [nv.error]: () => E }), null, NONVALID);
        perform('[Object object]', nv => () => nv({ [nv.error]: () => E }), null, NONVALID);
    });

    test('arrays', () => {
        const E = 'null';
        const AE = 5;
        const N = null;
        const UNEXPECTED = name => `Symbol(nonvalid.${name}) is not expected in an array schema`;
        const MANYEXTRA = 'Found more than 2 elements after the end-of-array marker';
        const MANYENDS = 'Encountered multiple end-of-array markers';
        const MANYFUNCS = 'Encountered multiple catch-other callbacks';
        const MANYERRORS = 'Encountered multiple shape error values';
        const FALSY = 'Shape error must be a truthy value';
        
        for (const prefix of [[], ['a'], ['a', 'aa']]) {
            const l = prefix.length;

            perform([...prefix, 'b', 'c'], [...prefix, 'b', 'c'], false);
            perform([...prefix, 'b', 'c'], [...prefix, 'b'], true);
            perform([...prefix, 'b'], [...prefix, 'b', 'c'], true, N, [l + 1]);

            perform([...prefix, 'b', 'c', 'd'],
                [...prefix, , v => !['b', 'c', 'd'].includes(v) && E, AE], false);
            perform([...prefix, 'b', 'c', 'd'], nv => () =>
                nv([...prefix, nv.end, v => !['b', 'c', 'd'].includes(v) && E]), false);

            perform([...prefix, 'b', 'c', 'd'],
                [...prefix, , v => !['c', 'd'].includes(v) && E], E, N, [l]);
            perform([...prefix, 'b', 'c', 'd'], nv => () =>
                nv([...prefix, nv.end, AE, v => !['c', 'd'].includes(v) && E]), E, N, [l]);

            perform([...prefix, 'b', 'c', 'd'],
                [...prefix, , v => !['b', 'c'].includes(v) && E, AE], E, N, [l + 2]);
            perform([...prefix, 'b', 'c', 'd'], nv => () =>
                nv([...prefix, nv.end, v => !['b', 'c'].includes(v) && E]), E, N, [l + 2]);

            perform([...prefix], [...prefix], false);
            perform({}, [...prefix], true);
            perform(null, [...prefix], true);
            perform(() => {}, [...prefix], true);
            perform(false, [...prefix], true);
            perform(true, nv => () => nv([...prefix, nv.end]), true);
            perform(Symbol(), nv => () => nv([...prefix, nv.end, () => false]), true);
            perform(Symbol(), [...prefix, , () => []], true);
            perform(undefined, nv => () => nv([...prefix, , E]), E);
            perform({}, nv => () => nv([...prefix, nv.end, E]), E);
            perform(AE, nv => () => nv([...prefix, nv.end, () => false, E]), E);
            perform('', nv => () => nv([...prefix, , E, () => false]), E);

            perform([...prefix], nv => () => nv([...prefix, nv.other]), N, UNEXPECTED('other'));
            perform([...prefix, 1, 2], nv => () =>
                nv([...prefix, nv.error, 2]), N, UNEXPECTED('error'));
            perform([...prefix, 'b', 'c', 'd'],
                [...prefix, , v => !['b', 'c', 'd'].includes(v) && E, AE, AE], N, MANYEXTRA);
            perform([], nv => () => nv([...prefix, nv.end, AE, v => true, () => {}]), N, MANYEXTRA);
            perform([...prefix, 'b', 'c', 'd'], nv => () =>
                nv([...prefix, , v => !['b', 'c', 'd'].includes(v) && E, nv.end]), N, MANYENDS);
            perform([], nv => () => nv([...prefix, nv.end, ,]), N, MANYENDS);
            perform([...prefix], nv => () =>
                nv([...prefix, nv.end, () => {}, () => {}]), N, MANYFUNCS);
            perform([], [...prefix, , AE, AE], N, MANYERRORS);
            perform([...prefix], nv => () => nv([...prefix, nv.end, false]), N, FALSY);
            perform([], [...prefix, , () => {}, null], N, FALSY);
            perform(null, nv => () => nv([...prefix, nv.end, '', () => {}]), N, FALSY);
        }
    });
});

describe('misc', () => {
    test('always return false for falsy', () => {
        expect(nonvalid.instance()(null, () => null)).toBe(false);
        expect(nonvalid.instance()({}, () => {})).toBe(false);
        expect(nonvalid.instance()({ abc: 123 }, { abc: () => '' })).toBe(false);
    });

    test('chaining of values', () => {
        const check = (nv, v, key, actualV, actualKey) => {
            expect(nv.value()).toBe(actualV);
            expect(v).toBe(actualV);
            expect(key).toBe(actualKey);
        };

        {
            const nv = nonvalid.instance();
            nv(123, (v, key) => {
                check(nv, v, key, 123);
                nv(v, (v, key) => {
                    check(nv, v, key, 123);
                    nv((v, key) => {
                        check(nv, v, key, 123);
                    });
                    check(nv, v, key, 123);
                });
                check(nv, v, key, 123);
            });
        }

        {
            const nv = nonvalid.instance();
            nv({ abc: { def: 'ghi' } }, { abc: { def: (v, key) => {
                check(nv, v, key, 'ghi', 'def');
                nv((v, key) => {
                    check(nv, v, key, 'ghi', 'def');
                    nv(v, (v, key) => {
                        check(nv, v, key, 'ghi', 'def');
                    });
                    check(nv, v, key, 'ghi', 'def');
                });
                check(nv, v, key, 'ghi', 'def');
            } } });
        }
    });

    test('resetting error from above', () => {
        const object = { a: { b: 'c' } };
        {
            const nv = nonvalid.instance();
            const error = nv(object, () => nv({ a: () => nv({ b: 'd' }) }));
            expect(error).toBe(true);
            expect(nv.errorPath()).toEqual(['a', 'b']);
        }
        {
            const nv = nonvalid.instance();
            const error = nv(object, () => nv({ a: () => nv({ b: 'd' }) && false }));
            expect(error).toBe(false);
            expect(nv.errorPath()).toBe(null);
        }
        {
            const nv = nonvalid.instance();
            const error = nv(object, () => nv({ a: () => nv({ b: 'd' }) && false }) || true);
            expect(error).toBe(true);
            expect(nv.errorPath()).toEqual([]);
        }
    });

    test('reusing instances and handling errors', () => {
        const E = 'custom';

        const ANOTHER = 'To validate another value, use nonvalid.instance()';
        const NOCONTEXT = 'Validator called with no value outside of any context';

        expect(nonvalid(123, 123)).toBe(false);
        expect(() => nonvalid(123, 123)).toThrow(new Error(ANOTHER));
        {
            const nv = nonvalid.instance();
            expect(nv(123, 124)).toBe(true);
            expect(() => nv(123, 124)).toThrow(new Error(ANOTHER));
        }
        expect(nonvalid.instance()(123, 123)).toBe(false);
        {
            const nv = nonvalid.instance();
            expect(() => nv(123, () => { throw new Error(E); })).toThrow(new Error(E));
            expect(() => nv(123, 124)).toThrow(new Error(ANOTHER));
        }
        {
            const nv = nonvalid.instance();
            expect(() => nv({
                value: 123
            }, () => {
                try { nv({ value: () => { throw new Error(E); } }); } catch (e) {}
                return false;
            })).toThrow(new Error(CANTPROCEED));
            expect(() => nv(123, 124)).toThrow(new Error(ANOTHER));
        }
        expect(() => nonvalid.instance()(() => false)).toThrow(new Error(NOCONTEXT));
        {
            const nv = nonvalid.instance();
            expect(() => nv({
                value: 123
            }, () => {
                nv({
                    value: () => {
                        try {
                            nv.get(() => {
                                nv.get(() => {
                                    const value = nv.value();
                                    expect(value === 123).toBe(false);
                                    expect(nv.get(() => value) === 123).toBe(true);
                                    throw new Error(E);
                                });
                            });
                        } catch(e) {}
                        expect(nv.value()).toBe(123);
                        expect(nv.root()).toEqual({ value: 123 });
                    }
                });
                return false;
            }));
        }
    });
});