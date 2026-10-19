#!/usr/bin/env python3
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
import sys
SCRIPTS = Path(__file__).resolve().parent.parent / 'scripts'
sys.path.insert(0, str(SCRIPTS))
MODULE=SCRIPTS.joinpath('compose-website.py')
spec=importlib.util.spec_from_file_location('compose',MODULE)
composer=importlib.util.module_from_spec(spec)
spec.loader.exec_module(composer)
PERSON='0 @I1@ INDI\n1 NAME A /Person/\n1 BIRT\n2 DATE ABT 1900\n'
NATIVE='0 HEAD\n1 CHAR UTF-8\n'+PERSON+'0 TRLR\n'
HEAD='0 HEAD\n1 _ATLAS\n2 _ROOT @I1@\n'
PATCH='0 @I1@ INDI\n1 _BASE_HASH '+hashlib.sha256(PERSON.encode()).hexdigest()+'\n'
class CompositionTests(unittest.TestCase):
 def test_current_facts_survive_with_presentation_appended(self):
  result=composer.compose(NATIVE,HEAD+PATCH+'1 _NARRATIVE A reviewed account.\n0 TRLR\n')
  self.assertIn(PERSON,result)
  self.assertIn('1 _NARRATIVE A reviewed account.',result)
  self.assertNotIn('_BASE_HASH',result)
 def test_changed_native_record_requires_review(self):
  with self.assertRaisesRegex(ValueError,'@I1@ changed in the tree.*flyleaf repin'):
   composer.compose(NATIVE.replace('ABT 1900','1901'),HEAD+PATCH+'0 TRLR\n')
 def test_no_facts_may_be_smuggled_under_review_hash(self):
  for tail in ['2 DATE 1800\n','2 BIRT\n3 DATE 1800\n','1 BIRT\n2 DATE 1800\n','1 OBJE\n2 BIRT\n3 DATE 1800\n']:
   with self.subTest(tail=tail),self.assertRaises(ValueError):composer.compose(NATIVE,HEAD+PATCH+tail+'0 TRLR\n')
 def test_root_is_required_in_its_exact_header_subtree(self):
  for head in ['0 HEAD\n1 _ARCHIVE_CATALOG\n2 _ROOT @I1@\n','0 HEAD\n1 _ATLAS\n','0 HEAD\n1 _ATLAS\n2 _ROOT @I1@\n2 _ROOT @I1@\n']:
   with self.subTest(head=head),self.assertRaises(ValueError):composer.compose(NATIVE,head+'0 TRLR\n')
 def test_unknown_references_and_old_record_overwrites_fail(self):
  for extra in ['0 @I2@ INDI\n1 NAME Lost /Person/\n','0 @I1@ OBJE\n1 FILE images/a.jpg\n','0 @W@ _CHAP\n1 _PERSON @MISSING@\n']:
   with self.subTest(extra=extra),self.assertRaises(ValueError):composer.compose(NATIVE,HEAD+extra+'0 TRLR\n')
 def test_bad_levels_do_not_attach_content_to_native_record(self):
  with self.assertRaisesRegex(ValueError,'hierarchy'):
   composer.compose(NATIVE,HEAD+PATCH+'3 CONT orphan\n0 TRLR\n')
 def test_research_associations_cannot_become_narrative_citations(self):
  source='0 @WEB_R@ SOUR\n1 TITL Research catalogue\n1 _STATUS research-only\n1 _PERSON @I1@\n'
  accepted=composer.compose(NATIVE,HEAD+'1 _ARCHIVE_CATALOG\n2 SOUR @WEB_R@\n'+source+'0 TRLR\n')
  self.assertIn('1 _STATUS research-only',accepted)
  with self.assertRaisesRegex(ValueError,'cannot serve as factual or narrative'):
   composer.compose(NATIVE,HEAD+PATCH+'1 _NARRATIVE An unadopted claim.\n2 SOUR @WEB_R@\n'+source+'0 TRLR\n')
 def test_the_build_names_the_command_that_fixes_a_changed_record(self):
  with tempfile.TemporaryDirectory() as tmp:
   family=Path(tmp)
   (family/'flyleaf.json').write_text(json.dumps({'paths':{'source_gedcom':'tree.ged','site_content':'site'}}))
   (family/'tree.ged').write_text(NATIVE.replace('ABT 1900','1901'))
   (family/'site').mkdir()
   (family/'site/edition.ged').write_text(HEAD+PATCH+'0 TRLR\n')
   run=subprocess.run([sys.executable,str(MODULE),'--output',str(family/'work/current.ged')],cwd=family,
                      env={**os.environ,'FLYLEAF_FAMILY':str(family)},capture_output=True,text=True)
   self.assertEqual(run.returncode,1,run.stderr)
   self.assertNotIn('Traceback',run.stderr)
   self.assertEqual([line for line in run.stderr.splitlines() if line.strip()],
                    ["The site build stopped. @I1@ changed in the tree after the site's additions to it were "
                     "checked. Look over its entry in the site's edition.ged, then run: flyleaf repin"])
if __name__=='__main__':unittest.main(verbosity=2)
