import assert from 'node:assert/strict';
import test from 'node:test';
import { validCitationPresentation, presentationsForNote, preferredCitationPdfPage } from '../app/lib/citation-presentation.ts';
import type { BookCitation } from '../app/lib/native-book.ts';
import { citationDocuments, readWebBookBody, type WebBook, type WebBookBody } from '../app/lib/native-book.ts';
import { parseGedcom } from '../app/lib/gedcom.ts';
import { readFileSync } from 'node:fs';

const album = 'images/documents/joan-penhallow/kitchen-songs/';
const data = parseGedcom(`0 HEAD
0 @I1@ INDI
1 REFN joan-treloar
1 NAME Joan /Treloar/
1 SOUR @SRC_JOAN_ALBUM@
2 PAGE original front cover, inner tray credits and dedication; two complete recordings
2 _KEY joan-penhallow-kitchen-songs
0 @I2@ INDI
1 REFN tamsin-penhallow
1 NAME Tamsin /Penhallow/
1 GRAD
2 SOUR @SRC_PROGRAMME@
3 PAGE Commencement programme, graduates' list
3 _KEY tamsin-commencement-2012
0 @SRC_JOAN_ALBUM@ SOUR
1 TITL Joan Penhallow, Kitchen Songs
1 OBJE
2 FILE ${album}artwork/front-cover.png
1 OBJE
2 FILE ${album}artwork/dedication.png
1 OBJE
2 FILE ${album}listening/01.mp3
0 @SRC_PROGRAMME@ SOUR
1 TITL Commencement programme
1 OBJE
2 FILE images/documents/2012-commencement-programme.pdf
0 TRLR`);
const citation: BookCitation = { person:'joan-treloar', key:'joan-penhallow-kitchen-songs',
  sourcePointer:'@SRC_JOAN_ALBUM@', legacyNotes:[], label:'Album', url:'',
  locators:['original front cover, inner tray credits and dedication; two complete recordings'],
  files:[album+'artwork/dedication.png'] };
const entry = {person:citation.person,key:citation.key,contextSha256:'a'.repeat(64),title:'Joan Penhallow, Kitchen Songs',context:'The dedication names her grandson Jory.',qualifications:['The artwork is dated 1995; no separate release date has been established.'],preferredFile:citation.files[0]};

void test('an explicit physical PDF page requires its exact reviewed PDF file',()=>{
 const pdfCitation={...citation,files:['images/complete-programme.pdf']};
 const pdfEntry={...entry,preferredFile:pdfCitation.files[0],preferredPdfPage:65};
 assert.ok(validCitationPresentation([pdfEntry],[pdfCitation]));
 for(const page of [0,-1,1.5,true,'65',null,NaN,Infinity,Number.MAX_SAFE_INTEGER+1]) assert.equal(validCitationPresentation([{...pdfEntry,preferredPdfPage:page}],[pdfCitation]),false);
 assert.equal(validCitationPresentation([{...pdfEntry,preferredFile:undefined}],[pdfCitation]),false);
 assert.equal(validCitationPresentation([{...entry,preferredPdfPage:65}],[citation]),false);
 assert.equal(validCitationPresentation([{...pdfEntry,preferredFile:'images/uncited.pdf'}],[pdfCitation]),false);
});

