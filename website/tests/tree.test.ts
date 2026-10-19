import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { parseGedcom } from '../app/lib/gedcom.ts';

const data = parseGedcom(`0 HEAD
0 @C@ INDI
1 NAME Child /Test/
0 @A@ INDI
1 NAME Parent A /Test/
0 @B@ INDI
1 NAME Parent B /Test/
0 @G@ INDI
1 NAME Shared grandparent /Test/
0 @F1@ FAM
1 HUSB @A@
1 WIFE @B@
1 CHIL @C@
0 @F2@ FAM
1 HUSB @G@
1 CHIL @A@
0 @F3@ FAM
1 HUSB @G@
1 CHIL @B@
0 TRLR`);
async function layout() {
  assert.ok(
    existsSync(new URL('../app/lib/tree.ts', import.meta.url)),
    'Tree layout not implemented',
  );
  return import('../app/lib/tree.ts');
}
void test('pedigree collapse renders a shared ancestor once and retains both parent links', async () => {
  const { familyLayout } = await layout();
  const result = familyLayout(data, 'C', 'ancestors', 3);
  assert.equal(result.nodes.length, 4);
  assert.equal(result.nodes.filter((n) => n.id === 'G').length, 1);
  assert.ok(result.links.some((l) => l.from === 'G' && l.to === 'A'));
  assert.ok(result.links.some((l) => l.from === 'G' && l.to === 'B'));
});
void test('generation limits and descendant direction change the visible relationships', async () => {
  const { familyLayout } = await layout();
  assert.equal(familyLayout(data, 'C', 'ancestors', 1).nodes.length, 3);
  assert.deepEqual(
    new Set(familyLayout(data, 'G', 'descendants', 2).nodes.map((n) => n.id)),
    new Set(['G', 'A', 'B', 'C']),
  );
  assert.equal(familyLayout(data, 'missing', 'ancestors', 3).nodes.length, 0);
});
void test('cycles terminate and all positions remain finite', async () => {
  const { familyLayout } = await layout();
  const cyclic = structuredClone(data);
  cyclic.people.find((p) => p.id === 'G')!.parents = ['C'];
  const result = familyLayout(cyclic, 'C', 'ancestors', 8);
  assert.equal(result.nodes.length, 4);
  assert.ok(
    result.nodes.every((n) => Number.isFinite(n.x) && Number.isFinite(n.y)),
  );
});

// An invented family: Tamsin with her parents, brother, grandparents, aunt,
// uncle, cousins and several partners, plus a great-grandfather.
const relatives = parseGedcom(`0 HEAD
1 _ATLAS
2 _ROOT @TAMSIN@
0 @TAMSIN@ INDI
1 REFN tamsin
1 NAME Tamsin /Penhallow/
1 SEX F
0 @JORY@ INDI
1 REFN jory
1 NAME Jory /Penhallow/
1 SEX M
0 @DAVID@ INDI
1 REFN david
1 NAME David /Penhallow/
1 SEX M
0 @KARIN@ INDI
1 REFN karin
1 NAME Karin /Solberg/
1 SEX F
0 @RUTH@ INDI
1 REFN ruth
1 NAME Ruth /Vogel/
1 SEX F
0 @SUSAN@ INDI
1 REFN susan
1 NAME Susan /Dahl/
1 SEX F
0 @ROBERT@ INDI
1 REFN robert
1 NAME Robert /Penhallow/
1 SEX M
0 @JOAN@ INDI
1 REFN joan
1 NAME Joan /Treloar/
1 SEX F
0 @MARGARET@ INDI
1 REFN margaret
1 NAME Margaret /Hale/
1 SEX F
0 @WILLIAM@ INDI
1 REFN william
1 NAME William /Penhallow/
1 SEX M
0 @CAROL@ INDI
1 REFN carol
1 NAME Carol /Penhallow/
1 SEX F
0 @WALTER@ INDI
1 REFN walter
1 NAME Walter /Kessler/
1 SEX M
0 @PAUL@ INDI
1 REFN paul
1 NAME Paul /Kessler/
1 SEX M
0 @ANNA@ INDI
1 REFN anna
1 NAME Anna /Kessler/
1 SEX F
0 @LISA@ INDI
1 REFN lisa
1 NAME Lisa /Kessler/
1 SEX F
0 @ERIK@ INDI
1 REFN erik
1 NAME Erik /Solberg/
1 SEX M
0 @HOME@ FAM
1 HUSB @DAVID@
1 WIFE @KARIN@
1 CHIL @TAMSIN@
1 CHIL @JORY@
0 @DAVID_RUTH@ FAM
1 HUSB @DAVID@
1 WIFE @RUTH@
0 @JORY_SUSAN@ FAM
1 HUSB @JORY@
1 WIFE @SUSAN@
0 @PENHALLOW@ FAM
1 HUSB @ROBERT@
1 WIFE @JOAN@
1 CHIL @DAVID@
1 CHIL @CAROL@
0 @ROBERT_MARGARET@ FAM
1 HUSB @ROBERT@
1 WIFE @MARGARET@
0 @EARLIER@ FAM
1 HUSB @WILLIAM@
1 CHIL @ROBERT@
0 @KESSLER@ FAM
1 HUSB @WALTER@
1 WIFE @CAROL@
1 CHIL @PAUL@
1 CHIL @ANNA@
1 CHIL @LISA@
0 @SOLBERG@ FAM
1 CHIL @KARIN@
1 CHIL @ERIK@
0 TRLR`);

