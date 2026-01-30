// src/api/pasta-features.11ty.js
module.exports = class {
  data() {
    return {
      permalink: "/api/pasta-features.json",
      eleventyExcludeFromCollections: true,
    };
  }

  render(data) {
    // data.pasta is your CSV array (from src/_data/pasta.csv)
    const rows = Array.isArray(data.pasta) ? data.pasta : [];

    // Only keep what we need for the identify flow
    const entries = rows
      .map((r) => {
        const name = r.ShapeName || r.name || "";
        const slug = r.Slug || r.slug || "";
        if (!name || !slug) return null;

        return {
          name,
          slug,
          url: `/pasta/${slug}/`,
          // Optional metadata for nicer display
          category: r.Category || "",
          description: r.Description || "",
          primaryGeometry: r.PrimaryGeometry || "",

          // Feature columns (from your updated CSV)
          type: r.Type || "",
          isHollow: r.IsHollow || "",
          isRidged: r.IsRidged || "",
          isTwisted: r.IsTwisted || "",
          isCurved: r.IsCurved || "",
          sizeClass: r.SizeClass || "",
          isStuffed: r.IsStuffed || "",
        };
      })
      .filter(Boolean);

    return JSON.stringify(
      {
        version: 1,
        generatedAt: new Date().toISOString(),
        count: entries.length,
        entries,
      },
      null,
      2
    );
  }
};