void test('a citation use selects only its reviewed physical PDF page',()=>{
 const person='tamsin-penhallow',key='tamsin-commencement-2012',page=38;
 const actual:BookCitation={person,key,sourcePointer:'@SRC_PROGRAMME@',legacyNotes:[],label:'Programme',url:'',locators:["Commencement programme, graduates' list"],files:['images/documents/2012-commencement-programme.pdf']};
 const selected=citationDocuments(data,actual)[0];
 assert.ok(selected.selectedUse);
 const reviewed={...entry,person,key,preferredFile:actual.files[0],preferredPdfPage:page};
 const path=actual.files[0];
 assert.equal(preferredCitationPdfPage(selected,path,[reviewed]),page);
 assert.equal(preferredCitationPdfPage({...selected,selectedUse:undefined},path,[reviewed]),undefined);
 assert.equal(preferredCitationPdfPage({...selected,unavailableUse:true},path,[reviewed]),undefined);
 assert.equal(preferredCitationPdfPage({...selected,context:'attachment'},path,[reviewed]),undefined);
 assert.equal(preferredCitationPdfPage({...selected,sourceIds:[]},path,[reviewed]),undefined);
 assert.equal(preferredCitationPdfPage({...selected,citationFilePaths:[]},path,[reviewed]),undefined);
 assert.equal(preferredCitationPdfPage({...selected,archives:[]},path,[reviewed]),undefined);
 assert.equal(preferredCitationPdfPage(selected,'images/other.pdf',[reviewed]),undefined);
 assert.equal(preferredCitationPdfPage(selected,path,[{...reviewed,key:'other-use'}]),undefined);
 assert.equal(preferredCitationPdfPage(selected,path,[{...reviewed,person:'other-person'}]),undefined);
 assert.equal(preferredCitationPdfPage(selected,path,[{...reviewed,preferredPdfPage:0}]),undefined);
 assert.equal(preferredCitationPdfPage(selected,path,[reviewed,reviewed]),undefined);
 assert.equal(preferredCitationPdfPage({...selected,selectedUse:{...selected.selectedUse!,owner:{...selected.selectedUse!.owner,people:[person,'other-person']}}},path,[reviewed,{...reviewed,person:'other-person'}]),undefined);
});

void test('display metadata keeps every citation use and meaningful qualification bound',()=>{
 assert.ok(validCitationPresentation([entry],[citation]));
 assert.deepEqual(presentationsForNote([citation,citation],[entry]),[entry]);
 assert.deepEqual(presentationsForNote([citation,{person:'tamsin-penhallow',key:'other'}],[entry]),[]);
 for(const bad of [{...entry,person:'unknown'},{...entry,preferredFile:'images/uncited.png'}, {...entry,title:'private@example.org'}, {...entry,qualifications:['private@example.org']}]) assert.equal(validCitationPresentation([bad],[citation]),false);
 assert.equal(validCitationPresentation([entry,entry],[citation]),false);
});
void test('a reviewed album citation opens dedication while preserving the full source bundle',()=>{
 const before=citationDocuments(data,citation);
 assert.notEqual(before[0].archives[0].path,entry.preferredFile);
 const selected=citationDocuments(data,citation,entry.preferredFile);
 assert.ok(selected.length);
 assert.equal(selected[0].archives[0].path,entry.preferredFile);
 assert.deepEqual(new Set(selected[0].archives.map(f=>f.path)),new Set(before[0].archives.map(f=>f.path)));
 assert.equal(selected[0].selectedUse?.id,before[0].selectedUse?.id);
 assert.deepEqual(citationDocuments(data,citation,'images/uncited.png'),before);
});

void test('full Book descriptor and body must carry the same reviewed presentation',async()=>{
 const raw = readFileSync(new URL('../public/data/book.json', import.meta.url),'utf8');
 const web=(JSON.parse(raw) as {webBook:WebBook}).webBook;
 const original=readFileSync(new URL('../public/data/'+web.path,import.meta.url));
 const body=JSON.parse(original.toString()) as WebBookBody;
 const encoded=new TextEncoder().encode(JSON.stringify(body));
 const fingerprint=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',encoded))).map(b=>b.toString(16).padStart(2,'0')).join('');
 const fixture={...web,sha256:fingerprint,bytes:encoded.byteLength};
 const different=body.citationPresentation?.length?[]:[entry];
 await assert.rejects(readWebBookBody(encoded.buffer,{...fixture,citationPresentation:different}));
 const matched=await readWebBookBody(encoded.buffer,fixture);
 assert.deepEqual(matched.citationPresentation,body.citationPresentation);
});