void test('the cousins circle includes recorded nearby relatives and their partners', async () => {
  const { familyLayout } = await layout();
  const result = familyLayout(relatives, 'tamsin', 'family', 2);
  const ids = new Set(result.nodes.map((node) => node.id));
  for (const id of [
    'david',
    'karin',
    'robert',
    'joan',
    'carol',
    'walter',
    'paul',
    'anna',
    'lisa',
    'erik',
    'ruth',
    'susan',
    'margaret',
  ])
    assert.ok(ids.has(id), id);
  assert.ok(
    !ids.has('william'),
    'The default circle is not an unbounded pedigree',
  );
  assert.equal(ids.size, result.nodes.length);
  for (const link of result.links) {
    const target = relatives.people.find((person) => person.id === link.to)!;
    assert.ok(
      (link.kind === 'parent' ? target.parents : target.partners).includes(
        link.from,
      ),
    );
  }
  assert.ok(
    result.links.some(
      (link) =>
        link.kind === 'partner' &&
        [link.from, link.to].includes('david') &&
        [link.from, link.to].includes('ruth'),
    ),
  );
  assert.ok(
    !result.links.some(
      (link) =>
        [link.from, link.to].includes('tamsin') &&
        [link.from, link.to].includes('jory'),
    ),
    'Siblings are not represented as partners',
  );
});

void test('the immediate circle stays bounded and a grandparent can reach grandchildren', async () => {
  const { familyLayout } = await layout();
  const ids = new Set(
    familyLayout(relatives, 'tamsin', 'family', 1).nodes.map((node) => node.id),
  );
  assert.ok(ids.has('ruth'));
  assert.ok(ids.has('susan'));
  assert.ok(!ids.has('paul'));
  assert.ok(!ids.has('joan'));
  const grandparent = familyLayout(relatives, 'joan', 'family', 2);
  for (const id of ['carol', 'tamsin', 'paul', 'anna', 'lisa'])
    assert.ok(
      grandparent.nodes.some((node) => node.id === id),
      id,
    );
});

