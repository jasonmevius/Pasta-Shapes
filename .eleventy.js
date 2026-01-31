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
