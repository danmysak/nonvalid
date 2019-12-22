# nonvalid

`nonvalid` is a validation library that relieves you of necessity to traverse data structures manually but keeps your validation logic completely custom. The workflow is as follows: you describe the expected shape of your data and provide a callback for each piece of it that you’d like to validate. If any of the callbacks return an error (that is, any truthy value), this becomes the result of the validation. Otherwise, `false` is returned, which means that there is no error and the validation is successful.

`nonvalid` supports validating values of all JavaScript data types, including [symbols](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Symbol) and [bigints](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/BigInt).


## <a name="installation"></a>Installation

If you are going to use `nonvalid` as part of a Node.js project, install the library with `npm i nonvalid`. You can import `nonvalid` in one of the following ways:

CommonJS:
```js
const nonvalid = require('nonvalid');
```

ES6 Modules:
```js
import nonvalid from 'nonvalid';
```

Browser:
```html
<script src="https://unpkg.com/nonvalid@1/dist/nonvalid.min.js"></script>
```


## <a name="basics"></a>Basics

Generally, you call `nonvalid` with two arguments: the data you are validating and the schema that you’re validating it against. The simplest way to use `nonvalid` is to compare two values literally:

```js
nonvalid({ value: 42 }, { value: 42 }); // returns false, as there is no error
```

```js
nonvalid({ value: '42' }, { value: 42 }); // returns true, as there is a type mismatch
```