void test('adding a recorded partner does not import that partner’s separate families', async () => {
  const { familyLayout } = await layout();
  const family = parseGedcom(`0 HEAD
0 @C@ INDI
1 NAME Child /Family/
0 @P@ INDI
1 NAME Parent /Family/
0 @S@ INDI
1 NAME Parent’s partner /Other/
0 @G@ INDI
1 NAME Partner’s parent /Other/
0 @X@ INDI
1 NAME Separate child /Other/
0 @Y@ INDI
1 NAME Separate partner /Other/
0 @F@ FAM
1 HUSB @P@
1 CHIL @C@
0 @F2@ FAM
1 HUSB @P@
1 WIFE @S@
0 @F3@ FAM
1 WIFE @G@
1 CHIL @S@
0 @F4@ FAM
1 HUSB @Y@
1 WIFE @S@
1 CHIL @X@
0 TRLR`);
  assert.deepEqual(
    new Set(
      familyLayout(family, 'C', 'family', 2).nodes.map((node) => node.id),
    ),
    new Set(['C', 'P', 'S']),
  );
});

void test('the family list uses source family groups and their recorded events', async () => {
  const { familyLayout, familyGroups } = await layout();
  const nodes = familyLayout(relatives, 'tamsin', 'family', 2).nodes;
  const groups = familyGroups(
    relatives,
    nodes.map((node) => node.id),
    'tamsin',
  );
  const kessler = groups.find((group) =>
    group.children.some((person) => person.id === 'paul'),
  )!;
  assert.ok(kessler);
  assert.equal(kessler.title, 'Carol and Walter');
  assert.equal(kessler.context, 'Aunt’s family');
  assert.deepEqual(
    new Set(kessler.children.map((person) => person.id)),
    new Set(['paul', 'anna', 'lisa']),
  );
  for (const group of groups) {
    const source = relatives.families.find((record) => record.id === group.id)!;
    assert.ok(source);
    assert.ok(
      group.parents.every((person) => source.parents.includes(person.id)),
    );
    assert.ok(
      group.children.every((person) => source.children.includes(person.id)),
    );
    assert.deepEqual(group.events, source.events);
  }
});

void test('close-family layouts terminate with collapsed and cyclic pedigrees', async () => {
  const { familyLayout } = await layout();
  const cyclic = structuredClone(data);
  cyclic.people.find((person) => person.id === 'G')!.parents = ['C'];
  for (const depth of [1, 2, 8]) {
    const result = familyLayout(cyclic, 'C', 'family', depth);
    assert.equal(
      result.nodes.length,
      new Set(result.nodes.map((node) => node.id)).size,
    );
    assert.ok(
      result.nodes.every(
        (node) => Number.isFinite(node.x) && Number.isFinite(node.y),
      ),
    );
  }
});

void test('siblings recorded in different parental unions remain visible without importing unrelated parents', async () => {
  const { familyLayout, familyGroups } = await layout();
  const family = parseGedcom(`0 HEAD
0 @FOCUS@ INDI
1 NAME First /Child/
0 @SIBLING@ INDI
1 NAME Second /Child/
0 @PARENT@ INDI
1 NAME Shared /Parent/
0 @OTHER_PARENT@ INDI
1 NAME Other /Parent/
0 @UNRELATED@ INDI
1 NAME Separate /Grandparent/
0 @F1@ FAM
1 HUSB @PARENT@
1 CHIL @FOCUS@
0 @F2@ FAM
1 HUSB @PARENT@
1 WIFE @OTHER_PARENT@
1 CHIL @SIBLING@
0 @F3@ FAM
1 HUSB @UNRELATED@
1 CHIL @OTHER_PARENT@
0 TRLR`);
  const result = familyLayout(family, 'FOCUS', 'family', 1);
  assert.deepEqual(
    new Set(result.nodes.map((node) => node.id)),
    new Set(['FOCUS', 'SIBLING', 'PARENT', 'OTHER_PARENT']),
  );
  const own = familyGroups(
    family,
    result.nodes.map((node) => node.id),
    'PARENT',
  ).find((group) => group.children.some((person) => person.id === 'FOCUS'))!;
  assert.equal(own.context, 'Children');
  for (const first of result.nodes)
    for (const second of result.nodes)
      if (first.id !== second.id)
        assert.ok(
          Math.abs(first.x - second.x) >= 248 ||
            Math.abs(first.y - second.y) >= 112,
        );
});
