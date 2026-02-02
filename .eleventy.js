module.exports = function (eleventyConfig) {
  // Existing slug filter (keep as-is)
  eleventyConfig.addFilter("slug", (value) => {
    return String(value || "")
      .toLowerCase()
      .trim()
      .replace(/['"]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
  });

  // -----------------------------------------------------------------------------
  // ImageKit helpers (CSV stores filenames only)
  // -----------------------------------------------------------------------------
  // Single source of truth for ImageKit base URL:
  // - local/dev fallback remains your current endpoint
  // - set IMAGEKIT_BASE_URL in Netlify (or local env) to change globally
  const IK_BASE = (process.env.IMAGEKIT_BASE_URL || "https://ik.imagekit.io/mevius").replace(/\/+$/, "");

  const IK_PASTA_BASE = `${IK_BASE}/pasta`;
  const IK_THUMBS = `${IK_PASTA_BASE}/thumbs/`;
  const IK_FULL = `${IK_PASTA_BASE}/full/`;

  // Pending placeholders (you will create these)
  const IK_PENDING_THUMB = `${IK_THUMBS}pending.png`;
  const IK_PENDING_PHOTO = `${IK_FULL}pending.jpg`;

  // Thumb URL from filename (or blank -> pending thumb)
  eleventyConfig.addFilter("pastaThumbUrl", (filename) => {
    const f = String(filename || "").trim();
    return f ? (IK_THUMBS + f) : IK_PENDING_THUMB;
  });

  // Photo URL from filename (or blank -> pending photo)
  eleventyConfig.addFilter("pastaPhotoUrl", (filename) => {
    const f = String(filename || "").trim();
    return f ? (IK_FULL + f) : IK_PENDING_PHOTO;
  });

  // Hero URL (prefer photo, else thumb, else pending *photo*)
  eleventyConfig.addFilter("pastaHeroUrl", (thumbFilename, photoFilename) => {
    const p = String(photoFilename || "").trim();
    if (p) return IK_FULL + p;

    const t = String(thumbFilename || "").trim();
    if (t) return IK_THUMBS + t;

    return IK_PENDING_PHOTO;
  });

  // -----------------------------------------------------------------------------
  // Favicons / icons (so layout.njk can stay variable-driven)
  // -----------------------------------------------------------------------------
  // Local favicon (in repo)
  eleventyConfig.addFilter("faviconUrl", () => "/favicon.ico");

  // Apple touch icon (served via ImageKit)
  // (Image path stays stable; ImageKit base can change via env var)
  eleventyConfig.addFilter("appleTouchIconUrl", (w = 180) => {
    const size = Number(w) || 180;
    return `${IK_PASTA_BASE}/favicon.png?tr=w-${size},f-png,q-50`;
  });

  // Passthrough copy: publish static JS and CSS files
  // src/js/* -> /js/*
  eleventyConfig.addPassthroughCopy({ "src/js": "js" });

  // src/css/* -> /css/*
  eleventyConfig.addPassthroughCopy({ "src/css": "css" });

  // OPTIONAL (only if your favicon.ico is in src/):
  // If your favicon.ico lives at src/favicon.ico, uncomment this so it ships to /favicon.ico
  // eleventyConfig.addPassthroughCopy({ "src/favicon.ico": "favicon.ico" });

  return {
    dir: {
      input: "src",
      output: "_site",
      includes: "_includes",
      data: "_data",
    },
  };
};
