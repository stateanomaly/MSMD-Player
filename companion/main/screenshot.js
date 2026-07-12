const { desktopCapturer, nativeImage, screen } = require("electron");

const MAX_LONG_EDGE = 1080;

function sizeForBounds(bounds) {
  const width = Math.max(1, Math.round(bounds?.width || 1280));
  const height = Math.max(1, Math.round(bounds?.height || 800));
  return { width, height };
}

function downscale(image) {
  if (!image || image.isEmpty()) {
    return image;
  }
  const size = image.getSize();
  const longEdge = Math.max(size.width, size.height);
  if (longEdge <= MAX_LONG_EDGE) {
    return image;
  }
  const scale = MAX_LONG_EDGE / longEdge;
  return image.resize({
    width: Math.max(1, Math.round(size.width * scale)),
    height: Math.max(1, Math.round(size.height * scale)),
    quality: "best",
  });
}

function blackRatio(image) {
  if (!image || image.isEmpty()) {
    return 1;
  }
  const bitmap = image.toBitmap();
  if (!bitmap.length) {
    return 1;
  }
  let dark = 0;
  let sampled = 0;
  const stride = Math.max(4, Math.floor(bitmap.length / 4000 / 4) * 4);
  for (let index = 0; index < bitmap.length; index += stride) {
    const b = bitmap[index];
    const g = bitmap[index + 1];
    const r = bitmap[index + 2];
    const a = bitmap[index + 3];
    if (a > 0) {
      sampled += 1;
      if (r < 8 && g < 8 && b < 8) {
        dark += 1;
      }
    }
  }
  return sampled ? dark / sampled : 1;
}

async function captureWindowSource(bounds) {
  const thumbnailSize = sizeForBounds(bounds);
  const sources = await desktopCapturer.getSources({
    types: ["window"],
    thumbnailSize,
    fetchWindowIcons: false,
  });
  const source = sources.find((candidate) => /blender/i.test(candidate.name));
  if (!source || source.thumbnail.isEmpty()) {
    return null;
  }
  return source.thumbnail;
}

async function captureScreenFallback(bounds) {
  const targetBounds = {
    x: Math.round(bounds?.x || 0),
    y: Math.round(bounds?.y || 0),
    ...sizeForBounds(bounds),
  };
  const display = screen.getDisplayMatching(targetBounds);
  const scaleFactor = display.scaleFactor || 1;
  const thumbnailSize = {
    width: Math.round(display.size.width * scaleFactor),
    height: Math.round(display.size.height * scaleFactor),
  };
  const sources = await desktopCapturer.getSources({
    types: ["screen"],
    thumbnailSize,
    fetchWindowIcons: false,
  });
  const source =
    sources.find((candidate) => String(candidate.display_id) === String(display.id)) || sources[0];
  if (!source || source.thumbnail.isEmpty()) {
    return null;
  }

  const crop = {
    x: Math.max(0, Math.round((targetBounds.x - display.bounds.x) * scaleFactor)),
    y: Math.max(0, Math.round((targetBounds.y - display.bounds.y) * scaleFactor)),
    width: Math.max(1, Math.round(targetBounds.width * scaleFactor)),
    height: Math.max(1, Math.round(targetBounds.height * scaleFactor)),
  };
  const fullSize = source.thumbnail.getSize();
  crop.width = Math.min(crop.width, Math.max(1, fullSize.width - crop.x));
  crop.height = Math.min(crop.height, Math.max(1, fullSize.height - crop.y));
  return source.thumbnail.crop(crop);
}

async function captureBlenderWindow(options = {}) {
  const logger = options.logger || console;
  const bounds = options.bounds || null;
  let image = await captureWindowSource(bounds);
  if (!image) {
    image = await captureScreenFallback(bounds);
  }
  if (!image || image.isEmpty()) {
    throw new Error("Unable to capture Blender window or screen fallback");
  }

  const ratio = blackRatio(image);
  if (ratio > 0.98) {
    logger.warn?.("Captured screenshot appears black; Screen Recording permission may be missing.");
  }

  return downscale(image).toPNG();
}

async function probeScreenPermission() {
  try {
    const sources = await desktopCapturer.getSources({
      types: ["screen"],
      thumbnailSize: { width: 320, height: 200 },
      fetchWindowIcons: false,
    });
    const source = sources[0];
    if (!source || source.thumbnail.isEmpty()) {
      return { ok: false, blackFrame: true };
    }
    const ratio = blackRatio(source.thumbnail);
    return { ok: ratio <= 0.98, blackFrame: ratio > 0.98 };
  } catch (error) {
    return { ok: false, blackFrame: false, error };
  }
}

module.exports = {
  captureBlenderWindow,
  probeScreenPermission,
};
