"""Full-frame browsing derivatives; held image bytes are never changed.

Called inside the exporter staging transaction. Cached derivatives are reusable
only for the same source bytes and recipe, after verifying their actual bytes.
"""
from pathlib import Path
import hashlib
import io
import json
import shutil

import PIL
from PIL import Image, ImageCms, ImageOps, features

IMAGE_SUFFIXES = {'.jpg', '.jpeg', '.png', '.webp', '.gif', '.tif', '.tiff'}
SRGB_PROFILE = (Path(__file__).parent / 'assets/preview-srgb.icc').read_bytes()
RECIPE = {'version': 1, 'pillow': PIL.__version__, 'webp': features.version('webp'),
          'littlecms': features.version('littlecms2'), 'sizes': [640, 1600],
          'srgbProfileSha256': hashlib.sha256(SRGB_PROFILE).hexdigest(),
          'quality': 82, 'method': 4, 'resampling': 'LANCZOS',
          'reducingGap': 3.0, 'rounding': 'nearest integer, minimum 1px',
          'orientation': 'EXIF transpose', 'frame': 'first', 'crop': 'none',
          'unsigned16': 'linear 0..65535 to 0..255; transparency mask before quantization; other numeric modes require explicit handling',
          'colour': 'retain RGB ICC; convert other profiled modes to sRGB'}
RECIPE_ID = hashlib.sha256(json.dumps(RECIPE, sort_keys=True).encode()).hexdigest()[:16]


def digest(path):
    h = hashlib.sha256()
    with Path(path).open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            h.update(block)
    return h.hexdigest()


def fit_size(size, limit):
    scale = min(1, limit / max(size))
    return [max(1, round(value * scale)) for value in size]


def cached_variant(previous, metadata, relative, expected_size):
    if not previous or not isinstance(metadata, dict) or metadata.get('path') != relative:
        return None
    path = previous / relative  # relative is calculated locally, not taken from metadata.
    if (not path.resolve().is_relative_to(previous.resolve())
            or any(part.is_symlink() for part in [path, *path.parents])
            or not path.is_file()):
        return None
    if path.stat().st_size != metadata.get('bytes') or digest(path) != metadata.get('sha256'):
        return None
    try:
        with Image.open(path) as image:
            if image.format != 'WEBP' or list(image.size) != metadata.get('size') or list(image.size) != expected_size:
                return None
    except (OSError, ValueError):
        return None
    return path


def browsing_image(original):
    image = ImageOps.exif_transpose(original)
    if image.mode.startswith('I;16'):
        # Direct RGB conversion clips document tones above 255. Preserve the
        # full unsigned 16-bit range in this 8-bit browsing representation.
        integer = image.convert('I')
        transparent = image.info.get('transparency')
        alpha = None
        if transparent is not None:
            if not isinstance(transparent, int) or not 0 <= transparent <= 65535:
                raise ValueError('Unsupported unsigned 16-bit transparency encoding')
            # Adjacent original tones can quantize to the same 8-bit value.
            # Construct the mask from their exact original values first.
            alpha = integer.point([0 if value == transparent else 255 for value in range(65536)], mode='L')
        scaled = integer.point(lambda value: value / 257 + 0.5)
        converted = scaled.convert('L')
        converted.info.pop('transparency', None)
        if alpha is not None:
            converted.putalpha(alpha)
            alpha.close()
        integer.close()
        scaled.close()
        image.close()
        image = converted
    elif image.mode in {'I', 'F'}:
        image.close()
        raise ValueError('A numeric image requires an explicit tonal-range policy before previewing')
    profile = image.info.get('icc_profile')
    if profile and image.mode not in {'RGB', 'RGBA'}:
        srgb = ImageCms.ImageCmsProfile(io.BytesIO(SRGB_PROFILE))
        alpha = image.convert('RGBA').getchannel('A') if image.mode in {'LA', 'PA'} or 'transparency' in image.info else None
        colour = image.getchannel('L') if image.mode == 'LA' else image.convert('RGB') if image.mode in {'P', 'PA'} else image
        converted = ImageCms.profileToProfile(colour, ImageCms.ImageCmsProfile(io.BytesIO(profile)), srgb, outputMode='RGB')
        if alpha is not None:
            converted.putalpha(alpha)
            alpha.close()
        if colour is not image:
            colour.close()
        image.close()
        image = converted
        profile = srgb.tobytes()
    elif image.mode not in {'RGB', 'RGBA'}:
        converted = image.convert('RGBA' if image.mode in {'LA', 'PA'} or 'transparency' in image.info else 'RGB')
        image.close()
        image = converted
    return image, profile


