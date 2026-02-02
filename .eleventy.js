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
  const IK_BASE = "https://ik.imagekit.io/mevius";
  const IK_THUMBS = `${IK_BASE}/pasta/thumbs/`;
  const IK_FULL = `${IK_BASE}/pasta/full/`;

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

  // Passthrough copy: publish static JS and CSS files
  // src/js/* -> /js/*
  eleventyConfig.addPassthroughCopy({ "src/js": "js" });

  // src/css/* -> /css/*
  eleventyConfig.addPassthroughCopy({ "src/css": "css" });

  return {
    dir: {
      input: "src",
      output: "_site",
      includes: "_includes",
      data: "_data",
    },
  };
};
