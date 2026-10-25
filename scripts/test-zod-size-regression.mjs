import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = resolve(process.argv[2]);
const require = createRequire(import.meta.url);
const entries = ['index', 'v3/index', 'v4/index', 'v4/mini/index'];
let checks = 0;
for (const entry of entries) {
  for (const format of ['cjs', 'js']) {
    const file = join(root, `${entry}.${format}`);
    const z = format === 'cjs' ? require(file) : await import(pathToFileURL(file).href);
    const mini = entry.includes('mini');
    const maxArray = (element, size) => mini ? z.array(element).check(z.maxLength(size)) : z.array(element).max(size);
    const exactArray = (element, size) => mini ? z.array(element).check(z.length(size)) : z.array(element).length(size);
    const maxSet = (element, size) => mini ? z.set(element).check(z.maxSize(size)) : z.set(element).max(size);
    const safe = (schema, input) => mini ? z.safeParse(schema, input) : schema.safeParse(input);
    const asyncSafe = (schema, input) => mini ? z.safeParseAsync(schema, input) : schema.safeParseAsync(input);
    let parsed = 0;
    const element = mini ? z.string().check(z.refine(() => { parsed++; return true; }))
      : z.string().refine(() => { parsed++; return true; });
    for (const [schema, input] of [
      [maxArray(element, 2), ['a', 'b', 'c']],
      [exactArray(element, 2), ['a', 'b', 'c']],
      [maxSet(element, 2), new Set(['a', 'b', 'c'])],
      [maxArray(z.string(), 2), new Array(10_000).fill(1)],
    ]) {
      for (const run of [safe, asyncSafe]) {
        parsed = 0;
        const result = await run(schema, input);
        assert.equal(result.success, false, `${entry}/${format}: oversized input accepted`);
        assert.equal(result.error.issues.length, 1, 'Oversized input walked elements');
        assert.equal(result.error.issues[0].code, 'too_big');
        assert.equal(parsed, 0, 'Element refinement ran before upper bound rejection');
        checks++;
      }
    }
    const nested = safe(z.object({ items: maxArray(z.string(), 1) }), { items: [1, 2] });
    assert.deepEqual(nested.error.issues.map(issue => issue.path), [['items']]);
    assert.equal(safe(maxArray(z.string(), 1), 'wrong type').error.issues[0].code, 'invalid_type');
    assert.deepEqual(safe(maxArray(z.string(), 2), ['a', 'b']).data, ['a', 'b']);
    assert.equal(safe(exactArray(z.string(), 2), ['a']).error.issues[0].code, 'too_small');
    assert.equal(safe(maxArray(z.string(), 2), [1]).error.issues[0].code, 'invalid_type');
    assert.equal((await asyncSafe(maxArray(z.string(), 2), ['a'])).success, true);
    checks += 6;
    if (entry.startsWith('v4/')) {
      const map = z.map(z.string(), z.string());
      const capped = map.check(z.maxSize(1));
      for (const run of [safe, asyncSafe]) {
        const result = await run(capped, new Map([[1, 1], [2, 2]]));
        assert.equal(result.success, false);
        assert.deepEqual(result.error.issues.map(issue => issue.code), ['too_big']);
        checks++;
      }
    }
    // Overwrites may change size before a later bound; don't move that bound
    // ahead of the transform in the bundled v4 interpreter.
    if (entry === 'v4/index') {
      const transformed = z.array(z.number()).overwrite(values => values.slice(0, 1)).max(1);
      assert.deepEqual(transformed.parse([1, 2]), [1]);
      checks++;
    }
  }
}
console.log(`zod-size-regression: ${checks} passed, 0 failed, 0 skipped`);