def build_previews(stage, assets, previous=None):
    stage, previous = Path(stage), Path(previous) if previous else None
    old = {}
    if previous and not (previous / 'previews.json').is_symlink() and (previous / 'previews.json').is_file():
        try:
            candidate = json.loads((previous / 'previews.json').read_text())
            if isinstance(candidate, dict) and candidate.get('recipe') == RECIPE and isinstance(candidate.get('files'), dict):
                old = candidate.get('files', {})
        except (OSError, ValueError):
            pass  # A damaged cache is rebuilt from the held images.
    result = {'schema': 1, 'recipe': RECIPE, 'gedcomSha256': digest(stage / 'family.ged'), 'files': {}}
    for relative in assets:
        if Path(relative).suffix.lower() not in IMAGE_SUFFIXES:
            continue
        source = stage / relative
        source_hash = digest(source)
        prior = old.get(relative, {})
        if not isinstance(prior, dict) or prior.get('sourceSha256') != source_hash:
            prior = {}
        with Image.open(source) as original:
            size = ([int(original.tag_v2[256]), int(original.tag_v2[257])]
                    if original.format == 'TIFF' else list(original.size))
            frames = getattr(original, 'n_frames', 1)
            if original.format == 'TIFF':
                # Pillow applies TIFF orientation while decoding and then
                # removes that tag. Do not apply its axis swap twice.
                original.load()
            orientation = original.getexif().get(274, 1)
            decoded_size = list(original.size)
            displayed_size = decoded_size[::-1] if orientation in {5, 6, 7, 8} else decoded_size
            record = {'sourceSha256': source_hash, 'sourceBytes': source.stat().st_size,
                      'sourceSize': size, 'displayedSize': displayed_size,
                      'frames': frames, 'variants': {}}
            image, profile = None, None
            for limit in RECIPE['sizes']:
                output_relative = f'previews/{RECIPE_ID}-{source_hash}/{limit}.webp'
                target = stage / output_relative
                target.parent.mkdir(parents=True, exist_ok=True)
                variants = prior.get('variants', {})
                prior_variant = variants.get(str(limit)) if isinstance(variants, dict) else None
                cached = cached_variant(previous, prior_variant, output_relative, fit_size(displayed_size, limit))
                if cached:
                    shutil.copyfile(cached, target)
                    variant_size = prior_variant['size']
                elif target.exists():
                    # Another source path can hold exactly the same original bytes.
                    with Image.open(target) as duplicate:
                        variant_size = list(duplicate.size)
                else:
                    if image is None:
                        image, profile = browsing_image(original)
                        if list(image.size) != displayed_size:
                            raise ValueError(f'Preview orientation metadata disagrees with decoded image: {relative}')
                    preview = image.resize(tuple(fit_size(image.size, limit)), Image.Resampling.LANCZOS,
                                           reducing_gap=RECIPE['reducingGap'])
                    preview.save(target, format='WEBP', quality=RECIPE['quality'], method=RECIPE['method'],
                                 **({'icc_profile': profile} if profile else {}))
                    variant_size = list(preview.size)
                    preview.close()
                record['variants'][str(limit)] = {'path': output_relative, 'size': variant_size,
                                                  'bytes': target.stat().st_size, 'sha256': digest(target)}
            if image is not None:
                image.close()
            result['files'][relative] = record
    (stage / 'previews.json').write_text(json.dumps(result, indent=2) + '\n')
    return result
