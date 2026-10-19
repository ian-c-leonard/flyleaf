#!/usr/bin/env python3
"""Exercise original preservation, preview fidelity and cache invalidation."""
import json
import shutil
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from PIL import Image, ImageCms, ImageDraw
import sys
SCRIPTS = Path(__file__).resolve().parent.parent / 'scripts'
sys.path.insert(0, str(SCRIPTS))
import website_previews as previews


class PreviewTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name).resolve()
        self.stage = self.root / 'stage'
        (self.stage / 'images').mkdir(parents=True)
        (self.stage / 'family.ged').write_text('0 HEAD\n0 TRLR\n')

    def image(self, name, size=(1800, 900), colour='white', **kwargs):
        path = self.stage / 'images' / name
        with Image.new('RGB', size, colour) as image:
            image.save(path, **kwargs)
        return 'images/' + name

    def rebuild(self):
        previous = self.root / 'previous'
        if previous.exists():
            shutil.rmtree(previous)
        shutil.copytree(self.stage, previous)
        shutil.rmtree(self.stage / 'previews')
        return previous

    def test_full_frame_orientation_no_upscaling_and_original_bytes(self):
        path = self.stage / 'images' / 'rotated.jpg'
        with Image.new('RGB', (2400, 1200), 'white') as image:
            draw = ImageDraw.Draw(image)
            for box, colour in [((0, 0, 599, 599), 'red'), ((1800, 0, 2399, 599), 'green'),
                                ((0, 600, 599, 1199), 'blue'), ((1800, 600, 2399, 1199), 'yellow')]:
                draw.rectangle(box, fill=colour)
            exif = Image.Exif()
            exif[274] = 6
            image.save(path, quality=98, exif=exif)
        small = self.image('small.png', (91, 37))
        paths = ['images/rotated.jpg', small]
        originals = {rel: (self.stage / rel).read_bytes() for rel in paths}
        result = previews.build_previews(self.stage, paths)
        record = result['files'][paths[0]]
        self.assertEqual(record['sourceSize'], [2400, 1200])
        self.assertEqual(record['displayedSize'], [1200, 2400])
        for limit, size in [('640', (320, 640)), ('1600', (800, 1600))]:
            with Image.open(self.stage / record['variants'][limit]['path']) as image:
                self.assertEqual(image.size, size)
                self.assertEqual(image.getexif().get(274, 1), 1)
                # A clockwise rotation puts blue/red at the top, yellow/green
                # at the bottom. Sampling all four corners detects cropping.
                rgb = image.convert('RGB')
                for point, expected in [((8, 8), (0, 0, 255)), ((size[0]-9, 8), (255, 0, 0)),
                                        ((8, size[1]-9), (255, 255, 0)), ((size[0]-9, size[1]-9), (0, 128, 0))]:
                    self.assertLess(max(abs(a-b) for a, b in zip(rgb.getpixel(point), expected)), 18)
        for variant in result['files'][small]['variants'].values():
            self.assertEqual(variant['size'], [91, 37])
        self.assertEqual(originals, {rel: (self.stage / rel).read_bytes() for rel in paths})
        self.assertEqual(result['gedcomSha256'], previews.digest(self.stage / 'family.ged'))

    def test_palette_and_rgba_transparency_and_rgb_profile_survive(self):
        profile = ImageCms.ImageCmsProfile(ImageCms.createProfile('sRGB')).tobytes()
        path = self.stage / 'images/alpha.png'
        with Image.new('RGBA', (80, 40), (180, 30, 90, 64)) as image:
            image.save(path, icc_profile=profile)
        palette = self.stage / 'images/palette.gif'
        with Image.new('P', (80, 40), 0) as image:
            image.putpalette([255, 0, 0] + [0, 0, 0] * 255)
            image.save(palette, transparency=0)
        result = previews.build_previews(self.stage, ['images/alpha.png', 'images/palette.gif'])
        for rel, alpha in [('images/alpha.png', 64), ('images/palette.gif', 0)]:
            with Image.open(self.stage / result['files'][rel]['variants']['640']['path']) as image:
                self.assertEqual(image.convert('RGBA').getpixel((10, 10))[3], alpha)
                if rel.endswith('png'):
                    self.assertEqual(image.info['icc_profile'], profile)

    def test_cache_reuses_verified_bytes_and_deduplicates_identical_originals(self):
        first = self.image('first.jpg')
        second = 'images/second.jpg'
        shutil.copyfile(self.stage / first, self.stage / second)
        result = previews.build_previews(self.stage, [first, second])
        self.assertEqual(result['files'][first]['variants'], result['files'][second]['variants'])
        self.assertEqual(len(list((self.stage / 'previews').rglob('*.webp'))), 2)
        previous = self.rebuild()
        with patch.object(previews, 'browsing_image', side_effect=AssertionError('Cache unexpectedly decoded original')):
            self.assertEqual(previews.build_previews(self.stage, [first, second], previous), result)

    def test_changed_source_gets_new_preview_paths(self):
        rel = self.image('source.png', colour='red')
        first = previews.build_previews(self.stage, [rel])
        previous = self.rebuild()
        self.image('source.png', colour='blue')
        second = previews.build_previews(self.stage, [rel], previous)
        self.assertNotEqual(first['files'][rel]['variants']['640']['path'], second['files'][rel]['variants']['640']['path'])

    def test_corrupt_bytes_wrong_geometry_and_escaping_cache_are_rebuilt(self):
        rel = self.image('source.png')
        for damage in ['bytes', 'geometry', 'symlink']:
            with self.subTest(damage=damage):
                expected = previews.build_previews(self.stage, [rel])
                previous = self.rebuild()
                manifest = json.loads((previous / 'previews.json').read_text())
                variant = manifest['files'][rel]['variants']['640']
                cached = previous / variant['path']
                if damage == 'bytes':
                    cached.write_bytes(b'broken')
                elif damage == 'geometry':
                    with Image.new('RGB', (20, 20)) as image:
                        image.save(cached, format='WEBP')
                    variant.update(size=[20, 20], bytes=cached.stat().st_size, sha256=previews.digest(cached))
                    (previous / 'previews.json').write_text(json.dumps(manifest))
                else:
                    outside = self.root / 'outside.webp'
                    shutil.copyfile(cached, outside)
                    cached.unlink()
                    cached.symlink_to(outside)
                with patch.object(previews, 'browsing_image', wraps=previews.browsing_image) as decode:
                    self.assertEqual(previews.build_previews(self.stage, [rel], previous), expected)
                    self.assertEqual(decode.call_count, 1)

    def test_invalid_cache_metadata_is_ignored(self):
        rel = self.image('source.png', (50, 25))
        expected = previews.build_previews(self.stage, [rel])
        for corrupt in [[], {'recipe': previews.RECIPE, 'files': []},
                        {'recipe': previews.RECIPE, 'files': {rel: []}},
                        {'recipe': previews.RECIPE, 'files': {rel: {'sourceSha256': previews.digest(self.stage / rel), 'variants': []}}}]:
            previous = self.rebuild()
            (previous / 'previews.json').write_text(json.dumps(corrupt))
            self.assertEqual(previews.build_previews(self.stage, [rel], previous), expected)

    def test_multiframe_original_is_retained_and_preview_declares_first_frame(self):
        rel = 'images/pages.tiff'
        with Image.new('RGB', (60, 40), 'red') as first, Image.new('RGB', (60, 40), 'blue') as second:
            first.save(self.stage / rel, save_all=True, append_images=[second])
        original = (self.stage / rel).read_bytes()
        result = previews.build_previews(self.stage, [rel])
        self.assertEqual(result['recipe']['frame'], 'first')
        self.assertEqual(result['files'][rel]['frames'], 2)
        self.assertEqual((self.stage / rel).read_bytes(), original)

    def test_tiff_orientation_metadata_and_cache_match_the_displayed_frame(self):
        for orientation in range(1, 9):
            rel = f'images/tiff-{orientation}.tiff'
            with Image.new('RGB', (400, 200), 'red') as image:
                exif = Image.Exif()
                exif[274] = orientation
                image.save(self.stage / rel, exif=exif)
            result = previews.build_previews(self.stage, [rel])
            expected = [200, 400] if orientation >= 5 else [400, 200]
            self.assertEqual(result['files'][rel]['sourceSize'], [400, 200])
            self.assertEqual(result['files'][rel]['displayedSize'], expected)
            self.assertEqual(result['files'][rel]['variants']['640']['size'], expected)
            previous = self.rebuild()
            with patch.object(previews, 'browsing_image', side_effect=AssertionError('Valid TIFF cache was not reused')):
                self.assertEqual(previews.build_previews(self.stage, [rel], previous), result)

    def test_unsigned_sixteen_bit_document_tones_are_scaled_without_clipping(self):
        for extension in ['png', 'tiff']:
            rel = 'images/greyscale16.' + extension
            with Image.new('I;16', (500, 40)) as image:
                levels = [0, 16384, 32768, 49152, 65535]
                image.putdata([levels[x // 100] for _ in range(40) for x in range(500)])
                image.save(self.stage / rel)
            original = (self.stage / rel).read_bytes()
            result = previews.build_previews(self.stage, [rel])
            with Image.open(self.stage / result['files'][rel]['variants']['640']['path']) as image:
                for i, expected in enumerate([0, 64, 128, 191, 255]):
                    actual = image.convert('RGB').getpixel((50 + 100 * i, 20))[0]
                    self.assertLessEqual(abs(actual - expected), 2)
            self.assertEqual((self.stage / rel).read_bytes(), original)

    def test_undefined_numeric_ranges_require_a_deliberate_policy(self):
        for mode in ['I', 'F']:
            with Image.new(mode, (20, 10), 1000) as image:
                with self.assertRaisesRegex(ValueError, 'tonal-range policy'):
                    previews.browsing_image(image)

    def test_sixteen_bit_transparency_uses_original_levels_before_quantization(self):
        for transparent in [0, 16384, 32768, 65535]:
            rel = f'images/transparent-{transparent}.png'
            levels = [0, 16384, 16385, 32768, 65535]
            with Image.new('I;16', (500, 40)) as image:
                image.putdata([levels[x // 100] for _ in range(40) for x in range(500)])
                image.save(self.stage / rel, transparency=transparent)
            result = previews.build_previews(self.stage, [rel])
            with Image.open(self.stage / result['files'][rel]['variants']['640']['path']) as image:
                rgba = image.convert('RGBA')
                for i, level in enumerate(levels):
                    self.assertEqual(rgba.getpixel((50 + 100 * i, 20))[3], 0 if level == transparent else 255)

    def test_colour_conversion_uses_a_stable_output_profile_for_reproducible_bytes(self):
        rel = 'images/lab.tiff'
        profile = ImageCms.ImageCmsProfile(ImageCms.createProfile('LAB')).tobytes()
        with Image.new('LAB', (80, 40), (128, 128, 128)) as image:
            image.save(self.stage / rel, icc_profile=profile)
        with patch.object(ImageCms, 'createProfile', side_effect=AssertionError('Do not generate a timestamped output profile per build')):
            first = previews.build_previews(self.stage, [rel])
            self.rebuild()
            second = previews.build_previews(self.stage, [rel])
        self.assertEqual(first, second)
        with Image.open(self.stage / second['files'][rel]['variants']['640']['path']) as image:
            self.assertEqual(image.info['icc_profile'], previews.SRGB_PROFILE)


if __name__ == '__main__':
    unittest.main()