As the [old saying](https://en.wikipedia.org/wiki/Anna_Karenina_principle) goes, all valid values are alike, but each invalid one is not valid in its own way. This is why `nonvalid` chooses to represent validity as just `false`; validation errors, on the other hand, are allowed to assume any truthy value that would best reflect the exact nature of the error.

Consider the following code:

```js
nonvalid({ value: 42.42 }, { value: v => {
  if (typeof v !== 'number') {
    return 'Value must be a number';
  }
  if (v < 42) {
    return 'Value must not be less than 42';  
  }
  if (v >= 43) {
    return 'Value must not be much greater than 42';  
  }
} });
```

This call will return `false`, but were we to pass `{ value: 41 }` as the first argument, it would have returned the string `'Value must not be less than 42'`.

If you prefer, you can rewrite the callback using [short-circuit evaluation](https://en.wikipedia.org/wiki/Short-circuit_evaluation) and a [matcher](#matchers):

```js
nonvalid({ value: 42.42 }, { value: v =>
  !nonvalid.number(v) && 'Value must be a number' ||
  v < 42 && 'Value must not be less than 42' ||
  v >= 43 && 'Value must not be much greater than 42'
});
```

Note that earlier, when we tried to validate the wrongly typed `{ value: '42' }` against `{ value: 42 }`, there was no callback for `nonvalid` to call, so it simply returned the generic `true` for an error.


## <a name="instances"></a>Validator instances

If you are going to validate more than one value with `nonvalid`, you must create a new validator instance each time before you perform validation. Use [`nonvalid.instance()`](#nonvalid-instance) for this:

```js
function validate(value) {
  const nv = nonvalid.instance();
  return nv(value, v => !nv.number(v) || v < 42 || v >= 43);
}

console.log(validate(42.42));
console.log(validate('foo'));
console.log(validate(41));
console.log(validate(43));
```

After creating a dedicated instance, you must call all [matchers](#matchers) and other methods on this instance rather than on `nonvalid` itself. 


## <a name="matchers"></a>Matchers

Some of the most basic checks needed for proper data validation often look ugly. For instance, to make sure that a value is a proper object, you would write `typeof value === 'object' && value !== null && !Array.isArray(value)`. To simplify things, `nonvalid` comes with a (very limited) set of validators of this kind, called matchers: [`number`](#nv-number), [`string`](#nv-string), [`boolean`](#nv-boolean), [`null`](#nv-null), [`undefined`](#nv-undefined), [`defined`](#nv-defined), [`bigint`](#nv-bigint), [`symbol`](#nv-symbol), [`function`](#nv-function), [`array`](#nv-array), and, finally, [`object`](#nv-object) (which is implemented exactly as above). For full reference on matchers, see [API](#api) below.

To use a matcher, simply pass a value to it:

```js
const nv = nonvalid.instance();
console.log(nv.object({ foo: 'bar' })); // true
console.log(nv.object('foo')); // false
console.log(nv.object(null)); // false
```

When calling a matcher during validation, you can choose to omit the argument you pass to it. In this case the matcher will use the innermost value that you are currently inspecting:

```js
const nv = nonvalid.instance();
console.log(nv({ value: { foo: 'bar' } }, { value: () => !nv.object() }));
// This is the same as  v => !nv.object(v); validation returns false
```

```js
const nv = nonvalid.instance();
console.log(nv({ value: 42 }, { value: () => !nv.object() }));
// Still the same as  v => !nv.object(v); validation returns true
```

You can also add your own matchers with [`addMatcher`](#nv-addMatcher):

```js
const nv = nonvalid.instance();
nv.addMatcher('positive', n => nv.number(n) && n > 0);
console.log(nv({ value: 42 }, { value: () => !nv.positive() })); // false
```

Note that in order to be made a matcher, a function has to accept exactly one parameter. However, after we have made a function a matcher, we can call it with no arguments during validation—just as we did in the case of built-in matchers. Similarly, custom matchers will automagically be capable of [safe navigation](#safe-navigation).


## <a name="traversal"></a>Automatic traversal

`nonvalid` automatically traverses objects and arrays and compares values residing in their corresponding keys/indices. When in the schema (the right-hand argument to `nonvalid`) a function is encountered, it is called with the left-hand value as an argument. The result it returns is then treated as an error of validation: falsy values mean there was no error; truthy values mean there _is_ an error, and it is immediately propagated to the very top and returned as the outcome of the whole validation routine.

```js
nv({ type: 'dragon', position: [12.3, 25.1] }, {
  type: v => !['dragon', 'zombie'].includes(v) && 'Unknown character type',
  position: [
    v => !nv.number(v) && 'The X coordinate must be a number',
    v => !nv.number(v) && 'The Y coordinate must be a number'  
  ]
});
```

<a name="recursion"></a>The cool thing about such traversals is that you can use recursion whenever there is a need to do so. For example, if we want to allow `null` values for position, we might write:

```js
nv({ type: 'dragon', position: [12.3, 25.1] }, {
  type: v => !['dragon', 'zombie'].includes(v) && 'Unknown character type',
  position: v => v !== null && nv(v, [
    v => !nv.number(v) && 'The X coordinate must be a number',
    v => !nv.number(v) && 'The Y coordinate must be a number'  
  ])
});
```

In fact, (matchers)[#matchers] and (recursive calls)[#nv] don’t even require passing them the current value, so the following code will do the job as well:

```js
nv({ type: 'dragon', position: [12.3, 25.1] }, {
  type: v => !['dragon', 'zombie'].includes(v) && 'Unknown character type',
  position: () => !nv.null() && nv([
    () => !nv.number() && 'The X coordinate must be a number',
    () => !nv.number() && 'The Y coordinate must be a number'  
  ])
});
```

Note that not having `position` at all (as opposed to having `position: null`) would make the object invalid. Basically, missing `position` is the same as having `position: undefined`. If we want to allow this as well, we need to write `position: () => nv.defined() && !nv.null() && ...` in the schema.

Keep in mind that the order in which you place validation schema properties is the order in which the checks will be executed (with some [qualifications](https://www.stefanjudis.com/today-i-learned/property-order-is-predictable-in-javascript-objects-since-es2015/)). This means that if you pass in a non-existing character type with non-numerical coordinates, the specific error you will get in return depends on whether you put the `type` checker or the `position` checker first when describing the schema object.


## <a name="shape"></a>Shape validation

If `nonvalid` encounters a number where the validation schema expects an object or, say, an object where the schema has an array, it will return `true` indicating a generic error:

```js
nv({ position: [12.3, 25.1] }, { position: {
  x: () => !nv.number() && 'X must be a number',
  y: () => !nv.number() && 'Y must be a number'
} }); // returns true because we have an array on the left but an object on the right
```

If you want to customize this error, provide a truthy value in the [`[nv.error]`](#nv-error) field of an object or after the [`nv.end`](#nv-end) helper value in an array:

```js
nv({ position: [12.3, 25.1] }, { position: {
  x: () => !nv.number() && 'X must be a number',
  y: () => !nv.number() && 'Y must be a number',
  [nv.error]: 'Position must be an object'
} });
```

```js
nv({ position: { x: 12.3, y: 25.1 } }, { position: [
  () => !nv.number() && 'X must be a number',
  () => !nv.number() && 'Y must be a number',
  nv.end,
  'Position must be an array'
] });
```

Often you would like your arrays and objects to contain any number of values that satisfy certain requirements. By default, `nonvalid` will return `true` for any extra values that the validation schema does not have.

To allow keys other than listed in the schema for an object, use [`[nv.other]`](#nv-other) in conjunction with [`nv.key()`](#nv-key):

```js
nv.addMatcher('color', v => nv.string() && v.match(/^#[0-9a-f]{6}$/));
nv({ default: '#ffffff', red: '#ff0000', white: '#ffffff', black: '#000000' }, {
  default: () => !nv.color() && 'You must specify a valid default color',
  [nv.other]: () => !nv.color() && `Code for the ${nv.key()} color is invalid`
});
```

For arrays, place the callback after [`nv.end`](#nv-end) and use [`nv.index()`](#nv-index) if necessary:

```js
nv.addMatcher('color', v => nv.string() && v.match(/^#[0-9a-f]{6}$/));
nv(['#ffffff', '#ff0000', '#000000'], [
  () => !nv.color() && 'You must specify a valid default color as the first item',
  nv.end,
  () => !nv.color() && `Color code at position ${nv.index()} is invalid`
]);
```

Of course, you can provide both this callback and the custom shape mismatch error (we omit here the definition of the `color` matcher):

```js
nv({ default: '#ffffff', red: '#ff0000', white: '#ffffff', black: '#000000' }, {
  default: () => !nv.color() && 'You must specify a valid default color',
  [nv.other]: () => !nv.color() && `Code for the ${nv.key()} color is invalid`,
  [nv.error]: 'The value must be an object'
});
```

```js
nv(['#ffffff', '#ff0000', '#000000'], [
  () => !nv.color() && 'You must specify a valid default color as the first item',
  nv.end,
  () => !nv.color() && `Color code at position ${nv.index()} is invalid`,
  'The value must be an array'
]);
```

If there are no mandatory elements like the default value above, it can be handled too:

```js
nv({ red: '#ff0000', white: '#ffffff', black: '#000000' }, {
  [nv.other]: () => !nv.color() && `Code for the ${nv.key()} color is invalid`,
  [nv.error]: 'The value must be an object'
});
```

```js
nv(['#ff0000', '#000000'], [
  nv.end,
  () => !nv.color() && `Color code at position ${nv.index()} is invalid`,
  'The value must be an array'
]);
```

Note the [`nv.end`](#nv-end) in front of the validation array. It is important to put it there, as otherwise the callback will only apply to the element at index 0, and the element at index 1 will be compared to the string `'The value must be an array'`. That’s not what you want.

By the way, in case you were wondering, [`nv.error`](#nv-error), [`nv.end`](#nv-end), and [`nv.other`](#nv-other) are all [symbols](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Symbol).


## <a name="paths"></a>Paths

At any point during traversal, you can request the path in the validation tree to the currently inspected element. Call to [`nv.path()`](#nv-path) will return an array of keys/indices that, when chained to the root element of the tree, will lead to the current value. By calling [`nv.path(name)`](#nv-path) you can get a textual (JS-like) representation of the path, assuming that the name of the root element is `name`.

```js
nv({ users: [{ name: 'John Doe' }, { name: 'Richard Roe' }] }, { users: [nv.end, () => nv({
  name: v => {
    if (v.startsWith('John')) {
      console.log(nv.path()); // ['users', 0, 'name']    
    }
    if (v.startsWith('Richard')) {
      console.log(nv.path('data')); // 'data["users"][1]["name"]'
    }
  }
})] });
```

Similarly, if the inspected value turned out to be invalid, the path to the element which triggered validation error can be retrieved with [`nv.errorPath()`](#nv-errorPath) or [`nv.errorPath(name)`](#nv-errorPath):

```js
nv({ names: ['John Doe', 'Richard Roe', null] }, { names: [nv.end, () => !nv.string()] });
console.log(nv.errorPath()); // ['names', 2]
console.log(nv.errorPath('props')); // 'props["names"][2]'
```


## <a name="navigation"></a>Regular navigation

`nonvalid` supports three methods to navigate the inspected tree of objects and arrays. During navigation, you can call [`nv.root()`](#nv-root) to get to the topmost level, [`nv.value()`](#nv-value) to retrieve the current (innermost) value, and [`nv.up(n)`](#nv-up) to get `n` levels up the tree from the current value, starting with its immediate parent:

```js
nv({ a: { b: { c: 'd' } } }, { a: { b: { c: () => {
  console.log(nv.root()); // { a: { b: { c: 'd' } } }
  console.log(nv.value()); // 'd'
  console.log(nv.up()); // { c: 'd' }
  console.log(nv.up(0)); // { c: 'd' }
  console.log(nv.up(1)); // { b: { c: 'd' } }
  console.log(nv.up(2)); // { a: { b: { c: 'd' } } }
} } } });
```

```js
nv(['a', ['b', ['c', 'd']]], ['a', ['b', () => {
  console.log(nv.root()); // ['a', ['b', ['c', 'd']]]
  console.log(nv.value()); // ['c', 'd']
  console.log(nv.up()); // ['b', ['c', 'd']]
  console.log(nv.up(0)); // ['b', ['c', 'd']]
  console.log(nv.up(1)); // ['a', ['b', ['c', 'd']]]
  console.log(nv.up(2)); // exception
}]]);
```

The methods work correctly regardless of whether you’re [using recursion](#recursion) in validation or not. However, navigation will start to act funny if you skip levels for some reason:

```js
nv({ a: { b: { c: 'd' } } }, { a: v => {
  return nv(v.b.c, () => {
    console.log(nv.root()); // { a: { b: { c: 'd' } } }, as should be
    console.log(nv.value()); // 'd', as should be
    console.log(nv.up()); // { a: { b: { c: 'd' } } }, because two levels were skipped
    console.log(nv.up(1)); // exception
  });
} });
```


## <a name="safe-navigation"></a>Safe navigation

`nonvalid` provides a built-in way to perform [optional chaining](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Operators/Optional_chaining) on a tree that is being validated. To use it, create a function that calls either [`nv.root()`](#nv-root), [`nv.up()`](#nv-up), or [`nv.value()`](#nv-value), performs regular chaining on the received value, and returns its result. Pass this function as the argument to any [matcher](#matchers). The matcher will call the function and treat its returned value as if you have passed it to the matcher directly. If the chaining was unsuccessful, the value will be `undefined`.

Let’s consider the following validation scenario:

```js
nv.addMatcher('color', v => nv.string() && v.match(/^#[0-9a-f]{6}$/));
nv({ shades: { red: '#ff0000', white: '#ffffff' }, color: 'red' }, {
  shades: () => nv.defined() && nv({ [nv.other]: () => !nv.color() }),
  color: v => !nv.color() && nv.undefined(() => nv.root().shades[v]) // safe navigation
});
```

So, we want the object to have the `color` field holding either a correct color code or a name of a color whose code is indexed in the `shapes` nested object. But we don’t care too much about `shapes`: it may as well be undefined as long as `color` is already a valid code. To achieve this, we use safe navigation by writing `nv.undefined(() => nv.root().shades[v])`. If we were to navigate simply by `nv.undefined(nv.root().shades[v])`, the code would throw an exception in an unfortunate case when `shades` are not present while `color` is not really a color code.

To facilitate safe navigation, there is an additional matcher, [`get`](#nv-get). It is useful in that it allows you to directly get the last link of a safe navigation chain:

```js
nv({
  redirects: {
    server: { home: 'news', news: 'news/latest' },  
  },
  page: 'home'
}, {
  page: v => {
    console.log(nv.get(() => nv.up().redirects.server[v])); // 'news'
    console.log(nv.get(() => nv.up().redirects.client[v])); // undefined
    console.log(nv.get(() => {
      return nv.up().redirects.server[nv.up().redirects.server[v]];
    })); // 'news/latest'
    console.log(nv.get(() => {
      return nv.up().redirects.client[nv.up().redirects.client[v]];
    })); // undefined
    console.log(nv.get(() => nv.value())); // 'home'
    console.log(nv.get(() => nv.value().some.field)); // undefined
    console.log(nv.get(() => v.some.field)); // exception
  }
});
```

Notice that we have used nested safe navigation for both server and client redirects. Also, the last line causes an exception, because the variable `v` is not a subject of safe navigation (only [`nv.value()`](#nv-value), [`nv.up()`](#nv-up), and [`nv.root()`](#nv-root) can be). 

One small benefit of using `nonvalid`’s safe navigation is that you don’t need to worry about keys named `'undefined'`:

```js
nv({
  types: {
    'string': 'the most straightforward type',
    'boolean': 'just yay or nay',    
    'number': 'infinitely complicated',
    'bigint': 'finitely complicated',
    'object': 'kind of curly',
    'null': 'somewhat like an object',
    'symbol': 'not like anything else',
    'undefined': 'like the future of JS'
  }
}, {
  type: v => {
    console.log(v); // undefined
    console.log(nv.value()); // undefined
    console.log(nv.get(() => nv.root().types[v])); // 'like the future of JS'
    console.log(nv.get(() => nv.root().types[nv.value()])); // undefined
  }
});
```


## <a name="api"></a>Full reference (API)

### Global method of `nonvalid`

#### <a name="nonvalid-instance"></a>`nonvalid.instance()`

Creates and returns a new validator instance. Use this method every time you need to validate a new value. See [Validator instances](#instances).

### Instance methods

#### <a name="nv"></a>`nv(value, schema)` or `nv(schema)`

If called as `nv(value, schema)`, validates the `value` against the `schema`. If called as `nv(schema)`, validates the currently inspected value against the schema (that is, the call is identical to `nv(nv.value(), schema)`). Validation occurs through [automatic tree traversal](#traversal), [strict value comparison and running callbacks](#basics). Each callback receives two parameters: the current value (what would `nv.value()` return) and the current key (what would `nv.key()` or `nv.index()` return; `undefined` if not inside any object or array).

Validation traverses an object’s properties in the following order:

1. Validation schema keys that are non-negative integers (or rather strings that represent them), in ascending order.
2. Other validation schema keys that are strings, in the order in which they were defined.
3. Validation schema that are symbols, in the order in which they were defined.
4. The inspected object’s remaining keys that are non-negative integers (or rather strings that represent them), in ascending order.
5. The inspected object’s other remaining keys that are strings, in the order in which they were defined.
6. The inspected object’s remaining keys that are symbols, in the order in which they were defined.

If the inspected object doesn’t have a key encountered in steps 1, 2, or 3, the corresponding value is considered `undefined`. Keys/values encountered in steps 4, 5, 6 (but not in 1, 2, or 3), if any, are sent to the validation schema’s callback under [`[nv.other]`](#nv-other), if present. Otherwise, error is returned (`true` or the value of [`[nv.error]`](#nv-other)).

Validation traverses an array’s properties in the following order:

1. Validation schema "regular" elements (that is, elements before [`[nv.end]`](#nv-end)), in ascending order of their indices.
2. Remaining elements of the inspected array, in ascending order of their indices.

If the inspected array doesn’t contain an element at position encountered during step 1, its value is considered `undefined`. Elements from step 2, if any, are sent to the validation schema’s callback, if present. Otherwise, error is returned. See [`nv.end`](#nv-end).

The method returns `false` if the `value` is valid (even if a callback has returned some other falsy value, like `null` or `undefined`); otherwise returns a truthy error. Can, and often should, be called recursively. See [Automatic traversal](#traversal).

#### <a name="nv-addMatcher"></a>`nv.addMatcher(name, func)` or `nv.addMatcher(namedFunc)`

Adds a function to the list of available matchers. The matcher can later be called with `nv.matcherName()` or `nv.matcherName(v)`, where `nv` is the instance to which the matcher was added and `matcherName` represents the name of the matcher. If the name is already taken by another matcher or a method of the instance, the call to `addMatcher` will throw.

If called as `nv.addMatcher(name, func)`, `name` becomes the name of the matcher (regardless of the name of `func`). `name` can be of type `string` or `symbol`.

If called as `nv.addMatcher(namedFunc)`, the `name` of `namedFunc` becomes the name of the matcher. Don’t use this way of adding a matcher if you plan to minify your code, as minification may change function names.

`func` or `namedFunc` must accept exactly one parameter. The function will be wrapped by `nonvalid`. 

When later called as `nv.matcherName()` with no arguments, `nonvalid` will actually call the function with the [current value](#nv-value) (that is, the call will be identical to `nv.matcherName(nv.value())`).

When during validation called as `nv.matcherName(f)` where `f` is a function distinct from the current value (`f !== nv.value()`), it will switch the validator instance to a safe mode of execution where calls to [`nv.value()`](#nv-value), [`nv.root()`](#nv-root), and [`nv.up()`](#nv-up) return safely wrapped values, call `f` in this context, then switch back and unwrap the value `f` returned. It will then call the initial function, `func` or `namedFunc`, passing it the unwrapped value. See [Safe navigation](#safe-navigation).

Also see [Matchers](#matchers).

#### <a name="nv-path"></a>`nv.path()` or `nv.path(name)`

Can be called during validation only. If called as `nv.path()`, returns a chain (array) of keys/indices that leads to the current value. Keys can be strings or symbols; indices are numbers. If current value is at the topmost level, returns an empty array. If called as `nv.path(name)` where `name` is a string, returns a formatted string that looks like a JS expression to retrieve the value from the topmost object/array, assuming the parameter passed in is its name. See [Paths](#paths).

#### <a name="nv-errorPath"></a>`nv.errorPath()` or `nv.errorPath(name)`

Can be called after validation only. If the inspected value was deemed valid or if the validation threw, returns `null`. Otherwise, the method returns exactly what [`nv.path()`](#nv-path) or [`nv.path(name)`](#nv-path) would have returned at the moment when the validation error occurred. See [Paths](#paths).

#### <a name="nv-key"></a>`nv.key()`

Can be called during validation only. If called while validating a value inside an object, returns this value’s key (a string or a symbol). Otherwise throws. See [Shape validation](#shape).

#### <a name="nv-index"></a>`nv.index()`

Can be called during validation only. If called while validating an element of an array, returns this element’s index (a number). Otherwise throws. See [Shape validation](#shape).

#### <a name="nv-value"></a>`nv.value()`

Can be called during validation only. Returns the (innermost) currently inspected value. See [Regular navigation](#navigation) and [Safe navigation](#safe-navigation).

#### <a name="nv-root"></a>`nv.root()`

Can be called during validation only. Returns the topmost object or array that the current value belongs to. If the current value is not inside any object or array, it throws.

See [Regular navigation](#navigation) and [Safe navigation](#safe-navigation).

#### <a name="nv-up"></a>`nv.up()` or `nv.up(n)`

Can be called during validation only. Goes `n` levels up the tree of objects/arrays that the current value is nested in. If called as `nv.up()`, `n` is considered zero. Zero levels mean the method should get the immediate parent of the current value; one level gets the grandparent, etc. If the value is `n` or less levels deep in the tree, the method throws.

See [Regular navigation](#navigation) and [Safe navigation](#safe-navigation).

### Instance symbols

#### <a name="nv-other"></a>`nv.other`

If present anywhere inside a validation schema, must be a key of an object. The value of this key must be a function. The function will be used as a callback for validating any keys (and respective values) of the inspected object that are not explicitly defined in the schema. See [Shape validation](#shape).

#### <a name="nv-error"></a>`nv.error`

If present anywhere inside a validation schema, must be a key of an object. The value of this key must be truthy and cannot be a function. This value defined what will be returned as an error if the corresponding inspected value is not an object. See [Shape validation](#shape).

#### <a name="nv-end"></a>`nv.end`

If present anywhere inside a validation schema, must be an element of an array. At most two elements can follow this value in the array. If one of them is a function, it will be used as a callback for validating any values of the inspected array whose position in the array is after the last "regular" schema value or callback (that is, at position where `nv.end` is or further). If one of the values that follow `nv.end` in the schema is truthy and not a function, it will be returned as an error if the corresponding inspected value is not an array. See [Shape validation](#shape).

`nv.end` is interchangeable with an empty slot in an array literal: if you prefer, you can write `[3, 2, 1,, v => v !== 0]` instead of `[3, 2, 1, nv.end, v => v !== 0]` or `[, 'Value must be an array']` instead of `[nv.end, 'Value must be an array']`.

### Built-in instance matchers

Built-in matchers are simple functions that work as though they were added via [`addMatcher`](#nv-addMatcher). See the entry on this method for details about the inner workings of matchers.

Also see [Matchers](#matchers).

#### <a name="nv-number"></a>`nv.number(v)`

Returns `true` if `v` is of type `number` and is not `Infinity`, `-Infinity`, or `NaN`. Otherwise returns `false`.

#### <a name="nv-string"></a>`nv.string(v)`

Returns `true` if `v` is of type `string`. Otherwise returns `false`.

#### <a name="nv-boolean"></a>`nv.boolean(v)`

Returns `true` if `v` is of type `boolean` (that is, it’s either `true` or `false`). Otherwise returns `false`.

#### <a name="nv-null"></a>`nv.null(v)`

Returns `true` if `v` is `null`. Otherwise returns `false`.

#### <a name="nv-undefined"></a>`nv.undefined(v)`

Returns `true` if `v` is `undefined`. Otherwise returns `false`.

#### <a name="nv-defined"></a>`nv.defined(v)`

Returns `true` if `v` is not `undefined`. Otherwise returns `false`.

#### <a name="nv-bigint"></a>`nv.bigint(v)`

Returns `true` if `v` is of type `bigint`. Otherwise returns `false`.

#### <a name="nv-symbol"></a>`nv.symbol(v)`

Returns `true` if `v` is of type `symbol`. Otherwise returns `false`.

#### <a name="nv-function"></a>`nv.function(v)`

Returns `true` if `v` is a function. Otherwise returns `false`.

#### <a name="nv-array"></a>`nv.array(v)`

Returns `true` if `v` is an array. Otherwise returns `false`.

#### <a name="nv-object"></a>`nv.object(v)`

Returns `true` if `v` is a proper object (i.e., of type `object`, but not an array or function). Otherwise returns `false`.

#### <a name="nv-get"></a>`nv.get(v)`

Returns `v` itself. You can use it for [safe navigation](#safe-navigation) or call `nv.get()` as a non-safe alias for `nv.value()`.