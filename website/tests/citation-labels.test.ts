import assert from 'node:assert/strict';
import test from 'node:test';
import { parseGedcom } from '../app/lib/gedcom.ts';
import { citationDisplayLabel } from '../app/lib/citation-labels.ts';
import { citationUseLabel } from '../app/lib/citation-uses.ts';

void test('a family-history display label leaves the recorded placement and evidence unchanged', () => {
  const data = parseGedcom(`0 HEAD
0 @I1@ INDI
1 REFN person-one
1 NAME Person /One/
1 NOTE Family history
2 SOUR @S1@
3 _KEY family-history-key
3 PAGE page 7
3 NOTE Exact original qualification
3 QUAY 2
0 @S1@ SOUR
1 TITL Original source title
1 NOTE Original source assessment
0 TRLR
`);
  const source = data.sources[0];
  const use = source.uses![0];
  const before = structuredClone({ source, use });
  assert.equal(citationUseLabel(use), 'Person One · General note reference');
  assert.equal(
    citationDisplayLabel(use, source.uses!, data.people),
    'Person One · Family history reference',
  );
  assert.deepEqual({ source, use }, before);

  use.placements[0].label = 'General note reference in a diary';
  assert.equal(
    citationDisplayLabel(use, source.uses!, data.people),
    'Person One · General note reference in a diary',
  );
});
