# Preview colour profile

`preview-srgb.icc` is a standard sRGB output profile generated with Pillow's
`ImageCms.createProfile('sRGB')` and LittleCMS. It is committed so repeat builds
use the same profile bytes instead of embedding a new profile creation time.
Its SHA-256 is part of the preview recipe. It is a build resource, not a
genealogical source or a copy of a licensed system profile.
