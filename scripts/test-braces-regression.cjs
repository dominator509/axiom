const assert = require('node:assert/strict');
const test = require('node:test');
const { runInNewContext } = require('node:vm');
const braces = require(process.argv[2]);
const nested = (n, open = '{', close = '}') => open.repeat(n) + 'a' + close.repeat(n);
for (const method of ['parse', 'compile', 'expand', 'stringify']) {
  for (const [open, close] of [
    ['{', '}'],
    ['(', ')'],
  ]) {
    test(`${method}: ${open} depth 100 accepted`, () =>
      assert.doesNotThrow(() => braces[method](nested(100, open, close))));
    test(`${method}: ${open} depth 101 rejected deliberately`, () =>
      assert.throws(() => braces[method](nested(101, open, close)), /exceeds max depth/));
    test(`${method}: ${open} 4500 depth rejected before stack exhaustion`, () =>
      assert.throws(() => braces[method](nested(4500, open, close)), /exceeds max depth/));
  }
  test(`${method}: caller cannot increase ceiling`, () =>
    assert.throws(() => braces[method](nested(101), { maxDepth: Infinity }), /exceeds max depth/));
  test(`${method}: fractional lower limit`, () =>
    assert.throws(() => braces[method](nested(2), { maxDepth: 1.5 }), /exceeds max depth/));
}
for (const method of ['compile', 'expand', 'stringify']) {
  test(`${method}: direct AST bypass blocked`, () => {
    let ast = { type: 'text', value: 'a' };
    for (let i = 0; i < 101; i++) ast = { type: 'brace', nodes: [ast] };
    assert.throws(() => braces[method]({ type: 'root', nodes: [ast] }), /exceeds max depth/);
  });
}
test('parent cycle rejected promptly', () => {
  const ast = { type: 'paren', nodes: [{ type: 'text', value: 'a' }] };
  ast.parent = ast;
  assert.throws(
    () => runInNewContext('braces.expand(ast)', { braces, ast }, { timeout: 1000 }),
    /parent chain contains a cycle/,
  );
});
test('ordinary expansion compatible', () =>
  assert.deepEqual(braces.expand('foo/({a,b})/{1..3}'), [
    'foo/(a)/1',
    'foo/(a)/2',
    'foo/(a)/3',
    'foo/(b)/1',
    'foo/(b)/2',
    'foo/(b)/3',
  ]));
test('ordinary compilation compatible', () =>
  assert.equal(braces.compile('foo/{a,b}/bar'), 'foo/(a|b)/bar'));
test('escapeInvalid compatibility', () => {
  for (const pattern of ['{{a}}', '{a,{b}}', '{{x}y}', '{a,{b,{c}}', '{}{a}'])
    assert.equal(braces.stringify(braces.parse(pattern), { escapeInvalid: true }), pattern);
});
