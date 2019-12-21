const matchers = {
    number: v => typeof v === 'number' && isFinite(v),
    string: v => typeof v === 'string',
    boolean: v => typeof v === 'boolean',
    null: v => v === null,
    undefined: v => v === undefined,
    defined: v => v !== undefined,
    bigint: v => typeof v === 'bigint',
    symbol: v => typeof v === 'symbol',
    function: v => typeof v === 'function',
    array: v => Array.isArray(v),
    object: v => typeof v === 'object' && v !== null && !Array.isArray(v),
    get: v => v
};

const symbols = {
    other: Symbol('nonvalid.other'),
    error: Symbol('nonvalid.error'),
    end: Symbol('nonvalid.end')
};
const symbolList = Object.values(symbols);

const privateSymbols = {
    unwrap: Symbol('nonvalid.unwrap')
};

const hasProperty = (object, property) => Object.hasOwnProperty.call(object, property);
const allEntries = object => [
    ...Object.entries(object),
    ...Object.getOwnPropertySymbols(object).map(key => [key, object[key]])
];

function createInstance() {
    let values, funnel, path, errorPath, validatorDepth, safeDepth, safeMap, started, finished;

    const basicReset = (final = true) => {
        safeMap = {};
        started = false;
        finished = final;
    };

    const reset = (final = true) => {
        values = [];
        funnel = [];
        path = [];
        errorPath = null;
        validatorDepth = 0;
        safeDepth = 0;
        basicReset(final);
    };

    reset(false);

    const resetAndThrow = error => {
        reset();
        throw new Error(error);
    };

    const run = (callback, value) => {
        values.push(value);
        let error;
        try {
            error = callback(value, currentKey()) || false;
        } catch(e) {
            if (!finished) {
                reset();
            }
            throw e;
        }
        if (finished) {
            throw new Error('Cannot proceed with validation after an error');
        }
        values.pop();
        return error;
    };

    const validateObjectSchema = schema => {
        const catchOther = schema[symbols.other];
        if (!matchers.undefined(catchOther) && !matchers.function(catchOther)) {
            resetAndThrow('The catch-other callback must be a function');
        }
        const shapeError = schema[symbols.error];
        if (matchers.defined(shapeError) && (matchers.function(shapeError) || !shapeError)) {
            resetAndThrow('The shape error must be a non-function truthy value');
        }
        for (const key of Object.getOwnPropertySymbols(schema)) {
            if (key !== symbols.other && key !== symbols.error && symbolList.includes(key)) {
                resetAndThrow(`${key.toString()} is not expected in an object schema`);
            }
        }
        return [catchOther, shapeError];
    };

    const inspectObject = (schema, value) => {
        const [catchOther, shapeError] = validateObjectSchema(schema);
        if (!matchers.object(value)) {
            return shapeError || true;
        }
        for (const [key, subschema] of allEntries(schema)) {
            if (matchers.symbol(key) && symbolList.includes(key)) {
                continue;
            }
            const error = inspectKey(subschema, value[key], key);
            if (error) {
                return error;
            }
        }
        for (const [key, subvalue] of allEntries(value)) {
            if (!hasProperty(schema, key)) {
                if (matchers.undefined(catchOther)) {
                    return true;
                }
                const error = inspectKey(catchOther, subvalue, key);
                if (error) {
                    return error;
                }
            }
        }
        return false;
    };

    const validateArraySchema = schema => {
        for (const value of schema) {
            if (matchers.symbol(value) && value !== symbols.end && symbolList.includes(value)) {
                resetAndThrow(`${value.toString()} is not expected in an array schema`);
            }
        }
        let endIndex = 0;
        while (hasProperty(schema, endIndex) && schema[endIndex] !== symbols.end) {
            endIndex++;
        }
        if (schema.length > endIndex + 3) {
            resetAndThrow('Found more than 2 elements after the end-of-array marker');
        }
        let functional = undefined;
        let truthy = undefined;
        for (let index = endIndex + 1; index < schema.length; index++) {
            if (!hasProperty(schema, index) || schema[index] === symbols.end) {
                resetAndThrow('Encountered multiple end-of-array markers');
            }
            const value = schema[index];
            if (matchers.function(value)) {
                if (matchers.defined(functional)) {
                    resetAndThrow('Encountered multiple catch-other callbacks');
                }
                functional = value;
            } else if (value) {
                if (matchers.defined(truthy)) {
                    resetAndThrow('Encountered multiple shape error values');
                }
                truthy = value;
            } else {
                resetAndThrow('Shape error must be a truthy value');
            }
        }
        return [endIndex, functional, truthy];
    };

    const inspectArray = (schema, value) => {
        const [maxIndex, catchOther, shapeError] = validateArraySchema(schema);
        if (!matchers.array(value)) {
            return shapeError || true;
        }
        for (let index = 0; index < maxIndex; index++) {
            const error = inspectKey(schema[index], value[index], index);
            if (error) {
                return error;
            }
        }
        for (let index = maxIndex; index < value.length; index++) {
            if (matchers.undefined(catchOther)) {
                return true;
            }
            const error = inspectKey(catchOther, value[index], index);
            if (error) {
                return error;
            }
        }
        return false;
    };

    const inspectDeeper = (inspector, schema, value) => {
        funnel.push(value);
        const error = inspector(schema, value);
        funnel.pop();
        return error;
    };

    const doInspect = (schema, value) => {
        if (matchers.function(schema)) {
            return run(schema, value);
        } else if (matchers.object(schema)) {
            return inspectDeeper(inspectObject, schema, value);
        } else if (matchers.array(schema)) {
            return inspectDeeper(inspectArray, schema, value);
        } else {
            return value !== schema;
        }
    };

    const inspectKey = (schema, value, key) => {
        path.push(key);
        const error = inspect(schema, value);
        path.pop();
        return error;
    };

    const inspect = (schema, value) => {
        const error = doInspect(schema, value);
        if (error) {
            if (!errorPath) {
                errorPath = [...path];
            }
        } else {
            errorPath = null;
        }
        return error;
    };

    const validator = (...args) => {
        if (validatorDepth === 0) {
            if (finished) {
                resetAndThrow('To validate another value, use nonvalid.instance()');
            }
            started = true;
        }
        validatorDepth++;
        let schema, value;
        if (args.length > 1) {
            [value, schema] = args;
        } else {
            if (values.length === 0) {
                resetAndThrow('Validator called with no value outside of any context');
            }
            schema = args[0];
            value = currentValue();
        }
        const error = inspect(schema, value);
        validatorDepth--;
        if (validatorDepth === 0) {
            basicReset();
        }
        return error;
    };

    const wrapIfSafe = value => {
        if (safeDepth > 0) {
            const unwrapTimeout = setTimeout(() => {
                throw new Error('Value created in safe context was not consumed by any matcher');
            }, 0);
            const wrap = value => new Proxy({}, {
                get: function getter(target, property) {
                    if (property === privateSymbols.unwrap) {
                        clearTimeout(unwrapTimeout);
                        return value;
                    }
                    if (property === Symbol.toPrimitive) {
                        clearTimeout(unwrapTimeout);
                        const key = Symbol('nonvalid.safe');
                        const timeout = setTimeout(() => {
                            throw new Error('Value created in safe context was used improperly');
                        }, 0);
                        safeMap[key] = { value, timeout };
                        return () => key;
                    }
                    let p = property;
                    if (hasProperty(safeMap, property)) {
                        p = safeMap[property].value;
                        clearTimeout(safeMap[property].timeout);
                    }
                    const valid = (
                        matchers.object(value) &&
                            (matchers.symbol(p) || matchers.string(p) || matchers.number(p))
                        || matchers.array(value) &&
                            (matchers.string(p) && p.match(/^\d+$/) || matchers.number(p))
                        ) && hasProperty(value, p);
                    return wrap(valid ? value[p] : undefined);
                },
                getOwnPropertyDescriptor: (target, property) => {
                    if (property === privateSymbols.unwrap) {
                        return {configurable: true, enumerable: false};
                    }
                }
            });
            return wrap(value);
        } else {
            return value;
        }
    };

    validator.root = () => {
        if (funnel.length === 0) {
            resetAndThrow('root() called outside of any object or array');
        }
        return wrapIfSafe(funnel[0]);
    };

    validator.up = (levels = 0) => {
        if (funnel.length <= levels) {
            resetAndThrow('up() call navigates above any object or array');
        }
        return wrapIfSafe(funnel[funnel.length - 1 - levels]);
    };

    const currentValue = () => {
        return values[values.length - 1];
    };

    validator.value = () => {
        if (values.length === 0) {
            resetAndThrow('value() called outside of any context');
        }
        return wrapIfSafe(currentValue());
    };

    const currentKey = () => {
        return path.length === 0 ? undefined : path[path.length - 1];
    };

    validator.key = () => {
        const result = currentKey();
        if (matchers.undefined(result)) {
            resetAndThrow('key() called outside of any context');
        }
        if (!matchers.string(result) && !matchers.symbol(result)) {
            resetAndThrow('key() can be called for objects only');
        }
        return result;
    };

    validator.index = () => {
        const result = currentKey();
        if (matchers.undefined(result)) {
            resetAndThrow('index() called outside of any context');
        }
        if (!matchers.number(result)) {
            resetAndThrow('index() can be called for arrays only');
        }
        return result;
    };

    const formatPath = (path, name) => {
        const chainifyKey = key => {
            if (matchers.symbol(key)) {
                return `[${key.toString()}]`;
            } else {
                return `[${JSON.stringify(key)}]`;
            }
        };
        return name ? name + path.map(chainifyKey).join('') : [...path];
    };

    validator.path = name => {
        if (finished) {
            throw new Error('path() called after validation');
        }
        if (!started) {
            throw new Error('path() called before validation');
        }
        return formatPath(path, name);
    };

    validator.errorPath = name => {
        if (!finished) {
            throw new Error('errorPath() called before validation is completed');
        }
        if (!errorPath) {
            return errorPath;
        }
        return formatPath(errorPath, name);
    };

    const enhanceMatcher = (matcher, name) => (...args) => {
        if (args.length > 1) {
            throw new Error('Matchers are supposed to be run with exactly one or no arguments');
        } else if (args.length === 1) {
            const value = args[0];
            if (values.length > 0 && matchers.function(value) && currentValue() !== value) {
                safeDepth++;
                let v;
                try {
                    v = value();
                } finally {
                    safeDepth--;
                }
                if (!matchers.object(v) || !hasProperty(v, privateSymbols.unwrap)) {
                    resetAndThrow('Callback didn’t perform traversal or didn’t return its result');
                }
                return matcher(v[privateSymbols.unwrap]);
            } else {
                return matcher(value);
            }
        } else {
            if (values.length === 0) {
                throw new Error(`${name}() called without arguments outside of any context`);
            }
            return matcher(currentValue());
        }
    };
    for (const [name, matcher] of allEntries(matchers)) {
        validator[name] = enhanceMatcher(matcher, name);
    }
    validator.addMatcher = (...args) => {
        let matcher, name;
        switch (args.length) {
            case 2:
                [name, matcher] = args;
                if (!matchers.string(name) && !matchers.symbol(name)) {
                    throw new Error('Name of a matcher should be either string or symbol');
                }
                if (!matchers.function(matcher)) {
                    throw new Error('Second addMatcher argument must be a function');
                }
                break;
            case 1:
                matcher = args[0];
                if (!matchers.function(matcher) || !matcher.name) {
                    throw new Error('Single addMatcher argument must be a named function');
                }
                name = matcher.name;
                break;
            default:
                throw new Error('addMatcher expects exactly one or two arguments');
        }
        if (matcher.length !== 1) {
            throw new Error('Matcher must accept exactly one parameter');
        }
        if (hasProperty(validator, name)) {
            throw new Error(`Validator already has property "${name.toString()}"`);
        }
        validator[name] = enhanceMatcher(matcher, name);
    };

    for (const [name, symbol] of allEntries(symbols)) {
        validator[name] = symbol;
    }

    return validator;
}

const defaultInstance = createInstance();
defaultInstance.instance = createInstance;
module.exports = defaultInstance;