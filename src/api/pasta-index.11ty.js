// src/api/pasta-index.11ty.js
module.exports = class {
  data() {
    return {
      permalink: "/api/pasta-index.json",
      eleventyExcludeFromCollections: true,
    };
  }

  render(data) {
    // data.pastaIndex is provided by src/_data/pastaIndex.js
    return JSON.stringify(data.pastaIndex, null, 0);
  }
};
