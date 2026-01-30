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

  // Passthrough copy: publish static JS files
  // src/js/pasta-search.js -> /js/pasta-search.js
  eleventyConfig.addPassthroughCopy({ "src/js": "js" });

  return {
    dir: {
      input: "src",
      output: "_site",
      includes: "_includes",
      data: "_data",
    },
  };
};
